'use strict';

const express = require('express');
const { authenticateMiddleware }  = require('../../middleware/auth.middleware');
const { tenantMiddleware }        = require('../../middleware/tenant.middleware');
const { validateBody }            = require('../../middleware/validate.middleware');
const { ok, created }             = require('../../helpers/response.helper');
const authEngine                  = require('../../engines/auth/auth.engine');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
} = require('../../validators/auth.validator');

const router = express.Router();

/**
 * ARTHA Auth Routes — /api/v1/auth
 *
 * Public routes (no auth required):
 *   POST /register  — create company + owner user + seed chart of accounts
 *   POST /login     — authenticate, get token pair
 *   POST /refresh   — exchange refresh token for new access token
 *
 * Protected routes (auth required):
 *   GET  /me        — get current user + company profile
 *
 * Day 3 change: register now seeds chart of accounts atomically.
 * Response includes ledger count to confirm seeding succeeded.
 *
 * Integration points:
 *   - auth.engine.js       — register, login, refresh, getMe
 *   - auth.validator.js    — request schema validation
 *   - validate.middleware   — validateBody() wrapper
 *   - response.helper      — ok(), created() response shape
 *   - authenticateMiddleware — protects /me
 *   - tenantMiddleware       — sets req.tenantContext on /me
 */

/**
 * POST /api/v1/auth/register
 *
 * Create company + owner user + seed 30 default ledger accounts.
 * All three in a single atomic transaction.
 * Returns token pair — user authenticated immediately on registration.
 *
 * Body: { companyName, ownerName, email, password, gstin?, pan?, businessType?, companyPhone? }
 */
router.post(
  '/register',
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      const result = await authEngine.register(req.validatedBody, req.traceId);

      req.log && req.log.info('auth_register_response', {
        company_id: result.company.id,
        user_id:    result.user.id,
      });

      return created(res, req, {
        company: result.company,
        user:    result.user,
        tokens:  result.tokens,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/v1/auth/login
 *
 * Authenticate with email + password within a company tenant.
 * companyId required — prevents cross-tenant email collisions.
 *
 * Body: { email, password, companyId }
 */
router.post(
  '/login',
  validateBody(loginSchema),
  async (req, res, next) => {
    try {
      const { email, password, companyId } = req.validatedBody;

      const result = await authEngine.login(
        email,
        password,
        companyId,
        req.traceId,
        req.ip || null
      );

      req.log && req.log.info('auth_login_response', {
        company_id: companyId,
        user_id:    result.user.id,
      });

      return ok(res, req, {
        user:   result.user,
        tokens: result.tokens,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/v1/auth/refresh
 *
 * Exchange a valid refresh token for a new access token.
 *
 * Body: { refreshToken }
 */
router.post(
  '/refresh',
  validateBody(refreshSchema),
  async (req, res, next) => {
    try {
      const result = authEngine.refresh(req.validatedBody.refreshToken, req.traceId);
      return ok(res, req, result);
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/auth/me
 *
 * Get current authenticated user + company.
 * Requires valid Bearer access token.
 */
router.get(
  '/me',
  authenticateMiddleware,
  tenantMiddleware,
  async (req, res, next) => {
    try {
      const result = await authEngine.getMe(
        req.tenantContext.companyId,
        req.tenantContext.userId,
        req.traceId
      );
      return ok(res, req, { user: result.user, company: result.company });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;