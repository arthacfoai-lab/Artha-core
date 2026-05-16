'use strict';

/**
 * ARTHA Standardized API Response Helpers
 *
 * All HTTP success responses use these helpers.
 * Ensures consistent shape across all routes:
 *   ok:       boolean  — always true for success
 *   data:     object   — payload
 *   meta:     object   — pagination, timestamps (optional)
 *   trace_id: string   — always present
 *
 * Error responses handled by error.middleware.js.
 * These helpers handle SUCCESS ONLY.
 */

function ok(res, req, data = {}, meta = null) {
  const body = { ok: true, data, trace_id: req.traceId || null };
  if (meta) { body.meta = meta; }
  return res.status(200).json(body);
}

function created(res, req, data = {}, meta = null) {
  const body = { ok: true, data, trace_id: req.traceId || null };
  if (meta) { body.meta = meta; }
  return res.status(201).json(body);
}

function noContent(res) {
  return res.status(204).send();
}

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

function accepted(res, req, jobId, message = 'Processing queued') {
  return res.status(202).json({
    ok:       true,
    data:     { jobId, status: 'queued', message },
    trace_id: req.traceId || null,
  });
}

function buildPaginationMeta(query, total) {
  return {
    total,
    limit:  query.limit  || 50,
    offset: query.offset || 0,
  };
}

module.exports = { ok, created, noContent, paginated, accepted, buildPaginationMeta };