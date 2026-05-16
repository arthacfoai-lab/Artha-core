'use strict';

/**
 * Journal entry test fixtures.
 * Returns plain objects — no DB calls.
 * All amounts in paise — never float.
 */

let counter = 0;

const CASH_LEDGER_ID  = 'cash-fixture-ledger-0000-000000000001';
const SALES_LEDGER_ID = 'sales-fixture-ledger-000-000000000001';
const EXP_LEDGER_ID   = 'expense-fixture-ledger-0-000000000001';

function makeJournalEntry(companyId, overrides = {}) {
  counter++;
  return {
    companyId:   companyId || 'company-uuid-fixture-001',
    entryDate:   '2025-01-15',
    narration:   `Test journal entry ${counter}`,
    referenceNo: `REF-FIXTURE-${String(counter).padStart(4, '0')}`,
    source:      'manual',
    createdBy:   'user-uuid-fixture-001',
    status:      'posted',
    metadata:    {},
    ...overrides,
  };
}

function makeIncomeLines(debitLedgerId, creditLedgerId, amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(`makeIncomeLines: amountPaise must be positive integer — got ${amountPaise}`);
  }
  return [
    { ledgerId: debitLedgerId,  type: 'DR', amount: amountPaise, currency: 'INR' },
    { ledgerId: creditLedgerId, type: 'CR', amount: amountPaise, currency: 'INR' },
  ];
}

function makeExpenseLines(debitLedgerId, creditLedgerId, amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(`makeExpenseLines: amountPaise must be positive integer — got ${amountPaise}`);
  }
  return [
    { ledgerId: debitLedgerId,  type: 'DR', amount: amountPaise, currency: 'INR' },
    { ledgerId: creditLedgerId, type: 'CR', amount: amountPaise, currency: 'INR' },
  ];
}

function makeMultiLineEntry(companyId, lines, overrides = {}) {
  const entry = makeJournalEntry(companyId, overrides);
  return { entry, lines };
}

/**
 * Assert lines are balanced — throws if DR ≠ CR.
 * Use in tests to verify test data integrity.
 */
function assertBalanced(lines) {
  const totalDr = lines.filter((l) => l.type === 'DR').reduce((s, l) => s + l.amount, 0);
  const totalCr = lines.filter((l) => l.type === 'CR').reduce((s, l) => s + l.amount, 0);
  if (totalDr !== totalCr) {
    throw new Error(`Fixture lines not balanced: DR=${totalDr} CR=${totalCr}`);
  }
  return true;
}

function resetCounter() { counter = 0; }

module.exports = {
  makeJournalEntry,
  makeIncomeLines,
  makeExpenseLines,
  makeMultiLineEntry,
  assertBalanced,
  resetCounter,
  CASH_LEDGER_ID,
  SALES_LEDGER_ID,
  EXP_LEDGER_ID,
};