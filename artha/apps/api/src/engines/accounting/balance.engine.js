'use strict';

const { AccountingError } = require('@artha/errors');

/**
 * ARTHA Balance Engine
 *
 * Validates and computes double-entry balance constraints.
 * FULLY DETERMINISTIC — no DB calls, no AI, no async.
 * Pure arithmetic on integer paise values.
 *
 * Core rule of double-entry bookkeeping:
 *   Sum of all DEBIT lines == Sum of all CREDIT lines
 *   Any imbalance is a programming or data error — never silently accepted.
 *
 * CRITICAL: All amounts are BIGINT paise. Never float.
 *   Uses integer arithmetic only.
 *   No parseFloat, no toFixed, no Math.round on money values.
 *   paise are whole numbers — there is no sub-paise value.
 *
 * Called by:
 *   - journal.engine.js — validateBalance() before every DB write
 *   - accounting.engine.js — computeLineDelta() for ledger adjustments
 *   - reconciliation.engine.js (future) — compareBalances()
 *   - Tests — directly to verify balance constraint enforcement
 *
 * Future integration:
 *   - Day 9 intelligence engine reads trial balance via getTrialBalance()
 *   - Day 9 P&L engine reads revenue/expense totals
 */

/**
 * Validate that journal lines are balanced (DR total === CR total).
 * Throws AccountingError if unbalanced.
 * Returns balance totals on success.
 *
 * @param {Array<{ type: 'DR'|'CR', amount: number }>} lines
 * @returns {{ totalDr: number, totalCr: number }}
 * @throws {AccountingError}
 */
function validateBalance(lines) {
  if (!lines || lines.length < 2) {
    throw new AccountingError(
      'Journal entry requires at least 2 lines (minimum: 1 DR + 1 CR)',
      { lineCount: lines ? lines.length : 0 }
    );
  }

  let totalDr = 0;
  let totalCr = 0;

  for (const line of lines) {
    // Type guard — never silently accept wrong type
    if (line.type !== 'DR' && line.type !== 'CR') {
      throw new AccountingError(
        `Invalid line type '${line.type}' — must be 'DR' or 'CR'`,
        { type: line.type }
      );
    }

    // Amount guard — must be positive integer paise
    if (!Number.isInteger(line.amount) || line.amount <= 0) {
      throw new AccountingError(
        `Line amount must be a positive integer paise — received ${line.amount}`,
        { amount: line.amount, type: line.type }
      );
    }

    if (line.type === 'DR') {
      totalDr += line.amount;
    } else {
      totalCr += line.amount;
    }
  }

  // Both sides must be non-zero
  if (totalDr === 0) {
    throw new AccountingError('Journal entry must have at least one debit line', { totalDr, totalCr });
  }
  if (totalCr === 0) {
    throw new AccountingError('Journal entry must have at least one credit line', { totalDr, totalCr });
  }

  // Core double-entry rule
  if (totalDr !== totalCr) {
    throw new AccountingError(
      `Journal entry is not balanced: DR ₹${totalDr / 100} ≠ CR ₹${totalCr / 100}`,
      {
        totalDr,
        totalCr,
        difference: Math.abs(totalDr - totalCr),
        differenceRupees: Math.abs(totalDr - totalCr) / 100,
      }
    );
  }

  return { totalDr, totalCr };
}

/**
 * Compute the balance delta for a specific ledger given a set of journal lines.
 *
 * For ASSET and EXPENSE accounts:
 *   DR increases balance, CR decreases balance
 *
 * For LIABILITY, EQUITY, and REVENUE accounts:
 *   CR increases balance, DR decreases balance
 *
 * @param {string} ledgerType  — 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
 * @param {string} lineType    — 'DR' | 'CR'
 * @param {number} amountPaise — positive integer
 * @returns {number} signed delta in paise (positive = increase, negative = decrease)
 */
function computeLineDelta(ledgerType, lineType, amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AccountingError(
      `computeLineDelta: amountPaise must be positive integer — received ${amountPaise}`,
      { amountPaise }
    );
  }

  // Normal balance rules:
  // Assets and Expenses: DR = increase, CR = decrease
  // Liabilities, Equity, Revenue: CR = increase, DR = decrease
  const normalDebitTypes = new Set(['asset', 'expense']);

  if (normalDebitTypes.has(ledgerType)) {
    return lineType === 'DR' ? amountPaise : -amountPaise;
  } else {
    return lineType === 'CR' ? amountPaise : -amountPaise;
  }
}

/**
 * Compute total debit and credit for a set of lines.
 * Does NOT validate balance — use validateBalance() for that.
 * Used for reporting and display.
 *
 * @param {Array<{ type: 'DR'|'CR', amount: number }>} lines
 * @returns {{ totalDr: number, totalCr: number, count: number }}
 */
function sumLines(lines) {
  if (!lines || lines.length === 0) {
    return { totalDr: 0, totalCr: 0, count: 0 };
  }

  let totalDr = 0;
  let totalCr = 0;

  for (const line of lines) {
    if (line.type === 'DR') { totalDr += line.amount; }
    else if (line.type === 'CR') { totalCr += line.amount; }
  }

  return { totalDr, totalCr, count: lines.length };
}

/**
 * Build journal lines for a simple two-account transaction.
 * Debit one account, credit another.
 * Validates that amount is positive integer paise.
 *
 * @param {string} debitLedgerId
 * @param {string} creditLedgerId
 * @param {number} amountPaise — positive integer
 * @param {string} [currency]
 * @returns {Array<{ ledgerId, type, amount, currency }>}
 */
function buildSimpleLines(debitLedgerId, creditLedgerId, amountPaise, currency = 'INR') {
  if (!debitLedgerId || !creditLedgerId) {
    throw new AccountingError('buildSimpleLines: debitLedgerId and creditLedgerId are required');
  }
  if (debitLedgerId === creditLedgerId) {
    throw new AccountingError('buildSimpleLines: debit and credit ledger cannot be the same');
  }
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AccountingError(
      `buildSimpleLines: amountPaise must be positive integer — received ${amountPaise}`,
      { amountPaise }
    );
  }

  return [
    { ledgerId: debitLedgerId,  type: 'DR', amount: amountPaise, currency },
    { ledgerId: creditLedgerId, type: 'CR', amount: amountPaise, currency },
  ];
}

/**
 * Format paise as rupee string for human-readable error messages.
 * NOT for financial computation — display only.
 *
 * @param {number} paise
 * @returns {string} e.g. "₹500.00"
 */
function formatPaise(paise) {
  if (!Number.isInteger(paise) || paise < 0) { return '₹0.00'; }
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

module.exports = {
  validateBalance,
  computeLineDelta,
  sumLines,
  buildSimpleLines,
  formatPaise,
};