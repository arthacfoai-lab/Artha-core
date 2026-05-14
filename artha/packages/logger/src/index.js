'use strict';

const winston = require('winston');
const config = require('@artha/config');

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

/**
 * ARTHA Structured Logger
 *
 * Built on winston. Every log line carries:
 *   - service name + version
 *   - environment
 *   - timestamp (ISO)
 *   - log level
 *   - trace_id  (per-request UUID — set by trace middleware)
 *   - company_id (tenant — set after auth middleware)
 *   - workflow_id (optional — set by Paperclip workflows, Day 10)
 *   - session_id  (optional — set by OpenClaw sessions, Day 5)
 *
 * Two formats:
 *   pretty — colorized, human-readable for development
 *   json   — structured JSON for production (Loki, Datadog, etc.)
 *
 * Three loggers exported:
 *   logger              — base logger, no request context
 *   createContextLogger — creates child logger bound to request context
 *   logAudit            — financial audit event stream (compliance)
 *
 * Rules:
 *   - Never use console.log anywhere in the codebase
 *   - Always use createContextLogger() inside request handlers
 *   - Always use logAudit() for financial write events
 *   - Audit logs are tagged stream:'audit' for SIEM routing
 */

// ── Pretty format (development) ───────────────────────────────────────────────

const prettyFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  errors({ stack: true }),
  printf(({
    level,
    message,
    timestamp: ts,
    trace_id,
    company_id,
    workflow_id,
    session_id,
    stream,
    stack,
    ...meta
  }) => {
    let line = `${ts} [${level}]`;
    if (stream === 'audit') { line += ' [AUDIT]'; }
    if (trace_id)    { line += ` [t:${String(trace_id).slice(0, 8)}]`; }
    if (company_id)  { line += ` [c:${String(company_id).slice(0, 8)}]`; }
    if (workflow_id) { line += ` [w:${String(workflow_id).slice(0, 8)}]`; }
    if (session_id)  { line += ` [s:${String(session_id).slice(0, 8)}]`; }
    line += ` ${message}`;

    const metaKeys = Object.keys(meta).filter((k) => k !== 'service' && k !== 'version' && k !== 'env');
    if (metaKeys.length > 0) {
      const metaStr = JSON.stringify(
        Object.fromEntries(metaKeys.map((k) => [k, meta[k]]))
      );
      line += ` ${metaStr}`;
    }
    if (stack) { line += `\n${stack}`; }
    return line;
  })
);

// ── JSON format (production) ──────────────────────────────────────────────────

const jsonFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ── Transport ─────────────────────────────────────────────────────────────────

const consoleTransport = new winston.transports.Console({
  handleExceptions: true,
  handleRejections: true,
});

// ── Base logger ───────────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: config.logging.level,
  format: config.logging.format === 'pretty' ? prettyFormat : jsonFormat,
  defaultMeta: {
    service: config.app.name,
    version: config.app.version,
    env:     config.env,
  },
  transports: [consoleTransport],
  exitOnError: false,
});

/**
 * Create a child logger bound to request context.
 *
 * Call this at the start of every request handler or engine method.
 * Every log line from this logger will include the provided context fields.
 *
 * @param {object} context
 * @param {string} context.trace_id    — required for traceability
 * @param {string} [context.company_id] — set after tenant middleware
 * @param {string} [context.user_id]
 * @param {string} [context.session_id] — set by OpenClaw (Day 5)
 * @param {string} [context.workflow_id] — set by Paperclip (Day 10)
 * @returns {winston.Logger}
 */
function createContextLogger(context = {}) {
  return logger.child(context);
}

/**
 * Write a financial audit log entry.
 *
 * Used for every significant financial or auth event.
 * Tagged stream:'audit' for routing to compliance SIEM.
 *
 * @param {object} event
 * @param {string} event.action       — e.g. 'journal_entry.created'
 * @param {string} [event.companyId]
 * @param {string} [event.userId]
 * @param {string} [event.traceId]
 * @param {object} [event.payload]    — snapshot of relevant data
 */
function logAudit(event) {
  logger.info('audit_event', {
    stream:     'audit',
    action:     event.action,
    company_id: event.companyId || null,
    user_id:    event.userId    || null,
    trace_id:   event.traceId   || null,
    payload:    event.payload   || {},
    audit_at:   new Date().toISOString(),
  });
}

module.exports = {
  logger,
  createContextLogger,
  logAudit,
};