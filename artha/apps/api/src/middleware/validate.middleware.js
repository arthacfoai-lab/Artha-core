'use strict';

const { ValidationError } = require('@artha/errors');

/**
 * ARTHA Validation Middleware Factory
 *
 * Creates Express middleware that validates req.body / req.query / req.params
 * against a Joi schema before reaching the route handler.
 *
 * On success: validated value stored on req.validatedBody / req.validatedQuery / req.validatedParams
 * On failure: next(ValidationError) — error.middleware returns 400
 *
 * Uses Joi directly — does not require @artha/validators package.
 * This allows route files to import validators from local validators/ dir.
 */

const DEFAULT_OPTIONS = {
  abortEarly:   false,
  stripUnknown: true,
  convert:      true,
};

function _validate(data, schema, options = {}) {
  const { error, value } = schema.validate(data, { ...DEFAULT_OPTIONS, ...options });

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

function validateBody(schema, options = {}) {
  return function bodyValidator(req, _res, next) {
    try {
      req.validatedBody = _validate(req.body || {}, schema, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function validateQuery(schema, options = {}) {
  return function queryValidator(req, _res, next) {
    try {
      req.validatedQuery = _validate(req.query || {}, schema, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function validateParams(schema, options = {}) {
  return function paramsValidator(req, _res, next) {
    try {
      req.validatedParams = _validate(req.params || {}, schema, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { validateBody, validateQuery, validateParams };