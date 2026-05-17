'use strict';

/**
 * Unit tests — reconciliation.engine.js
 *
 * Tests balance verification, ledger statement generation,
 * and unreconciled summary.
 * Mocks @artha/database — no real DB needed.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

// ── Mock @artha/database ───────────────────────────────────────────────────────
jest.mock('@artha/database', () => {
  const COMPANY_ID = 'company-uuid-recon-test-001';
  const LEDGER_ID  = 'ledger-uuid-recon-test-0001';

  return {
    query: jest.fn(async (sql) => {
      // Mock for verifyLedgerBalance lines query
      if (sql.includes('journal_lines') && sql.includes('journal_entries')) {
        return {
          rows: [
            { type: 'DR', amount: 50000, ledger_type: 'asset' },
            { type: 'DR', amount: 25000, ledger_type: 'asset' },
          ],
        };
      }
      // Mock for opening balance query
      if (sql.includes('entry_date  <')) {
        return { rows: [] };
      }
      // Mock for unreconciled summary
      if (sql.includes('total_entries')) {
        return {
          rows: [{
            total_entries: '5',
            posted:        '4',
            reversed:      '1',
            draft:         '0',
          }],
        };
      }
      return { rows: [] };
    }),

    ledgerRepository: {
      findById: jest.fn(async (_companyId, id) => ({
        id,
        company_id: COMPANY_ID,
        name:       'Cash in Hand',
        code:       '1001',
        type:       'asset',
        sub_type:   'cash',
        is_system:  true,
        balance:    75000,
        currency:   'INR',
        deleted_at: null,
      })),

      getBalance: jest.fn(async (_companyId, id) => ({
        id,
        balance:  75000,
        currency: 'INR',
      })),
    },

    journalRepository: {
      getLedgerLines: jest.fn(async () => [
        {
          type:        'DR',
          amount:      50000,
          entry_date:  '2025-01-10',
          narration:   'Cash received',
          reference_no: 'INV-001',
          status:      'posted',
        },
        {
          type:        'DR',
          amount:      25000,
          entry_date:  '2025-01-12',
          narration:   'Cash received again',
          reference_no: null,
          status:      'posted',
        },
      ]),
    },

    COMPANY_ID,
    LEDGER_ID,
  };
});

jest.mock('@artha/logger', () => ({
  createContextLogger: jest.fn(() => ({
    info:  jest.fn(),
    debug: jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
    })),
  })),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const reconciliationEngine = require('../../../apps/api/src/engines/accounting/reconciliation.engine');
const dbMock               = require('@artha/database');
const { COMPANY_ID, LEDGER_ID } = dbMock;
const TRACE_ID = 'trace-recon-test-001';

beforeEach(() => { jest.clearAllMocks(); });

describe('reconciliation.engine', () => {

  // ── verifyLedgerBalance ─────────────────────────────────────────────────────
  describe('verifyLedgerBalance()', () => {

    it('returns verification result object', async () => {
      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result).toHaveProperty('ledgerId');
      expect(result).toHaveProperty('storedBalance');
      expect(result).toHaveProperty('computedBalance');
      expect(result).toHaveProperty('isMatched');
      expect(result).toHaveProperty('discrepancyPaise');
    });

    it('returns correct ledgerId', async () => {
      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result.ledgerId).toBe(LEDGER_ID);
    });

    it('returns storedBalance from ledger table', async () => {
      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result.storedBalance).toBe(75000);
    });

    it('computes balance from journal lines (50000 + 25000 = 75000)', async () => {
      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result.computedBalance).toBe(75000);
    });

    it('isMatched true when stored equals computed', async () => {
      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result.isMatched).toBe(true);
      expect(result.discrepancyPaise).toBe(0);
    });

    it('isMatched false when balances differ', async () => {
      // Override stored balance to create mismatch
      dbMock.ledgerRepository.getBalance.mockResolvedValueOnce({
        id: LEDGER_ID, balance: 60000, currency: 'INR',
      });

      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result.isMatched).toBe(false);
      expect(result.discrepancyPaise).toBeGreaterThan(0);
    });

    it('discrepancyPaise is absolute difference', async () => {
      dbMock.ledgerRepository.getBalance.mockResolvedValueOnce({
        id: LEDGER_ID, balance: 60000, currency: 'INR',
      });

      const result = await reconciliationEngine.verifyLedgerBalance(
        COMPANY_ID, LEDGER_ID, TRACE_ID
      );
      expect(result.discrepancyPaise).toBe(Math.abs(60000 - 75000));
    });
  });

  // ── getLedgerStatement ──────────────────────────────────────────────────────
  describe('getLedgerStatement()', () => {

    it('returns statement object with required fields', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      expect(result).toHaveProperty('ledger');
      expect(result).toHaveProperty('fromDate');
      expect(result).toHaveProperty('toDate');
      expect(result).toHaveProperty('openingBalance');
      expect(result).toHaveProperty('closingBalance');
      expect(result).toHaveProperty('transactions');
      expect(result).toHaveProperty('transactionCount');
      expect(result).toHaveProperty('generatedAt');
    });

    it('ledger has correct fields', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      expect(result.ledger).toHaveProperty('id');
      expect(result.ledger).toHaveProperty('name');
      expect(result.ledger).toHaveProperty('code');
      expect(result.ledger).toHaveProperty('type');
    });

    it('fromDate and toDate match input', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      expect(result.fromDate).toBe('2025-01-01');
      expect(result.toDate).toBe('2025-01-31');
    });

    it('transactions is an array', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      expect(Array.isArray(result.transactions)).toBe(true);
    });

    it('each transaction has balance field (running balance)', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      for (const tx of result.transactions) {
        expect(tx).toHaveProperty('balance');
        expect(tx).toHaveProperty('entryDate');
        expect(tx).toHaveProperty('narration');
        expect(tx).toHaveProperty('type');
        expect(tx).toHaveProperty('amountPaise');
      }
    });

    it('closingBalance equals openingBalance + net transactions', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      // Mock has 2 DR lines of 50000 + 25000 for asset = +75000 net
      const expectedClosing = result.openingBalance + 75000;
      expect(result.closingBalance).toBe(expectedClosing);
    });

    it('transactionCount matches transactions array length', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      expect(result.transactionCount).toBe(result.transactions.length);
    });

    it('generatedAt is ISO timestamp', async () => {
      const result = await reconciliationEngine.getLedgerStatement(
        COMPANY_ID, LEDGER_ID, '2025-01-01', '2025-01-31', TRACE_ID
      );

      expect(() => new Date(result.generatedAt)).not.toThrow();
      expect(typeof result.generatedAt).toBe('string');
    });

    it('throws when fromDate missing', async () => {
      await expect(
        reconciliationEngine.getLedgerStatement(
          COMPANY_ID, LEDGER_ID, null, '2025-01-31', TRACE_ID
        )
      ).rejects.toThrow();
    });

    it('throws when toDate missing', async () => {
      await expect(
        reconciliationEngine.getLedgerStatement(
          COMPANY_ID, LEDGER_ID, '2025-01-01', null, TRACE_ID
        )
      ).rejects.toThrow();
    });
  });

  // ── getUnreconciledSummary ──────────────────────────────────────────────────
  describe('getUnreconciledSummary()', () => {

    it('returns summary object with required fields', async () => {
      const result = await reconciliationEngine.getUnreconciledSummary(
        COMPANY_ID, TRACE_ID
      );

      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('totalEntries');
      expect(result).toHaveProperty('posted');
      expect(result).toHaveProperty('reversed');
      expect(result).toHaveProperty('draft');
      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('bankMatching');
    });

    it('period has fromDate and toDate', async () => {
      const result = await reconciliationEngine.getUnreconciledSummary(
        COMPANY_ID, TRACE_ID
      );

      expect(result.period).toHaveProperty('fromDate');
      expect(result.period).toHaveProperty('toDate');
    });

    it('counts are integers', async () => {
      const result = await reconciliationEngine.getUnreconciledSummary(
        COMPANY_ID, TRACE_ID
      );

      expect(Number.isInteger(result.totalEntries)).toBe(true);
      expect(Number.isInteger(result.posted)).toBe(true);
      expect(Number.isInteger(result.reversed)).toBe(true);
      expect(Number.isInteger(result.draft)).toBe(true);
    });

    it('bankMatching.status is not_implemented (Day 3 foundation)', async () => {
      const result = await reconciliationEngine.getUnreconciledSummary(
        COMPANY_ID, TRACE_ID
      );

      expect(result.bankMatching.status).toBe('not_implemented');
      expect(result.bankMatching.availableFromDay).toBe(7);
    });

    it('generatedAt is valid ISO string', async () => {
      const result = await reconciliationEngine.getUnreconciledSummary(
        COMPANY_ID, TRACE_ID
      );

      const parsed = new Date(result.generatedAt);
      expect(isNaN(parsed.getTime())).toBe(false);
    });
  });

});