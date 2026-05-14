'use strict';

/**
 * ARTHA Error Taxonomy
 *
 * Every error in the system is a typed class.
 * The centralized error middleware in apps/api maps
 * error type → HTTP status code → structured JSON response.
 *
 * Rules:
 *   - Never throw plain Error objects from engine code
 *   - Never throw string literals
 *   - Always use typed errors — they carry code, statusCode, meta
 *   - isOperational=true  → expected business error, safe to return to client
 *   - isOperational=false → unexpected crash, mask details in production
 *   - Never expose stack traces to API clients in production
 *
 * Fintech-specific errors:
 *   - AccountingError — double-entry violations, ledger errors
 *   - GSTError        — GST calculation or filing violations
 *   - InsufficientFundsError — balance check failures
 *
 * Future errors (add here when implementing those systems):
 *   - OCRError        — Day 7
 *   - WorkflowError   — Day 10 (Paperclip)
 *   - ReportError     — Day 9
 */

// ── Base ──────────────────────────────────────────────────────────────────────

class ArthаBaseError extends Error {
  /**
   * @param {string} message    — human-readable error description
   * @param {string} code       — machine-readable error code (SCREAMING_SNAKE)
   * @param {number} statusCode — HTTP status code
   * @param {object} meta       — additional context for debugging
   */
  constructor(message, code, statusCode, meta = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.meta = meta;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── Validation (400) ──────────────────────────────────────────────────────────

class ValidationError extends ArthаBaseError {
  /**
   * Input failed schema validation.
   * @param {string} message
   * @param {object} [meta] — e.g. { field: 'amount', received: 'abc' }
   */
  constructor(message, meta) {
    super(message, 'VALIDATION_ERROR', 400, meta);
  }
}

// ── Auth (401 / 403) ──────────────────────────────────────────────────────────

class AuthenticationError extends ArthаBaseError {
  /**
   * Request is not authenticated — token missing, invalid, or expired.
   */
  constructor(message = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401);
  }
}

class AuthorizationError extends ArthаBaseError {
  /**
   * Request is authenticated but lacks permission for this action.
   */
  constructor(message = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403);
  }
}

// ── Tenant (403) ──────────────────────────────────────────────────────────────

class TenantError extends ArthаBaseError {
  /**
   * Tenant context (company_id) missing or mismatched.
   * Always 403 — never reveal tenant existence to wrong caller.
   */
  constructor(message = 'Tenant context missing or invalid') {
    super(message, 'TENANT_ERROR', 403);
  }
}

// ── Not Found (404) ───────────────────────────────────────────────────────────

class NotFoundError extends ArthаBaseError {
  /**
   * @param {string} resource — e.g. 'Journal entry', 'Ledger', 'User'
   */
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

// ── Conflict (409) ────────────────────────────────────────────────────────────

class ConflictError extends ArthаBaseError {
  /**
   * Resource already exists / duplicate detected.
   * @param {string} message
   * @param {object} [meta] — e.g. { gstin: '27AAAAA...' }
   */
  constructor(message, meta) {
    super(message, 'CONFLICT', 409, meta);
  }
}

// ── Financial — Unprocessable (422) ───────────────────────────────────────────

class AccountingError extends ArthаBaseError {
  /**
   * Double-entry violation, ledger mismatch, balance error,
   * or any accounting-domain failure.
   *
   * @param {string} message
   * @param {object} [meta] — e.g. { debit: 50000, credit: 40000 }
   */
  constructor(message, meta) {
    super(message, 'ACCOUNTING_ERROR', 422, meta);
  }
}

class GSTError extends ArthаBaseError {
  /**
   * GST calculation, GSTIN validation, or filing workflow failure.
   *
   * @param {string} message
   * @param {object} [meta]
   */
  constructor(message, meta) {
    super(message, 'GST_ERROR', 422, meta);
  }
}

class InsufficientFundsError extends ArthаBaseError {
  /**
   * Ledger balance insufficient for the requested operation.
   *
   * @param {string} [message]
   * @param {object} [meta] — e.g. { available: 50000, required: 100000 }
   */
  constructor(message = 'Insufficient balance for this operation', meta) {
    super(message, 'INSUFFICIENT_FUNDS', 422, meta);
  }
}

// ── Rate Limit (429) ──────────────────────────────────────────────────────────

class RateLimitError extends ArthаBaseError {
  constructor() {
    super('Rate limit exceeded. Please try again later.', 'RATE_LIMIT_EXCEEDED', 429);
  }
}

// ── Webhook (401) ─────────────────────────────────────────────────────────────

class WebhookVerificationError extends ArthаBaseError {
  /**
   * HMAC signature on incoming webhook did not match.
   * Always 401 — never reveal why it failed.
   */
  constructor() {
    super('Webhook signature verification failed', 'WEBHOOK_INVALID', 401);
  }
}

// ── Internal (500) ────────────────────────────────────────────────────────────

class InternalError extends ArthаBaseError {
  /**
   * Unexpected system failure.
   * isOperational=false — details masked in production.
   *
   * @param {string} [message]
   */
  constructor(message = 'An unexpected internal error occurred') {
    super(message, 'INTERNAL_ERROR', 500);
    this.isOperational = false;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ArthаBaseError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  TenantError,
  NotFoundError,
  ConflictError,
  AccountingError,
  GSTError,
  InsufficientFundsError,
  RateLimitError,
  WebhookVerificationError,
  InternalError,
};