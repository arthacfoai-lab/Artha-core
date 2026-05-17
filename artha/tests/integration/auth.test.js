'use strict';

/**
 * Integration tests — auth routes
 * UPDATED Day 3: tests ledger seeding on registration.
 *
 * Tests full HTTP: request → middleware → engine → response.
 * Mocks @artha/database and @artha/session.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

// ── Mock @artha/database ───────────────────────────────────────────────────────
jest.mock('@artha/database', () => {
  const crypto  = require('crypto');
  const companies = new Map();
  const users     = new Map();
  const ledgers   = new Map();

  return {
    healthCheck:     jest.fn(async () => ({ alive: true, db_time: new Date() })),
    closePool:       jest.fn(async () => {}),
    withTransaction: jest.fn(async (fn) => fn({ query: jest.fn() })),

    companyRepository: {
      create: jest.fn(async ({ name, gstin }) => {
        const co = {
          id:         crypto.randomUUID(),
          name,
          gstin:      gstin || null,
          is_active:  true,
          plan:       'trial',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        companies.set(co.id, co);
        return co;
      }),
      findById:    jest.fn(async (id)     => companies.get(id)     || null),
      findByGstin: jest.fn(async (gstin)  => {
        for (const co of companies.values()) {
          if (co.gstin === gstin) { return co; }
        }
        return null;
      }),
    },

    userRepository: {
      create: jest.fn(async ({ companyId, name, email, role, passwordHash }) => {
        const user = {
          id:            crypto.randomUUID(),
          company_id:    companyId,
          name,
          email,
          role:          role || 'owner',
          password_hash: passwordHash,
          is_active:     true,
          created_at:    new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        };
        users.set(`${companyId}:${email}`, user);
        return user;
      }),
      findById: jest.fn(async (companyId, id) => {
        for (const u of users.values()) {
          if (u.id === id && u.company_id === companyId) { return u; }
        }
        return null;
      }),
      findByEmail:    jest.fn(async (companyId, email) => users.get(`${companyId}:${email}`) || null),
      touchLastSeen:  jest.fn(async () => {}),
    },

    // Day 3: ledger repository mock — tracks how many ledgers were seeded
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
        };
        const key = `${companyId}:${subType}`;
        ledgers.set(key, ledger);
        return ledger;
      }),
      findSystemBySubType: jest.fn(async (companyId, subType) => {
        return ledgers.get(`${companyId}:${subType}`) || null;
      }),
      findAll:  jest.fn(async () => [...ledgers.values()]),
      findById: jest.fn(async () => null),
    },

    auditRepository: {
      write:       jest.fn(async () => {}),
      writeSilent: jest.fn(async () => {}),
    },

    __getCreatedLedgerCount: () => ledgers.size,
    __resetStore: () => {
      companies.clear();
      users.clear();
      ledgers.clear();
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

const REGISTER_BODY = {
  companyName:  'Artha Test Traders',
  ownerName:    'Ramesh Kumar',
  email:        'ramesh@arthatest.com',
  password:     'securepass123',
  businessType: 'sole_proprietor',
};

let registeredCompanyId    = null;
let registeredAccessToken  = null;
let registeredRefreshToken = null;

beforeEach(() => {
  dbMock.__resetStore();
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════
describe('POST /api/v1/auth/register', () => {

  it('returns 201 with company, user, tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('company');
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data).toHaveProperty('tokens');
    expect(res.body.trace_id).toBeDefined();

    registeredCompanyId    = res.body.data.company.id;
    registeredAccessToken  = res.body.data.tokens.accessToken;
    registeredRefreshToken = res.body.data.tokens.refreshToken;
  });

  // ── Day 3: ledger seeding verification ─────────────────────────────────────
  it('seeds chart of accounts on registration', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    // ledgerRepository.create should be called for each default account
    const createCalls = dbMock.ledgerRepository.create.mock.calls.length;
    expect(createCalls).toBeGreaterThan(20);
  });

  it('seeds accounts with correct account types', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    const calls = dbMock.ledgerRepository.create.mock.calls;
    const types = calls.map((c) => c[0].type);

    expect(types).toContain('asset');
    expect(types).toContain('liability');
    expect(types).toContain('equity');
    expect(types).toContain('revenue');
    expect(types).toContain('expense');
  });

  it('seeds cash and bank as system accounts', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    const calls = dbMock.ledgerRepository.create.mock.calls;
    const cashCall = calls.find((c) => c[0].subType === 'cash');
    const bankCall = calls.find((c) => c[0].subType === 'bank');

    expect(cashCall).toBeDefined();
    expect(cashCall[0].isSystem).toBe(true);
    expect(bankCall).toBeDefined();
    expect(bankCall[0].isSystem).toBe(true);
  });

  it('seeds GST accounts', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    const calls     = dbMock.ledgerRepository.create.mock.calls;
    const subTypes  = calls.map((c) => c[0].subType);

    expect(subTypes).toContain('gst_payable');
    expect(subTypes).toContain('cgst_payable');
    expect(subTypes).toContain('sgst_payable');
    expect(subTypes).toContain('gst_itc');
  });

  it('all ledgers scoped to new company_id', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    const companyId = res.body.data.company.id;
    const calls     = dbMock.ledgerRepository.create.mock.calls;

    for (const call of calls) {
      expect(call[0].companyId).toBe(companyId);
    }
  });

  it('withTransaction called once (atomic)', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send(REGISTER_BODY);

    expect(dbMock.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('tokens have correct shape', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...REGISTER_BODY, email: 'other@test.com' });

    const { tokens } = res.body.data;
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    expect(tokens.tokenType).toBe('Bearer');
  });

  it('user has no password_hash in response', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...REGISTER_BODY, email: 'nohash@test.com' });

    expect(res.body.data.user).not.toHaveProperty('password_hash');
  });

  it('access token has correct payload', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...REGISTER_BODY, email: 'payload@test.com' });

    const payload = jwt.decode(res.body.data.tokens.accessToken);
    expect(payload.type).toBe('access');
    expect(payload.role).toBe('owner');
    expect(payload.company_id).toBeDefined();
  });

  it('returns 400 for missing companyName', async () => {
    const { companyName: _, ...body } = REGISTER_BODY;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...REGISTER_BODY, email: 'short@test.com', password: '123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...REGISTER_BODY, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('X-Trace-Id propagated', async () => {
    const traceId = 'register-trace-test-001';
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-Trace-Id', traceId)
      .send({ ...REGISTER_BODY, email: 'trace@test.com' });

    expect(res.headers['x-trace-id']).toBe(traceId);
    expect(res.body.trace_id).toBe(traceId);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('POST /api/v1/auth/login', () => {

  it('returns 400 when companyId missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ramesh@arthatest.com', password: 'securepass123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when companyId not UUID', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ramesh@arthatest.com', password: 'pass', companyId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for user not found', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email:     'notfound@test.com',
        password:  'anypassword',
        companyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 400 for missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: 'pass', companyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('POST /api/v1/auth/refresh', () => {

  it('returns 400 when refreshToken missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid.token.here' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 when access token used as refresh token', async () => {
    const accessToken = jwt.sign(
      { sub: 'u', company_id: 'c', role: 'owner', type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: accessToken });
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
describe('GET /api/v1/auth/me', () => {

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 401 for invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('returns 401 when refresh token used as access', async () => {
    const refreshToken = jwt.sign(
      { sub: 'u', company_id: 'c', role: 'owner', type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`);
    expect(res.status).toBe(401);
  });

  it('X-Trace-Id propagated on auth error', async () => {
    const traceId = 'auth-me-trace-test-001';
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('X-Trace-Id', traceId);
    expect(res.headers['x-trace-id']).toBe(traceId);
  });
});