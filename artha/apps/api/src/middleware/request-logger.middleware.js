'use strict';

const { logger } = require('@artha/logger');

/**
 * ARTHA Request Logger Middleware
 *
 * Logs every HTTP request on response completion.
 * Uses res.on('finish') — logs after response is sent, not before.
 *
 * Log fields per request:
 *   method      — GET, POST, etc.
 *   path        — req.path (not full URL — avoids logging sensitive query params)
 *   status      — HTTP response status code
 *   duration_ms — time from request received to response sent
 *   company_id  — tenant ID (null for unauthenticated requests)
 *   ip          — client IP
 *
 * Log level by status:
 *   5xx → error
 *   4xx → warn
 *   2xx/3xx → info
 *
 * Uses req.log (trace-bound context logger) if available.
 * Falls back to base logger for requests where trace middleware failed.
 *
 * Skips logging for /health (high-frequency probe — would flood logs).
 * Logs /ready at debug level (may be called frequently by orchestrator).
 *
 * Must be registered AFTER traceMiddleware (needs req.log + req.startTime).
 * Must be registered BEFORE route handlers.
 */
function requestLoggerMiddleware(req, res, next) {
  res.on('finish', () => {
    // Skip liveness probe — called every few seconds by orchestrator
    if (req.path === '/health') { return; }

    const duration = Date.now() - (req.startTime || Date.now());
    const log      = req.log || logger;

    const meta = {
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      duration_ms: duration,
      company_id: req.companyId || null,
      ip:         req.ip        || null,
    };

    if (req.path === '/ready' || req.path === '/version') {
      log.debug('http_request', meta);
      return;
    }

    if (res.statusCode >= 500) {
      log.error('http_request', meta);
    } else if (res.statusCode >= 400) {
      log.warn('http_request', meta);
    } else {
      log.info('http_request', meta);
    }
  });

  next();
}

module.exports = { requestLoggerMiddleware };