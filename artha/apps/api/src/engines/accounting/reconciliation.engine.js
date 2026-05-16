'use strict';

const { createContextLogger } = require('@artha/logger');
const { query }               = require('@artha/database');
const ledgerRepository        = require('@artha/database').ledgerRepository;
const journalRepository       = require('@artha/database').journalRepository;
const { AccountingError }     = require('@artha/errors');

/**
 * ARTHA Reconciliation Engine — Day 3 Foundation
 *
 * Provides account reconciliation infrastructure.
 * Day 3: foundation + basic balance verification only.
 * Future days add: bank feed reconciliation, OCR statement matching,
 * discrepancy detection, automated matching.
 *
 * Day 3 capabilities:
 *   - verifyLedgerBalance()   — verify running balance matches DB balance
 *   - getLedgerStatement()    — get all transactions for a ledger in range
 *   - getUnreconciledSummary() — summary of unreconciled transactions
 *
 * Future capabilities (Day 7+):
 *   - matchBankStatement()    — match bank CSV to journal entries
 *   - flagDiscrepancy()       — mark mismatched transactions
 *   - autoReconcile()         — automatic match by amount + date
 *
 * Integration points (existing):
 *   - ledgerRepository (Day 1) — balance reads
 *   - journalRepository (Day 1) — getLedgerLines
 *   - balance.engine (Day 3)   — sumLines
 *
 * Integration points (future):
 *   - ocr.handler (Day 7)     — bank statement extraction
 *   - intelligence.engine (Day 9) — reconciliation insights
 */

/**
 * Verify that a ledger's stored balance matches
 * the sum of all posted journal lines for that ledger.
 *
 * Used for data integrity checks and audit.
 * A mismatch indicates a bug — should never happen in production.
 *
 * @param {string} companyId
 * @param {string} ledgerId
 * @param {string} traceId
 * @returns {Promise<{
 *   ledgerId: string,
 *   storedBalance: number,
 *   computedBalance: number,
 *   isMatched: boolean,
 *   discrepancyPaise: number
 * }>}
 */
async function verifyLedgerBalance(companyId, ledgerId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('reconciliation_verify_balance', { ledger_id: ledgerId });

  // Get stored balance from ledgers table
  const ledger = await ledgerRepository.getBalance(companyId, ledgerId);
  const storedBalance = ledger.balance;

  // Compute balance from all posted journal lines
  const linesResult = await query(
    `SELECT jl.type, jl.amount, l.type AS ledger_type
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     JOIN ledgers l ON l.id = jl.ledger_id
     WHERE jl.company_id = $1
       AND jl.ledger_id  = $2
       AND je.status     = 'posted'`,
    [companyId, ledgerId]
  );

  // Recompute balance from scratch using accounting rules
  let computedBalance = 0;
  const normalDebitTypes = new Set(['asset', 'expense']);

  for (const line of linesResult.rows) {
    if (!Number.isInteger(line.amount) || line.amount <= 0) {
      throw new AccountingError(
        `Invalid line amount in reconciliation: ${line.amount}`,
        { ledgerId, amount: line.amount }
      );
    }

    const isNormalDebit = normalDebitTypes.has(line.ledger_type);
    if (isNormalDebit) {
      computedBalance += line.type === 'DR' ? line.amount : -line.amount;
    } else {
      computedBalance += line.type === 'CR' ? line.amount : -line.amount;
    }
  }

  const isMatched       = storedBalance === computedBalance;
  const discrepancyPaise = Math.abs(storedBalance - computedBalance);

  if (!isMatched) {
    log.error('reconciliation_balance_mismatch', {
      ledger_id:         ledgerId,
      stored_balance:    storedBalance,
      computed_balance:  computedBalance,
      discrepancy_paise: discrepancyPaise,
    });
  } else {
    log.debug('reconciliation_balance_matched', { ledger_id: ledgerId, balance: storedBalance });
  }

  return {
    ledgerId,
    storedBalance,
    computedBalance,
    isMatched,
    discrepancyPaise,
  };
}

