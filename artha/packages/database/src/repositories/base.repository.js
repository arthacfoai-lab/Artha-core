'use strict';

const { query, withTransaction } = require('../client');
const { TenantError } = require('@artha/errors');

/**
 * ARTHA Base Repository
 *
 * All domain repositories extend this class.
 * Enforces multi-tenant isolation on every operation.
 *
 * THE MOST IMPORTANT RULE IN THIS FILE:
 *   _assertTenant(companyId) must be called at the top of
 *   every public method. If companyId is missing, the method
 *   throws TenantError immediately — before any DB query runs.
 *   This is the last line of defense against cross-tenant data access.
 *
 * Provided methods (available to all child repositories):
 *   findById()    — find by UUID within tenant
 *   findAll()     — list within tenant with pagination
 *   count()       — count rows within tenant
 *   softDelete()  — set deleted_at (never hard-delete financial records)
 *   withTransaction() — expose transaction helper to child repos
 *
 * Child repositories add domain-specific methods on top.
 *
 * Pattern:
 *   class LedgerRepository extends BaseRepository {
 *     constructor() { super('ledgers'); }
 *     async findByCode(companyId, code, client) {
 *       this._assertTenant(companyId);
 *       return query('SELECT ...', [companyId, code], client);
 *     }
 *   }
 *   module.exports = new LedgerRepository();
 */
class BaseRepository {
  /**
   * @param {string} tableName — PostgreSQL table name
   */
  constructor(tableName) {
    if (!tableName || typeof tableName !== 'string') {
      throw new Error('BaseRepository requires a tableName string');
    }
    this.tableName = tableName;
  }

  /**
   * TENANT SAFETY GATE.
   *
   * Must be called at the top of every public method.
   * Throws TenantError if companyId is falsy.
   * Never silently proceed without a tenant context.
   *
   * @param {string} companyId
   */
  _assertTenant(companyId) {
    if (!companyId) {
      throw new TenantError(
        `${this.tableName} repository called without company_id — tenant isolation violation prevented`
      );
    }
  }

  /**
   * Find a single record by UUID within tenant scope.
   * Returns null if not found (never throws NotFoundError — caller decides).
   *
   * @param {string} companyId
   * @param {string} id
   * @param {object} [client]
   * @returns {object|null}
   */
  async findById(companyId, id, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `SELECT * FROM ${this.tableName}
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL`,
      [id, companyId],
      client
    );

    return result.rows[0] || null;
  }

  /**
   * List all records within tenant scope.
   * Ordered by created_at DESC. Paginated.
   *
   * @param {string} companyId
   * @param {{ limit?: number, offset?: number }} [opts]
   * @param {object} [client]
   * @returns {Array<object>}
   */
  async findAll(companyId, { limit = 50, offset = 0 } = {}, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `SELECT * FROM ${this.tableName}
       WHERE company_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
      client
    );

    return result.rows;
  }

  /**
   * Count total records within tenant scope.
   * Used for pagination metadata.
   *
   * @param {string} companyId
   * @param {object} [client]
   * @returns {number}
   */
  async count(companyId, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `SELECT COUNT(*) AS total
       FROM ${this.tableName}
       WHERE company_id = $1
         AND deleted_at IS NULL`,
      [companyId],
      client
    );

    return parseInt(result.rows[0].total, 10);
  }

  /**
   * Soft delete a record.
   *
   * CRITICAL: Financial systems never hard-delete records.
   * Sets deleted_at and updated_at. Record remains in DB for audit.
   * To correct a financial error: post a reversal entry, not delete.
   *
   * @param {string} companyId
   * @param {string} id
   * @param {string} deletedBy — user UUID performing the delete
   * @param {object} [client]
   * @returns {boolean} true if deleted, false if not found
   */
  async softDelete(companyId, id, deletedBy, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `UPDATE ${this.tableName}
       SET deleted_at  = NOW(),
           updated_at  = NOW(),
           updated_by  = $3
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
       RETURNING id`,
      [id, companyId, deletedBy],
      client
    );

    return result.rows.length > 0;
  }

  /**
   * Expose withTransaction for multi-table operations in child repos.
   */
  withTransaction(fn) {
    return withTransaction(fn);
  }
}

module.exports = { BaseRepository };