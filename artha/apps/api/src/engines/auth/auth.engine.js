'use strict';

const { createContextLogger }  = require('@artha/logger');
const { withTransaction }      = require('@artha/database');
const companyRepository        = require('@artha/database').companyRepository;
const userRepository           = require('@artha/database').userRepository;
const auditRepository          = require('@artha/database').auditRepository;
const { hashPassword, verifyPassword } = require('./password.service');
const { issueTokenPair, refreshAccessToken } = require('./token.service');
const {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} = require('@artha/errors');

/**
 * ARTHA Auth Engine
 *
 * Handles all authentication and identity operations.
 * Pure business logic — no Express dependency.
 * Receives typed inputs, returns typed outputs.
 * Can be called from HTTP handlers OR queue workers.
 *
 * Operations:
 *   register()  — create company + owner user atomically
 *   login()     — verify credentials, issue token pair
 *   refresh()   — issue new access token from refresh token
 *   getMe()     — load current user + company profile
 *
 * Multi-tenant rules:
 *   - Company created first, user scoped under company_id
 *   - login() requires companyId — prevents cross-tenant email collisions
 *   - All DB writes inside withTransaction() — atomic or rollback
 *   - Audit log written for every auth event (silent — never crashes tx)
 *
 * Integration points (Day 1):
 *   - companyRepository — create, findById
 *   - userRepository    — create, findByEmail, touchLastSeen
 *   - auditRepository   — writeSilent for all auth events
 *   - withTransaction   — atomic company + user creation
 *
 * Integration points (Day 3+):
 *   - ledger.engine.js  — seed chart of accounts on company registration
 *   - session package   — bind WhatsApp session after login (Day 5)
 */

/**
 * Register a new company and owner user.
 * Atomic — both created in single transaction or neither.
 * Returns token pair immediately — user is logged in on registration.
 *
 * @param {object} params
 * @param {string} params.companyName
 * @param {string} [params.gstin]
 * @param {string} [params.pan]
 * @param {string} [params.businessType]
 * @param {string} [params.companyPhone]
 * @param {string} params.ownerName
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} traceId
 * @returns {Promise<{ company, user, tokens }>}
 */
async function register(params, traceId) {
  const {
    companyName,
    gstin,
    pan,
    businessType,
    companyPhone,
    ownerName,
    email,
    password,
  } = params;

  const log = createContextLogger({ trace_id: traceId });
  log.info('auth_register_start', { email, companyName });

  if (!companyName || !ownerName || !email || !password) {
    throw new ValidationError(
      'companyName, ownerName, email, password are all required'
    );
  }

  // Hash before transaction — scrypt is CPU-intensive
  const passwordHash = await hashPassword(password);

  const result = await withTransaction(async (client) => {
    // 1. Create company (tenant root)
    const company = await companyRepository.create(
      {
        name:         companyName,
        gstin:        gstin        || null,
        pan:          pan          || null,
        businessType: businessType || null,
        phone:        companyPhone || null,
      },
      client
    );

    // 2. Create owner user scoped to new company
    const user = await userRepository.create(
      {
        companyId:    company.id,
        name:         ownerName,
        email,
        phone:        companyPhone || null,
        role:         'owner',
        passwordHash,
      },
      client
    );

    // 3. Audit — silent, never fails transaction
    await auditRepository.writeSilent(
      {
        companyId:    company.id,
        userId:       user.id,
        traceId,
        action:       'company.registered',
        resourceType: 'company',
        resourceId:   company.id,
        payload:      { companyName, email, ownerName },
      },
      client
    );

    return { company, user };
  });

  // Issue token pair after successful transaction
  const tokens = issueTokenPair({
    id:        result.user.id,
    companyId: result.company.id,
    role:      result.user.role,
  });

  log.info('auth_register_complete', {
    company_id: result.company.id,
    user_id:    result.user.id,
  });

  return {
    company: result.company,
    user:    _stripHash(result.user),
    tokens,
  };
}

