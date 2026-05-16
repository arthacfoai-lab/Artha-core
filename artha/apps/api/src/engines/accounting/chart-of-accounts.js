'use strict';

/**
 * ARTHA Default Chart of Accounts
 *
 * Standard MSME chart of accounts for Indian businesses.
 * Seeded into the ledgers table on company registration.
 * Called by ledger.engine.js seedDefaultAccounts().
 *
 * Account type classification:
 *   asset     — things the business owns (cash, bank, receivables)
 *   liability — things the business owes (payables, GST payable)
 *   equity    — owner's stake (capital, retained earnings)
 *   revenue   — income sources (sales, service revenue)
 *   expense   — cost categories (COGS, rent, salaries)
 *
 * sub_type is the machine-readable identifier used by the accounting
 * engine to resolve ledger IDs without requiring user to specify them.
 * e.g. ledger.engine.resolveBySubType(companyId, 'cash') → ledger row
 *
 * Code scheme:
 *   1xxx — Assets
 *   2xxx — Liabilities
 *   3xxx — Equity
 *   4xxx — Revenue
 *   5xxx — Expenses
 *
 * is_system=true → cannot be deleted by user.
 * These are the minimum required for double-entry to function.
 *
 * All balances start at 0 BIGINT paise.
 *
 * Future: Day 6 GST engine adds GST payable / ITC ledgers.
 * Future: Day 9 intelligence engine reads these for P&L.
 * Future: Admin can add custom ledgers alongside system ones.
 */

const DEFAULT_ACCOUNTS = [

  // ── ASSETS (1xxx) ──────────────────────────────────────────────────────────
  {
    code:        '1001',
    name:        'Cash in Hand',
    type:        'asset',
    subType:     'cash',
    isSystem:    true,
    description: 'Physical cash held by the business',
  },
  {
    code:        '1002',
    name:        'Bank Account',
    type:        'asset',
    subType:     'bank',
    isSystem:    true,
    description: 'Primary business bank account',
  },
  {
    code:        '1003',
    name:        'Trade Receivables',
    type:        'asset',
    subType:     'trade_receivable',
    isSystem:    true,
    description: 'Amounts owed by customers (debtors)',
  },
  {
    code:        '1004',
    name:        'GST Input Tax Credit',
    type:        'asset',
    subType:     'gst_itc',
    isSystem:    true,
    description: 'GST paid on purchases — available for set-off against GST collected',
  },
  {
    code:        '1005',
    name:        'Inventory',
    type:        'asset',
    subType:     'inventory',
    isSystem:    false,
    description: 'Stock of goods held for sale or production',
  },
  {
    code:        '1006',
    name:        'Prepaid Expenses',
    type:        'asset',
    subType:     'prepaid',
    isSystem:    false,
    description: 'Expenses paid in advance (rent, insurance, etc.)',
  },
  {
    code:        '1007',
    name:        'Other Current Assets',
    type:        'asset',
    subType:     'other_current_asset',
    isSystem:    false,
    description: 'Other short-term assets not classified above',
  },

  // ── LIABILITIES (2xxx) ────────────────────────────────────────────────────
  {
    code:        '2001',
    name:        'Trade Payables',
    type:        'liability',
    subType:     'trade_payable',
    isSystem:    true,
    description: 'Amounts owed to vendors and suppliers (creditors)',
  },
  {
    code:        '2002',
    name:        'GST Payable',
    type:        'liability',
    subType:     'gst_payable',
    isSystem:    true,
    description: 'Net GST collected and payable to government',
  },
  {
    code:        '2003',
    name:        'CGST Payable',
    type:        'liability',
    subType:     'cgst_payable',
    isSystem:    true,
    description: 'Central GST collected on sales — payable to government',
  },
  {
    code:        '2004',
    name:        'SGST Payable',
    type:        'liability',
    subType:     'sgst_payable',
    isSystem:    true,
    description: 'State GST collected on sales — payable to government',
  },
  {
    code:        '2005',
    name:        'IGST Payable',
    type:        'liability',
    subType:     'igst_payable',
    isSystem:    true,
    description: 'Integrated GST collected on inter-state sales',
  },
  {
    code:        '2006',
    name:        'Short-Term Loans',
    type:        'liability',
    subType:     'short_term_loan',
    isSystem:    false,
    description: 'Loans and borrowings repayable within 12 months',
  },
  {
    code:        '2007',
    name:        'Other Current Liabilities',
    type:        'liability',
    subType:     'other_current_liability',
    isSystem:    false,
    description: 'Other short-term obligations not classified above',
  },

  // ── EQUITY (3xxx) ─────────────────────────────────────────────────────────
  {
    code:        '3001',
    name:        "Owner's Capital",
    type:        'equity',
    subType:     'capital',
    isSystem:    true,
    description: "Owner's investment in the business",
  },
  {
    code:        '3002',
    name:        'Retained Earnings',
    type:        'equity',
    subType:     'retained_earnings',
    isSystem:    true,
    description: 'Accumulated profits retained in the business',
  },
  {
    code:        '3003',
    name:        "Owner's Drawings",
    type:        'equity',
    subType:     'drawings',
    isSystem:    false,
    description: 'Amounts withdrawn by the owner for personal use',
  },

  // ── REVENUE (4xxx) ────────────────────────────────────────────────────────
  {
    code:        '4001',
    name:        'Sales Revenue',
    type:        'revenue',
    subType:     'sales',
    isSystem:    true,
    description: 'Income from primary business sales activity',
  },
  {
    code:        '4002',
    name:        'Service Revenue',
    type:        'revenue',
    subType:     'service_revenue',
    isSystem:    false,
    description: 'Income from services rendered to customers',
  },
  {
    code:        '4003',
    name:        'Other Income',
    type:        'revenue',
    subType:     'other_income',
    isSystem:    false,
    description: 'Miscellaneous income not from primary operations',
  },
  {
    code:        '4004',
    name:        'Interest Income',
    type:        'revenue',
    subType:     'interest_income',
    isSystem:    false,
    description: 'Interest earned on deposits and loans given',
  },

  // ── EXPENSES (5xxx) ───────────────────────────────────────────────────────
  {
    code:        '5001',
    name:        'Cost of Goods Sold',
    type:        'expense',
    subType:     'cogs',
    isSystem:    true,
    description: 'Direct cost of goods sold in the period',
  },
  {
    code:        '5002',
    name:        'Purchases',
    type:        'expense',
    subType:     'purchases',
    isSystem:    true,
    description: 'Goods purchased for resale or production',
  },
  {
    code:        '5003',
    name:        'Rent Expense',
    type:        'expense',
    subType:     'rent',
    isSystem:    false,
    description: 'Office, warehouse, or shop rent payments',
  },
  {
    code:        '5004',
    name:        'Salary & Wages',
    type:        'expense',
    subType:     'salary',
    isSystem:    false,
    description: 'Employee salaries, wages, and allowances',
  },
  {
    code:        '5005',
    name:        'Electricity & Utilities',
    type:        'expense',
    subType:     'utilities',
    isSystem:    false,
    description: 'Electricity, water, gas, internet, phone bills',
  },
  {
    code:        '5006',
    name:        'Transport & Logistics',
    type:        'expense',
    subType:     'transport',
    isSystem:    false,
    description: 'Freight, delivery, courier, vehicle expenses',
  },
  {
    code:        '5007',
    name:        'Marketing & Advertising',
    type:        'expense',
    subType:     'marketing',
    isSystem:    false,
    description: 'Advertising, promotions, and marketing costs',
  },
  {
    code:        '5008',
    name:        'Professional Fees',
    type:        'expense',
    subType:     'professional_fees',
    isSystem:    false,
    description: 'CA, lawyer, consultant, and advisory fees',
  },
  {
    code:        '5009',
    name:        'Bank Charges',
    type:        'expense',
    subType:     'bank_charges',
    isSystem:    false,
    description: 'Bank transaction fees, service charges, DD charges',
  },
  {
    code:        '5010',
    name:        'Miscellaneous Expenses',
    type:        'expense',
    subType:     'misc_expense',
    isSystem:    false,
    description: 'Other business expenses not classified above',
  },
];

