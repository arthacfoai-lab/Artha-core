'use strict';

const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const config  = require('@artha/config');

/**
 * ARTHA Token Service
 *
 * Issues and verifies JWT access + refresh tokens.
 * Stateless — no DB or Redis required for verification.
 *
 * Token types:
 *
 *   Access token  (type: 'access')
 *     - Short-lived: config.jwt.expiresIn (default 24h)
 *     - Verified by authenticateMiddleware on every protected request
 *     - Carries: sub (userId), company_id, role, type
 *
 *   Refresh token (type: 'refresh')
 *     - Long-lived: config.jwt.refreshExpiresIn (default 7d)
 *     - Used only at POST /api/v1/auth/refresh
 *     - Carries: sub, company_id, role, type, jti (unique ID)
 *     - jti enables future revocation via Redis blocklist (Day 5+)
 *
 * JWT payload shape:
 *   {
 *     sub:        string  — userId (UUID)
 *     company_id: string  — companyId (UUID)
 *     role:       string  — 'owner' | 'accountant' | 'viewer'
 *     type:       string  — 'access' | 'refresh'
 *     jti?:       string  — UUID (refresh tokens only)
 *     iat:        number  — issued at (Unix timestamp)
 *     exp:        number  — expires at (Unix timestamp)
 *   }
 *
 * Integration points:
 *   - authenticateMiddleware (Day 1) — verifies access tokens
 *   - auth.engine.js (Day 2)        — calls issueTokenPair on login/register
 *   - auth.routes.js /refresh       — calls refreshAccessToken
 *   - Future Day 5: jti blocklist in Redis for refresh token revocation
 *
 * Called by:
 *   - auth.engine.js register()
 *   - auth.engine.js login()
 *   - auth.engine.js refresh()
 */

/**
 * Issue an access + refresh token pair for a user.
 *
 * @param {{ id, companyId, role }} user
 * @returns {{ accessToken, refreshToken, expiresIn, tokenType }}
 */
function issueTokenPair(user) {
  const { id, companyId, role } = user;

  if (!id || !companyId || !role) {
    throw new Error(
      'issueTokenPair: requires id, companyId, role — got: ' +
      JSON.stringify({ id: !!id, companyId: !!companyId, role: !!role })
    );
  }

  const accessToken = jwt.sign(
    {
      sub:        id,
      company_id: companyId,
      role,
      type:       'access',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  const refreshToken = jwt.sign(
    {
      sub:        id,
      company_id: companyId,
      role,
      type:       'refresh',
      jti:        crypto.randomUUID(),
    },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return {
    accessToken,
    refreshToken,
    expiresIn:  config.jwt.expiresIn,
    tokenType:  'Bearer',
  };
}

/**
 * Verify and decode a JWT token.
 * Throws descriptive errors — caller maps to AuthenticationError.
 *
 * @param {string} token
 * @param {'access'|'refresh'} expectedType
 * @returns {object} decoded payload
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyToken(token, expectedType = 'access') {
  if (!token || typeof token !== 'string') {
    throw new jwt.JsonWebTokenError('Token is required');
  }

  const payload = jwt.verify(token, config.jwt.secret);

  if (payload.type !== expectedType) {
    throw new jwt.JsonWebTokenError(
      `Expected ${expectedType} token but received ${payload.type} token`
    );
  }

  return payload;
}

/**
 * Decode a token WITHOUT verification.
 * Use only for logging, debugging, or extracting jti for blocklist.
 * NEVER use for authorization decisions.
 *
 * @param {string} token
 * @returns {object|null} decoded payload or null
 */
function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

/**
 * Issue a new access token from a valid refresh token.
 * Does NOT issue a new refresh token — client reuses existing one.
 *
 * @param {string} refreshToken
 * @returns {{ accessToken, expiresIn, tokenType }}
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function refreshAccessToken(refreshToken) {
  const payload = verifyToken(refreshToken, 'refresh');

  const accessToken = jwt.sign(
    {
      sub:        payload.sub,
      company_id: payload.company_id,
      role:       payload.role,
      type:       'access',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  return {
    accessToken,
    expiresIn: config.jwt.expiresIn,
    tokenType: 'Bearer',
  };
}

/**
 * Extract expiry timestamp from token without full verification.
 * Used for client-side token expiry display only.
 *
 * @param {string} token
 * @returns {number|null} Unix timestamp or null
 */
function getTokenExpiry(token) {
  const decoded = decodeToken(token);
  return decoded ? decoded.exp || null : null;
}

module.exports = {
  issueTokenPair,
  verifyToken,
  decodeToken,
  refreshAccessToken,
  getTokenExpiry,
};