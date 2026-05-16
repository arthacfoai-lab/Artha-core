'use strict';

const express = require('express');

const { authenticateMiddleware }  = require('../../middleware/auth.middleware');
const { tenantMiddleware }        = require('../../middleware/tenant.middleware');
const { validateBody }            = require('../../middleware/validate.middleware');
const { ok }                      = require('../../helpers/response.helper');
const { route }                   = require('../../engines/routing/routing.engine');
const {
  getRoutingSession,
  resetRoutingSession,
} = require('../../engines/routing/session.context');

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
 */

// All message routes require auth + tenant context
router.use(authenticateMiddleware);
router.use(tenantMiddleware);

// ── Request schemas ────────────────────────────────────────────────────────────

const messageSchema = Joi.object({

  message: Joi.string()
    .min(1)
    .max(2000)
    .required()
    .messages({
      'string.min':
        'message must not be empty',

      'string.max':
        'message must not exceed 2000 characters',

      'any.required':
        'message is required',
    }),

  sessionId: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'any.required':
        'sessionId is required',
    }),

  source: Joi.string()
    .valid(
      'whatsapp',
      'telegram',
      'api'
    )
    .default('api')
    .optional(),
});

const sessionParamSchema = Joi.object({

  sessionId: Joi.string()
    .min(1)
    .max(100)
    .required(),
});

// ── POST /api/v1/message ──────────────────────────────────────────────────────

router.post(
  '/',
  validateBody(messageSchema),

  async (req, res, next) => {

    try {

      const {
        message,
        sessionId,
        source,
      } = req.validatedBody;

      const result = await route({

        raw:
          message,

        companyId:
          req.tenantContext.companyId,

        userId:
          req.tenantContext.userId,

        sessionId,

        traceId:
          req.traceId,

        source:
          source || 'api',
      });

      req.log && req.log.info(
        'message_routed',
        {
          outcome:
            result.outcome,

          intent:
            result.intent,

          score:
            result.score,

          session_id:
            sessionId,

          duration_ms:
            result.trace?.durationMs,
        }
      );

      return ok(res, req, {

        outcome:
          result.outcome,

        intent:
          result.intent,

        domain:
          result.domain,

        score:
          result.score,

        message:
          result.message,

        payload:
          result.payload,

        session:
          result.session,
      });

    } catch (err) {

      return next(err);
    }
  }
);

// ── GET /api/v1/message/session/:sessionId ───────────────────────────────────

router.get(
  '/session/:sessionId',

  async (req, res, next) => {

    try {

      const {
        sessionId,
      } = req.params;

      if (
        !sessionId ||
        sessionId.length < 1 ||
        sessionId.length > 100
      ) {
        throw new ValidationError(
          'sessionId param is required and must be 1–100 chars'
        );
      }

      const sessionData =
        await getRoutingSession(
          req.tenantContext.companyId,
          sessionId
        );

      const session =
        sessionData || {
          state: 'idle',
        };

      return ok(res, req, {
        session,
      });

    } catch (err) {

      return next(err);
    }
  }
);

// ── DELETE /api/v1/message/session/:sessionId ────────────────────────────────

router.delete(
  '/session/:sessionId',

  async (req, res, next) => {

    try {

      const {
        sessionId,
      } = req.params;

      if (
        !sessionId ||
        sessionId.length < 1 ||
        sessionId.length > 100
      ) {
        throw new ValidationError(
          'sessionId param is required and must be 1–100 chars'
        );
      }

      await resetRoutingSession(
        req.tenantContext.companyId,
        sessionId
      );

      req.log && req.log.info(
        'session_reset',
        {
          session_id:
            sessionId,

          company_id:
            req.tenantContext.companyId,
        }
      );

      return ok(res, req, {
        session: {
          state: 'idle',
        },
      });

    } catch (err) {

      return next(err);
    }
  }
);

module.exports = router;