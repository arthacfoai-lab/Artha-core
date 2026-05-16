'use strict';

const { createContextLogger }  = require('@artha/logger');
const { withTransaction }      = require('@artha/database');
const ledgerRepository         = require('@artha/database').ledgerRepository;
const auditRepository          = require('@artha/database').auditRepository;
const { getDefaultAccounts }   = require('./chart-of-accounts');
const { computeLineDelta }     = require('./balance.engine');
const {
  AccountingError,
  NotFoundError,
  ValidationError,
} = require('@artha/errors');

/**
 * ARTHA Ledger Engine
 *
 * Manages the Chart of Accounts for each tenant.
 * Handles ledger creation, balance reads, and balance adjustments.
 *
 * Rules:
 *   - System ledgers cannot be deleted (is_system=true)
 *   - All balances stored as BIGINT paise — never float
 *   - Balance adjustments are atomic delta operations — not absolute sets
 *   - adjustBalances() must always be called inside a transaction
 *   - seedDefaultAccounts() called on company registration
 *
 * Integration points (existing):
 *   - ledgerRepository (Day 1) — all DB operations
 *   - auditRepository (Day 1)  — audit log on create/delete
 *   - chart-of-accounts.js     — default account definitions
 *   - balance.engine.js        — computeLineDelta for adjustments
 *   - withTransaction (Day 1)  — atomic operations
 *
 * Integration points (future):
 *   - journal.engine.js (Day 3)  — calls adjustBalances after posting
 *   - intelligence.engine (Day 9) — reads balances for P&L, cashflow
 *   - reconciliation.engine      — reads + compares balances
 *
 * Called by:
 *   - auth.engine.js register()  — seedDefaultAccounts on new company
 *   - journal.engine.js          — adjustBalances after entry posted
 *   - accounting.routes.js       — list ledgers, get balance
 */

/**
 * Seed default chart of accounts for a new company.
 * Called atomically inside company registration transaction.
 * Creates all default accounts defined in chart-of-accounts.js.
 *
 * @param {string} companyId
 * @param {object} client — transaction client (REQUIRED)
 * @returns {Promise<Array<object>>} created ledger rows
 */
async function seedDefaultAccounts(companyId, client) {
  if (!companyId) { throw new AccountingError('seedDefaultAccounts requires companyId'); }
  if (!client) { throw new AccountingError('seedDefaultAccounts requires transaction client'); }

  const accounts = getDefaultAccounts();
  const created  = [];

  for (const account of accounts) {
    const ledger = await ledgerRepository.create(
      {
        companyId,
        name:        account.name,
        code:        account.code,
        type:        account.type,
        subType:     account.subType,
        isSystem:    account.isSystem,
        currency:    'INR',
        description: account.description,
      },
      client
    );
    created.push(ledger);
  }

  return created;
}

/**
 * Resolve a ledger by sub_type within a tenant.
 * Used by accounting engine to find "cash" or "bank" ledger
 * without requiring user to specify ledger IDs.
 *
 * @param {string} companyId
 * @param {string} subType — e.g. 'cash', 'bank', 'sales', 'purchases'
 * @param {object} [client]
 * @returns {Promise<object>} ledger row
 * @throws {NotFoundError}
 */
async function resolveBySubType(companyId, subType, client = null) {
  const ledger = await ledgerRepository.findSystemBySubType(companyId, subType, client);
  if (!ledger) {
    throw new NotFoundError(`Ledger with sub_type '${subType}'`);
  }
  return ledger;
}

/**
 * Atomically adjust balances for multiple ledger lines.
 * Must be called inside a transaction.
 *
 * For each line: compute signed delta based on ledger type + line type,
 * then apply atomic UPDATE balance = balance + delta.
 *
 * @param {string} companyId
 * @param {Array<{ ledgerId, type, amount }>} lines
 * @param {object} client — transaction client (REQUIRED)
 * @returns {Promise<Array<{ id, balance }>>} updated balances
 */
async function adjustBalances(companyId, lines, client) {
  if (!client) {
    throw new AccountingError('adjustBalances must be called inside a transaction');
  }

  const results = [];

  for (const line of lines) {
    // Load ledger to get type (asset/liability/equity/revenue/expense)
    const ledger = await ledgerRepository.findById(companyId, line.ledgerId, client);
    if (!ledger) {
      throw new NotFoundError(`Ledger ${line.ledgerId}`);
    }

    // Compute signed delta using accounting normal balance rules
    const delta = computeLineDelta(ledger.type, line.type, line.amount);

    // Atomic balance adjustment
    const updated = await ledgerRepository.adjustBalance(
      companyId,
      line.ledgerId,
      delta,
      client
    );

    results.push(updated);
  }

  return results;
}

