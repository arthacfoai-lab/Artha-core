'use strict';

require('dotenv').config();

const { getPool, query, withTransaction, closePool } = require('../client');
const { logger } = require('@artha/logger');

/**
 * ARTHA Migration Runner
 *
 * Simple, dependency-free migration system.
 * No ORM. Raw SQL. Full control.
 *
 * Migrations are plain JS files exporting:
 *   { id: '001', name: 'core_foundation', up: '<SQL>', down: '<SQL>' }
 *
 * State tracked in schema_migrations table.
 * All migrations run inside a transaction — atomic apply or rollback.
 *
 * Commands:
 *   node src/migrations/runner.js up       — apply all pending migrations
 *   node src/migrations/runner.js down     — rollback last applied migration
 *   node src/migrations/runner.js status   — show migration status
 *
 * From root:
 *   npm run migrate
 *   npm run migrate:down
 *   npm run migrate:status
 */

// ── Register all migrations here in order ─────────────────────────────────────
const MIGRATIONS = [
  require('./001_core_foundation'),
  // 002_vendors_customers  — Day 8
  // 003_reports            — Day 11
  // 004_ocr_jobs           — Day 7
];

// ── Internal helpers ──────────────────────────────────────────────────────────

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          VARCHAR(10)   PRIMARY KEY,
      name        VARCHAR(255)  NOT NULL,
      applied_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedIds(client) {
  const result = await client.query(
    'SELECT id FROM schema_migrations ORDER BY id ASC'
  );
  return new Set(result.rows.map((r) => r.id));
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function runUp() {
  logger.info('migration_up_start');

  await withTransaction(async (client) => {
    await ensureMigrationsTable(client);
    const applied = await getAppliedIds(client);

    let count = 0;
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) {
        logger.info('migration_skip', { id: migration.id, name: migration.name });
        continue;
      }

      logger.info('migration_applying', { id: migration.id, name: migration.name });

      await client.query(migration.up);
      await client.query(
        'INSERT INTO schema_migrations (id, name) VALUES ($1, $2)',
        [migration.id, migration.name]
      );

      logger.info('migration_applied', { id: migration.id, name: migration.name });
      count++;
    }

    if (count === 0) {
      logger.info('migrations_all_current');
    } else {
      logger.info('migrations_complete', { applied_count: count });
    }
  });
}

async function runDown() {
  logger.info('migration_down_start');

  await withTransaction(async (client) => {
    await ensureMigrationsTable(client);
    const applied = await getAppliedIds(client);

    const toRollback = [...MIGRATIONS]
      .reverse()
      .filter((m) => applied.has(m.id));

    if (toRollback.length === 0) {
      logger.info('migration_nothing_to_rollback');
      return;
    }

    const last = toRollback[0];
    logger.info('migration_rolling_back', { id: last.id, name: last.name });

    await client.query(last.down);
    await client.query(
      'DELETE FROM schema_migrations WHERE id = $1',
      [last.id]
    );

    logger.info('migration_rolled_back', { id: last.id, name: last.name });
  });
}

async function runStatus() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedIds(client);

    process.stdout.write('\nARTHA Migration Status\n');
    process.stdout.write('─'.repeat(50) + '\n');

    for (const m of MIGRATIONS) {
      const status = applied.has(m.id) ? '✓ applied' : '✗ pending';
      process.stdout.write(`[${m.id}] ${m.name.padEnd(30)} ${status}\n`);
    }

    process.stdout.write('─'.repeat(50) + '\n\n');
  } finally {
    client.release();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const command = process.argv[2] || 'up';
const runners = { up: runUp, down: runDown, status: runStatus };
const runner = runners[command];

if (!runner) {
  process.stderr.write(
    `Unknown migration command: ${command}\n` +
    `Usage: node runner.js [up|down|status]\n`
  );
  process.exit(1);
}

runner()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('migration_failed', { error: err.message, stack: err.stack });
    await closePool();
    process.exit(1);
  });