'use strict';

const { validate } = require('@artha/validators');

/**
 * ARTHA Validation Middleware Factory
 *
 * Creates Express middleware that validates req.body, req.query,
 * or req.params against a Joi schema before reaching the route handler.
 *
 * On success:
 *   Validated + coerced value stored on req.validatedBody / req.validatedQuery / req.validatedParams
 *   Calls next() — handler proceeds
 *
 * On failure:
 *   Calls next(ValidationError) — error.middleware.js returns 400
 *   Route handler never executes
 *
 * Usage:
 *   const { validateBody, validateQuery } = require('../middleware/validate.middleware');
 *   const { loginSchema } = require('../validators/auth.validator');
 *
 *   router.post('/login',
 *     validateBody(loginSchema),
 *     async (req, res, next) => {
 *       const { email, password, companyId } = req.validatedBody;
 *       // ...
 *     }
 *   );
 *
 * Integration points:
 *   - All route handlers — body, query, param validation
 *   - @artha/validators validate() — core validation function (Day 2)
 *   - error.middleware.js (Day 1) — catches ValidationError from next()
 *
 * Note: This middleware is the Express-layer wrapper around @artha/validators validate().
 * For non-HTTP contexts (workers, schedulers), call validate() directly.
 */

/**
 * Validate req.body against schema.
 * Stores validated value on req.validatedBody.
 *
 * @param {Joi.Schema} schema
 * @param {object} [options] — Joi options override
 * @returns {Function} Express middleware
 */
function validateBody(schema, options = {}) {
  return function bodyValidator(req, _res, next) {
    try {
      req.validatedBody = validate(req.body || {}, schema, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Validate req.query against schema.
 * Stores validated value on req.validatedQuery.
 *
 * @param {Joi.Schema} schema
 * @param {object} [options]
 * @returns {Function} Express middleware
 */
function validateQuery(schema, options = {}) {
  return function queryValidator(req, _res, next) {
    try {
      req.validatedQuery = validate(req.query || {}, schema, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Validate req.params against schema.
 * Stores validated value on req.validatedParams.
 *
 * @param {Joi.Schema} schema
 * @param {object} [options]
 * @returns {Function} Express middleware
 */
function validateParams(schema, options = {}) {
  return function paramsValidator(req, _res, next) {
    try {
      req.validatedParams = validate(req.params || {}, schema, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
};