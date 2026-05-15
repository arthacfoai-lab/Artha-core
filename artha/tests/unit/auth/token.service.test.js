'use strict';

/**
 * Unit tests — token.service.js
 *
 * Tests JWT issuance, verification, refresh, decode.
 * No DB, no Redis required — pure crypto.
 * JWT_SECRET set via process.env before module load.
 */

process.env.NODE_ENV       = 'test';
process.env.DATABASE_URL   = 'postgresql://artha:artha_dev@localhost:5432/artha_test';
process.env.REDIS_URL      = 'redis://localhost:6379';
process.env.JWT_SECRET     = 'test_only_secret_minimum_32_chars_xxxxxxxxxx';
process.env.WEBHOOK_SECRET = 'test_webhook_secret_min16';

const jwt = require('jsonwebtoken');
const {
  issueTokenPair,
  verifyToken,
  decodeToken,
  refreshAccessToken,
  getTokenExpiry,
} = require('../../../apps/api/src/engines/auth/token.service');

const VALID_USER = {
  id:        'user-uuid-aaaa-bbbb-cccc-dddddddddddd',
  companyId: 'comp-uuid-aaaa-bbbb-cccc-dddddddddddd',
  role:      'owner',
};

describe('token.service', () => {

  // ── issueTokenPair ──────────────────────────────────────────────────────────
  describe('issueTokenPair()', () => {
    it('returns accessToken, refreshToken, expiresIn, tokenType', () => {
      const tokens = issueTokenPair(VALID_USER);
      expect(tokens).toHaveProperty('accessToken');
      expect(tokens).toHaveProperty('refreshToken');
      expect(tokens).toHaveProperty('expiresIn');
      expect(tokens).toHaveProperty('tokenType', 'Bearer');
    });

    it('accessToken is a valid JWT string', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      expect(typeof accessToken).toBe('string');
      expect(accessToken.split('.').length).toBe(3);
    });

    it('refreshToken is a valid JWT string', () => {
      const { refreshToken } = issueTokenPair(VALID_USER);
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.split('.').length).toBe(3);
    });

    it('access token payload has correct claims', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      const payload = jwt.decode(accessToken);
      expect(payload.sub).toBe(VALID_USER.id);
      expect(payload.company_id).toBe(VALID_USER.companyId);
      expect(payload.role).toBe(VALID_USER.role);
      expect(payload.type).toBe('access');
    });

    it('refresh token payload has correct claims', () => {
      const { refreshToken } = issueTokenPair(VALID_USER);
      const payload = jwt.decode(refreshToken);
      expect(payload.sub).toBe(VALID_USER.id);
      expect(payload.company_id).toBe(VALID_USER.companyId);
      expect(payload.type).toBe('refresh');
      expect(payload.jti).toBeDefined();
    });

    it('each refresh token has unique jti', () => {
      const t1 = issueTokenPair(VALID_USER);
      const t2 = issueTokenPair(VALID_USER);
      const p1 = jwt.decode(t1.refreshToken);
      const p2 = jwt.decode(t2.refreshToken);
      expect(p1.jti).not.toBe(p2.jti);
    });

    it('throws if id is missing', () => {
      expect(() => issueTokenPair({ companyId: 'c', role: 'owner' }))
        .toThrow();
    });

    it('throws if companyId is missing', () => {
      expect(() => issueTokenPair({ id: 'u', role: 'owner' }))
        .toThrow();
    });

    it('throws if role is missing', () => {
      expect(() => issueTokenPair({ id: 'u', companyId: 'c' }))
        .toThrow();
    });
  });

  // ── verifyToken ─────────────────────────────────────────────────────────────
  describe('verifyToken()', () => {
    it('verifies valid access token', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      const payload = verifyToken(accessToken, 'access');
      expect(payload.sub).toBe(VALID_USER.id);
      expect(payload.company_id).toBe(VALID_USER.companyId);
      expect(payload.type).toBe('access');
    });

    it('verifies valid refresh token', () => {
      const { refreshToken } = issueTokenPair(VALID_USER);
      const payload = verifyToken(refreshToken, 'refresh');
      expect(payload.type).toBe('refresh');
    });

    it('throws JsonWebTokenError when access token used as refresh', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      expect(() => verifyToken(accessToken, 'refresh'))
        .toThrow(jwt.JsonWebTokenError);
    });

    it('throws JsonWebTokenError when refresh token used as access', () => {
      const { refreshToken } = issueTokenPair(VALID_USER);
      expect(() => verifyToken(refreshToken, 'access'))
        .toThrow(jwt.JsonWebTokenError);
    });

    it('throws JsonWebTokenError for tampered token', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      const tampered = accessToken.slice(0, -5) + 'XXXXX';
      expect(() => verifyToken(tampered, 'access'))
        .toThrow(jwt.JsonWebTokenError);
    });

    it('throws JsonWebTokenError for empty string', () => {
      expect(() => verifyToken('', 'access'))
        .toThrow(jwt.JsonWebTokenError);
    });

    it('throws JsonWebTokenError for null', () => {
      expect(() => verifyToken(null, 'access'))
        .toThrow(jwt.JsonWebTokenError);
    });

    it('throws JsonWebTokenError for garbage string', () => {
      expect(() => verifyToken('not.a.jwt', 'access'))
        .toThrow(jwt.JsonWebTokenError);
    });
  });

  // ── decodeToken ─────────────────────────────────────────────────────────────
  describe('decodeToken()', () => {
    it('decodes without verification', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      const payload = decodeToken(accessToken);
      expect(payload).not.toBeNull();
      expect(payload.sub).toBe(VALID_USER.id);
    });

    it('returns null for null input', () => {
      expect(decodeToken(null)).toBeNull();
    });

    it('returns null for garbage input', () => {
      expect(decodeToken('notavalidtoken')).toBeNull();
    });
  });

  // ── refreshAccessToken ──────────────────────────────────────────────────────
  describe('refreshAccessToken()', () => {
    it('returns new access token from valid refresh token', () => {
      const { refreshToken } = issueTokenPair(VALID_USER);
      const result = refreshAccessToken(refreshToken);
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('expiresIn');
      expect(result).toHaveProperty('tokenType', 'Bearer');
    });

    it('new access token has correct claims', () => {
      const { refreshToken } = issueTokenPair(VALID_USER);
      const { accessToken }  = refreshAccessToken(refreshToken);
      const payload = jwt.decode(accessToken);
      expect(payload.sub).toBe(VALID_USER.id);
      expect(payload.company_id).toBe(VALID_USER.companyId);
      expect(payload.type).toBe('access');
    });

    it('throws when access token passed instead of refresh', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      expect(() => refreshAccessToken(accessToken))
        .toThrow(jwt.JsonWebTokenError);
    });

    it('throws for invalid token', () => {
      expect(() => refreshAccessToken('invalid.token.here'))
        .toThrow();
    });
  });

  // ── getTokenExpiry ──────────────────────────────────────────────────────────
  describe('getTokenExpiry()', () => {
    it('returns expiry timestamp for valid token', () => {
      const { accessToken } = issueTokenPair(VALID_USER);
      const expiry = getTokenExpiry(accessToken);
      expect(typeof expiry).toBe('number');
      expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('returns null for null input', () => {
      expect(getTokenExpiry(null)).toBeNull();
    });

    it('returns null for garbage token', () => {
      expect(getTokenExpiry('garbage')).toBeNull();
    });
  });

});