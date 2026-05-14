'use strict';

const { query } = require('../client');
const { BaseRepository } = require('./base.repository');
const { NotFoundError, ConflictError } = require('@artha/errors');

/**
 * UserRepository
 *
 * Tenant-scoped. Every query filters by company_id.
 * Password hash is stored here but NEVER returned by safe methods.
 * Only findByEmail() returns password_hash — used only by auth.engine.js.
 *
 * OpenClaw integration (Day 5):
 *   findByWhatsappId() and findByTelegramId() are platform-wide lookups.
 *   WhatsApp/Telegram IDs are globally unique across all tenants.
 *   These two methods do NOT scope by company_id intentionally.
 *
 * Called by:
 *   - auth.engine.js (login, register, getMe)
 *   - Day 5: OpenClaw session binding
 */
class UserRepository extends BaseRepository {
  constructor() {
    super('users');
  }

  /**
   * Create a user within a company.
   * Checks email uniqueness within the tenant.
   *
   * @param {{ companyId, name, phone, email, role, passwordHash, whatsappId, telegramId }} params
   * @param {object} [client]
   * @returns {object} user row WITHOUT password_hash
   */
  async create(
    { companyId, name, phone, email, role, passwordHash, whatsappId, telegramId },
    client = null
  ) {
    this._assertTenant(companyId);

    if (email) {
      const existing = await this.findByEmail(companyId, email, client);
      if (existing) {
        throw new ConflictError(
          `User with email ${email} already exists in this company`,
          { email }
        );
      }
    }

    const result = await query(
      `INSERT INTO users
         (company_id, name, phone, email, role, password_hash, whatsapp_id, telegram_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING
         id, company_id, name, phone, email, role,
         whatsapp_id, telegram_id, is_active,
         last_seen_at, created_at, updated_at`,
      [
        companyId,
        name,
        phone        || null,
        email        || null,
        role         || 'owner',
        passwordHash || null,
        whatsappId   || null,
        telegramId   || null,
      ],
      client
    );

    return result.rows[0];
  }

  /**
   * Find user by ID within tenant.
   * Never returns password_hash.
   *
   * @param {string} companyId
   * @param {string} id
   * @param {object} [client]
   * @returns {object|null}
   */
  async findById(companyId, id, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `SELECT
         id, company_id, name, phone, email, role,
         whatsapp_id, telegram_id, is_active,
         last_seen_at, created_at, updated_at
       FROM users
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL`,
      [id, companyId],
      client
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by email within tenant.
   * RETURNS password_hash — used ONLY by auth.engine.js for login.
   * Never expose this result directly to API responses.
   *
   * @param {string} companyId
   * @param {string} email
   * @param {object} [client]
   * @returns {object|null} — includes password_hash
   */
  async findByEmail(companyId, email, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `SELECT *
       FROM users
       WHERE email = $1
         AND company_id = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [email, companyId],
      client
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by WhatsApp ID — platform-wide (no company_id scope).
   * WhatsApp IDs are globally unique. Used by OpenClaw (Day 5)
   * to identify which company + user sent a message.
   *
   * @param {string} whatsappId
   * @param {object} [client]
   * @returns {object|null}
   */
  async findByWhatsappId(whatsappId, client = null) {
    const result = await query(
      `SELECT
         id, company_id, name, phone, email, role,
         whatsapp_id, telegram_id, is_active,
         last_seen_at, created_at, updated_at
       FROM users
       WHERE whatsapp_id = $1
         AND deleted_at IS NULL
         AND is_active = TRUE
       LIMIT 1`,
      [whatsappId],
      client
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by Telegram ID — platform-wide (no company_id scope).
   * Used by OpenClaw (Day 5) for Telegram session binding.
   *
   * @param {string} telegramId
   * @param {object} [client]
   * @returns {object|null}
   */
  async findByTelegramId(telegramId, client = null) {
    const result = await query(
      `SELECT
         id, company_id, name, phone, email, role,
         whatsapp_id, telegram_id, is_active,
         last_seen_at, created_at, updated_at
       FROM users
       WHERE telegram_id = $1
         AND deleted_at IS NULL
         AND is_active = TRUE
       LIMIT 1`,
      [telegramId],
      client
    );

    return result.rows[0] || null;
  }

  /**
   * Find all users within a company.
   * Never returns password_hash.
   *
   * @param {string} companyId
   * @param {{ limit, offset }} [opts]
   * @param {object} [client]
   * @returns {Array<object>}
   */
  async findAll(companyId, { limit = 50, offset = 0 } = {}, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `SELECT
         id, company_id, name, phone, email, role,
         whatsapp_id, telegram_id, is_active,
         last_seen_at, created_at, updated_at
       FROM users
       WHERE company_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [companyId, limit, offset],
      client
    );

    return result.rows;
  }

  /**
   * Update user profile fields.
   * Explicit allow-list — no mass assignment.
   *
   * @param {string} companyId
   * @param {string} id
   * @param {{ name, phone, email, role, whatsappId, telegramId }} fields
   * @param {object} [client]
   * @returns {object} updated user row (no password_hash)
   */
  async update(companyId, id, { name, phone, email, role, whatsappId, telegramId }, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `UPDATE users
       SET name        = COALESCE($3, name),
           phone       = COALESCE($4, phone),
           email       = COALESCE($5, email),
           role        = COALESCE($6, role),
           whatsapp_id = COALESCE($7, whatsapp_id),
           telegram_id = COALESCE($8, telegram_id),
           updated_at  = NOW()
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
       RETURNING
         id, company_id, name, phone, email, role,
         whatsapp_id, telegram_id, is_active,
         last_seen_at, created_at, updated_at`,
      [
        id,
        companyId,
        name        || null,
        phone       || null,
        email       || null,
        role        || null,
        whatsappId  || null,
        telegramId  || null,
      ],
      client
    );

    if (!result.rows[0]) { throw new NotFoundError('User'); }
    return result.rows[0];
  }

  /**
   * Update password hash.
   * Separate method — intentional friction to prevent accidental hash writes.
   *
   * @param {string} companyId
   * @param {string} id
   * @param {string} passwordHash
   * @param {object} [client]
   */
  async updatePasswordHash(companyId, id, passwordHash, client = null) {
    this._assertTenant(companyId);

    await query(
      `UPDATE users
       SET password_hash = $3,
           updated_at    = NOW()
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL`,
      [id, companyId, passwordHash],
      client
    );
  }

  /**
   * Touch last_seen_at timestamp.
   * Called on every authenticated request — fire and forget.
   * Does NOT require company_id — user ID is globally unique.
   *
   * @param {string} id
   */
  async touchLastSeen(id) {
    await query(
      `UPDATE users
       SET last_seen_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  /**
   * Soft delete user within tenant.
   *
   * @param {string} companyId
   * @param {string} id
   * @param {string} deletedBy
   * @param {object} [client]
   * @returns {boolean}
   */
  async softDelete(companyId, id, deletedBy, client = null) {
    this._assertTenant(companyId);

    const result = await query(
      `UPDATE users
       SET deleted_at = NOW(),
           updated_at = NOW(),
           is_active  = FALSE
       WHERE id = $1
         AND company_id = $2
         AND deleted_at IS NULL
       RETURNING id`,
      [id, companyId],
      client
    );

    return result.rows.length > 0;
  }
}

module.exports = new UserRepository();