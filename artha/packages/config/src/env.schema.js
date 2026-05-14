'use strict';

const Joi = require('joi');

/**
 * ARTHA Environment Schema
 *
 * Every required environment variable is validated at process startup.
 * Fail-fast — never silently proceed with missing or malformed config.
 *
 * Rules:
 *   - All required vars throw on missing — no defaults for secrets
 *   - Numeric vars are coerced from strings automatically by Joi
 *   - JWT_SECRET minimum 32 chars — enforced at schema level
 *   - WEBHOOK_SECRET minimum 16 chars — enforced at schema level
 *   - NODE_ENV must be one of the allowed values — no typos silently ignored
 *
 * Adding a new environment variable:
 *   1. Add it here with type + constraints
 *   2. Add it to .env.example with documentation
 *   3. Add it to packages/config/src/index.js config object
 *   4. Never access process.env directly anywhere else in the codebase
 */

const envSchema = Joi.object({

  // ── Runtime ────────────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),

  PORT: Joi.number()
    .integer()
    .min(1024)
    .max(65535)
    .default(3000),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required()
    .description('PostgreSQL connection string'),

  DATABASE_POOL_MIN: Joi.number()
    .integer()
    .min(1)
    .default(2),

  DATABASE_POOL_MAX: Joi.number()
    .integer()
    .min(2)
    .default(10),

  // ── Redis ──────────────────────────────────────────────────────────────────
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required()
    .description('Redis connection string'),

  REDIS_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .default(3600),

  // ── JWT ────────────────────────────────────────────────────────────────────
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description('JWT signing secret — minimum 32 characters'),

  JWT_EXPIRES_IN: Joi.string()
    .default('24h'),

  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .default('7d'),

  // ── Security ───────────────────────────────────────────────────────────────
  WEBHOOK_SECRET: Joi.string()
    .min(16)
    .required()
    .description('Shared secret for OpenClaw and Paperclip webhook verification'),

  RATE_LIMIT_WINDOW_MS: Joi.number()
    .integer()
    .min(1000)
    .default(60000),

  RATE_LIMIT_MAX_REQUESTS: Joi.number()
    .integer()
    .min(1)
    .default(100),

  // ── Logging ────────────────────────────────────────────────────────────────
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug', 'silent')
    .default('info'),

  LOG_FORMAT: Joi.string()
    .valid('json', 'pretty')
    .default('json'),

  // ── App metadata ───────────────────────────────────────────────────────────
  APP_VERSION: Joi.string()
    .default('0.1.0'),

  APP_NAME: Joi.string()
    .default('artha-api'),

}).unknown(true); // allow other OS-level env vars through

/**
 * Validate process.env against schema.
 * Throws a descriptive error listing ALL missing/invalid vars at once.
 * Called once at process startup — never lazily.
 *
 * @param {object} env — typically process.env
 * @returns {object} validated + coerced env values
 */
function validateEnv(env) {
  const { error, value } = envSchema.validate(env, {
    abortEarly: false,      // collect ALL errors, not just first
    stripUnknown: false,    // preserve unknown vars
    convert: true,          // coerce strings to numbers where schema says number
  });

  if (error) {
    const problems = error.details
      .map((d) => `  • ${d.message}`)
      .join('\n');

    throw new Error(
      `\n\nARTHA startup failed — environment configuration invalid:\n${problems}\n\n` +
      `Check your .env file against .env.example\n`
    );
  }

  return value;
}

module.exports = { validateEnv, envSchema };