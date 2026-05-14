'use strict';

const crypto = require('crypto');
const config = require('@artha/config');
const { WebhookVerificationError } = require('@artha/errors');

/**
 * ARTHA Webhook Verification Middleware
 *
 * Verifies HMAC-SHA256 signatures on incoming webhook requests.
 * Used for OpenClaw (Day 5) and Paperclip (Day 10) webhook endpoints.
 *
 * Expected request:
 *   Header: X-Artha-Signature: sha256=<hex_digest>
 *   Body:   raw JSON buffer (must use express.raw() before this middleware)
 *
 * Signature algorithm:
 *   HMAC-SHA256(rawBody, WEBHOOK_SECRET) → hex
 *   Prefixed with 'sha256='
 *
 * Security:
 *   - Uses crypto.timingSafeEqual() — prevents timing attacks
 *   - Raw body required — JSON parsing before verification breaks HMAC
 *   - Signature failure always returns same error — no information leakage
 *   - Failed attempts logged with IP for monitoring
 *
 * After verification:
 *   - req.webhookPayload contains the parsed JSON body
 *   - Route handlers access req.webhookPayload, not req.body
 *
 * Integration points:
 *   - OpenClaw (Day 5)  — sends X-Artha-Signature on every webhook
 *   - Paperclip (Day 10) — sends X-Artha-Signature on workflow callbacks
 *   - webhook.routes.js  — applies this middleware to /api/webhooks/*
 */
function verifyWebhookMiddleware(req, _res, next) {
  const signature = req.headers['x-artha-signature'];

  if (!signature) {
    req.log && req.log.warn('webhook_missing_signature', { ip: req.ip, path: req.path });
    return next(new WebhookVerificationError());
  }

  if (!signature.startsWith('sha256=')) {
    req.log && req.log.warn('webhook_invalid_signature_format', { ip: req.ip, path: req.path });
    return next(new WebhookVerificationError());
  }

  // Body must be raw Buffer — app.js configures express.raw() for /api/webhooks
  const rawBody = req.body;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    req.log && req.log.warn('webhook_non_buffer_body', { ip: req.ip, path: req.path });
    return next(new WebhookVerificationError());
  }

  // Compute expected signature
  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', config.security.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const sigBuffer      = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  // Length check before timingSafeEqual (different lengths throw)
  if (sigBuffer.length !== expectedBuffer.length) {
    req.log && req.log.warn('webhook_signature_length_mismatch', { ip: req.ip });
    return next(new WebhookVerificationError());
  }

  // Constant-time comparison — prevents timing attacks
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    req.log && req.log.warn('webhook_signature_mismatch', { ip: req.ip, path: req.path });
    return next(new WebhookVerificationError());
  }

  // Parse JSON after verification — never before
  try {
    req.webhookPayload = JSON.parse(rawBody.toString('utf8'));
  } catch (parseErr) {
    req.log && req.log.warn('webhook_json_parse_error', {
      ip:    req.ip,
      error: parseErr.message,
    });
    return next(new WebhookVerificationError());
  }

  return next();
}

module.exports = { verifyWebhookMiddleware };