/**
 * Login with email + password within a company tenant.
 *
 * companyId is required — two companies can have users with the same email.
 * Never reveal whether email exists — always return generic error on failure.
 *
 * @param {string} email
 * @param {string} password
 * @param {string} companyId
 * @param {string} traceId
 * @param {string} [ipAddress]
 * @returns {Promise<{ user, tokens }>}
 */
async function login(email, password, companyId, traceId, ipAddress = null) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.info('auth_login_attempt', { email });

  if (!email || !password || !companyId) {
    throw new ValidationError('email, password, companyId are required');
  }

  // Load user WITH password_hash — only findByEmail returns hash
  const userWithHash = await userRepository.findByEmail(companyId, email);

  // Generic error — never reveal whether email exists
  if (!userWithHash) {
    log.warn('auth_login_email_not_found', { email });
    await auditRepository.writeSilent({
      companyId,
      traceId,
      action:    'auth.login_failed',
      payload:   { email, reason: 'email_not_found' },
      ipAddress,
    });
    throw new AuthenticationError('Invalid email or password');
  }

  if (!userWithHash.is_active) {
    log.warn('auth_login_inactive_user', { email, user_id: userWithHash.id });
    throw new AuthenticationError('Account is inactive. Contact support.');
  }

  const valid = await verifyPassword(password, userWithHash.password_hash);

  if (!valid) {
    log.warn('auth_login_invalid_password', { email, user_id: userWithHash.id });
    await auditRepository.writeSilent({
      companyId,
      userId:    userWithHash.id,
      traceId,
      action:    'auth.login_failed',
      payload:   { email, reason: 'invalid_password' },
      ipAddress,
    });
    throw new AuthenticationError('Invalid email or password');
  }

  // Issue tokens
  const tokens = issueTokenPair({
    id:        userWithHash.id,
    companyId,
    role:      userWithHash.role,
  });

  // Touch last_seen_at — fire and forget, never awaited
  userRepository.touchLastSeen(userWithHash.id).catch(() => {});

  // Success audit
  await auditRepository.writeSilent({
    companyId,
    userId:    userWithHash.id,
    traceId,
    action:    'auth.login_success',
    payload:   { email },
    ipAddress,
  });

  log.info('auth_login_success', { user_id: userWithHash.id, role: userWithHash.role });

  return {
    user:   _stripHash(userWithHash),
    tokens,
  };
}

/**
 * Issue a new access token from a valid refresh token.
 *
 * @param {string} token   — refresh token from client
 * @param {string} traceId
 * @returns {{ accessToken, expiresIn, tokenType }}
 */
function refresh(token, traceId) {
  const log = createContextLogger({ trace_id: traceId });
  log.info('auth_token_refresh_attempt');

  try {
    const result = refreshAccessToken(token);
    log.info('auth_token_refresh_success');
    return result;
  } catch (err) {
    log.warn('auth_token_refresh_failed', { error: err.message });
    throw new AuthenticationError(
      err.name === 'TokenExpiredError'
        ? 'Refresh token has expired — please login again'
        : 'Invalid refresh token'
    );
  }
}

/**
 * Get current authenticated user profile + company.
 * Called by GET /api/v1/auth/me.
 * companyId and userId come from JWT payload via req.tenantContext.
 *
 * @param {string} companyId
 * @param {string} userId
 * @param {string} traceId
 * @returns {Promise<{ user, company }>}
 */
async function getMe(companyId, userId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.info('auth_get_me', { user_id: userId });

  const [user, company] = await Promise.all([
    userRepository.findById(companyId, userId),
    companyRepository.findById(companyId),
  ]);

  if (!user)    { throw new NotFoundError('User'); }
  if (!company) { throw new NotFoundError('Company'); }

  return {
    user:    _stripHash(user),
    company,
  };
}

/**
 * Strip password_hash from user object before returning to any caller.
 * Defense-in-depth — repositories already exclude hash from safe methods,
 * but findByEmail returns the hash. Always strip before leaving engine.
 *
 * @param {object} user
 * @returns {object} user without password_hash
 */
function _stripHash(user) {
  if (!user) { return user; }
  const { password_hash, ...safe } = user;
  return safe;
}

module.exports = {
  register,
  login,
  refresh,
  getMe,
};