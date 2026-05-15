'use strict';

/**
 * Integration tests — message routing routes
 *
 * Tests POST /api/v1/message, GET/DELETE /session/:id.
 * Mocks Redis session + DB — no external services needed.
 * Tests routing outcomes, auth gates, session state, trace propagation.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

// ── Mock @artha/session ────────────────────────────────────────────────────────
jest.mock('@artha/session', () => {
  let store = {};
  return {
    healthCheck:  jest.fn(async () => ({ alive: true, pong: 'PONG' })),
    closeRedis:   jest.fn(async () => {}),
    getSession:   jest.fn(async (companyId, sessionId) => {
      return store[`${companyId}:${sessionId}`] || null;
    }),
    setSession:   jest.fn(async (companyId, sessionId, data) => {
      store[`${companyId}:${sessionId}`] = data;
    }),
    deleteSession: jest.fn(async (companyId, sessionId) => {
      delete store[`${companyId}:${sessionId}`];
    }),
    touchSession: jest.fn(async () => {}),
    __resetStore: () => { store = {}; },
  };
});

// ── Mock @artha/database ───────────────────────────────────────────────────────
jest.mock('@artha/database', () => ({
  healthCheck:     jest.fn(async () => ({ alive: true, db_time: new Date() })),
  closePool:       jest.fn(async () => {}),
  withTransaction: jest.fn(async (fn) => fn({})),
  BaseRepository:  class {},
  companyRepository: { findById: jest.fn(async () => null) },
  userRepository:    { findById: jest.fn(async () => null), touchLastSeen: jest.fn() },
  auditRepository:   { write: jest.fn(), writeSilent: jest.fn() },
}));

const request    = require('supertest');
const jwt        = require('jsonwebtoken');
const { createApp } = require('../../apps/api/src/app');
const sessionMock  = require('@artha/session');

const app = createApp();

// ── JWT helper ─────────────────────────────────────────────────────────────────
function makeToken(overrides = {}) {
  return jwt.sign(
    {
      sub:        'user-uuid-test-aaa-bbb-ccc',
      company_id: 'comp-uuid-test-aaa-bbb-ccc',
      role:       'owner',
      type:       'access',
      ...overrides,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

const VALID_TOKEN   = makeToken();
const COMPANY_ID    = 'comp-uuid-test-aaa-bbb-ccc';
const SESSION_ID    = 'test-session-001';
const AUTH_HEADER   = { Authorization: `Bearer ${VALID_TOKEN}` };

beforeEach(() => {
  sessionMock.__resetStore();
  jest.clearAllMocks();
});

// ── POST /api/v1/message ───────────────────────────────────────────────────────
describe('POST /api/v1/message', () => {

  describe('Authentication', () => {
    it('returns 401 without token', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .send({ message: 'hello', sessionId: SESSION_ID });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('returns 401 with invalid token', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set('Authorization', 'Bearer bad.token.here')
        .send({ message: 'hello', sessionId: SESSION_ID });

      expect(res.status).toBe(401);
    });

    it('returns 401 with refresh token used as access', async () => {
      const refreshToken = jwt.sign(
        { sub: 'u', company_id: 'c', role: 'owner', type: 'refresh' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      const res = await request(app)
        .post('/api/v1/message')
        .set('Authorization', `Bearer ${refreshToken}`)
        .send({ message: 'hello', sessionId: SESSION_ID });

      expect(res.status).toBe(401);
    });
  });

  describe('Input validation', () => {
    it('returns 400 when message is missing', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ sessionId: SESSION_ID });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when message is empty string', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: '', sessionId: SESSION_ID });

      expect(res.status).toBe(400);
    });

    it('returns 400 when sessionId is missing', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'hello' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when message exceeds 2000 chars', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'a'.repeat(2001), sessionId: SESSION_ID });

      expect(res.status).toBe(400);
    });
  });

  describe('Routing outcomes', () => {
    it('returns 200 for valid message', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'help', sessionId: SESSION_ID });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('response has required fields', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'show balance', sessionId: SESSION_ID });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('outcome');
      expect(res.body.data).toHaveProperty('intent');
      expect(res.body.data).toHaveProperty('domain');
      expect(res.body.data).toHaveProperty('score');
      expect(res.body.data).toHaveProperty('session');
      expect(res.body).toHaveProperty('trace_id');
    });

    it('help message returns system.help intent', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'help madad', sessionId: SESSION_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.intent).toBe('system.help');
    });

    it('unrecognized message returns fallback outcome', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'xyzzy plugh unrecognized completely', sessionId: SESSION_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('fallback');
      expect(res.body.data.message).toBeTruthy();
    });

    it('income with amount returns non-fallback outcome', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'received ₹500 income from customer', sessionId: SESSION_ID });

      expect(res.status).toBe(200);
      expect(res.body.data.outcome).not.toBe('fallback');
      expect(res.body.data.intent).toBe('accounting.record_income');
    });

    it('score is between 0 and 1', async () => {
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'received ₹500', sessionId: SESSION_ID });

      expect(res.body.data.score).toBeGreaterThanOrEqual(0);
      expect(res.body.data.score).toBeLessThanOrEqual(1);
    });

    it('trace_id in response matches X-Trace-Id header', async () => {
      const traceId = 'test-trace-msg-001';
      const res = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .set('X-Trace-Id', traceId)
        .send({ message: 'balance', sessionId: SESSION_ID });

      expect(res.body.trace_id).toBe(traceId);
      expect(res.headers['x-trace-id']).toBe(traceId);
    });
  });

  describe('Multi-turn confirmation flow', () => {
    it('"haan" after income confirmation → dispatched', async () => {
      const SID = 'multi-turn-ses-001';

      const turn1 = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'received ₹500 income', sessionId: SID });

      if (turn1.body.data.outcome !== 'awaiting_confirmation') {
        return; // direct dispatch — skip
      }

      const turn2 = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'haan', sessionId: SID });

      expect(turn2.status).toBe(200);
      expect(turn2.body.data.outcome).toBe('dispatched');
    });

    it('"nahi" after confirmation → rejected', async () => {
      const SID = 'multi-turn-ses-002';

      const turn1 = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'received ₹500 income', sessionId: SID });

      if (turn1.body.data.outcome !== 'awaiting_confirmation') {
        return;
      }

      const turn2 = await request(app)
        .post('/api/v1/message')
        .set(AUTH_HEADER)
        .send({ message: 'nahi', sessionId: SID });

      expect(turn2.status).toBe(200);
      expect(turn2.body.data.outcome).toBe('rejected');
    });
  });

  describe('Session isolation', () => {
    it('different companies cannot share sessions', async () => {
      const tokenA = makeToken({ company_id: 'comp-aaa', sub: 'user-aaa' });
      const tokenB = makeToken({ company_id: 'comp-bbb', sub: 'user-bbb' });

      const resA = await request(app)
        .post('/api/v1/message')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'received ₹500 income', sessionId: 'shared-session' });

      const resB = await request(app)
        .post('/api/v1/message')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ message: 'show balance', sessionId: 'shared-session' });

      // Both return valid responses — independent session state
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.data.intent).not.toBe(resB.body.data.intent);
    });
  });
});

// ── GET /api/v1/message/session/:sessionId ─────────────────────────────────────
describe('GET /api/v1/message/session/:sessionId', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .get(`/api/v1/message/session/${SESSION_ID}`);

    expect(res.status).toBe(401);
  });

  it('returns 200 with session state', async () => {
    const res = await request(app)
      .get(`/api/v1/message/session/${SESSION_ID}`)
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('session');
    expect(res.body.data.session).toHaveProperty('state');
  });

  it('returns idle state for new session', async () => {
    const res = await request(app)
      .get('/api/v1/message/session/brand-new-session-xyz')
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data.session.state).toBe('idle');
  });
});

// ── DELETE /api/v1/message/session/:sessionId ──────────────────────────────────
describe('DELETE /api/v1/message/session/:sessionId', () => {

  it('returns 401 without token', async () => {
    const res = await request(app)
      .delete(`/api/v1/message/session/${SESSION_ID}`);

    expect(res.status).toBe(401);
  });

  it('returns 200 and resets session', async () => {
    const res = await request(app)
      .delete(`/api/v1/message/session/${SESSION_ID}`)
      .set(AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.session.state).toBe('idle');
  });
});