'use strict';

const express = require('express');

const { authenticateMiddleware } = require('../../middleware/auth.middleware');
const { tenantMiddleware }       = require('../../middleware/tenant.middleware');
const { validateBody }           = require('../../middleware/validate.middleware');
const { ok, created }            = require('../../helpers/response.helper');
const authEngine                 = require('../../engines/auth/auth.engine');
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
 *   POST /api/v1/auth/register  — create company + owner user
 *   POST /api/v1/auth/login     — get token pair
 *   POST /api/v1/auth/refresh   — exchange refresh token for new access token
 *
 * Protected routes (auth required):
 *   GET  /api/v1/auth/me        — get current user + company profile
 *
 * Multi-tenant login:
 *   Login requires companyId in request body.
 *   Two companies can have users with the same email address.
 *   companyId scopes the email lookup to the correct tenant.
 *
 * Token flow:
 *   register/login → { accessToken, refreshToken }
 *   accessToken    → Authorization: Bearer <token> on protected routes
 *   refreshToken   → POST /auth/refresh → new accessToken
 *
 * Integration points:
 *   - auth.engine.js      — register(), login(), refresh(), getMe()
 *   - auth.validator.js   — request schema validation
 *   - validate.middleware — validateBody() wraps schemas
 *   - response.helper     — ok(), created() response shape
 *   - authenticateMiddleware (Day 1) — protects /me route
 *   - tenantMiddleware (Day 1)       — sets req.tenantContext on /me
 *   - auditRepository (Day 1)        — auth events logged by auth.engine
 */

/**
 * POST /api/v1/auth/register
 *
 * Create a new company and owner user.
 * Returns token pair — user is authenticated immediately on registration.
 *
 * Body: { companyName, ownerName, email, password, gstin?, pan?, businessType?, companyPhone? }
 * Response: { company, user, tokens }
 */
router.post(
  '/register',
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      const result = await authEngine.register(
        req.validatedBody,
        req.traceId
      );

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
 * companyId required — scopes email lookup to correct tenant.
 *
 * Body: { email, password, companyId }
 * Response: { user, tokens }
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
 * Refresh token is NOT rotated — client reuses until expiry.
 *
 * Body: { refreshToken }
 * Response: { accessToken, expiresIn, tokenType }
 */
router.post(
  '/refresh',
  validateBody(refreshSchema),
  async (req, res, next) => {
    try {
      const { refreshToken } = req.validatedBody;

      const result = authEngine.refresh(refreshToken, req.traceId);

      return ok(res, req, result);

    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/auth/me
 *
 * Get current authenticated user profile and company.
 * Requires valid Bearer token.
 *
 * Response: { user, company }
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

      return ok(res, req, {
        user:    result.user,
        company: result.company,
      });

    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;