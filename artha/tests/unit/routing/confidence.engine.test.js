'use strict';

/**
 * Unit tests — confidence.engine.js
 * Pure logic — no DB, no Redis, no HTTP.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

const {
  scoreIntent,
  rankIntents,
  getTopIntent,
} = require('../../../apps/api/src/engines/routing/confidence.engine');

const { normalize } = require('../../../apps/api/src/engines/routing/normalizer');
const { INTENT, CONFIDENCE } = require('../../../apps/api/src/engines/routing/intent.types');

describe('confidence.engine', () => {

  // ── scoreIntent ─────────────────────────────────────────────────────────────
  describe('scoreIntent()', () => {
    it('returns 0 for unrelated input', () => {
      const input = normalize('the quick brown fox jumps over the lazy dog');
      expect(scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, input)).toBe(0);
    });

    it('returns positive score for matching input', () => {
      const input = normalize('received payment from customer');
      expect(scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, input)).toBeGreaterThan(0);
    });

    it('returns higher score for more signal matches', () => {
      const weak   = normalize('received');
      const strong = normalize('received income payment collected from customer');
      const ws = scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, weak);
      const ss = scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, strong);
      expect(ss).toBeGreaterThan(ws);
    });

    it('penalizes write intent without amount', () => {
      const withAmt    = normalize('received ₹500 income');
      const withoutAmt = normalize('received income payment');
      const sA = scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, withAmt);
      const sB = scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, withoutAmt);
      expect(sA).toBeGreaterThan(sB);
    });

    it('boosts score when session has matching pending intent', () => {
      const input      = normalize('received ₹500');
      const noSession  = scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, input, null);
      const withSession = scoreIntent(INTENT.ACCOUNTING_RECORD_INCOME, input, {
        pendingIntent: INTENT.ACCOUNTING_RECORD_INCOME,
      });
      expect(withSession).toBeGreaterThan(noSession);
    });

    it('score is always between 0 and 1', () => {
      const inputs = [
        'received ₹500 income collected payment from customer',
        'paid expense kharcha vendor',
        'show balance',
        'gst sale invoice raised with tax',
        '',
      ];
      const intents = Object.values(INTENT).filter((i) =>
        i !== INTENT.UNKNOWN && !i.startsWith('confirm')
      );
      for (const raw of inputs) {
        const input = normalize(raw);
        for (const intent of intents) {
          const score = scoreIntent(intent, input);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }
    });

    it('returns 0 for UNKNOWN intent', () => {
      const input = normalize('received ₹500');
      expect(scoreIntent(INTENT.UNKNOWN, input)).toBe(0);
    });
  });

  // ── rankIntents ─────────────────────────────────────────────────────────────
  describe('rankIntents()', () => {
    it('returns empty array for unrecognized input', () => {
      const input = normalize('abcdefghijklmnop unrecognized text here');
      expect(rankIntents(input)).toHaveLength(0);
    });

    it('returns array sorted descending by score', () => {
      const input  = normalize('received ₹500 income from customer');
      const ranked = rankIntents(input);
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
      }
    });

    it('expense input ranks ACCOUNTING_RECORD_EXPENSE highest', () => {
      const input  = normalize('paid ₹1000 expense kharcha vendor');
      const ranked = rankIntents(input);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].intent).toBe(INTENT.ACCOUNTING_RECORD_EXPENSE);
    });

    it('balance query ranks ACCOUNTING_VIEW_BALANCE highest', () => {
      const input  = normalize('show balance kitna hai account');
      const ranked = rankIntents(input);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].intent).toBe(INTENT.ACCOUNTING_VIEW_BALANCE);
    });

    it('help query ranks SYSTEM_HELP highest', () => {
      const input  = normalize('help madad what can you do');
      const ranked = rankIntents(input);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].intent).toBe(INTENT.SYSTEM_HELP);
    });

    it('GST sale query ranks GST_RECORD_SALE highest', () => {
      const input  = normalize('gst sale invoice raised with tax');
      const ranked = rankIntents(input);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0].intent).toBe(INTENT.GST_RECORD_SALE);
    });

    it('each result has intent and score fields', () => {
      const input  = normalize('received ₹500');
      const ranked = rankIntents(input);
      for (const item of ranked) {
        expect(item).toHaveProperty('intent');
        expect(item).toHaveProperty('score');
        expect(typeof item.intent).toBe('string');
        expect(typeof item.score).toBe('number');
      }
    });

    it('does not include UNKNOWN or CONFIRM intents in ranking', () => {
      const input  = normalize('received ₹500 income');
      const ranked = rankIntents(input);
      const intents = ranked.map((r) => r.intent);
      expect(intents).not.toContain(INTENT.UNKNOWN);
      expect(intents).not.toContain(INTENT.CONFIRM_YES);
      expect(intents).not.toContain(INTENT.CONFIRM_NO);
    });
  });

  // ── getTopIntent ────────────────────────────────────────────────────────────
  describe('getTopIntent()', () => {
    it('returns UNKNOWN for empty input', () => {
      const result = getTopIntent(normalize(''));
      expect(result.intent).toBe(INTENT.UNKNOWN);
      expect(result.level).toBe('fallback');
      expect(result.score).toBe(0);
    });

    it('returns UNKNOWN for completely unrelated input', () => {
      const result = getTopIntent(normalize('what is the capital of France'));
      expect(result.intent).toBe(INTENT.UNKNOWN);
    });

    it('result has all required fields', () => {
      const result = getTopIntent(normalize('received ₹500'));
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('isAmbiguous');
      expect(result).toHaveProperty('ranked');
    });

    it('level is always one of valid values', () => {
      const validLevels = new Set(['direct', 'confirm', 'clarify', 'fallback']);
      const inputs = [
        'received ₹500 income',
        'paid expense',
        '',
        'show balance',
        'gst sale',
      ];
      for (const raw of inputs) {
        const result = getTopIntent(normalize(raw));
        expect(validLevels.has(result.level)).toBe(true);
      }
    });

    it('score is between 0 and 1', () => {
      const inputs = ['received ₹500', 'paid ₹1000', 'balance', ''];
      for (const raw of inputs) {
        const result = getTopIntent(normalize(raw));
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it('ranked contains top 5 or fewer results', () => {
      const result = getTopIntent(normalize('received ₹500 income'));
      expect(result.ranked.length).toBeLessThanOrEqual(5);
    });

    it('isAmbiguous is boolean', () => {
      const result = getTopIntent(normalize('received paid balance'));
      expect(typeof result.isAmbiguous).toBe('boolean');
    });

    it('high-confidence input returns direct or confirm level', () => {
      const result = getTopIntent(
        normalize('show balance kitna hai account current')
      );
      expect(['direct', 'confirm']).toContain(result.level);
    });

    it('CONFIDENCE thresholds match expected values', () => {
      expect(CONFIDENCE.DIRECT).toBeGreaterThan(CONFIDENCE.CONFIRM);
      expect(CONFIDENCE.CONFIRM).toBeGreaterThan(CONFIDENCE.MINIMUM);
      expect(CONFIDENCE.DIRECT).toBeLessThan(1);
      expect(CONFIDENCE.MINIMUM).toBeGreaterThan(0);
    });
  });

});