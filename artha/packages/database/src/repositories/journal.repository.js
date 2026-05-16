'use strict';

const { query } = require('../client');

class JournalRepository {

  async createWithLines(
    companyId,
    entry,
    lines,
    client
  ) {

    const entrySql = `
      INSERT INTO journal_entries (
        company_id,
        entry_date,
        narration,
        source
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
    `;

    const entryResult = await query(
      entrySql,
      [
        companyId,
        entry.entryDate,
        entry.narration,
        entry.source || 'manual',
      ],
      client
    );

    const createdEntry =
      entryResult.rows[0];

    const createdLines = [];

    for (let i = 0; i < lines.length; i++) {

      const line = lines[i];

      const lineSql = `
        INSERT INTO journal_lines (
          company_id,
          journal_entry_id,
          ledger_id,
          line_number,
          type,
          amount
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING *
      `;

      const lineResult = await query(
        lineSql,
        [
          companyId,
          createdEntry.id,
          line.ledgerId,
          i + 1,
          line.type,
          line.amount,
        ],
        client
      );

      createdLines.push(
        lineResult.rows[0]
      );
    }

    return {
      entry: createdEntry,
      lines: createdLines,
    };
  }

  async findById(
    companyId,
    entryId,
    client = null
  ) {

    const sql = `
      SELECT *
      FROM journal_entries
      WHERE company_id = $1
      AND id = $2
      LIMIT 1
    `;

    const result = await query(
      sql,
      [companyId, entryId],
      client
    );

    return result.rows[0] || null;
  }

  async list(
    companyId,
    filters = {},
    client = null
  ) {

    const sql = `
      SELECT *
      FROM journal_entries
      WHERE company_id = $1
      ORDER BY entry_date DESC, created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await query(
      sql,
      [
        companyId,
        filters.limit || 100,
        filters.offset || 0,
      ],
      client
    );

    return result.rows;
  }
}

module.exports = new JournalRepository();