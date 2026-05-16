'use strict';

/**
 * ARTHA Database Package — Public API
 *
 * Centralized export surface for all database primitives,
 * repositories, and transaction helpers.
 *
 * RULES:
 *   - NEVER import internal files directly outside this package
 *   - ALWAYS use:
 *       const db = require('@artha/database');
 *
 * PURPOSE:
 *   - Stable dependency boundary
 *   - Prevent circular imports
 *   - Simplify repository discovery
 *   - Standardize transaction handling
 *   - Enable future ORM/query-layer replacement
 *
 * EXPORTED:
 *
 *   Core DB:
 *     getPool()
 *     query()
 *     withTransaction()
 *     healthCheck()
 *     closePool()
 *
 *   Base Infrastructure:
 *     BaseRepository
 *
 *   Repository Singletons:
 *     companyRepository
 *     userRepository
 *     auditRepository
 *     ledgerRepository
 *     journalRepository
 *
 * IMPORTANT:
 *   Repositories MUST export instantiated singletons:
 *
 *     module.exports = new LedgerRepository();
 *
 *   NOT:
 *
 *     module.exports = LedgerRepository;
 */

const client = require('./client');

const {
  BaseRepository,
} = require('./repositories/base.repository');

// ─────────────────────────────────────────────────────────────────────────────
// Repository Singletons
// ─────────────────────────────────────────────────────────────────────────────

const companyRepository =
  require('./repositories/company.repository');

const userRepository =
  require('./repositories/user.repository');

const auditRepository =
  require('./repositories/audit.repository');

// Day 3 — Accounting repositories
const ledgerRepository =
  require('./repositories/ledger.repository');

const journalRepository =
  require('./repositories/journal.repository');

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

module.exports = Object.freeze({

  // ── Core DB primitives ────────────────────────────────────────────────────
  getPool:        client.getPool,
  query:          client.query,
  withTransaction: client.withTransaction,
  healthCheck:    client.healthCheck,
  closePool:      client.closePool,

  // ── Base repository ───────────────────────────────────────────────────────
  BaseRepository,

  // ── Domain repositories ───────────────────────────────────────────────────
  companyRepository,
  userRepository,
  auditRepository,

  // Accounting
  ledgerRepository,
  journalRepository,

});