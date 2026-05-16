'use strict';

const { query } = require('../client');

class LedgerRepository {

  async create(data, client = null) {
    const sql = `
      INSERT INTO ledgers (
        company_id,
        name,
        code,
        type,
        sub_type,
        is_system,
        currency,
        description
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8
      )
      RETURNING *
    `;

    const values = [
      data.companyId,
      data.name,
      data.code,
      data.type,
      data.subType,
      data.isSystem || false,
      data.currency || 'INR',
      data.description || null,
    ];

    const result = await query(
      sql,
      values,
      client
    );

    return result.rows[0];
  }

  async findAll(companyId, opts = {}, client = null) {
    const sql = `
      SELECT *
      FROM ledgers
      WHERE company_id = $1
      ORDER BY code ASC
      LIMIT $2 OFFSET $3
    `;

    const result = await query(
      sql,
      [
        companyId,
        opts.limit || 100,
        opts.offset || 0,
      ],
      client
    );

    return result.rows;
  }

  async findById(companyId, ledgerId, client = null) {
    const sql = `
      SELECT *
      FROM ledgers
      WHERE company_id = $1
      AND id = $2
      LIMIT 1
    `;

    const result = await query(
      sql,
      [companyId, ledgerId],
      client
    );

    return result.rows[0] || null;
  }

  async findByType(companyId, type, client = null) {
    const sql = `
      SELECT *
      FROM ledgers
      WHERE company_id = $1
      AND type = $2
      ORDER BY code ASC
    `;

    const result = await query(
      sql,
      [companyId, type],
      client
    );

    return result.rows;
  }

  async findSystemBySubType(
    companyId,
    subType,
    client = null
  ) {
    const sql = `
      SELECT *
      FROM ledgers
      WHERE company_id = $1
      AND sub_type = $2
      AND is_system = true
      LIMIT 1
    `;

    const result = await query(
      sql,
      [companyId, subType],
      client
    );

    return result.rows[0] || null;
  }

  async adjustBalance(
    companyId,
    ledgerId,
    delta,
    client = null
  ) {
    const sql = `
      UPDATE ledgers
      SET balance = balance + $1
      WHERE company_id = $2
      AND id = $3
      RETURNING *
    `;

    const result = await query(
      sql,
      [delta, companyId, ledgerId],
      client
    );

    return result.rows[0];
  }

  async getBalance(
    companyId,
    ledgerId,
    client = null
  ) {
    const sql = `
      SELECT
        id,
        balance,
        currency
      FROM ledgers
      WHERE company_id = $1
      AND id = $2
      LIMIT 1
    `;

    const result = await query(
      sql,
      [companyId, ledgerId],
      client
    );

    return result.rows[0] || null;
  }
}

module.exports = new LedgerRepository();