'use strict';

const { Pool } = require('pg');
const config = require('@artha/config');
const { logger } = require('@artha/logger');

/**
 * ARTHA PostgreSQL Client
 *
 * Singleton connection pool. Never create multiple pools.
 * All database access goes through query() or withTransaction().
 *
 * Rules:
 *   - Always use parameterized queries — never string interpolation
 *   - All financial queries must use withTransaction() for atomicity
 *   - Heavy queries (reports, GST) go to worker queues — never block API
 *   - SSL enforced in production
 *   - Pool events logged for observability
 *
 * Usage:
 *   const { query, withTransaction } = require('@artha/database');
 *
 *   // Simple query
 *   const result = await query('SELECT * FROM companies WHERE id = $1', [id]);
 *
 *   // Transaction
 *   await withTransaction(async (client) => {
 *     await query('INSERT INTO journal_entries ...', [...], client);
 *     await query('UPDATE ledgers SET balance ...', [...], client);
 *   });
 */

let pool = null;

/**
 * Get or create singleton PostgreSQL connection pool.
 */
function getPool() {
  if (pool) { return pool; }

  pool = new Pool({
    connectionString: config.database.url,
    min: config.database.pool.min,
    max: config.database.pool.max,
    idleTimeoutMillis:    30000,
    connectionTimeoutMillis: 10000,
    statement_timeout:    30000,
    ...(config.isProd && {
      ssl: { rejectUnauthorized: true },
    }),
  });

  pool.on('connect', (_client) => {
    logger.debug('db_pool_connect', { pool: 'postgresql' });
  });

  pool.on('acquire', (_client) => {
    logger.debug('db_pool_acquire');
  });

  pool.on('remove', (_client) => {
    logger.debug('db_pool_remove');
  });

  pool.on('error', (err, _client) => {
    logger.error('db_pool_error', {
      error: err.message,
      code:  err.code,
    });
  });

  logger.info('db_pool_created', {
    min: config.database.pool.min,
    max: config.database.pool.max,
  });

  return pool;
}

/**
 * Execute a parameterized SQL query.
 *
 * @param {string}  text    — SQL with $1, $2... placeholders
 * @param {Array}   values  — parameter values (never interpolate strings)
 * @param {object}  [client] — transaction client (pass when inside withTransaction)
 * @returns {Promise<pg.QueryResult>}
 */
async function query(text, values = [], client = null) {
  const executor = client || getPool();
  const start = Date.now();

  try {
    const result = await executor.query(text, values);
    const duration = Date.now() - start;

    logger.debug('db_query_ok', {
      duration_ms: duration,
      rows:        result.rowCount,
    });

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error('db_query_error', {
      error:       err.message,
      code:        err.code,
      duration_ms: duration,
      // Never log the full query text in production — may contain sensitive data
      query_hint:  config.isDev ? text.slice(0, 120) : '[hidden in production]',
    });
    throw err;
  }
}

/**
 * Execute operations inside an ACID transaction.
 *
 * Automatically:
 *   - Acquires a dedicated client from the pool
 *   - Issues BEGIN
 *   - Calls your function with the client
 *   - Issues COMMIT on success
 *   - Issues ROLLBACK on any error
 *   - Releases client back to pool in finally block
 *
 * CRITICAL: pass the client to every query() inside the callback.
 *
 * @param {Function} fn — async (client) => result
 * @returns {Promise<*>} — whatever fn returns
 */
async function withTransaction(fn) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    logger.debug('db_transaction_committed');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('db_transaction_rolled_back', {
      error: err.message,
      code:  err.code,
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verify database connectivity.
 * Used by /ready health endpoint.
 *
 * @returns {{ alive: boolean, db_time: Date }}
 */
async function healthCheck() {
  const result = await query('SELECT 1 AS alive, NOW() AS db_time');
  return {
    alive:   true,
    db_time: result.rows[0].db_time,
  };
}

/**
 * Gracefully close the connection pool.
 * Called during process shutdown.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('db_pool_closed');
  }
}

module.exports = {
  getPool,
  query,
  withTransaction,
  healthCheck,
  closePool,
};