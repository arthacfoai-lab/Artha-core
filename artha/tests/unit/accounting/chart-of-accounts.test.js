'use strict';

/**
 * Unit tests — chart-of-accounts.js
 * Pure data tests. No DB, no Redis.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

const {
  getDefaultAccounts,
  getSystemAccounts,
  findBySubType,
  findByCode,
  getSubTypesByType,
  DEFAULT_ACCOUNTS,
} = require('../../../apps/api/src/engines/accounting/chart-of-accounts');

describe('chart-of-accounts', () => {

  describe('getDefaultAccounts()', () => {

    it('returns an array', () => {
      expect(Array.isArray(getDefaultAccounts())).toBe(true);
    });

    it('returns more than 20 accounts', () => {
      expect(getDefaultAccounts().length).toBeGreaterThan(20);
    });

    it('returns a new array each call — no mutation risk', () => {
      const a = getDefaultAccounts();
      const b = getDefaultAccounts();
      expect(a).not.toBe(b);
    });

    it('all accounts have required fields', () => {
      const accounts = getDefaultAccounts();
      for (const account of accounts) {
        expect(account).toHaveProperty('code');
        expect(account).toHaveProperty('name');
        expect(account).toHaveProperty('type');
        expect(account).toHaveProperty('subType');
        expect(account).toHaveProperty('isSystem');
        expect(account).toHaveProperty('description');
      }
    });

    it('all account types are valid', () => {
      const validTypes = new Set(['asset', 'liability', 'equity', 'revenue', 'expense']);
      const accounts   = getDefaultAccounts();
      for (const account of accounts) {
        expect(validTypes.has(account.type)).toBe(true);
      }
    });

    it('all codes are unique', () => {
      const accounts = getDefaultAccounts();
      const codes    = accounts.map((a) => a.code);
      const unique   = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });

    it('all subTypes are unique', () => {
      const accounts  = getDefaultAccounts();
      const subTypes  = accounts.map((a) => a.subType);
      const unique    = new Set(subTypes);
      expect(unique.size).toBe(subTypes.length);
    });

    it('contains accounts of all 5 types', () => {
      const accounts = getDefaultAccounts();
      const types    = new Set(accounts.map((a) => a.type));
      expect(types.has('asset')).toBe(true);
      expect(types.has('liability')).toBe(true);
      expect(types.has('equity')).toBe(true);
      expect(types.has('revenue')).toBe(true);
      expect(types.has('expense')).toBe(true);
    });

    it('codes follow numeric scheme', () => {
      const accounts = getDefaultAccounts();
      for (const account of accounts) {
        expect(/^\d{4}$/.test(account.code)).toBe(true);
      }
    });
  });

  describe('getSystemAccounts()', () => {

    it('returns only system accounts', () => {
      const accounts = getSystemAccounts();
      expect(accounts.every((a) => a.isSystem === true)).toBe(true);
    });

    it('returns fewer accounts than getDefaultAccounts', () => {
      expect(getSystemAccounts().length).toBeLessThan(getDefaultAccounts().length);
    });

    it('contains critical system accounts', () => {
      const subTypes = new Set(getSystemAccounts().map((a) => a.subType));
      expect(subTypes.has('cash')).toBe(true);
      expect(subTypes.has('bank')).toBe(true);
      expect(subTypes.has('sales')).toBe(true);
      expect(subTypes.has('trade_payable')).toBe(true);
      expect(subTypes.has('trade_receivable')).toBe(true);
      expect(subTypes.has('gst_payable')).toBe(true);
      expect(subTypes.has('capital')).toBe(true);
    });
  });

  describe('findBySubType()', () => {

    it('finds cash account', () => {
      const account = findBySubType('cash');
      expect(account).not.toBeNull();
      expect(account.code).toBe('1001');
      expect(account.type).toBe('asset');
    });

    it('finds bank account', () => {
      const account = findBySubType('bank');
      expect(account).not.toBeNull();
      expect(account.code).toBe('1002');
    });

    it('finds sales account', () => {
      const account = findBySubType('sales');
      expect(account).not.toBeNull();
      expect(account.type).toBe('revenue');
    });

    it('finds purchases account', () => {
      const account = findBySubType('purchases');
      expect(account).not.toBeNull();
      expect(account.type).toBe('expense');
    });

    it('finds trade_payable account', () => {
      const account = findBySubType('trade_payable');
      expect(account).not.toBeNull();
      expect(account.type).toBe('liability');
    });

    it('finds gst_payable account', () => {
      const account = findBySubType('gst_payable');
      expect(account).not.toBeNull();
      expect(account.type).toBe('liability');
    });

    it('finds capital account', () => {
      const account = findBySubType('capital');
      expect(account).not.toBeNull();
      expect(account.type).toBe('equity');
    });

    it('returns null for unknown subType', () => {
      expect(findBySubType('unknown_type')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(findBySubType(null)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(findBySubType('')).toBeNull();
    });
  });

  describe('findByCode()', () => {

    it('finds account by code 1001 (cash)', () => {
      const account = findByCode('1001');
      expect(account).not.toBeNull();
      expect(account.subType).toBe('cash');
    });

    it('finds account by code 4001 (sales)', () => {
      const account = findByCode('4001');
      expect(account).not.toBeNull();
      expect(account.subType).toBe('sales');
    });

    it('returns null for unknown code', () => {
      expect(findByCode('9999')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(findByCode(null)).toBeNull();
    });
  });

  describe('getSubTypesByType()', () => {

    it('returns array of subTypes for asset', () => {
      const subTypes = getSubTypesByType('asset');
      expect(Array.isArray(subTypes)).toBe(true);
      expect(subTypes.length).toBeGreaterThan(0);
      expect(subTypes).toContain('cash');
      expect(subTypes).toContain('bank');
    });

    it('returns array for expense type', () => {
      const subTypes = getSubTypesByType('expense');
      expect(subTypes).toContain('cogs');
      expect(subTypes).toContain('purchases');
      expect(subTypes).toContain('salary');
    });

    it('returns empty array for unknown type', () => {
      expect(getSubTypesByType('unknown')).toHaveLength(0);
    });
  });

  describe('Code scheme validation', () => {

    it('asset codes start with 1', () => {
      const assets = getDefaultAccounts().filter((a) => a.type === 'asset');
      expect(assets.every((a) => a.code.startsWith('1'))).toBe(true);
    });

    it('liability codes start with 2', () => {
      const liabilities = getDefaultAccounts().filter((a) => a.type === 'liability');
      expect(liabilities.every((a) => a.code.startsWith('2'))).toBe(true);
    });

    it('equity codes start with 3', () => {
      const equity = getDefaultAccounts().filter((a) => a.type === 'equity');
      expect(equity.every((a) => a.code.startsWith('3'))).toBe(true);
    });

    it('revenue codes start with 4', () => {
      const revenue = getDefaultAccounts().filter((a) => a.type === 'revenue');
      expect(revenue.every((a) => a.code.startsWith('4'))).toBe(true);
    });

    it('expense codes start with 5', () => {
      const expense = getDefaultAccounts().filter((a) => a.type === 'expense');
      expect(expense.every((a) => a.code.startsWith('5'))).toBe(true);
    });
  });

});