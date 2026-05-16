'use strict';

const { createContextLogger }  = require('@artha/logger');
const { withTransaction }      = require('@artha/database');
const companyRepository        = require('@artha/database').companyRepository;
const userRepository           = require('@artha/database').userRepository;
const auditRepository          = require('@artha/database').auditRepository;
const { seedDefaultAccounts }  = require('../accounting/ledger.engine');
const { hashPassword, verifyPassword } = require('./password.service');
const { issueTokenPair, refreshAccessToken } = require('./token.service');
const {
  AuthenticationError,
  NotFoundError,
  ValidationError,
} = require('@artha/errors');

/**
 * ARTHA Auth Engine — UPDATED Day 3
 *
 * Change from Day 2:
 *   register() now seeds the default chart of accounts inside the
 *   same transaction as company + user creation.
 *   This ensures every new company has a complete ledger set
 *   before any accounting operation can be attempted.
 *
 * All other methods unchanged from Day 2.
 *
 * Integration points added (Day 3):
 *   - ledger.engine.seedDefaultAccounts() — called in register() transaction
 *
 * Integration points (existing Day 1/2):
 *   - companyRepository — create, findById
 *   - userRepository    — create, findByEmail, touchLastSeen
 *   - auditRepository   — writeSilent for all auth events
 *   - withTransaction   — atomic company + user + ledger creation
 *   - password.service  — hashPassword, verifyPassword
 *   - token.service     — issueTokenPair, refreshAccessToken
 */

/**
 * Register a new company, owner user, and seed chart of accounts.
 * All three created atomically in a single transaction.
 * Returns token pair immediately — user is authenticated on registration.
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

  // Hash before transaction — scrypt is CPU-intensive, keep tx short
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

    // 2. Create owner user scoped to company
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

    // 3. Seed default chart of accounts — Day 3 addition
    //    Every new company gets a complete set of ledgers immediately.
    //    This must be in the same transaction — if ledger seeding fails,
    //    company + user creation is also rolled back.
    const ledgers = await seedDefaultAccounts(company.id, client);

    // 4. Audit — silent, never fails transaction
    await auditRepository.writeSilent(
      {
        companyId:    company.id,
        userId:       user.id,
        traceId,
        action:       'company.registered',
        resourceType: 'company',
        resourceId:   company.id,
        payload:      {
          companyName,
          email,
          ownerName,
          ledgersSeeded: ledgers.length,
        },
      },
      client
    );

    return { company, user, ledgersSeeded: ledgers.length };
  });

  // Issue token pair after successful transaction
  const tokens = issueTokenPair({
    id:        result.user.id,
    companyId: result.company.id,
    role:      result.user.role,
  });

  log.info('auth_register_complete', {
    company_id:     result.company.id,
    user_id:        result.user.id,
    ledgers_seeded: result.ledgersSeeded,
  });

  return {
    company: result.company,
    user:    _stripHash(result.user),
    tokens,
  };
}

/**
 * Login with email + password within a company tenant.
 * companyId required — multi-tenant email scoping.
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

  const userWithHash = await userRepository.findByEmail(companyId, email);

  if (!userWithHash) {
    log.warn('auth_login_email_not_found', { email });
    await auditRepository.writeSilent({
      companyId,
      traceId,
      action:   'auth.login_failed',
      payload:  { email, reason: 'email_not_found' },
      ipAddress,
    });
    throw new AuthenticationError('Invalid email or password');
  }

  if (!userWithHash.is_active) {
    log.warn('auth_login_inactive_user', { email });
    throw new AuthenticationError('Account is inactive. Contact support.');
  }

  const valid = await verifyPassword(password, userWithHash.password_hash);

  if (!valid) {
    log.warn('auth_login_invalid_password', { email, user_id: userWithHash.id });
    await auditRepository.writeSilent({
      companyId,
      userId:   userWithHash.id,
      traceId,
      action:   'auth.login_failed',
      payload:  { email, reason: 'invalid_password' },
      ipAddress,
    });
    throw new AuthenticationError('Invalid email or password');
  }

  const tokens = issueTokenPair({
    id:        userWithHash.id,
    companyId,
    role:      userWithHash.role,
  });

  userRepository.touchLastSeen(userWithHash.id).catch(() => {});

  await auditRepository.writeSilent({
    companyId,
    userId:   userWithHash.id,
    traceId,
    action:   'auth.login_success',
    payload:  { email },
    ipAddress,
  });

  log.info('auth_login_success', { user_id: userWithHash.id, role: userWithHash.role });

  return {
    user:   _stripHash(userWithHash),
    tokens,
  };
}

/**
 * Issue new access token from valid refresh token.
 *
 * @param {string} token
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
 * Get current authenticated user + company profile.
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

function _stripHash(user) {
  if (!user) { return user; }
  const { password_hash, ...safe } = user;
  return safe;
}

module.exports = { register, login, refresh, getMe };