/**
 * Get full default chart of accounts.
 * Returns new array each time — prevents mutation of master list.
 *
 * @returns {Array<object>}
 */
function getDefaultAccounts() {
  return DEFAULT_ACCOUNTS.map((a) => ({ ...a }));
}

/**
 * Get system-only accounts (is_system=true).
 * These are the minimum required for ARTHA to function.
 *
 * @returns {Array<object>}
 */
function getSystemAccounts() {
  return DEFAULT_ACCOUNTS
    .filter((a) => a.isSystem)
    .map((a) => ({ ...a }));
}

/**
 * Find default account definition by sub_type.
 * Used by accounting engine to identify intent → ledger mapping.
 *
 * @param {string} subType
 * @returns {object|null}
 */
function findBySubType(subType) {
  return DEFAULT_ACCOUNTS.find((a) => a.subType === subType) || null;
}

/**
 * Find default account definition by code.
 *
 * @param {string} code
 * @returns {object|null}
 */
function findByCode(code) {
  return DEFAULT_ACCOUNTS.find((a) => a.code === code) || null;
}

/**
 * Get all sub_types for a given account type.
 * Used by reporting engine (Day 9) to group ledgers.
 *
 * @param {string} type — 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
 * @returns {Array<string>}
 */
function getSubTypesByType(type) {
  return DEFAULT_ACCOUNTS
    .filter((a) => a.type === type)
    .map((a) => a.subType);
}

module.exports = {
  getDefaultAccounts,
  getSystemAccounts,
  findBySubType,
  findByCode,
  getSubTypesByType,
  DEFAULT_ACCOUNTS,
};