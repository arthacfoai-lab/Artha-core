'use strict';

const { query } = require('../client');
const { TenantError } = require('@artha/errors');

/**
 * AuditRepository
 *
 * Writes to audit_logs — append-only, never update, never delete.
 * Every significant financial or auth event produces an audit log entry.
 *
 * Does NOT extend BaseRepository:
 *   Audit logs have no tenant-scoped findAll/softDelete semantics.
 *   This is a write-heavy, compliance-first repository.
 *
 * Two write methods:
 *   write()        — throws on failure (use inside transactions)
 *   writeSilent()  — swallows errors (use for non-critical audit events)
 *
 * RULE: audit failure must NEVER crash a financial transaction.
 * Use writeSilent() for post-transaction audit events.
 * Use write() when the audit record itself is part of the transaction.
 *
 * Called by:
 *   - auth.engine.js (login, registration events)
 *   - accounting.engine.js (Day 3 — journal entry events)
 *   - All write operations throughout the platform
 */
class AuditRepository {

  /**
   * Write an audit log entry.
   * Throws on failure.
   *
   * @param {object} params
   * @param {string|null} params.companyId     — null for system-level events
   * @param {string|null} params.userId
   * @param {string}      params.traceId       — required
   * @param {string}      params.action        — e.g. 'journal_entry.created'
   * @param {string|null} params.resourceType  — e.g. 'journal_entry'
   * @param {string|null} params.resourceId    — UUID of affected resource
   * @param {object}      params.payload       — data snapshot
   * @param {string|null} params.ipAddress
   * @param {string|null} params.userAgent
   * @param {object|null} client               — transaction client
   */
  async write(
    {
      companyId    = null,
      userId       = null,
      traceId,
      action,
      resourceType = null,
      resourceId   = null,
      payload      = {},
      ipAddress    = null,
      userAgent    = null,
    },
    client = null
  ) {
    if (!traceId) { throw new TenantError('Audit log requires traceId'); }
    if (!action)  { throw new TenantError('Audit log requires action'); }

    await query(
      `INSERT INTO audit_logs
         (company_id, user_id, trace_id, action, resource_type,
          resource_id, payload, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9)`,
      [
        companyId    || null,
        userId       || null,
        traceId,
        action,
        resourceType || null,
        resourceId   || null,
        JSON.stringify(payload),
        ipAddress    || null,
        userAgent    || null,
      ],
      client
    );
  }

  /**
   * Write an audit log entry silently.
   * Swallows errors — audit failure never crashes the calling operation.
   * Logs the failure at error level for monitoring.
   *
   * @param {object} params — same as write()
   * @param {object|null} client
   */
  async writeSilent(params, client = null) {
    try {
      await this.write(params, client);
    } catch (err) {
      // Import lazily to avoid circular dependency
      const { logger } = require('@artha/logger');
      logger.error('audit_write_failed', {
        error:    err.message,
        action:   params.action,
        trace_id: params.traceId,
      });
    }
  }

  /**
   * Read audit trail for a specific resource.
   * Tenant-scoped. Used for compliance dashboards.
   *
   * @param {string} companyId
   * @param {string} resourceType
   * @param {string} resourceId
   * @param {object} [client]
   * @returns {Array<object>}
   */
  async findByResource(companyId, resourceType, resourceId, client = null) {
    if (!companyId) { throw new TenantError('findByResource requires companyId'); }

    const result = await query(
      `SELECT * FROM audit_logs
       WHERE company_id    = $1
         AND resource_type = $2
         AND resource_id   = $3
       ORDER BY created_at ASC`,
      [companyId, resourceType, resourceId],
      client
    );

    return result.rows;
  }

  /**
   * Read audit trail by trace_id.
   * Cross-resource trace reconstruction for debugging.
   *
   * @param {string} traceId
   * @param {object} [client]
   * @returns {Array<object>}
   */
  async findByTraceId(traceId, client = null) {
    const result = await query(
      `SELECT * FROM audit_logs
       WHERE trace_id = $1
       ORDER BY created_at ASC`,
      [traceId],
      client
    );

    return result.rows;
  }

  /**
   * Read recent audit events for a company.
   * Used for compliance dashboard (Day 11+).
   *
   * @param {string} companyId
   * @param {{ limit, offset }} [opts]
   * @param {object} [client]
   * @returns {Array<object>}
   */
  async findRecent(companyId, { limit = 100, offset = 0 } = {}, client = null) {
    if (!companyId) { throw new TenantError('findRecent requires companyId'); }

    const result = await query(
      `SELECT * FROM audit_logs
       WHERE company_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
      client
    );

    return result.rows;
  }
}

module.exports = new AuditRepository();