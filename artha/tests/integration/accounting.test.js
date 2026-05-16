'use strict';

/**
 * Integration tests — accounting routes
 *
 * Tests full HTTP stack: request → middleware → engine → response.
 * Mocks @artha/database and @artha/session — no real DB or Redis.
 *
 * Covers:
 *   POST /api/v1/accounting/journal          — post entry
 *   GET  /api/v1/accounting/journal          — list entries
 *   GET  /api/v1/accounting/journal/:id      — get single entry
 *   POST /api/v1/accounting/journal/:id/reverse — reverse entry
 *   GET  /api/v1/accounting/ledgers          — list ledgers
 *   POST /api/v1/accounting/ledgers          — create ledger
 *   GET  /api/v1/accounting/ledgers/trial-balance — trial balance
 *   GET  /api/v1/accounting/ledgers/:id/balance   — ledger balance
 *   GET  /api/v1/accounting/reconciliation/summary
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

// ── Shared test state ──────────────────────────────────────────────────────────
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID    = '22222222-2222-4222-8222-222222222222';

const CASH_ID    = '33333333-3333-4333-8333-333333333333';
const SALES_ID   = '44444444-4444-4444-8444-444444444444';
const EXPENSE_ID = '55555555-5555-4555-8555-555555555555';
// ── Mock @artha/database ───────────────────────────────────────────────────────
jest.mock('@artha/database', () => {
  const crypto = require('crypto');

  const entries    = new Map();
  const lines      = new Map();
  const ledgerBal  = new Map();

  // Pre-seed ledger balances
  ledgerBal.set(CASH_ID,    { id: CASH_ID,    balance: 0, currency: 'INR' });
  ledgerBal.set(SALES_ID,   { id: SALES_ID,   balance: 0, currency: 'INR' });
  ledgerBal.set(EXPENSE_ID, { id: EXPENSE_ID, balance: 0, currency: 'INR' });

  const LEDGERS = [
    { id: CASH_ID,    company_id: COMPANY_ID, name: 'Cash in Hand',   code: '1001', type: 'asset',   sub_type: 'cash',         is_system: true,  balance: 0, currency: 'INR', deleted_at: null },
    { id: SALES_ID,   company_id: COMPANY_ID, name: 'Sales Revenue',  code: '4001', type: 'revenue', sub_type: 'sales',        is_system: true,  balance: 0, currency: 'INR', deleted_at: null },
    { id: EXPENSE_ID, company_id: COMPANY_ID, name: 'Misc Expenses',  code: '5010', type: 'expense', sub_type: 'misc_expense', is_system: true,  balance: 0, currency: 'INR', deleted_at: null },
  ];

  return {
    healthCheck:     jest.fn(async () => ({ alive: true, db_time: new Date() })),
    closePool:       jest.fn(async () => {}),
    withTransaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
    query:           jest.fn(async () => ({ rows: [{ total_entries: 1, posted: 1, reversed: 0, draft: 0 }] })),

    companyRepository: {
      findById: jest.fn(async () => ({ id: COMPANY_ID, name: 'Test Co' })),
    },

    userRepository: {
      findById:      jest.fn(async () => ({ id: USER_ID, role: 'owner', is_active: true })),
      touchLastSeen: jest.fn(async () => {}),
    },

    ledgerRepository: {
      create: jest.fn(async ({ companyId, name, type, code, subType, isSystem }) => ({
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
      })),

      findById: jest.fn(async (_companyId, id) => {
        return LEDGERS.find((l) => l.id === id) || null;
      }),

      findSystemBySubType: jest.fn(async (_companyId, subType) => {
        return LEDGERS.find((l) => l.sub_type === subType) || null;
      }),

      findByType: jest.fn(async (_companyId, type) => {
        return LEDGERS.filter((l) => l.type === type);
      }),

      findAll: jest.fn(async () => LEDGERS),

      adjustBalance: jest.fn(async (_companyId, ledgerId, delta) => {
        const bal = ledgerBal.get(ledgerId);
        if (bal) { bal.balance += delta; }
        return { id: ledgerId, balance: bal ? bal.balance : delta };
      }),

      getBalance: jest.fn(async (_companyId, ledgerId) => {
        const bal = ledgerBal.get(ledgerId) || { id: ledgerId, balance: 0, currency: 'INR' };
        return bal;
      }),
    },

    journalRepository: {
      createWithLines: jest.fn(async (entry, entryLines) => {
        const id = crypto.randomUUID();
        const je = {
          id,
          company_id:   entry.companyId,
          entry_date:   entry.entryDate,
          narration:    entry.narration,
          reference_no: entry.referenceNo || null,
          source:       entry.source,
          created_by:   entry.createdBy,
          status:       'posted',
          created_at:   new Date().toISOString(),
        };
        entries.set(id, je);

        const createdLines = entryLines.map((line) => ({
          id:               crypto.randomUUID(),
          journal_entry_id: id,
          company_id:       entry.companyId,
          ledger_id:        line.ledgerId,
          type:             line.type,
          amount:           line.amount,
          currency:         'INR',
        }));
        lines.set(id, createdLines);

        return { entry: je, lines: createdLines };
      }),

      findByIdWithLines: jest.fn(async (companyId, entryId) => {
        const entry = entries.get(entryId);
        if (!entry || entry.company_id !== companyId) { return null; }
        return { entry, lines: lines.get(entryId) || [] };
      }),

      createReversal: jest.fn(async (_companyId, originalId) => {
        const original = entries.get(originalId);
        if (original) { original.status = 'reversed'; }
        const id     = crypto.randomUUID();
        const reversal = {
          id,
          company_id: COMPANY_ID,
          narration:  `Reversal of entry`,
          status:     'posted',
          created_at: new Date().toISOString(),
        };
        entries.set(id, reversal);
        return { entry: reversal, lines: [] };
      }),

      findByDateRange:  jest.fn(async () => [...entries.values()]),
      countByDateRange: jest.fn(async () => entries.size),

      getLedgerLines: jest.fn(async () => []),
    },

    auditRepository: {
      write:       jest.fn(async () => {}),
      writeSilent: jest.fn(async () => {}),
      findByResource: jest.fn(async () => []),
    },

    CASH_ID,
    SALES_ID,
    EXPENSE_ID,
    COMPANY_ID,

    __resetState: () => {
      entries.clear();
      lines.clear();
      ledgerBal.set(CASH_ID,    { id: CASH_ID,    balance: 0, currency: 'INR' });
      ledgerBal.set(SALES_ID,   { id: SALES_ID,   balance: 0, currency: 'INR' });
      ledgerBal.set(EXPENSE_ID, { id: EXPENSE_ID, balance: 0, currency: 'INR' });
    },
  };
});

// ── Mock @artha/session ────────────────────────────────────────────────────────
jest.mock('@artha/session', () => ({
  healthCheck:   jest.fn(async () => ({ alive: true, pong: 'PONG' })),
  closeRedis:    jest.fn(async () => {}),
  getSession:    jest.fn(async () => null),
  setSession:    jest.fn(async () => {}),
  deleteSession: jest.fn(async () => {}),
  touchSession:  jest.fn(async () => {}),
}));

const request    = require('supertest');
const jwt        = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');
const dbMock        = require('@artha/database');

const app = createApp();

// ── JWT helpers ────────────────────────────────────────────────────────────────
function makeToken(role = 'owner') {
  return jwt.sign(
    {
      sub:        USER_ID,
      company_id: COMPANY_ID,
      role,
      type:       'access',
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const OWNER_TOKEN     = makeToken('owner');
const ACCOUNTANT_TOKEN = makeToken('accountant');
const VIEWER_TOKEN    = makeToken('viewer');

const OWNER_HDR      = { Authorization: `Bearer ${OWNER_TOKEN}` };
const ACCOUNTANT_HDR = { Authorization: `Bearer ${ACCOUNTANT_TOKEN}` };
const VIEWER_HDR     = { Authorization: `Bearer ${VIEWER_TOKEN}` };

// Valid balanced journal entry body
const VALID_JOURNAL_BODY = {
  entryDate: '2025-01-15',
  narration: 'Cash received from customer',
  source:    'manual',
  lines: [
    { ledgerId: CASH_ID,  type: 'DR', amount: 50000 },
    { ledgerId: SALES_ID, type: 'CR', amount: 50000 },
  ],
};

beforeEach(() => {
  dbMock.__resetState();
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════
// JOURNAL ROUTES
// ════════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/accounting/journal', () => {

  describe('Authentication + Authorization', () => {
    it('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .send(VALID_JOURNAL_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(VIEWER_HDR)
        .send(VALID_JOURNAL_BODY);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
    });

    it('returns 201 for owner role', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(VALID_JOURNAL_BODY);
      expect(res.status).toBe(201);
    });

    it('returns 201 for accountant role', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(ACCOUNTANT_HDR)
        .send(VALID_JOURNAL_BODY);
      expect(res.status).toBe(201);
    });
  });

  describe('Request validation', () => {
    it('returns 400 for float amount', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({
          ...VALID_JOURNAL_BODY,
          lines: [
            { ledgerId: CASH_ID,  type: 'DR', amount: 500.50 },
            { ledgerId: SALES_ID, type: 'CR', amount: 500.50 },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for single line entry', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({
          ...VALID_JOURNAL_BODY,
          lines: [{ ledgerId: CASH_ID, type: 'DR', amount: 50000 }],
        });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing entryDate', async () => {
      const { entryDate: _, ...body } = VALID_JOURNAL_BODY;
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid date format', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({ ...VALID_JOURNAL_BODY, entryDate: '15-01-2025' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing narration', async () => {
      const { narration: _, ...body } = VALID_JOURNAL_BODY;
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid line type (lowercase)', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({
          ...VALID_JOURNAL_BODY,
          lines: [
            { ledgerId: CASH_ID,  type: 'dr', amount: 50000 },
            { ledgerId: SALES_ID, type: 'cr', amount: 50000 },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid ledgerId (not UUID)', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({
          ...VALID_JOURNAL_BODY,
          lines: [
            { ledgerId: 'not-a-uuid',  type: 'DR', amount: 50000 },
            { ledgerId: SALES_ID,      type: 'CR', amount: 50000 },
          ],
        });
      expect(res.status).toBe(400);
    });
  });

  describe('Successful posting', () => {
    it('returns entry + lines + balanceUpdates', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(VALID_JOURNAL_BODY);

      expect(res.status).toBe(201);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toHaveProperty('entry');
      expect(res.body.data).toHaveProperty('lines');
      expect(res.body.data).toHaveProperty('balanceUpdates');
    });

    it('entry has correct narration', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(VALID_JOURNAL_BODY);

      expect(res.body.data.entry.narration).toBe(VALID_JOURNAL_BODY.narration);
    });

    it('entry has status posted', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(VALID_JOURNAL_BODY);

      expect(res.body.data.entry.status).toBe('posted');
    });

    it('creates 2 lines', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(VALID_JOURNAL_BODY);

      expect(res.body.data.lines).toHaveLength(2);
    });

    it('response has trace_id', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send(VALID_JOURNAL_BODY);

      expect(res.body.trace_id).toBeDefined();
    });
  });

  describe('Financial validation', () => {
    it('returns 422 for unbalanced entry (DR ≠ CR)', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({
          ...VALID_JOURNAL_BODY,
          lines: [
            { ledgerId: CASH_ID,  type: 'DR', amount: 50000 },
            { ledgerId: SALES_ID, type: 'CR', amount: 40000 },
          ],
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ACCOUNTING_ERROR');
    });

    it('error details include DR and CR amounts for imbalanced entry', async () => {
      const res = await request(app)
        .post('/api/v1/accounting/journal')
        .set(OWNER_HDR)
        .send({
          ...VALID_JOURNAL_BODY,
          lines: [
            { ledgerId: CASH_ID,  type: 'DR', amount: 60000 },
            { ledgerId: SALES_ID, type: 'CR', amount: 50000 },
          ],
        });

      expect(res.body.error.message).toContain('balanced');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/accounting/journal', () => {

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/accounting/journal');
    expect(res.status).toBe(401);
  });

  it('returns 200 with list', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/journal')
      .set(OWNER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns pagination meta', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/journal')
      .set(VIEWER_HDR);  // viewers can read
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta).toHaveProperty('limit');
    expect(res.body.meta).toHaveProperty('offset');
  });

  it('accepts date range query params', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/journal?fromDate=2025-01-01&toDate=2025-12-31')
      .set(OWNER_HDR);
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid date format', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/journal?fromDate=01-01-2025')
      .set(OWNER_HDR);
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/accounting/journal/:id', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .get(`/api/v1/accounting/journal/${CASH_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 400 for non-UUID id', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/journal/not-a-uuid')
      .set(OWNER_HDR);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent entry', async () => {
    dbMock.journalRepository.findByIdWithLines.mockResolvedValueOnce(null);
    const res = await request(app)
      .get(`/api/v1/accounting/journal/${CASH_ID}`)
      .set(OWNER_HDR);
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('POST /api/v1/accounting/journal/:id/reverse', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post(`/api/v1/accounting/journal/${CASH_ID}/reverse`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    const res = await request(app)
      .post(`/api/v1/accounting/journal/${CASH_ID}/reverse`)
      .set(VIEWER_HDR)
      .send({});
    expect(res.status).toBe(403);
  });

  it('returns 400 for non-UUID id', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/journal/not-uuid/reverse')
      .set(OWNER_HDR)
      .send({});
    expect(res.status).toBe(400);
  });

  it('reverses a posted entry', async () => {
    // Post first
    const postRes = await request(app)
      .post('/api/v1/accounting/journal')
      .set(OWNER_HDR)
      .send(VALID_JOURNAL_BODY);

    const entryId = postRes.body.data.entry.id;

    // Reverse it
    const revRes = await request(app)
      .post(`/api/v1/accounting/journal/${entryId}/reverse`)
      .set(OWNER_HDR)
      .send({});

    expect(revRes.status).toBe(201);
    expect(revRes.body.data).toHaveProperty('reversalEntry');
    expect(revRes.body.data).toHaveProperty('originalEntryId');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// LEDGER ROUTES
// ════════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/accounting/ledgers', () => {

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/accounting/ledgers');
    expect(res.status).toBe(401);
  });

  it('returns 200 with ledgers array', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers')
      .set(VIEWER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('ledgers');
    expect(Array.isArray(res.body.data.ledgers)).toBe(true);
  });

  it('viewer role can read ledgers', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers')
      .set(VIEWER_HDR);
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('POST /api/v1/accounting/ledgers', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/ledgers')
      .send({ name: 'Test', type: 'asset' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/ledgers')
      .set(VIEWER_HDR)
      .send({ name: 'Test', type: 'asset' });
    expect(res.status).toBe(403);
  });

  it('creates ledger for owner', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/ledgers')
      .set(OWNER_HDR)
      .send({ name: 'Custom Expense', type: 'expense', code: '5099' });
    expect(res.status).toBe(201);
    expect(res.body.data.ledger).toHaveProperty('id');
    expect(res.body.data.ledger.name).toBe('Custom Expense');
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/ledgers')
      .set(OWNER_HDR)
      .send({ name: 'Test', type: 'invalid_type' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/ledgers')
      .set(OWNER_HDR)
      .send({ type: 'asset' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/accounting/ledgers/trial-balance', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers/trial-balance');
    expect(res.status).toBe(401);
  });

  it('returns trial balance data', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers/trial-balance')
      .set(OWNER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('ledgers');
    expect(res.body.data).toHaveProperty('totals');
    expect(res.body.data).toHaveProperty('generatedAt');
  });

  it('totals has isBalanced field', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers/trial-balance')
      .set(VIEWER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toHaveProperty('isBalanced');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/accounting/ledgers/:id/balance', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .get(`/api/v1/accounting/ledgers/${CASH_ID}/balance`);
    expect(res.status).toBe(401);
  });

  it('returns balance data', async () => {
    const res = await request(app)
      .get(`/api/v1/accounting/ledgers/${CASH_ID}/balance`)
      .set(OWNER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('balancePaise');
    expect(res.body.data).toHaveProperty('balanceRupees');
  });

  it('returns 400 for non-UUID id', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers/not-uuid/balance')
      .set(OWNER_HDR);
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// RECONCILIATION ROUTES
// ════════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/accounting/reconciliation/summary', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/reconciliation/summary');
    expect(res.status).toBe(401);
  });

  it('returns summary data', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/reconciliation/summary')
      .set(OWNER_HDR);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('period');
    expect(res.body.data).toHaveProperty('totalEntries');
    expect(res.body.data).toHaveProperty('posted');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('Response shape consistency', () => {

  it('all successful responses have ok: true', async () => {
    const endpoints = [
      { method: 'get',  path: '/api/v1/accounting/ledgers' },
      { method: 'get',  path: '/api/v1/accounting/ledgers/trial-balance' },
      { method: 'get',  path: '/api/v1/accounting/journal' },
      { method: 'get',  path: '/api/v1/accounting/reconciliation/summary' },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.path).set(OWNER_HDR);
      expect(res.body.ok).toBe(true);
    }
  });

  it('all responses have trace_id', async () => {
    const res = await request(app)
      .get('/api/v1/accounting/ledgers')
      .set(OWNER_HDR);
    expect(res.body.trace_id).toBeDefined();
  });

  it('X-Trace-Id header propagated', async () => {
    const traceId = 'accounting-test-trace-001';
    const res = await request(app)
      .get('/api/v1/accounting/ledgers')
      .set(OWNER_HDR)
      .set('X-Trace-Id', traceId);
    expect(res.headers['x-trace-id']).toBe(traceId);
    expect(res.body.trace_id).toBe(traceId);
  });

  it('error responses have ok: false and error.code', async () => {
    const res = await request(app)
      .post('/api/v1/accounting/journal')
      .set(OWNER_HDR)
      .send({
        ...VALID_JOURNAL_BODY,
        lines: [
          { ledgerId: CASH_ID,  type: 'DR', amount: 50000 },
          { ledgerId: SALES_ID, type: 'CR', amount: 40000 },
        ],
      });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
  });
});