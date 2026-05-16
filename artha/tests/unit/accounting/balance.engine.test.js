'use strict';

/**
 * Unit tests — balance.engine.js
 *
 * Pure arithmetic tests. No DB, no Redis, no HTTP.
 * These tests are the financial correctness foundation —
 * every double-entry rule is verified here.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

const {
  validateBalance,
  computeLineDelta,
  sumLines,
  buildSimpleLines,
  formatPaise,
} = require('../../../apps/api/src/engines/accounting/balance.engine');

describe('balance.engine', () => {

  // ── validateBalance ─────────────────────────────────────────────────────────
  describe('validateBalance()', () => {

    it('accepts balanced two-line entry', () => {
      const lines = [
        { type: 'DR', amount: 50000 },
        { type: 'CR', amount: 50000 },
      ];
      const result = validateBalance(lines);
      expect(result.totalDr).toBe(50000);
      expect(result.totalCr).toBe(50000);
    });

    it('accepts balanced multi-line entry', () => {
      const lines = [
        { type: 'DR', amount: 30000 },
        { type: 'DR', amount: 20000 },
        { type: 'CR', amount: 50000 },
      ];
      const result = validateBalance(lines);
      expect(result.totalDr).toBe(50000);
      expect(result.totalCr).toBe(50000);
    });

    it('accepts large paise values (up to 1 crore)', () => {
      const lines = [
        { type: 'DR', amount: 1_000_000_000 },
        { type: 'CR', amount: 1_000_000_000 },
      ];
      const result = validateBalance(lines);
      expect(result.totalDr).toBe(1_000_000_000);
    });

    it('throws AccountingError for unbalanced entry', () => {
      const lines = [
        { type: 'DR', amount: 50000 },
        { type: 'CR', amount: 40000 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError when DR > CR', () => {
      const lines = [
        { type: 'DR', amount: 60000 },
        { type: 'CR', amount: 50000 },
      ];
      expect(() => validateBalance(lines)).toThrow();
    });

    it('throws AccountingError when CR > DR', () => {
      const lines = [
        { type: 'DR', amount: 40000 },
        { type: 'CR', amount: 50000 },
      ];
      expect(() => validateBalance(lines)).toThrow();
    });

    it('throws AccountingError for single line (no DR/CR pair)', () => {
      const lines = [{ type: 'DR', amount: 50000 }];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for empty lines array', () => {
      expect(() => validateBalance([]))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for null lines', () => {
      expect(() => validateBalance(null))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for float amount', () => {
      const lines = [
        { type: 'DR', amount: 500.50 },
        { type: 'CR', amount: 500.50 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for zero amount', () => {
      const lines = [
        { type: 'DR', amount: 0 },
        { type: 'CR', amount: 0 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for negative amount', () => {
      const lines = [
        { type: 'DR', amount: -50000 },
        { type: 'CR', amount: -50000 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for invalid type', () => {
      const lines = [
        { type: 'DEBIT', amount: 50000 },
        { type: 'CR',    amount: 50000 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for lowercase type', () => {
      const lines = [
        { type: 'dr', amount: 50000 },
        { type: 'cr', amount: 50000 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError when all lines are DR', () => {
      const lines = [
        { type: 'DR', amount: 25000 },
        { type: 'DR', amount: 25000 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError when all lines are CR', () => {
      const lines = [
        { type: 'CR', amount: 25000 },
        { type: 'CR', amount: 25000 },
      ];
      expect(() => validateBalance(lines))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('error message contains DR and CR amounts', () => {
      const lines = [
        { type: 'DR', amount: 50000 },
        { type: 'CR', amount: 40000 },
      ];
      try {
        validateBalance(lines);
        fail('should have thrown');
      } catch (err) {
        expect(err.message).toContain('500');
        expect(err.message).toContain('400');
      }
    });

    it('error meta contains difference', () => {
      const lines = [
        { type: 'DR', amount: 50000 },
        { type: 'CR', amount: 40000 },
      ];
      try {
        validateBalance(lines);
      } catch (err) {
        expect(err.meta.difference).toBe(10000);
      }
    });
  });

  // ── computeLineDelta ────────────────────────────────────────────────────────
  describe('computeLineDelta()', () => {

    describe('Asset accounts (normal debit balance)', () => {
      it('DR increases asset balance', () => {
        expect(computeLineDelta('asset', 'DR', 1000)).toBe(1000);
      });
      it('CR decreases asset balance', () => {
        expect(computeLineDelta('asset', 'CR', 1000)).toBe(-1000);
      });
    });

    describe('Expense accounts (normal debit balance)', () => {
      it('DR increases expense balance', () => {
        expect(computeLineDelta('expense', 'DR', 1000)).toBe(1000);
      });
      it('CR decreases expense balance', () => {
        expect(computeLineDelta('expense', 'CR', 1000)).toBe(-1000);
      });
    });

    describe('Liability accounts (normal credit balance)', () => {
      it('CR increases liability balance', () => {
        expect(computeLineDelta('liability', 'CR', 1000)).toBe(1000);
      });
      it('DR decreases liability balance', () => {
        expect(computeLineDelta('liability', 'DR', 1000)).toBe(-1000);
      });
    });

    describe('Equity accounts (normal credit balance)', () => {
      it('CR increases equity balance', () => {
        expect(computeLineDelta('equity', 'CR', 1000)).toBe(1000);
      });
      it('DR decreases equity balance', () => {
        expect(computeLineDelta('equity', 'DR', 1000)).toBe(-1000);
      });
    });

    describe('Revenue accounts (normal credit balance)', () => {
      it('CR increases revenue balance', () => {
        expect(computeLineDelta('revenue', 'CR', 1000)).toBe(1000);
      });
      it('DR decreases revenue balance', () => {
        expect(computeLineDelta('revenue', 'DR', 1000)).toBe(-1000);
      });
    });

    it('throws AccountingError for float amount', () => {
      expect(() => computeLineDelta('asset', 'DR', 500.50))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for zero amount', () => {
      expect(() => computeLineDelta('asset', 'DR', 0))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws AccountingError for negative amount', () => {
      expect(() => computeLineDelta('asset', 'DR', -1000))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });
  });

  // ── sumLines ────────────────────────────────────────────────────────────────
  describe('sumLines()', () => {

    it('sums DR and CR separately', () => {
      const lines = [
        { type: 'DR', amount: 30000 },
        { type: 'DR', amount: 20000 },
        { type: 'CR', amount: 50000 },
      ];
      const result = sumLines(lines);
      expect(result.totalDr).toBe(50000);
      expect(result.totalCr).toBe(50000);
      expect(result.count).toBe(3);
    });

    it('returns zero totals for empty array', () => {
      const result = sumLines([]);
      expect(result.totalDr).toBe(0);
      expect(result.totalCr).toBe(0);
      expect(result.count).toBe(0);
    });

    it('returns zero totals for null', () => {
      const result = sumLines(null);
      expect(result.totalDr).toBe(0);
      expect(result.totalCr).toBe(0);
    });
  });

  // ── buildSimpleLines ────────────────────────────────────────────────────────
  describe('buildSimpleLines()', () => {

    it('builds two lines — DR then CR', () => {
      const lines = buildSimpleLines('ledger-a', 'ledger-b', 50000);
      expect(lines).toHaveLength(2);
      expect(lines[0].type).toBe('DR');
      expect(lines[1].type).toBe('CR');
    });

    it('both lines have correct amount', () => {
      const lines = buildSimpleLines('ledger-a', 'ledger-b', 50000);
      expect(lines[0].amount).toBe(50000);
      expect(lines[1].amount).toBe(50000);
    });

    it('sets correct ledger IDs', () => {
      const lines = buildSimpleLines('debit-id', 'credit-id', 50000);
      expect(lines[0].ledgerId).toBe('debit-id');
      expect(lines[1].ledgerId).toBe('credit-id');
    });

    it('defaults currency to INR', () => {
      const lines = buildSimpleLines('a', 'b', 50000);
      expect(lines[0].currency).toBe('INR');
      expect(lines[1].currency).toBe('INR');
    });

    it('accepts custom currency', () => {
      const lines = buildSimpleLines('a', 'b', 50000, 'USD');
      expect(lines[0].currency).toBe('USD');
    });

    it('throws when same ledger for DR and CR', () => {
      expect(() => buildSimpleLines('same-id', 'same-id', 50000))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws when debitLedgerId missing', () => {
      expect(() => buildSimpleLines(null, 'credit-id', 50000))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws for float amount', () => {
      expect(() => buildSimpleLines('a', 'b', 500.50))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws for zero amount', () => {
      expect(() => buildSimpleLines('a', 'b', 0))
        .toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('resulting lines pass validateBalance', () => {
      const lines = buildSimpleLines('a', 'b', 75000);
      const result = validateBalance(lines);
      expect(result.totalDr).toBe(75000);
      expect(result.totalCr).toBe(75000);
    });
  });

  // ── formatPaise ─────────────────────────────────────────────────────────────
  describe('formatPaise()', () => {

    it('formats 50000 paise as ₹500.00', () => {
      expect(formatPaise(50000)).toContain('500.00');
      expect(formatPaise(50000)).toContain('₹');
    });

    it('formats 100 paise as ₹1.00', () => {
      expect(formatPaise(100)).toContain('1.00');
    });

    it('formats 0 paise as ₹0.00', () => {
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('returns ₹0.00 for null', () => {
      expect(formatPaise(null)).toBe('₹0.00');
    });

    it('returns ₹0.00 for negative', () => {
      expect(formatPaise(-100)).toBe('₹0.00');
    });

    it('formats large amounts correctly', () => {
      const result = formatPaise(100000000); // 10 lakh
      expect(result).toContain('₹');
      expect(result).toContain('00');
    });
  });

});