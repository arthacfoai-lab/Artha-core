'use strict';

const { Joi }        = require('@artha/validators');
const {
  dateSchema,
  dateRangeSchema,
  sourceSchema,
  currencySchema,
  narrationSchema,
  referenceNoSchema,
  uuidParamsSchema,
} = require('./common.validator');

/**
 * Journal entry request validators.
 *
 * Used by accounting.routes.js (Day 3) via validateBody() middleware.
 * All schemas integrate with the fintech money rules from @artha/validators.
 *
 * IMPORTANT:
 *   All amount fields accept paise (BIGINT integer).
 *   Never accept float amounts — validation rejects them.
 *   Conversion from rupee strings happens at the UI/WhatsApp layer
 *   before reaching these validators.
 *
 * Schemas:
 *   createJournalSchema    — POST /api/v1/accounting/journal
 *   journalLineSchema      — individual DR/CR line
 *   listJournalSchema      — GET /api/v1/accounting/journal (query params)
 *   reverseJournalSchema   — POST /api/v1/accounting/journal/:id/reverse
 *   dateRangeQuerySchema   — shared date range query params
 */

/**
 * Single journal line schema.
 * Part of createJournalSchema lines array.
 */
const journalLineSchema = Joi.object({
  ledgerId: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'any.required': 'ledgerId is required for each journal line',
      'string.guid':  'ledgerId must be a valid UUID',
    }),

  type: Joi.string()
    .valid('DR', 'CR')
    .uppercase()
    .required()
    .messages({
      'any.only':     'type must be DR (debit) or CR (credit)',
      'any.required': 'type is required for each journal line',
    }),

  amount: Joi.number()
    .integer()
    .min(1)
    .max(1_000_000_000)
    .required()
    .messages({
      'number.integer': 'amount must be an integer (paise) — no decimals allowed',
      'number.min':     'amount must be at least 1 paise',
      'number.max':     'amount exceeds maximum allowed per line',
      'any.required':   'amount is required for each journal line',
    }),

  currency: currencySchema,
});

/**
 * Create journal entry schema.
 * Validates full double-entry request.
 *
 * Minimum 2 lines required (double-entry rule).
 * Balance (DR total = CR total) validated in accounting engine — not here.
 * Schema validates structure, engine validates financial correctness.
 */
const createJournalSchema = Joi.object({
  entryDate:   dateSchema,
  narration:   narrationSchema,
  referenceNo: referenceNoSchema,
  source:      sourceSchema,

  lines: Joi.array()
    .items(journalLineSchema)
    .min(2)
    .required()
    .messages({
      'array.min':    'Journal entry requires at least 2 lines (double-entry)',
      'any.required': 'lines array is required',
    }),

  metadata: Joi.object()
    .optional()
    .default({}),
});

/**
 * Reverse journal entry schema.
 * Used for POST /api/v1/accounting/journal/:id/reverse
 */
const reverseJournalSchema = Joi.object({
  narration: Joi.string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .allow('', null)
    .description('Optional custom narration for reversal entry'),
});

/**
 * List journals query schema.
 * Used for GET /api/v1/accounting/journal
 */
const listJournalSchema = Joi.object({
  fromDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({ 'string.pattern.base': 'fromDate must be YYYY-MM-DD' }),

  toDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({ 'string.pattern.base': 'toDate must be YYYY-MM-DD' }),

  source: Joi.string()
    .valid('manual', 'whatsapp', 'telegram', 'ocr', 'system', 'api')
    .optional(),

  status: Joi.string()
    .valid('draft', 'posted', 'reversed')
    .optional(),

  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

/**
 * Date range query schema — reused by ledger + report queries.
 */
const dateRangeQuerySchema = Joi.object({
  fromDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({ 'string.pattern.base': 'fromDate must be YYYY-MM-DD' }),

  toDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({ 'string.pattern.base': 'toDate must be YYYY-MM-DD' }),
});

module.exports = {
  createJournalSchema,
  journalLineSchema,
  reverseJournalSchema,
  listJournalSchema,
  dateRangeQuerySchema,
  uuidParamsSchema,
};