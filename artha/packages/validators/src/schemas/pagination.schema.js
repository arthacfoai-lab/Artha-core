'use strict';

const Joi = require('joi');

/**
 * Pagination schema — shared across all list endpoints.
 *
 * Defaults:
 *   limit  → 50  (max 200 — prevents runaway queries)
 *   offset → 0
 *   page   → optional convenience alias for offset calculation
 *
 * All list endpoints import this and merge with their own schema.
 */
const paginationSchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(200)
    .default(50)
    .description('Number of records to return'),

  offset: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .description('Number of records to skip'),

  page: Joi.number()
    .integer()
    .min(1)
    .optional()
    .description('Page number — alternative to offset (1-based)'),
});

/**
 * Resolve offset from page + limit if page provided.
 * Call after Joi validation.
 *
 * @param {{ limit, offset, page }} validated
 * @returns {{ limit, offset }}
 */
function resolvePagination({ limit = 50, offset = 0, page }) {
  if (page && page >= 1) {
    return { limit, offset: (page - 1) * limit };
  }
  return { limit, offset };
}

module.exports = { paginationSchema, resolvePagination };