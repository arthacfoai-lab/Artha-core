'use strict';

/**
 * Unit tests — ledger.engine.js
 * Mocks all DB repositories — no real DB needed.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

// ── Mock @artha/database ───────────────────────────────────────────────────────
jest.mock('@artha/database', () => {
  const crypto = require('crypto');

  const ledgerStore = new Map();

  return {
    withTransaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
    query:           jest.fn(),

    ledgerRepository: {
      create: jest.fn(async ({ companyId, name, code, type, subType, isSystem }) => {
        const ledger = {
          id:        crypto.randomUUID(),
          company_id: companyId,
          name,
          code:      code    || null,
          type,
          sub_type:  subType || null,
          is_system: isSystem || false,
          balance:   0,
          currency:  'INR',
          deleted_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        ledgerStore.set(`${companyId}:${subType}`, ledger);
        ledgerStore.set(`${companyId}:id:${ledger.id}`, ledger);
        return ledger;
      }),

      findById: jest.fn(async (companyId, id) => {
        return ledgerStore.get(`${companyId}:id:${id}`) || null;
      }),

      findSystemBySubType: jest.fn(async (companyId, subType) => {
        return ledgerStore.get(`${companyId}:${subType}`) || null;
      }),

      findByType: jest.fn(async (companyId, type) => {
        const results = [];
        for (const [, ledger] of ledgerStore) {
          if (ledger.company_id === companyId && ledger.type === type) {
            results.push(ledger);
          }
        }
        return results;
      }),

      findAll: jest.fn(async (companyId) => {
        const results = [];
        for (const [, ledger] of ledgerStore) {
          if (ledger.company_id === companyId && !ledger.key_is_id) {
            results.push(ledger);
          }
        }
        return results;
      }),

      adjustBalance: jest.fn(async (companyId, ledgerId, delta) => {
        const key    = `${companyId}:id:${ledgerId}`;
        const ledger = ledgerStore.get(key);
        if (!ledger) { throw new Error('Ledger not found'); }
        ledger.balance += delta;
        return { id: ledgerId, balance: ledger.balance };
      }),

      getBalance: jest.fn(async (companyId, ledgerId) => {
        const key    = `${companyId}:id:${ledgerId}`;
        const ledger = ledgerStore.get(key);
        if (!ledger) { throw new Error('Ledger not found'); }
        return { id: ledgerId, balance: ledger.balance, currency: 'INR' };
      }),
    },

    auditRepository: {
      write:       jest.fn(async () => {}),
      writeSilent: jest.fn(async () => {}),
    },

    __resetStore: () => { ledgerStore.clear(); },
  };
});

jest.mock('@artha/logger', () => ({
  createContextLogger: jest.fn(() => ({
    info:  jest.fn(),
    debug: jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  })),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ledgerEngine   = require('../../../apps/api/src/engines/accounting/ledger.engine');
const dbMock         = require('@artha/database');
const COMPANY_ID     = 'company-uuid-test-001';
const TRACE_ID       = 'trace-uuid-test-001';

beforeEach(() => {
  dbMock.__resetStore();
  jest.clearAllMocks();
});

describe('ledger.engine', () => {

  describe('seedDefaultAccounts()', () => {

    it('creates all default accounts', async () => {
      const client  = { query: jest.fn() };
      const created = await ledgerEngine.seedDefaultAccounts(COMPANY_ID, client);
      expect(created.length).toBeGreaterThan(20);
    });

    it('creates accounts with correct structure', async () => {
      const client  = { query: jest.fn() };
      const created = await ledgerEngine.seedDefaultAccounts(COMPANY_ID, client);
      for (const ledger of created) {
        expect(ledger).toHaveProperty('id');
        expect(ledger).toHaveProperty('name');
        expect(ledger).toHaveProperty('type');
        expect(ledger.company_id).toBe(COMPANY_ID);
      }
    });

    it('throws without companyId', async () => {
      await expect(ledgerEngine.seedDefaultAccounts(null, {}))
        .rejects.toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });

    it('throws without transaction client', async () => {
      await expect(ledgerEngine.seedDefaultAccounts(COMPANY_ID, null))
        .rejects.toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });
  });

  describe('resolveBySubType()', () => {

    it('resolves cash ledger after seeding', async () => {
      await ledgerEngine.seedDefaultAccounts(COMPANY_ID, { query: jest.fn() });
      const ledger = await ledgerEngine.resolveBySubType(COMPANY_ID, 'cash');
      expect(ledger).not.toBeNull();
      expect(ledger.sub_type).toBe('cash');
    });

    it('throws NotFoundError for unknown subType', async () => {
      await expect(ledgerEngine.resolveBySubType(COMPANY_ID, 'nonexistent_type'))
        .rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });
  });

  describe('adjustBalances()', () => {

    it('increases asset balance on DR', async () => {
      const client = { query: jest.fn() };
      await ledgerEngine.seedDefaultAccounts(COMPANY_ID, client);

      const cash    = await ledgerEngine.resolveBySubType(COMPANY_ID, 'cash');
      const results = await ledgerEngine.adjustBalances(
        COMPANY_ID,
        [{ ledgerId: cash.id, type: 'DR', amount: 50000 }],
        client
      );
      expect(results[0].balance).toBe(50000);
    });

    it('decreases asset balance on CR', async () => {
      const client = { query: jest.fn() };
      await ledgerEngine.seedDefaultAccounts(COMPANY_ID, client);

      const cash = await ledgerEngine.resolveBySubType(COMPANY_ID, 'cash');
      // First increase
      await ledgerEngine.adjustBalances(
        COMPANY_ID,
        [{ ledgerId: cash.id, type: 'DR', amount: 50000 }],
        client
      );
      // Then decrease
      await ledgerEngine.adjustBalances(
        COMPANY_ID,
        [{ ledgerId: cash.id, type: 'CR', amount: 20000 }],
        client
      );

      const balance = await dbMock.ledgerRepository.getBalance(COMPANY_ID, cash.id);
      expect(balance.balance).toBe(30000);
    });

    it('increases revenue balance on CR', async () => {
      const client = { query: jest.fn() };
      await ledgerEngine.seedDefaultAccounts(COMPANY_ID, client);

      const sales   = await ledgerEngine.resolveBySubType(COMPANY_ID, 'sales');
      const results = await ledgerEngine.adjustBalances(
        COMPANY_ID,
        [{ ledgerId: sales.id, type: 'CR', amount: 50000 }],
        client
      );
      expect(results[0].balance).toBe(50000);
    });

    it('throws without transaction client', async () => {
      await expect(
        ledgerEngine.adjustBalances(COMPANY_ID, [], null)
      ).rejects.toThrow(expect.objectContaining({ code: 'ACCOUNTING_ERROR' }));
    });
  });

  describe('createLedger()', () => {

    it('creates a custom ledger', async () => {
      const ledger = await ledgerEngine.createLedger(
        COMPANY_ID,
        { name: 'Custom Expense', type: 'expense', code: '5099' },
        'user-uuid-001',
        TRACE_ID
      );
      expect(ledger).toHaveProperty('id');
      expect(ledger.name).toBe('Custom Expense');
      expect(ledger.type).toBe('expense');
      expect(ledger.is_system).toBe(false);
    });

    it('throws ValidationError without name', async () => {
      await expect(
        ledgerEngine.createLedger(COMPANY_ID, { type: 'expense' }, 'user-id', TRACE_ID)
      ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    it('throws ValidationError with invalid type', async () => {
      await expect(
        ledgerEngine.createLedger(
          COMPANY_ID, { name: 'Test', type: 'invalid_type' }, 'user-id', TRACE_ID
        )
      ).rejects.toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });
  });

});