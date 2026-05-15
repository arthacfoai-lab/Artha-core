'use strict';

const express = require('express');

const { authenticateMiddleware }  = require('../../middleware/auth.middleware');
const { tenantMiddleware }        = require('../../middleware/tenant.middleware');
const { validateBody }            = require('../../middleware/validate.middleware');
const { ok }                      = require('../../helpers/response.helper');
const { route }                   = require('../../engines/routing/routing.engine');
const { getRoutingSession, resetRoutingSession } =
  require('../../engines/routing/session.context');
const { ValidationError }         = require('@artha/errors');
const { Joi }                     = require('@artha/validators');

const router = express.Router();

/**
 * ARTHA Message Routes — /api/v1/message
 *
 * Inbound message routing endpoint.
 * Every user message — WhatsApp, Telegram, or direct API — passes through here.
 *
 * Routes:
 *   POST   /api/v1/message                       — route a message
 *   GET    /api/v1/message/session/:sessionId    — get session state
 *   DELETE /api/v1/message/session/:sessionId    — reset session
 *
 * Day 2: Returns routing decision + intent + outcome.
 * Day 3: Dispatched intents call accounting.engine, result included.
 * Day 4: Understanding Engine enriches payload before routing.
 * Day 5: OpenClaw sends WhatsApp messages directly to POST /message.
 *
 * All routes require authentication + tenant context.
 *
 * Response shape for POST /message:
 *   {
 *     ok:       true,
 *     data: {
 *       outcome:  string  — dispatched | awaiting_confirmation | ...
 *       intent:   string  — canonical intent code
 *       domain:   string  — accounting | gst | ...
 *       score:    number  — confidence 0.0–1.0
 *       message:  string|null — human-readable response to show user
 *       payload:  object  — extracted data (amount, date, party, etc.)
 *       session:  object  — session state snapshot
 *     },
 *     trace_id: string,
 *   }
 *
 * Integration points:
 *   - routing.engine.js    — core routing logic
 *   - session.context.js   — Redis session state
 *   - authenticateMiddleware (Day 1)
 *   - tenantMiddleware (Day 1)
 *   - response.helper      — standardized response shape
 *   - OpenClaw (Day 5)     — posts inbound messages here
 *   - accounting.engine (Day 3) — handles DISPATCHED accounting intents
 */

// All message routes require auth + tenant context
router.use(authenticateMiddleware);
router.use(tenantMiddleware);

// ── Request schemas ────────────────────────────────────────────────────────────

const messageSchema = Joi.object({
  message:   Joi.string().min(1).max(2000).required().messages({
    'string.min':   'message must not be empty',
    'string.max':   'message must not exceed 2000 characters',
    'any.required': 'message is required',
  }),
  sessionId: Joi.string().min(1).max(100).required().messages({
    'any.required': 'sessionId is required',
  }),
  source: Joi.string()
    .valid('whatsapp', 'telegram', 'api')
    .default('api')
    .optional(),
});

const sessionParamSchema = Joi.object({
  sessionId: Joi.string().min(1).max(100).required(),
});

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/message
 *
 * Route an inbound user message.
 * Returns routing outcome — what to do next.
 *
 * Body: { message, sessionId, source? }
 */
router.post(
  '/',
  validateBody(messageSchema),
  async (req, res, next) => {
    try {
      const { message, sessionId, source } = req.validatedBody;

      const result = await route({
        raw:       message,
        companyId: req.tenantContext.companyId,
        userId:    req.tenantContext.userId,
        sessionId,
        traceId:   req.traceId,
        source:    source || 'api',
      });

      req.log && req.log.info('message_routed', {
        outcome:    result.outcome,
        intent:     result.intent,
        score:      result.score,
        session_id: sessionId,
        duration_ms: result.trace.durationMs,
      });

      return ok(res, req, {
        outcome:  result.outcome,
        intent:   result.intent,
        domain:   result.domain,
        score:    result.score,
        message:  result.message,
        payload:  result.payload,
        session:  result.session,
      });

    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/message/session/:sessionId
 *
 * Get current routing session state.
 * Useful for client-side state sync and debugging.
 *
 * Response: { session }
 */
router.get(
  '/session/:sessionId',
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId || sessionId.length < 1 || sessionId.length > 100) {
        throw new ValidationError('sessionId param is required and must be 1–100 chars');
      }

      const session = await getRoutingSession(
        req.tenantContext.companyId,
        sessionId
      );

      return ok(res, req, { session });

    } catch (err) {
      return next(err);
    }
  }
);

/**
 * DELETE /api/v1/message/session/:sessionId
 *
 * Reset routing session to IDLE.
 * User explicitly starts over — clears pending confirmation/clarification.
 *
 * Response: { session }
 */
router.delete(
  '/session/:sessionId',
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;

      if (!sessionId || sessionId.length < 1 || sessionId.length > 100) {
        throw new ValidationError('sessionId param is required and must be 1–100 chars');
      }

      const session = await resetRoutingSession(
        req.tenantContext.companyId,
        sessionId
      );

      req.log && req.log.info('session_reset', {
        session_id:  sessionId,
        company_id:  req.tenantContext.companyId,
      });

      return ok(res, req, { session });

    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;