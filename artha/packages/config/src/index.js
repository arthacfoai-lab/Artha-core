'use strict';

/**
 * ARTHA Centralized Configuration
 *
 * Single source of truth for all runtime configuration.
 * Validates environment at import time — fails fast on startup.
 *
 * Usage across the entire codebase:
 *   const config = require('@artha/config');
 *   config.app.port
 *   config.database.url
 *   config.jwt.secret
 *
 * Rules:
 *   - Never access process.env directly anywhere outside this file
 *   - Never use config values before this module is imported
 *   - Adding new config: add to env.schema.js first, then here
 *   - All secrets come from environment — never hardcoded
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../../.env'),
});

const { validateEnv } = require('./env.schema');

// Validate at import time. If env is broken, startup fails here with
// a clear error message listing all problems. Never proceeds silently.
const env = validateEnv(process.env);

const config = Object.freeze({

  // ── Runtime ───────────────────────────────────────────────────────────────
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  isProd: env.NODE_ENV === 'production',

  // ── App ───────────────────────────────────────────────────────────────────
  app: Object.freeze({
    name: env.APP_NAME,
    version: env.APP_VERSION,
    port: env.PORT,
  }),

  // ── Database ──────────────────────────────────────────────────────────────
  database: Object.freeze({
    url: env.DATABASE_URL,
    pool: Object.freeze({
      min: env.DATABASE_POOL_MIN,
      max: env.DATABASE_POOL_MAX,
    }),
  }),

  // ── Redis ─────────────────────────────────────────────────────────────────
  redis: Object.freeze({
    url: env.REDIS_URL,
    sessionTtl: env.REDIS_SESSION_TTL_SECONDS,
  }),

  // ── JWT ───────────────────────────────────────────────────────────────────
  jwt: Object.freeze({
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  }),

  // ── Security ──────────────────────────────────────────────────────────────
  security: Object.freeze({
    webhookSecret: env.WEBHOOK_SECRET,
    rateLimit: Object.freeze({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX_REQUESTS,
    }),
  }),

  // ── Logging ───────────────────────────────────────────────────────────────
  logging: Object.freeze({
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
  }),

});

module.exports = config;