/**
 * Get a ledger statement — all transactions in a date range.
 * Includes opening balance, transactions, closing balance.
 * Used for ledger statement reports and bank reconciliation.
 *
 * @param {string} companyId
 * @param {string} ledgerId
 * @param {string} fromDate — YYYY-MM-DD
 * @param {string} toDate   — YYYY-MM-DD
 * @param {string} traceId
 * @returns {Promise<object>} ledger statement
 */
async function getLedgerStatement(companyId, ledgerId, fromDate, toDate, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('reconciliation_ledger_statement', { ledger_id: ledgerId, fromDate, toDate });

  if (!fromDate || !toDate) {
    throw new AccountingError('getLedgerStatement requires fromDate and toDate');
  }

  // Get ledger info
  const ledger = await ledgerRepository.findById(companyId, ledgerId);
  if (!ledger) { throw new AccountingError(`Ledger ${ledgerId} not found`); }

  // Get opening balance (balance of all posted lines BEFORE fromDate)
  const openingResult = await query(
    `SELECT jl.type, jl.amount, l.type AS ledger_type
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     JOIN ledgers l ON l.id = jl.ledger_id
     WHERE jl.company_id = $1
       AND jl.ledger_id  = $2
       AND je.entry_date  < $3
       AND je.status     = 'posted'`,
    [companyId, ledgerId, fromDate]
  );

  const normalDebitTypes = new Set(['asset', 'expense']);
  const isNormalDebit    = normalDebitTypes.has(ledger.type);

  let openingBalance = 0;
  for (const line of openingResult.rows) {
    if (isNormalDebit) {
      openingBalance += line.type === 'DR' ? line.amount : -line.amount;
    } else {
      openingBalance += line.type === 'CR' ? line.amount : -line.amount;
    }
  }

  // Get transactions in range
  const transactions = await journalRepository.getLedgerLines(
    companyId, ledgerId, fromDate, toDate
  );

  // Compute running balance
  let runningBalance = openingBalance;
  const rows = transactions.map((tx) => {
    const delta = isNormalDebit
      ? (tx.type === 'DR' ? tx.amount : -tx.amount)
      : (tx.type === 'CR' ? tx.amount : -tx.amount);

    runningBalance += delta;

    return {
      entryDate:    tx.entry_date,
      narration:    tx.narration,
      referenceNo:  tx.reference_no,
      type:         tx.type,
      amountPaise:  tx.amount,
      balance:      runningBalance,
    };
  });

  return {
    ledger: {
      id:      ledger.id,
      name:    ledger.name,
      code:    ledger.code,
      type:    ledger.type,
      subType: ledger.sub_type,
    },
    fromDate,
    toDate,
    openingBalance,
    closingBalance: runningBalance,
    transactions:   rows,
    transactionCount: rows.length,
    generatedAt:    new Date().toISOString(),
  };
}

/**
 * Get summary of unreconciled (pending) items.
 * Day 3 foundation — returns basic summary.
 * Day 7+ will add bank statement matching.
 *
 * @param {string} companyId
 * @param {string} traceId
 * @returns {Promise<object>}
 */
async function getUnreconciledSummary(companyId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('reconciliation_unreconciled_summary');

  // Day 3: basic summary — count of posted entries in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
  const toDate   = new Date().toISOString().split('T')[0];

  const result = await query(
    `SELECT COUNT(*) AS total_entries,
            SUM(CASE WHEN status = 'posted'   THEN 1 ELSE 0 END) AS posted,
            SUM(CASE WHEN status = 'reversed' THEN 1 ELSE 0 END) AS reversed,
            SUM(CASE WHEN status = 'draft'    THEN 1 ELSE 0 END) AS draft
     FROM journal_entries
     WHERE company_id  = $1
       AND entry_date BETWEEN $2 AND $3`,
    [companyId, fromDate, toDate]
  );

  const stats = result.rows[0];

  return {
    period:        { fromDate, toDate },
    totalEntries:  parseInt(stats.total_entries, 10),
    posted:        parseInt(stats.posted,        10),
    reversed:      parseInt(stats.reversed,      10),
    draft:         parseInt(stats.draft,         10),
    generatedAt:   new Date().toISOString(),
    // Day 7+: unmatched bank transactions will appear here
    bankMatching:  { status: 'not_implemented', availableFromDay: 7 },
  };
}

module.exports = {
  verifyLedgerBalance,
  getLedgerStatement,
  getUnreconciledSummary,
};