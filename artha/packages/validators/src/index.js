'use strict';

const Joi = require('joi');
const { ValidationError } = require('@artha/errors');

/**
 * ARTHA Validators Package — Public API
 *
 * Centralizes all Joi validation schemas and helpers.
 * Shared across apps/api, apps/worker, apps/scheduler.
 *
 * Usage in route handlers:
 *   const { validate, authSchemas } = require('@artha/validators');
 *
 *   router.post('/login', async (req, res, next) => {
 *     const body = validate(req.body, authSchemas.login);
 *     // body is validated + typed — throws ValidationError if invalid
 *   });
 *
 * Usage as Express middleware:
 *   router.post('/login', validateBody(authSchemas.login), handler);
 *
 * Exported schemas:
 *   pagination  — limit/offset/page
 *   money       — paise/rupee validation + conversion
 *   gstin       — GSTIN format validation
 *
 * Domain schemas added per day:
 *   authSchemas       — Day 2
 *   journalSchemas    — Day 3
 *   gstSchemas        — Day 6
 *   vendorSchemas     — Day 8
 *   customerSchemas   — Day 8
 */

const { paginationSchema, resolvePagination } = require('./schemas/pagination.schema');
const moneySchemas = require('./schemas/money.schema');
const gstinSchemas = require('./schemas/gstin.schema');

/**
 * Validate data against a Joi schema.
 * Throws ValidationError (typed) on failure — never raw Joi error.
 * Returns validated + coerced value on success.
 *
 * @param {object} data        — raw input (req.body, req.query, etc.)
 * @param {Joi.Schema} schema  — Joi schema to validate against
 * @param {object} [options]   — Joi options override
 * @returns {object} validated value
 * @throws {ValidationError}
 */
function validate(data, schema, options = {}) {
  const defaultOptions = {
    abortEarly:   false,   // collect all errors, not just first
    stripUnknown: true,    // remove unknown fields — security best practice
    convert:      true,    // coerce types (string "50" → number 50)
  };

  const { error, value } = schema.validate(data, { ...defaultOptions, ...options });

  if (error) {
    const message = error.details
      .map((d) => d.message.replace(/['"]/g, ''))
      .join('; ');

    const meta = {
      fields: error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
        type:    d.type,
      })),
    };

    throw new ValidationError(message, meta);
  }

  return value;
}

/**
 * Express middleware factory — validates req.body against schema.
 * Passes validated value back on req.validatedBody.
 * Calls next(ValidationError) on failure.
 *
 * @param {Joi.Schema} schema
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
  return function bodyValidationMiddleware(req, _res, next) {
    try {
      req.validatedBody = validate(req.body, schema);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Express middleware factory — validates req.query against schema.
 * Passes validated value back on req.validatedQuery.
 *
 * @param {Joi.Schema} schema
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
  return function queryValidationMiddleware(req, _res, next) {
    try {
      req.validatedQuery = validate(req.query, schema);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Express middleware factory — validates req.params against schema.
 *
 * @param {Joi.Schema} schema
 * @returns {Function} Express middleware
 */
function validateParams(schema) {
  return function paramsValidationMiddleware(req, _res, next) {
    try {
      req.validatedParams = validate(req.params, schema);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Common UUID param schema — reusable for :id params.
 */
const uuidParamSchema = Joi.object({
  id: Joi.string().uuid({ version: 'uuidv4' }).required(),
});

module.exports = {
  // Core validation function
  validate,

  // Middleware factories
  validateBody,
  validateQuery,
  validateParams,

  // Common schemas
  paginationSchema,
  resolvePagination,
  uuidParamSchema,

  // Domain schemas
  money:  moneySchemas,
  gstin:  gstinSchemas,

  // Re-export Joi for schema composition in consuming packages
  Joi,
};