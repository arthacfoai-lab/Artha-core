'use strict';

const Joi = require('joi');

/**
 * Common validators — reused across all route domains.
 *
 * Imported by journal, GST, vendor, customer validators.
 * Never duplicated — single source of truth for shared schemas.
 */

const uuidSchema = Joi.string()
  .uuid({ version: 'uuidv4' })
  .required()
  .messages({
    'string.guid':  'Must be a valid UUID v4',
    'any.required': 'ID is required',
  });

const uuidParamsSchema = Joi.object({ id: uuidSchema });

const dateSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .required()
  .messages({
    'string.pattern.base': 'Date must be in YYYY-MM-DD format',
    'any.required':        'Date is required',
  });

const dateOptionalSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .messages({ 'string.pattern.base': 'Date must be in YYYY-MM-DD format' });

const dateRangeSchema = Joi.object({
  fromDate: dateSchema,
  toDate:   Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({
      'string.pattern.base': 'toDate must be in YYYY-MM-DD format',
      'any.required':        'toDate is required',
    }),
});

const sourceSchema = Joi.string()
  .valid('manual', 'whatsapp', 'telegram', 'ocr', 'system', 'api')
  .default('api')
  .optional();

const currencySchema = Joi.string()
  .valid('INR')
  .default('INR')
  .optional()
  .messages({ 'any.only': 'Only INR is currently supported' });

const phoneSchema = Joi.string()
  .trim()
  .pattern(/^[6-9]\d{9}$/)
  .optional()
  .allow('', null)
  .messages({ 'string.pattern.base': 'Phone must be a valid 10-digit Indian mobile number' });

const narrationSchema = Joi.string()
  .trim()
  .min(1)
  .max(500)
  .required()
  .messages({
    'string.min':   'Narration must not be empty',
    'string.max':   'Narration must not exceed 500 characters',
    'any.required': 'Narration is required',
  });

const narrationOptionalSchema = Joi.string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .allow('', null);

const referenceNoSchema = Joi.string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .allow('', null);

module.exports = {
  uuidSchema,
  uuidParamsSchema,
  dateSchema,
  dateOptionalSchema,
  dateRangeSchema,
  sourceSchema,
  currencySchema,
  phoneSchema,
  narrationSchema,
  narrationOptionalSchema,
  referenceNoSchema,
};