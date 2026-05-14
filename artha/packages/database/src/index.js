'use strict';

/**
 * ARTHA Database Package — Public API
 *
 * All database access in the application imports from '@artha/database'.
 * Never import from internal paths like '@artha/database/src/client'.
 *
 * Exports:
 *   Client primitives:
 *     query()           — parameterized SQL query
 *     withTransaction() — atomic transaction wrapper
 *     healthCheck()     — DB connectivity probe
 *     closePool()       — graceful shutdown
 *     getPool()         — raw pool (advanced use only)
 *
 *   Repository base:
 *     BaseRepository    — extend to create domain repositories
 *
 *   Repository singletons (added progressively per day):
 *     companyRepository  — Day 1
 *     userRepository     — Day 1
 *     ledgerRepository   — Day 3
 *     journalRepository  — Day 3
 *     auditRepository    — Day 1
 *
 * Repositories not yet implemented return undefined.
 * They are wired in as their implementation days arrive.
 */

const client = require('./client');
const { BaseRepository } = require('./repositories/base.repository');

// ── Repositories — wired progressively ───────────────────────────────────────
// Day 1 repositories
const companyRepository = require('./repositories/company.repository');
const userRepository    = require('./repositories/user.repository');
const auditRepository   = require('./repositories/audit.repository');

// Day 3 repositories (uncomment when Day 3 files are created)
// const ledgerRepository  = require('./repositories/ledger.repository');
// const journalRepository = require('./repositories/journal.repository');

module.exports = {
  // Client primitives
  ...client,

  // Base class for extension
  BaseRepository,

  // Repository singletons
  companyRepository,
  userRepository,
  auditRepository,

  // Day 3+
  // ledgerRepository,
  // journalRepository,
};