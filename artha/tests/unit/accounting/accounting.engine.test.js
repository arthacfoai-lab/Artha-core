'use strict';

/**
 * Unit tests — accounting.engine.js
 * Tests intent dispatch and operation routing.
 * Mocks journal.engine and ledger.engine — no DB needed.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

// ── Mock engines ───────────────────────────────────────────────────────────────
jest.mock('../../../apps/api/src/engines/accounting/journal.engine', () => ({
  postEntry:    jest.fn(async (params) => ({
    entry: {
      id:         'entry-uuid-test-001',
      narration:  params.narration,
      entry_date: params.entryDate,
      status:     'posted',
    },
    lines:          params.lines.map((l, i) => ({ id: `line-${i}`, ...l })),
    balanceUpdates: [],
  })),
  reverseEntry: jest.fn(async () => ({
    entry:          { id: 'reversal-uuid-001', status: 'posted' },
    lines:          [],
    balanceUpdates: [],
    originalEntryId: 'original-uuid-001',
  })),
  getEntry:     jest.fn(async () => ({ entry: {}, lines: [] })),
  listEntries:  jest.fn(async () => ({ entries: [], total: 0 })),
}));

jest.mock('../../../apps/api/src/engines/accounting/ledger.engine', () => {
  const ledgers = {
    cash:              { id: 'cash-id-001',   name: 'Cash in Hand',   type: 'asset',   balance: 0 },
    bank:              { id: 'bank-id-001',   name: 'Bank Account',   type: 'asset',   balance: 0 },
    sales:             { id: 'sales-id-001',  name: 'Sales Revenue',  type: 'revenue', balance: 0 },
    misc_expense:      { id: 'exp-id-001',    name: 'Misc Expenses',  type: 'expense', balance: 0 },
    trade_payable:     { id: 'pay-id-001',    name: 'Trade Payables', type: 'liability', balance: 0 },
    trade_receivable:  { id: 'rec-id-001',    name: 'Trade Receivables', type: 'asset', balance: 0 },
  };

  return {
    resolveBySubType: jest.fn(async (_companyId, subType) => {
      const ledger = ledgers[subType];
      if (!ledger) { throw new Error(`Ledger subType '${subType}' not found`); }
      return ledger;
    }),
    getBalance:    jest.fn(async (_companyId, ledgerId) => ({
      ledger:       { id: ledgerId, balance: 50000, currency: 'INR' },
      balancePaise:  50000,
      balanceRupees: '500.00',
    })),
    getTrialBalance: jest.fn(async () => ({
      ledgers: {},
      totals:  { totalDr: 0, totalCr: 0, isBalanced: true },
    })),
    listLedgers:    jest.fn(async () => []),
    createLedger:   jest.fn(async (_companyId, params) => ({ id: 'new-ledger-id', ...params })),
    seedDefaultAccounts: jest.fn(async () => []),
    adjustBalances: jest.fn(async () => []),
  };
});

jest.mock('../../../apps/api/src/engines/accounting/reconciliation.engine', () => ({
  getLedgerStatement:    jest.fn(async () => ({ transactions: [], openingBalance: 0 })),
  getUnreconciledSummary: jest.fn(async () => ({ totalEntries: 0 })),
  verifyLedgerBalance:   jest.fn(async () => ({ isMatched: true })),
}));

jest.mock('@artha/logger', () => ({
  createContextLogger: jest.fn(() => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  })),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const accountingEngine = require('../../../apps/api/src/engines/accounting/accounting.engine');
const journalEngine    = require('../../../apps/api/src/engines/accounting/journal.engine');
const ledgerEngine     = require('../../../apps/api/src/engines/accounting/ledger.engine');
const { INTENT }       = require('../../../apps/api/src/engines/routing/intent.types');

const COMPANY_ID = 'company-uuid-test-001';
const TRACE_ID   = 'trace-uuid-test-001';
const USER_ID    = 'user-uuid-test-001';

const BASE_PAYLOAD = {
  amountPaise:  50000,
  userId:       USER_ID,
  entryDate:    '2025-01-15',
  source:       'api',
  narration:    'Test transaction',
  ledgerHint:   null,
  party:        null,
  referenceNo:  null,
};

beforeEach(() => { jest.clearAllMocks(); });

describe('accounting.engine', () => {

  describe('dispatch()', () => {

    it('dispatches accounting.record_income', async () => {
      await accountingEngine.dispatch(INTENT.ACCOUNTING_RECORD_INCOME, BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(journalEngine.postEntry).toHaveBeenCalledTimes(1);
    });

    it('dispatches accounting.record_expense', async () => {
      await accountingEngine.dispatch(INTENT.ACCOUNTING_RECORD_EXPENSE, BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(journalEngine.postEntry).toHaveBeenCalledTimes(1);
    });

    it('dispatches accounting.record_payment', async () => {
      await accountingEngine.dispatch(INTENT.ACCOUNTING_RECORD_PAYMENT, BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(journalEngine.postEntry).toHaveBeenCalledTimes(1);
    });

    it('dispatches accounting.record_receipt', async () => {
      await accountingEngine.dispatch(INTENT.ACCOUNTING_RECORD_RECEIPT, BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(journalEngine.postEntry).toHaveBeenCalledTimes(1);
    });

    it('dispatches accounting.record_transfer', async () => {
      await accountingEngine.dispatch(INTENT.ACCOUNTING_RECORD_TRANSFER, BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(journalEngine.postEntry).toHaveBeenCalledTimes(1);
    });

    it('dispatches accounting.view_balance', async () => {
      await accountingEngine.dispatch(
        INTENT.ACCOUNTING_VIEW_BALANCE,
        { ...BASE_PAYLOAD, ledgerId: 'cash-id-001' },
        COMPANY_ID,
        TRACE_ID
      );
      expect(ledgerEngine.getBalance).toHaveBeenCalledTimes(1);
    });

    it('dispatches accounting.view_summary', async () => {
      await accountingEngine.dispatch(INTENT.ACCOUNTING_VIEW_SUMMARY, BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(ledgerEngine.getTrialBalance).toHaveBeenCalledTimes(1);
    });

    it('throws AccountingError for unknown intent', async () => {
      await expect(
        accountingEngine.dispatch('unknown.intent', BASE_PAYLOAD, COMPANY_ID, TRACE_ID)
      ).rejects.toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });
  });

  describe('recordIncome()', () => {

    it('uses cash as debit by default', async () => {
      await accountingEngine.recordIncome(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'cash');
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'sales');
    });

    it('uses bank as debit when ledgerHint is bank', async () => {
      await accountingEngine.recordIncome(
        { ...BASE_PAYLOAD, ledgerHint: 'bank' },
        COMPANY_ID,
        TRACE_ID
      );
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'bank');
    });

    it('posts entry with DR and CR lines', async () => {
      await accountingEngine.recordIncome(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      const call  = journalEngine.postEntry.mock.calls[0][0];
      const types = call.lines.map((l) => l.type);
      expect(types).toContain('DR');
      expect(types).toContain('CR');
    });

    it('posts correct amount on both lines', async () => {
      await accountingEngine.recordIncome(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      const call = journalEngine.postEntry.mock.calls[0][0];
      expect(call.lines[0].amount).toBe(50000);
      expect(call.lines[1].amount).toBe(50000);
    });

    it('throws ValidationError when amountPaise missing', async () => {
      await expect(
        accountingEngine.recordIncome(
          { ...BASE_PAYLOAD, amountPaise: null },
          COMPANY_ID,
          TRACE_ID
        )
      ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('throws ValidationError for float amountPaise', async () => {
      await expect(
        accountingEngine.recordIncome(
          { ...BASE_PAYLOAD, amountPaise: 500.50 },
          COMPANY_ID,
          TRACE_ID
        )
      ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('result has action income_recorded', async () => {
      const result = await accountingEngine.recordIncome(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(result.action).toBe('income_recorded');
    });

    it('result has amountFormatted', async () => {
      const result = await accountingEngine.recordIncome(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(result.amountFormatted).toContain('₹');
      expect(result.amountFormatted).toContain('500');
    });
  });

  describe('recordExpense()', () => {

    it('uses misc_expense as debit', async () => {
      await accountingEngine.recordExpense(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'misc_expense');
    });

    it('uses cash as credit by default', async () => {
      await accountingEngine.recordExpense(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'cash');
    });

    it('uses bank as credit when ledgerHint is bank', async () => {
      await accountingEngine.recordExpense(
        { ...BASE_PAYLOAD, ledgerHint: 'bank' },
        COMPANY_ID,
        TRACE_ID
      );
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'bank');
    });

    it('result has action expense_recorded', async () => {
      const result = await accountingEngine.recordExpense(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(result.action).toBe('expense_recorded');
    });
  });

  describe('recordTransfer()', () => {

    it('transfers cash to bank by default (DR bank, CR cash)', async () => {
      await accountingEngine.recordTransfer(BASE_PAYLOAD, COMPANY_ID, TRACE_ID);
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'bank');
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'cash');
    });

    it('transfers bank to cash when ledgerHint is bank_to_cash', async () => {
      await accountingEngine.recordTransfer(
        { ...BASE_PAYLOAD, ledgerHint: 'bank_to_cash' },
        COMPANY_ID,
        TRACE_ID
      );
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'cash');
      expect(ledgerEngine.resolveBySubType).toHaveBeenCalledWith(COMPANY_ID, 'bank');
    });
  });

  describe('reverseEntry()', () => {

    it('throws ValidationError when entryId missing in payload', async () => {
      await expect(
        accountingEngine.reverseEntry(
          { ...BASE_PAYLOAD, entryId: null },
          COMPANY_ID,
          TRACE_ID
        )
      ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('calls journal.engine.reverseEntry with correct args', async () => {
      await accountingEngine.reverseEntry(
        { ...BASE_PAYLOAD, entryId: 'entry-to-reverse-001' },
        COMPANY_ID,
        TRACE_ID
      );
      expect(journalEngine.reverseEntry).toHaveBeenCalledWith(
        COMPANY_ID,
        'entry-to-reverse-001',
        USER_ID,
        null,
        TRACE_ID
      );
    });
  });

});