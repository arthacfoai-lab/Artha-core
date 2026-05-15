'use strict';

const { Joi } = require('@artha/validators');

/**
 * Auth request validators.
 *
 * Used by auth.routes.js via validateBody() middleware.
 * All schemas strip unknown fields (stripUnknown: true in validate()).
 *
 * Schemas:
 *   register — POST /api/v1/auth/register
 *   login    — POST /api/v1/auth/login
 *   refresh  — POST /api/v1/auth/refresh
 */

/**
 * Registration schema.
 *
 * Required:
 *   companyName — business name
 *   ownerName   — owner full name
 *   email       — owner email (unique within company)
 *   password    — min 8 chars
 *
 * Optional:
 *   gstin        — GST number (validated format if provided)
 *   pan          — PAN number
 *   businessType — sole_proprietor | partnership | pvt_ltd | llp | other
 *   companyPhone — business phone
 */
const registerSchema = Joi.object({
  companyName: Joi.string()
    .trim()
    .min(2)
    .max(255)
    .required()
    .messages({
      'string.min':  'Company name must be at least 2 characters',
      'any.required': 'Company name is required',
    }),

  gstin: Joi.string()
    .trim()
    .uppercase()
    .length(15)
    .pattern(/^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    .optional()
    .allow('', null)
    .messages({
      'string.pattern.base': 'GSTIN format is invalid — must be 15 character alphanumeric',
      'string.length':       'GSTIN must be exactly 15 characters',
    }),

  pan: Joi.string()
    .trim()
    .uppercase()
    .length(10)
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
    .optional()
    .allow('', null)
    .messages({
      'string.pattern.base': 'PAN format is invalid — must be 10 character alphanumeric',
    }),

  businessType: Joi.string()
    .valid('sole_proprietor', 'partnership', 'pvt_ltd', 'llp', 'other')
    .optional()
    .allow('', null),

  companyPhone: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .optional()
    .allow('', null)
    .messages({
      'string.pattern.base': 'Phone must be a valid 10-digit Indian mobile number',
    }),

  ownerName: Joi.string()
    .trim()
    .min(2)
    .max(255)
    .required()
    .messages({
      'any.required': 'Owner name is required',
    }),

  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .max(255)
    .required()
    .messages({
      'string.email':  'A valid email address is required',
      'any.required':  'Email is required',
    }),

  password: Joi.string()
    .min(8)
    .max(128)
    .required()
    .messages({
      'string.min':   'Password must be at least 8 characters',
      'any.required': 'Password is required',
    }),
});

/**
 * Login schema.
 *
 * Required:
 *   email     — user email
 *   password  — user password
 *   companyId — tenant UUID (required — multi-tenant safety)
 */
const loginSchema = Joi.object({
  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .required()
    .messages({
      'string.email':  'A valid email address is required',
      'any.required':  'Email is required',
    }),

  password: Joi.string()
    .min(1)
    .max(128)
    .required()
    .messages({
      'any.required': 'Password is required',
    }),

  companyId: Joi.string()
    .uuid({ version: 'uuidv4' })
    .required()
    .messages({
      'string.guid':  'companyId must be a valid UUID',
      'any.required': 'companyId is required for tenant-scoped login',
    }),
});

/**
 * Refresh token schema.
 *
 * Required:
 *   refreshToken — JWT refresh token string
 */
const refreshSchema = Joi.object({
  refreshToken: Joi.string()
    .min(10)
    .required()
    .messages({
      'any.required': 'refreshToken is required',
    }),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
};