'use strict';

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const config  = require('@artha/config');

const { traceMiddleware }          = require('./middleware/trace.middleware');
const { requestLoggerMiddleware }  = require('./middleware/request-logger.middleware');
const { errorMiddleware, notFoundMiddleware } = require('./middleware/error.middleware');

const systemRoutes = require('./routes/system.routes');
const v1Routes     = require('./routes/v1/index');

/**
 * ARTHA Express App Factory
 *
 * Creates and configures the Express application.
 * Exported as a factory function — not a singleton.
 * Allows multiple instances for testing without port conflicts.
 *
 * Middleware execution order — CRITICAL, do not reorder:
 *   1.  helmet         — security headers (first, always)
 *   2.  cors           — CORS headers
 *   3.  rate limiting  — before any processing
 *   4.  trace          — attach trace_id to every request
 *   5.  body parsing   — JSON for API, raw buffer for webhooks
 *   6.  request logger — log after body parsed, before routing
 *   7.  routes         — system + v1
 *   8.  404 handler    — catches unmatched routes
 *   9.  error handler  — MUST be last, catches all thrown errors
 *
 * Routes:
 *   /health            — liveness probe
 *   /ready             — readiness probe (checks DB + Redis)
 *   /version           — build metadata
 *   /api/v1/*          — ARTHA API v1
 *   /api/webhooks/*    — OpenClaw + Paperclip webhooks (Day 5+)
 */
function createApp() {
  const app = express();

  // ── 1. Security headers ────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy:    config.isProd,
    crossOriginEmbedderPolicy: config.isProd,
  }));

  // ── 2. CORS ────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: config.isProd ? false : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Trace-Id',
      'X-Artha-Signature',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Trace-Id'],
    credentials: false,
  }));

  // ── 3. Rate limiting ───────────────────────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: config.security.rateLimit.windowMs,
    max:      config.security.rateLimit.max,
    standardHeaders: true,
    legacyHeaders:   false,
    handler: (_req, res) => {
      res.status(429).json({
        ok:    false,
        error: {
          code:    'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      });
    },
    skip: (req) => req.path === '/health' || req.path === '/ready',
  });

  app.use('/api/', apiLimiter);

  // ── 4. Trace ID ────────────────────────────────────────────────────────────
  app.use(traceMiddleware);

  // ── 5. Body parsing ────────────────────────────────────────────────────────
  // JSON for standard API routes
  app.use('/api/v1', express.json({ limit: '1mb' }));
  app.use('/api/v1', express.urlencoded({ extended: false, limit: '1mb' }));

  // Raw buffer for webhook routes (HMAC verification needs raw body)
  // Webhook middleware parses JSON AFTER signature verification
  app.use('/api/webhooks', express.raw({
    type:  'application/json',
    limit: '512kb',
  }));

  // ── 6. Request logger ──────────────────────────────────────────────────────
  app.use(requestLoggerMiddleware);

  // ── 7. Routes ──────────────────────────────────────────────────────────────
  app.use('/', systemRoutes);       // /health /ready /version
  app.use('/api/v1', v1Routes);     // /api/v1/...

  // ── 8. 404 handler ─────────────────────────────────────────────────────────
  app.use(notFoundMiddleware);

  // ── 9. Error handler — MUST be last ───────────────────────────────────────
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };