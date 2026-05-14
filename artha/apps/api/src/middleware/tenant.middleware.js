'use strict';

const { TenantError } = require('@artha/errors');

/**
 * ARTHA Tenant Middleware
 *
 * Enforces multi-tenant isolation on every authenticated request.
 * Must run AFTER authenticateMiddleware — depends on req.companyId.
 *
 * Responsibilities:
 *   1. Assert req.companyId is present (set by auth middleware)
 *   2. Prevent IDOR attacks — if route has :companyId URL param,
 *      it MUST match the JWT company_id. Prevents tenant A from
 *      accessing tenant B data by changing a URL parameter.
 *   3. Set req.tenantContext — structured context object passed to engines
 *
 * req.tenantContext shape:
 *   {
 *     companyId: string,   — tenant UUID
 *     userId:    string,   — authenticated user UUID
 *     role:      string,   — user role
 *     traceId:   string,   — request trace ID
 *   }
 *
 * All engine methods receive tenantContext as first argument.
 * All repository methods receive companyId as first argument.
 * Neither ever reads from req directly — engines are HTTP-agnostic.
 *
 * Integration points:
 *   - authenticateMiddleware — must run before this
 *   - All engine calls       — receive req.tenantContext
 *   - All repository calls   — receive req.companyId
 *   - Day 5 OpenClaw         — sets companyId from WhatsApp session
 */
function tenantMiddleware(req, _res, next) {
  const companyId = req.companyId;

  if (!companyId) {
    return next(new TenantError(
      'Tenant context missing — authenticateMiddleware must run before tenantMiddleware'
    ));
  }

  // IDOR prevention — URL param :companyId must match JWT company_id
  if (req.params && req.params.companyId) {
    if (req.params.companyId !== companyId) {
      return next(new TenantError(
        'Tenant mismatch — URL company ID does not match authenticated company'
      ));
    }
  }

  // Structured tenant context — passed to all engine calls
  req.tenantContext = Object.freeze({
    companyId,
    userId:  req.user ? req.user.id   : null,
    role:    req.user ? req.user.role  : null,
    traceId: req.traceId || null,
  });

  return next();
}

module.exports = { tenantMiddleware };