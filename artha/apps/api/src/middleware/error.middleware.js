'use strict';

const { ArthаBaseError } = require('@artha/errors');
const { logger }         = require('@artha/logger');
const config             = require('@artha/config');

/**
 * ARTHA Centralized Error Handler
 *
 * Must be registered as the LAST middleware in Express.
 * Catches all errors thrown or passed to next(err) anywhere in the app.
 *
 * Two error categories:
 *
 *   Operational (isOperational=true):
 *     — Expected business errors: ValidationError, AuthenticationError, etc.
 *     — Safe to return structured JSON to client
 *     — Logged at warn level
 *
 *   Non-operational (isOperational=false):
 *     — Unexpected crashes: InternalError, uncaught exceptions
 *     — Details masked in production
 *     — Logged at error level with full stack
 *     — Stack trace included in development only
 *
 * Response shape (all errors):
 *   {
 *     ok:       false,
 *     error: {
 *       code:    string,   — machine-readable (VALIDATION_ERROR, etc.)
 *       message: string,   — human-readable
 *       details: object,   — optional additional context (from err.meta)
 *     },
 *     trace_id: string,    — always included for support correlation
 *   }
 *
 * Never exposes:
 *   - Stack traces in production
 *   - Internal database errors in production
 *   - Internal system paths in production
 */
function errorMiddleware(err, req, res, _next) {
  const log     = req.log || logger;
  const traceId = req.traceId || null;

  // ── Operational error — expected, safe to return ──────────────────────────
  if (err instanceof ArthаBaseError && err.isOperational) {
    log.warn('operational_error', {
      code:       err.code,
      status:     err.statusCode,
      message:    err.message,
      meta:       err.meta,
    });

    return res.status(err.statusCode).json({
      ok:    false,
      error: {
        code:    err.code,
        message: err.message,
        ...(err.meta && Object.keys(err.meta).length > 0
          ? { details: err.meta }
          : {}
        ),
      },
      trace_id: traceId,
    });
  }

  // ── Non-operational error — unexpected crash ───────────────────────────────
  log.error('unexpected_error', {
    message: err.message,
    name:    err.name,
    stack:   err.stack,
    code:    err.code,
  });

  return res.status(500).json({
    ok:    false,
    error: {
      code:    'INTERNAL_ERROR',
      message: config.isProd
        ? 'An unexpected error occurred. Our team has been notified.'
        : err.message,
      ...(config.isDev ? { stack: err.stack } : {}),
    },
    trace_id: traceId,
  });
}

/**
 * 404 handler — catches all unmatched routes.
 * Must be registered AFTER all routes, BEFORE errorMiddleware.
 */
function notFoundMiddleware(req, res) {
  const traceId = req.traceId || null;

  return res.status(404).json({
    ok:    false,
    error: {
      code:    'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
    trace_id: traceId,
  });
}

module.exports = { errorMiddleware, notFoundMiddleware };