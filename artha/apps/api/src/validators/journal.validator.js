'use strict';

const Joi = require('joi');
const {
  dateSchema,
  sourceSchema,
  currencySchema,
  narrationSchema,
  narrationOptionalSchema,
  referenceNoSchema,
  uuidParamsSchema,
  dateOptionalSchema,
} = require('./common.validator');

/**
 * Journal entry request validators.
 *
 * Used by accounting.routes.js via validateBody() / validateQuery() middleware.
 *
 * FINTECH RULES enforced at this layer:
 *   - amount must be integer (paise) — float rejected
 *   - minimum 2 lines (double-entry)
 *   - DR/CR type must be uppercase exact match
 *   - ledgerId must be valid UUID
 *
 * Balance validation (DR=CR) happens in balance.engine.js — not here.
 * Schema validates structure. Engine validates financial correctness.
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
      'number.max':     'amount exceeds maximum allowed per line (₹1 crore)',
      'any.required':   'amount is required for each journal line',
    }),

  currency: currencySchema,
});

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

const reverseJournalSchema = Joi.object({
  narration: narrationOptionalSchema,
});

const listJournalSchema = Joi.object({
  fromDate: dateOptionalSchema,
  toDate:   dateOptionalSchema,
  source:   Joi.string()
    .valid('manual', 'whatsapp', 'telegram', 'ocr', 'system', 'api')
    .optional(),
  status: Joi.string()
    .valid('draft', 'posted', 'reversed')
    .optional(),
  limit:  Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

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

const createLedgerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(255).required()
    .messages({ 'any.required': 'Ledger name is required' }),
  code: Joi.string().trim().min(1).max(50).optional().allow('', null),
  type: Joi.string()
    .valid('asset', 'liability', 'equity', 'revenue', 'expense')
    .required()
    .messages({
      'any.only':     'type must be: asset, liability, equity, revenue, or expense',
      'any.required': 'type is required',
    }),
  subType:     Joi.string().trim().max(50).optional().allow('', null),
  description: Joi.string().trim().max(500).optional().allow('', null),
});

module.exports = {
  createJournalSchema,
  journalLineSchema,
  reverseJournalSchema,
  listJournalSchema,
  dateRangeQuerySchema,
  createLedgerSchema,
  uuidParamsSchema,
};