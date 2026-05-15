'use strict';

const Joi = require('joi');

/**
 * GSTIN validation schema and helpers.
 *
 * GSTIN format (15 characters):
 *   Positions 1-2:   State code (01–37)
 *   Positions 3-12:  PAN number (10 chars: AAAAA9999A)
 *   Position  13:    Entity number (1–9, A–Z)
 *   Position  14:    'Z' (always)
 *   Position  15:    Check digit (0–9 or A–Z)
 *
 * Examples:
 *   27AAAAA0000A1Z5  — Maharashtra
 *   09BBBBB1111B2Z3  — Uttar Pradesh
 *
 * Valid state codes: 01–37 (includes UT codes)
 *
 * Used by:
 *   - Company registration (optional GSTIN)
 *   - GST engine (Day 6) — mandatory for GST transactions
 *   - OCR extraction (Day 7) — validate extracted GSTIN
 */

// Full GSTIN regex — 15 chars, structure-validated
const GSTIN_REGEX = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Valid state codes 01–37 (as strings)
const VALID_STATE_CODES = new Set(
  Array.from({ length: 37 }, (_, i) => String(i + 1).padStart(2, '0'))
);

/**
 * Joi schema for GSTIN — optional by default.
 * Use .required() when mandatory.
 */
const gstinSchema = Joi.string()
  .uppercase()
  .length(15)
  .pattern(GSTIN_REGEX)
  .optional()
  .description('GST Identification Number — 15 character alphanumeric');

/**
 * Joi schema for GSTIN — required.
 */
const gstinRequiredSchema = Joi.string()
  .uppercase()
  .length(15)
  .pattern(GSTIN_REGEX)
  .required()
  .description('GST Identification Number — required');

/**
 * Validate a GSTIN string deterministically.
 * Returns structured result — never throws.
 *
 * @param {string} gstin
 * @returns {{ valid: boolean, error?: string, stateCode?: string, pan?: string }}
 */
function validateGSTIN(gstin) {
  if (!gstin || typeof gstin !== 'string') {
    return { valid: false, error: 'GSTIN is required' };
  }

  const upper = gstin.trim().toUpperCase();

  if (upper.length !== 15) {
    return { valid: false, error: `GSTIN must be 15 characters, got ${upper.length}` };
  }

  if (!GSTIN_REGEX.test(upper)) {
    return { valid: false, error: 'GSTIN format is invalid' };
  }

  const stateCode = upper.slice(0, 2);
  if (!VALID_STATE_CODES.has(stateCode)) {
    return { valid: false, error: `Invalid state code: ${stateCode}` };
  }

  const pan = upper.slice(2, 12);

  return {
    valid:     true,
    stateCode,
    pan,
    gstin:     upper,
  };
}

/**
 * Extract state name from GSTIN state code.
 * Returns null for unknown codes.
 *
 * @param {string} gstin
 * @returns {string|null}
 */
function getStateFromGSTIN(gstin) {
  if (!gstin || gstin.length < 2) { return null; }
  const code = gstin.slice(0, 2);
  return STATE_CODE_MAP[code] || null;
}

const STATE_CODE_MAP = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

module.exports = {
  gstinSchema,
  gstinRequiredSchema,
  validateGSTIN,
  getStateFromGSTIN,
  GSTIN_REGEX,
  STATE_CODE_MAP,
};