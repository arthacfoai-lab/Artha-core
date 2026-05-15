'use strict';

/**
 * Unit tests — normalizer.js
 * No external dependencies — pure string processing.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

const {
  normalize,
  normalizeText,
  extractAmountPaise,
  detectLanguage,
  detectConfirmation,
} = require('../../../apps/api/src/engines/routing/normalizer');

describe('normalizer', () => {

  // ── extractAmountPaise ──────────────────────────────────────────────────────
  describe('extractAmountPaise()', () => {
    it('extracts ₹500 → 50000 paise', () => {
      expect(extractAmountPaise('received ₹500')).toBe(50000);
    });

    it('extracts ₹5,000 (comma format) → 500000 paise', () => {
      expect(extractAmountPaise('paid ₹5,000')).toBe(500000);
    });

    it('extracts ₹500.50 → 50050 paise', () => {
      expect(extractAmountPaise('₹500.50')).toBe(50050);
    });

    it('extracts Rs 1000 → 100000 paise', () => {
      expect(extractAmountPaise('Rs 1000 paid')).toBe(100000);
    });

    it('extracts rs.500 → 50000 paise', () => {
      expect(extractAmountPaise('rs.500')).toBe(50000);
    });

    it('extracts 2 lakh → 20000000 paise', () => {
      expect(extractAmountPaise('received 2 lakh')).toBe(20000000);
    });

    it('extracts 1.5 lakh → 15000000 paise', () => {
      expect(extractAmountPaise('paid 1.5 lakh')).toBe(15000000);
    });

    it('extracts 1 crore → 100000000 paise', () => {
      expect(extractAmountPaise('transfer 1 crore')).toBe(1000000000);
    });

    it('extracts 5000 rupees → 500000 paise', () => {
      expect(extractAmountPaise('5000 rupees received')).toBe(500000);
    });

    it('extracts 500/- → 50000 paise', () => {
      expect(extractAmountPaise('paid 500/-')).toBe(50000);
    });

    it('returns null when no amount present', () => {
      expect(extractAmountPaise('show balance')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractAmountPaise('')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(extractAmountPaise(null)).toBeNull();
    });

    it('result is always integer — never float', () => {
      const result = extractAmountPaise('₹500.50');
      expect(Number.isInteger(result)).toBe(true);
    });

    it('extracts first amount when multiple present', () => {
      const result = extractAmountPaise('received ₹500 and paid ₹200');
      expect(result).toBe(50000);
    });
  });

  // ── detectLanguage ──────────────────────────────────────────────────────────
  describe('detectLanguage()', () => {
    it('detects English', () => {
      expect(detectLanguage('received payment from customer')).toBe('english');
    });

    it('detects Hinglish — aaya', () => {
      expect(detectLanguage('500 aaya customer se')).toBe('hinglish');
    });

    it('detects Hinglish — gaya', () => {
      expect(detectLanguage('1000 gaya vendor ko')).toBe('hinglish');
    });

    it('detects Hinglish — kharcha', () => {
      expect(detectLanguage('kharcha hua 500')).toBe('hinglish');
    });

    it('detects Hindi — Devanagari script', () => {
      expect(detectLanguage('पाँच सौ रुपये मिले')).toBe('hindi');
    });

    it('detects Hindi — Devanagari in mixed text', () => {
      expect(detectLanguage('received ₹500 आज')).toBe('hindi');
    });

    it('returns english for empty string', () => {
      expect(detectLanguage('')).toBe('english');
    });

    it('returns english for null', () => {
      expect(detectLanguage(null)).toBe('english');
    });
  });

  // ── detectConfirmation ──────────────────────────────────────────────────────
  describe('detectConfirmation()', () => {
    const yesWords = ['yes', 'haan', 'han', 'ok', 'okay', 'confirm',
                      'sahi', 'theek', 'bilkul', 'y', 'ji'];
    const noWords  = ['no', 'nahi', 'na', 'cancel', 'stop', 'galat', 'n'];
    const modWords = ['change', 'badlo', 'modify', 'edit', 'alag'];

    yesWords.forEach((word) => {
      it(`detects "${word}" as yes`, () => {
        expect(detectConfirmation(word)).toBe('yes');
      });
    });

    noWords.forEach((word) => {
      it(`detects "${word}" as no`, () => {
        expect(detectConfirmation(word)).toBe('no');
      });
    });

    modWords.forEach((word) => {
      it(`detects "${word}" as modify`, () => {
        expect(detectConfirmation(word)).toBe('modify');
      });
    });

    it('returns null for financial input', () => {
      expect(detectConfirmation('received ₹500 from Ramesh')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(detectConfirmation('')).toBeNull();
    });

    it('returns null for null', () => {
      expect(detectConfirmation(null)).toBeNull();
    });
  });

  // ── normalizeText ───────────────────────────────────────────────────────────
  describe('normalizeText()', () => {
    it('converts to lowercase', () => {
      expect(normalizeText('RECEIVED PAYMENT')).toBe('received payment');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeText('paid   500   rupees')).toBe('paid 500 rupees');
    });

    it('replaces "aaya" with "received"', () => {
      expect(normalizeText('500 aaya')).toContain('received');
    });

    it('replaces "gaya" with "paid"', () => {
      expect(normalizeText('500 gaya')).toContain('paid');
    });

    it('replaces "kharcha" with "expense"', () => {
      expect(normalizeText('kharcha 500')).toContain('expense');
    });

    it('replaces "hisab" with "account summary"', () => {
      expect(normalizeText('hisab dikhao')).toContain('account summary');
    });

    it('handles empty string', () => {
      expect(normalizeText('')).toBe('');
    });

    it('handles null input', () => {
      expect(normalizeText(null)).toBe('');
    });
  });

  // ── normalize() full pipeline ───────────────────────────────────────────────
  describe('normalize()', () => {
    it('returns all expected fields', () => {
      const result = normalize('received ₹500 from Ramesh');
      expect(result).toHaveProperty('original');
      expect(result).toHaveProperty('normalized');
      expect(result).toHaveProperty('amountPaise');
      expect(result).toHaveProperty('language');
      expect(result).toHaveProperty('confirmation');
      expect(result).toHaveProperty('length');
      expect(result).toHaveProperty('isEmpty');
    });

    it('processes English income statement', () => {
      const result = normalize('received ₹500 from Ramesh');
      expect(result.amountPaise).toBe(50000);
      expect(result.language).toBe('english');
      expect(result.isEmpty).toBe(false);
      expect(result.confirmation).toBeNull();
    });

    it('processes Hinglish income statement', () => {
      const result = normalize('₹1000 aaya customer se');
      expect(result.amountPaise).toBe(100000);
      expect(result.language).toBe('hinglish');
    });

    it('detects confirmation in full pipeline', () => {
      expect(normalize('haan').confirmation).toBe('yes');
      expect(normalize('nahi').confirmation).toBe('no');
      expect(normalize('badlo').confirmation).toBe('modify');
    });

    it('marks empty input as isEmpty', () => {
      expect(normalize('   ').isEmpty).toBe(true);
      expect(normalize('').isEmpty).toBe(true);
    });

    it('handles null without throwing', () => {
      const result = normalize(null);
      expect(result.isEmpty).toBe(true);
      expect(result.amountPaise).toBeNull();
    });

    it('original field is unchanged raw input', () => {
      const raw    = 'Received ₹500 from RAMESH';
      const result = normalize(raw);
      expect(result.original).toBe(raw);
    });

    it('length reflects trimmed character count', () => {
      const result = normalize('  hello  ');
      expect(result.length).toBe(5);
    });
  });

});
