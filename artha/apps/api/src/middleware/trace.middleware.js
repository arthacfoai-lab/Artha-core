'use strict';

const crypto = require('crypto');
const { createContextLogger } = require('@artha/logger');

/**
 * ARTHA Trace Middleware
 *
 * Attaches a unique trace_id to every incoming request.
 * Enables full request traceability across:
 *   - API handlers
 *   - Engine calls
 *   - Database queries
 *   - Queue workers
 *   - Paperclip workflow callbacks
 *   - OpenClaw webhook events
 *
 * trace_id rules:
 *   - Generated as UUID v4 if not provided by caller
 *   - Accepts X-Trace-Id or X-Request-Id from incoming headers
 *     (allows distributed tracing from upstream systems like OpenClaw)
 *   - Always echoed back in X-Trace-Id response header
 *   - Attached to req.traceId — available in all downstream middleware
 *   - Attached to req.log — context-bound logger for this request
 *   - Attached to req.startTime — for duration calculation in logger
 *
 * Must be registered BEFORE all other middleware.
 * Must be registered BEFORE body parsers.
 */
function traceMiddleware(req, res, next) {
  const traceId =
    req.headers['x-trace-id']   ||
    req.headers['x-request-id'] ||
    crypto.randomUUID();

  req.traceId   = traceId;
  req.startTime = Date.now();

  // Bind context logger to this request's trace_id.
  // company_id added later by auth + tenant middleware.
  req.log = createContextLogger({ trace_id: traceId });

  // Echo trace_id back — allows caller to correlate response to request
  res.setHeader('X-Trace-Id', traceId);

  next();
}

module.exports = { traceMiddleware };