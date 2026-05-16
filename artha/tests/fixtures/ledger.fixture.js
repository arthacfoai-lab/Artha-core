'use strict';

/**
 * Ledger test fixtures.
 * Returns plain objects — no DB calls.
 */

let counter = 0;

function makeLedger(companyId, overrides = {}) {
  counter++;
  return {
    id:        `ledger-fixture-uuid-${String(counter).padStart(4, '0')}-000000000001`,
    company_id: companyId || 'company-uuid-fixture-001',
    name:       `Test Ledger ${counter}`,
    code:       `${9000 + counter}`,
    type:       'asset',
    sub_type:   null,
    is_system:  false,
    balance:    0,
    currency:   'INR',
    description: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCashLedger(companyId, overrides = {}) {
  return makeLedger(companyId, {
    name:      'Cash in Hand',
    code:      '1001',
    type:      'asset',
    sub_type:  'cash',
    is_system: true,
    ...overrides,
  });
}

function makeSalesLedger(companyId, overrides = {}) {
  return makeLedger(companyId, {
    name:      'Sales Revenue',
    code:      '4001',
    type:      'revenue',
    sub_type:  'sales',
    is_system: true,
    ...overrides,
  });
}

function makeBankLedger(companyId, overrides = {}) {
  return makeLedger(companyId, {
    name:      'Bank Account',
    code:      '1002',
    type:      'asset',
    sub_type:  'bank',
    is_system: true,
    ...overrides,
  });
}

function makeExpenseLedger(companyId, overrides = {}) {
  return makeLedger(companyId, {
    name:      'Miscellaneous Expenses',
    code:      '5010',
    type:      'expense',
    sub_type:  'misc_expense',
    is_system: true,
    ...overrides,
  });
}

/**
 * Build a minimal chart of accounts for testing.
 * Returns map of subType → ledger row.
 */
function makeTestChartOfAccounts(companyId) {
  return {
    cash:             makeCashLedger(companyId),
    bank:             makeBankLedger(companyId),
    sales:            makeSalesLedger(companyId),
    misc_expense:     makeExpenseLedger(companyId),
    trade_payable:    makeLedger(companyId, { name: 'Trade Payables',     code: '2001', type: 'liability', sub_type: 'trade_payable',    is_system: true }),
    trade_receivable: makeLedger(companyId, { name: 'Trade Receivables',  code: '1003', type: 'asset',     sub_type: 'trade_receivable', is_system: true }),
    capital:          makeLedger(companyId, { name: "Owner's Capital",    code: '3001', type: 'equity',    sub_type: 'capital',          is_system: true }),
    purchases:        makeLedger(companyId, { name: 'Purchases',          code: '5002', type: 'expense',   sub_type: 'purchases',        is_system: true }),
  };
}

function resetCounter() { counter = 0; }

module.exports = {
  makeLedger,
  makeCashLedger,
  makeSalesLedger,
  makeBankLedger,
  makeExpenseLedger,
  makeTestChartOfAccounts,
  resetCounter,
};