/**
 * Get current balance for a ledger.
 * Tenant-scoped. Returns balance in paise.
 *
 * @param {string} companyId
 * @param {string} ledgerId
 * @param {string} traceId
 * @returns {Promise<{ ledger, balancePaise, balanceRupees }>}
 */
async function getBalance(companyId, ledgerId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('ledger_get_balance', { ledger_id: ledgerId });

  const ledger = await ledgerRepository.getBalance(companyId, ledgerId);

  return {
    ledger: {
      id:      ledger.id,
      balance: ledger.balance,
      currency: ledger.currency,
    },
    balancePaise:  ledger.balance,
    balanceRupees: (ledger.balance / 100).toFixed(2),
  };
}

/**
 * List all ledgers for a tenant.
 * Optionally filtered by type.
 *
 * @param {string} companyId
 * @param {{ type?, limit?, offset? }} opts
 * @param {string} traceId
 * @returns {Promise<Array<object>>}
 */
async function listLedgers(companyId, opts = {}, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('ledger_list', { type: opts.type });

  if (opts.type) {
    return ledgerRepository.findByType(companyId, opts.type);
  }

  return ledgerRepository.findAll(companyId, {
    limit:  opts.limit  || 100,
    offset: opts.offset || 0,
  });
}

/**
 * Create a custom ledger account.
 * System ledgers are not created here — use seedDefaultAccounts().
 * Users can create custom ledgers alongside system ones.
 *
 * @param {string} companyId
 * @param {{ name, code, type, subType, description }} params
 * @param {string} userId
 * @param {string} traceId
 * @returns {Promise<object>} created ledger
 */
async function createLedger(companyId, params, userId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });

  const { name, code, type, subType, description } = params;

  if (!name || !type) {
    throw new ValidationError('Ledger name and type are required');
  }

  const VALID_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
  if (!VALID_TYPES.has(type)) {
    throw new ValidationError(
      `Invalid ledger type '${type}'. Must be: ${[...VALID_TYPES].join(', ')}`
    );
  }

  const ledger = await ledgerRepository.create({
    companyId,
    name,
    code:        code        || null,
    type,
    subType:     subType     || null,
    isSystem:    false,       // user-created ledgers are never system
    description: description || null,
  });

  await auditRepository.writeSilent({
    companyId,
    userId,
    traceId,
    action:       'ledger.created',
    resourceType: 'ledger',
    resourceId:   ledger.id,
    payload:      { name, code, type, subType },
  });

  log.info('ledger_created', { ledger_id: ledger.id, name, type });

  return ledger;
}

/**
 * Get trial balance for a company.
 * Returns all ledger balances grouped by account type.
 * Used by intelligence engine (Day 9) and reporting.
 *
 * @param {string} companyId
 * @param {string} traceId
 * @returns {Promise<object>} trial balance summary
 */
async function getTrialBalance(companyId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('ledger_trial_balance');

  const allLedgers = await ledgerRepository.findAll(companyId, { limit: 500, offset: 0 });

  const grouped = {
    asset:     [],
    liability: [],
    equity:    [],
    revenue:   [],
    expense:   [],
  };

  let totalDr = 0;
  let totalCr = 0;

  for (const ledger of allLedgers) {
    const group = grouped[ledger.type];
    if (!group) { continue; }

    const balance = ledger.balance;
    group.push({
      id:       ledger.id,
      code:     ledger.code,
      name:     ledger.name,
      subType:  ledger.sub_type,
      balance,
      isSystem: ledger.is_system,
    });

    // Assets + expenses have debit normal balance
    if (ledger.type === 'asset' || ledger.type === 'expense') {
      totalDr += Math.max(balance, 0);
      totalCr += Math.max(-balance, 0);
    } else {
      totalCr += Math.max(balance, 0);
      totalDr += Math.max(-balance, 0);
    }
  }

  return {
    ledgers:  grouped,
    totals: {
      totalDr,
      totalCr,
      isBalanced: totalDr === totalCr,
      difference: Math.abs(totalDr - totalCr),
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  seedDefaultAccounts,
  resolveBySubType,
  adjustBalances,
  getBalance,
  listLedgers,
  createLedger,
  getTrialBalance,
};