'use strict';

const { Joi } = require('@artha/validators');

/**
 * Common validators — reused across all route domains.
 *
 * Imported by accounting, GST, vendor, customer validators.
 * Never duplicated — single source of truth.
 *
 * Exports:
 *   uuidSchema         — single UUID param
 *   uuidParamsSchema   — { id } URL param object
 *   dateSchema         — ISO date string YYYY-MM-DD
 *   dateRangeSchema    — { fromDate, toDate }
 *   paginationSchema   — { limit, offset, page }
 *   sourceSchema       — transaction source enum
 *   currencySchema     — ISO 4217 currency code
 *   phoneSchema        — Indian mobile number
 */

/**
 * UUID v4 string.
 */
const uuidSchema = Joi.string()
  .uuid({ version: 'uuidv4' })
  .required()
  .messages({
    'string.guid':  'Must be a valid UUID v4',
    'any.required': 'ID is required',
  });

/**
 * { id } URL parameter object — used with validateParams().
 */
const uuidParamsSchema = Joi.object({
  id: uuidSchema,
});

/**
 * ISO date string — YYYY-MM-DD.
 * Used for journal entry dates, GST filing periods, report ranges.
 */
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
  .messages({
    'string.pattern.base': 'Date must be in YYYY-MM-DD format',
  });

/**
 * Date range — { fromDate, toDate } both YYYY-MM-DD.
 * toDate must be >= fromDate.
 */
const dateRangeSchema = Joi.object({
  fromDate: dateSchema,
  toDate:   Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .custom((value, helpers) => {
      const from = helpers.state.ancestors[0].fromDate;
      if (from && value < from) {
        return helpers.error('date.range');
      }
      return value;
    })
    .messages({
      'string.pattern.base': 'toDate must be in YYYY-MM-DD format',
      'any.required':        'toDate is required',
      'date.range':          'toDate must be on or after fromDate',
    }),
});

/**
 * Transaction source enum.
 * Matches journal_entries.source CHECK constraint in migration 001.
 */
const sourceSchema = Joi.string()
  .valid('manual', 'whatsapp', 'telegram', 'ocr', 'system', 'api')
  .default('api')
  .optional();

/**
 * ISO 4217 currency code.
 * Currently only INR supported — extendable.
 */
const currencySchema = Joi.string()
  .valid('INR')
  .default('INR')
  .optional()
  .messages({
    'any.only': 'Only INR is currently supported',
  });

/**
 * Indian mobile number — 10 digits, starts with 6-9.
 */
const phoneSchema = Joi.string()
  .trim()
  .pattern(/^[6-9]\d{9}$/)
  .optional()
  .allow('', null)
  .messages({
    'string.pattern.base': 'Phone must be a valid 10-digit Indian mobile number',
  });

/**
 * Narration / description text.
 * Used for journal entry narrations, vendor notes, etc.
 */
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

/**
 * Reference number — invoice, receipt, bill number.
 */
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