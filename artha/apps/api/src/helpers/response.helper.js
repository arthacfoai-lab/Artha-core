'use strict';

/**
 * ARTHA Standardized API Response Helpers
 *
 * All HTTP responses across the entire API use these helpers.
 * Ensures consistent response shape — every response has:
 *   ok:       boolean  — true on success, false on error
 *   data:     object   — payload (success only)
 *   error:    object   — error details (failure only)
 *   meta:     object   — pagination, timestamps (optional)
 *   trace_id: string   — always present for support correlation
 *
 * Error responses are handled by error.middleware.js (Day 1).
 * These helpers handle SUCCESS responses only.
 *
 * Usage in route handlers:
 *   const { ok, created, paginated, noContent } = require('../helpers/response.helper');
 *
 *   router.get('/ledgers', async (req, res, next) => {
 *     try {
 *       const ledgers = await ledgerEngine.list(req.tenantContext);
 *       return ok(res, req, { ledgers });
 *     } catch (err) {
 *       return next(err);
 *     }
 *   });
 *
 * Integration points:
 *   - All route handlers — auth, accounting, GST, memory, reporting
 *   - error.middleware.js (Day 1) — error responses (separate concern)
 *   - Future: response envelope versioning
 */

/**
 * 200 OK — standard success response.
 *
 * @param {object} res     — Express response
 * @param {object} req     — Express request (for trace_id)
 * @param {object} data    — response payload
 * @param {object} [meta]  — optional metadata (pagination, etc.)
 * @returns {object} Express response
 */
function ok(res, req, data = {}, meta = null) {
  const body = {
    ok:       true,
    data,
    trace_id: req.traceId || null,
  };
  if (meta) { body.meta = meta; }
  return res.status(200).json(body);
}

/**
 * 201 Created — resource creation success.
 *
 * @param {object} res
 * @param {object} req
 * @param {object} data   — created resource
 * @param {object} [meta]
 * @returns {object}
 */
function created(res, req, data = {}, meta = null) {
  const body = {
    ok:       true,
    data,
    trace_id: req.traceId || null,
  };
  if (meta) { body.meta = meta; }
  return res.status(201).json(body);
}

/**
 * 204 No Content — success with no body (DELETE, etc.)
 *
 * @param {object} res
 * @returns {object}
 */
function noContent(res) {
  return res.status(204).send();
}

/**
 * 200 OK — paginated list response.
 * Includes standard pagination metadata.
 *
 * @param {object} res
 * @param {object} req
 * @param {Array}  items    — array of resources
 * @param {object} pagination
 * @param {number} pagination.total  — total count (for client pagination)
 * @param {number} pagination.limit
 * @param {number} pagination.offset
 * @returns {object}
 */
function paginated(res, req, items, { total, limit, offset }) {
  return res.status(200).json({
    ok:   true,
    data: items,
    meta: {
      total,
      limit,
      offset,
      has_more: offset + items.length < total,
      count:    items.length,
    },
    trace_id: req.traceId || null,
  });
}

/**
 * 200 OK — accepted for async processing.
 * Used when operation is queued (OCR, reporting, etc.)
 *
 * @param {object} res
 * @param {object} req
 * @param {string} jobId   — queue job ID for polling
 * @param {string} [message]
 * @returns {object}
 */
function accepted(res, req, jobId, message = 'Processing queued') {
  return res.status(202).json({
    ok:      true,
    data:    { jobId, status: 'queued', message },
    trace_id: req.traceId || null,
  });
}

/**
 * Build pagination meta from query params.
 * Helper for route handlers to build paginated() call.
 *
 * @param {object} query   — validated query params { limit, offset }
 * @param {number} total   — total count from DB
 * @returns {object}
 */
function buildPaginationMeta(query, total) {
  return {
    total,
    limit:  query.limit  || 50,
    offset: query.offset || 0,
  };
}

module.exports = {
  ok,
  created,
  noContent,
  paginated,
  accepted,
  buildPaginationMeta,
};