'use strict';

const { query } = require('../client');
const { BaseRepository } = require('./base.repository');
const { NotFoundError, ConflictError } = require('@artha/errors');

/**
 * CompanyRepository
 *
 * Multi-tenant root. One company = one tenant.
 * Every other repository scopes all queries to company_id.
 *
 * Rules:
 *   - GSTIN is unique platform-wide (not per-tenant) — checked here
 *   - Companies are never hard-deleted — soft delete only
 *   - findById() here does NOT require company_id scope —
 *     companies ARE the tenant root, not scoped under one
 *   - All other repositories scope under company_id
 *
 * Called by:
 *   - auth.engine.js  (registration)
 *   - auth.engine.js  (getMe)
 *   - tenant.middleware.js (future: company status check)
 */
class CompanyRepository extends BaseRepository {
  constructor() {
    super('companies');
  }

  /**
   * Create a new company (called during registration).
   * Checks GSTIN uniqueness platform-wide before insert.
   *
   * @param {{ name, gstin, pan, businessType, phone, email, address }} params
   * @param {object} [client] — transaction client
   * @returns {object} created company row
   */
  async create({ name, gstin, pan, businessType, phone, email, address }, client = null) {
    if (!name) { throw new Error('Company name is required'); }

    // GSTIN uniqueness — platform-wide, not per-tenant
    if (gstin) {
      const existing = await this.findByGstin(gstin, client);
      if (existing) {
        throw new ConflictError(
          `A company with GSTIN ${gstin} is already registered`,
          { gstin }
        );
      }
    }

    const result = await query(
      `INSERT INTO companies
         (name, gstin, pan, business_type, phone, email, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        name,
        gstin        || null,
        pan          || null,
        businessType || null,
        phone        || null,
        email        || null,
        JSON.stringify(address || {}),
      ],
      client
    );

    return result.rows[0];
  }

  /**
   * Find company by ID.
   * No company_id scope — companies are the tenant root.
   *
   * @param {string} id
   * @param {object} [client]
   * @returns {object|null}
   */
  async findById(id, client = null) {
    const result = await query(
      `SELECT * FROM companies
       WHERE id = $1
         AND deleted_at IS NULL`,
      [id],
      client
    );
    return result.rows[0] || null;
  }

  /**
   * Find company by GSTIN — platform-wide lookup.
   * Used for uniqueness checks during registration.
   *
   * @param {string} gstin
   * @param {object} [client]
   * @returns {object|null}
   */
  async findByGstin(gstin, client = null) {
    const result = await query(
      `SELECT * FROM companies
       WHERE gstin = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [gstin],
      client
    );
    return result.rows[0] || null;
  }

  /**
   * Update company profile fields.
   * Explicit allow-list — never mass-assign.
   * COALESCE keeps existing value if new value is null.
   *
   * @param {string} id
   * @param {{ name, gstin, pan, businessType, phone, email, address, settings }} fields
   * @param {object} [client]
   * @returns {object} updated company row
   */
  async update(id, { name, gstin, pan, businessType, phone, email, address, settings }, client = null) {
    const result = await query(
      `UPDATE companies
       SET name          = COALESCE($2, name),
           gstin         = COALESCE($3, gstin),
           pan           = COALESCE($4, pan),
           business_type = COALESCE($5, business_type),
           phone         = COALESCE($6, phone),
           email         = COALESCE($7, email),
           address       = COALESCE($8, address),
           settings      = COALESCE($9, settings),
           updated_at    = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING *`,
      [
        id,
        name         || null,
        gstin        || null,
        pan          || null,
        businessType || null,
        phone        || null,
        email        || null,
        address  ? JSON.stringify(address)  : null,
        settings ? JSON.stringify(settings) : null,
      ],
      client
    );

    if (!result.rows[0]) { throw new NotFoundError('Company'); }
    return result.rows[0];
  }

  /**
   * Set company active/inactive status.
   *
   * @param {string} id
   * @param {boolean} isActive
   * @param {object} [client]
   * @returns {object|null}
   */
  async setActive(id, isActive, client = null) {
    const result = await query(
      `UPDATE companies
       SET is_active  = $2,
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING *`,
      [id, isActive],
      client
    );
    return result.rows[0] || null;
  }

  /**
   * Soft delete company.
   * Sets deleted_at. Financial data is retained permanently.
   *
   * @param {string} id
   * @param {object} [client]
   * @returns {boolean}
   */
  async softDelete(id, client = null) {
    const result = await query(
      `UPDATE companies
       SET deleted_at = NOW(),
           updated_at = NOW(),
           is_active  = FALSE
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING id`,
      [id],
      client
    );
    return result.rows.length > 0;
  }
}

module.exports = new CompanyRepository();