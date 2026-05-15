'use strict';

const Joi = require('joi');

/**
 * Money validation schemas — ARTHA fintech safety rules.
 *
 * CRITICAL RULES:
 *   - All monetary values stored and transmitted as INTEGER PAISE
 *   - Never accept float/decimal amounts — reject at validation boundary
 *   - Never use parseFloat on money — use parseInt only
 *   - 1 rupee = 100 paise. ₹500 = 50000 paise.
 *   - Maximum single transaction: ₹10 crore = 1,000,000,000 paise
 *   - Minimum amount: 1 paise (₹0.01)
 *
 * Two input modes supported:
 *
 *   paise  — raw integer (API internal, worker communication)
 *     e.g. 50000 → ₹500.00
 *
 *   rupees — decimal string from user-facing input (UI, WhatsApp)
 *     e.g. "500" or "500.50" → converted to paise on ingest
 *     Accepted formats: "500", "500.50", "5,000", "5,000.50"
 *
 * Conversion helpers:
 *   rupeesToPaise(rupees)  — string/number → integer paise
 *   paiseTOrupees(paise)   — integer paise → string rupees (2 decimal)
 *   formatINR(paise)       — integer paise → "₹5,000.00" (Indian locale)
 */

const MAX_PAISE = 1_000_000_000; // ₹1 crore
const MIN_PAISE = 1;             // ₹0.01

/**
 * Paise schema — for internal API communication.
 * Accepts only positive integers.
 */
const paiseSchema = Joi.number()
  .integer()
  .min(MIN_PAISE)
  .max(MAX_PAISE)
  .required()
  .description('Amount in paise (integer). 1 rupee = 100 paise.');

/**
 * Optional paise schema — for filter/query params.
 */
const paiseOptionalSchema = Joi.number()
  .integer()
  .min(MIN_PAISE)
  .max(MAX_PAISE)
  .optional();

/**
 * Rupee string schema — for user-facing input.
 * Accepts "500", "500.50", "5,000", "5,000.50"
 * Strips commas, validates decimal places max 2.
 */
const rupeeStringSchema = Joi.string()
  .pattern(/^\d{1,10}(,\d{3})*(\.\d{1,2})?$/)
  .required()
  .description('Amount in rupees. Examples: "500", "1,500.50"');

/**
 * Convert rupee string/number to integer paise.
 * Rejects floats from JS arithmetic — uses string parsing only.
 *
 * @param {string|number} rupees
 * @returns {number} integer paise
 * @throws {Error} if result is not a valid integer paise amount
 */
function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined) {
    throw new Error('rupeesToPaise: amount is required');
  }

  // Remove commas from Indian number format
  const cleaned = String(rupees).replace(/,/g, '').trim();

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`rupeesToPaise: invalid amount format — "${rupees}"`);
  }

  const parts = cleaned.split('.');
  const rupeePart = parseInt(parts[0], 10);
  const paisePart = parts[1]
    ? parseInt(parts[1].padEnd(2, '0'), 10)
    : 0;

  const total = rupeePart * 100 + paisePart;

  if (!Number.isInteger(total) || total < MIN_PAISE) {
    throw new Error(`rupeesToPaise: result ${total} is invalid paise`);
  }

  if (total > MAX_PAISE) {
    throw new Error(`rupeesToPaise: amount ₹${rupees} exceeds maximum allowed`);
  }

  return total;
}

/**
 * Convert integer paise to rupee string with 2 decimal places.
 *
 * @param {number} paise — integer
 * @returns {string} e.g. "500.00"
 */
function paiseToRupees(paise) {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(`paiseToRupees: invalid paise value — ${paise}`);
  }
  return (paise / 100).toFixed(2);
}

/**
 * Format paise as Indian locale currency string.
 *
 * @param {number} paise — integer
 * @returns {string} e.g. "₹5,000.00"
 */
function formatINR(paise) {
  if (!Number.isInteger(paise) || paise < 0) { return '₹0.00'; }
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

module.exports = {
  paiseSchema,
  paiseOptionalSchema,
  rupeeStringSchema,
  rupeesToPaise,
  paiseToRupees,
  formatINR,
  MAX_PAISE,
  MIN_PAISE,
};