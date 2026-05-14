'use strict';

const jwt = require('jsonwebtoken');
const config = require('@artha/config');
const { AuthenticationError, AuthorizationError } = require('@artha/errors');

/**
 * ARTHA Auth Middleware
 *
 * Verifies JWT access tokens on protected routes.
 * Sets req.user and req.companyId on success.
 * Enriches req.log with user + tenant context after verification.
 *
 * JWT payload shape (issued by token.service.js, Day 3):
 *   {
 *     sub:        userId (UUID)
 *     company_id: companyId (UUID)
 *     role:       'owner' | 'accountant' | 'viewer'
 *     type:       'access'
 *     iat, exp
 *   }
 *
 * Exports three middleware functions:
 *
 *   authenticateMiddleware
 *     — verifies Bearer token, throws 401 if missing/invalid/expired
 *     — use on all protected routes
 *
 *   requireRole(...roles)
 *     — RBAC factory, call AFTER authenticateMiddleware
 *     — throws 403 if user role not in allowed list
 *     — example: requireRole('owner', 'accountant')
 *
 *   optionalAuth
 *     — attaches user if token present, proceeds silently if not
 *     — use on routes that behave differently when authenticated
 *
 * Integration points:
 *   - token.service.js (Day 3) — issues tokens this middleware verifies
 *   - tenant.middleware.js     — runs after this, uses req.companyId
 *   - All protected routes     — import authenticateMiddleware
 */

/**
 * Verify Bearer JWT. Sets req.user, req.companyId, enriches req.log.
 */
function authenticateMiddleware(req, _res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AuthenticationError('Bearer token required'));
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return next(new AuthenticationError('Bearer token is empty'));
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);

    // Enforce token type — refresh tokens must not be used as access tokens
    if (payload.type && payload.type !== 'access') {
      return next(new AuthenticationError(
        `Expected access token, received ${payload.type} token`
      ));
    }

    req.user = {
      id:        payload.sub,
      role:      payload.role,
      companyId: payload.company_id,
    };

    req.companyId = payload.company_id;

    // Enrich request logger with auth context
    if (req.log) {
      req.log = req.log.child({
        company_id: payload.company_id,
        user_id:    payload.sub,
        role:       payload.role,
      });
    }

    return next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AuthenticationError('Token has expired — please refresh'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AuthenticationError('Token is invalid'));
    }
    if (err.name === 'NotBeforeError') {
      return next(new AuthenticationError('Token not yet valid'));
    }
    return next(new AuthenticationError('Token verification failed'));
  }
}

/**
 * RBAC middleware factory.
 *
 * Usage:
 *   router.post('/journal', authenticateMiddleware, requireRole('owner', 'accountant'), handler)
 *
 * @param {...string} roles — allowed roles
 * @returns {Function} Express middleware
 */
function requireRole(...roles) {
  return function roleMiddleware(req, _res, next) {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required before role check'));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AuthorizationError(
        `Role '${req.user.role}' is not permitted to perform this action. ` +
        `Required: ${roles.join(' or ')}`
      ));
    }

    return next();
  };
}

/**
 * Optional auth — attaches user context if valid token present.
 * Proceeds without error if no token provided.
 * Used for public endpoints that return richer data when authenticated.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  return authenticateMiddleware(req, res, next);
}

module.exports = {
  authenticateMiddleware,
  requireRole,
  optionalAuth,
};