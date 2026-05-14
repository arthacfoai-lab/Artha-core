'use strict';

const Redis = require('ioredis');
const config = require('@artha/config');
const { logger } = require('@artha/logger');

/**
 * ARTHA Redis Session Abstraction
 *
 * All session data is stored in Redis.
 * Keys are always namespaced by company_id — cross-tenant bleed is impossible.
 *
 * Key format:
 *   artha:session:{company_id}:{session_id}
 *
 * Why namespaced:
 *   OpenClaw (Day 5) will provide session_id from WhatsApp/Telegram.
 *   Without company_id in the key, two companies could share session IDs
 *   and read each other's routing state. This is a critical safety rule.
 *
 * Session TTL:
 *   Default: config.redis.sessionTtl (3600s = 1 hour)
 *   Extended on activity via touchSession()
 *   Explicit delete via deleteSession() on logout
 *
 * Exports:
 *   getRedis()       — singleton Redis client
 *   setSession()     — write session data with TTL
 *   getSession()     — read session data (returns null if missing)
 *   deleteSession()  — delete session (logout / reset)
 *   touchSession()   — extend TTL without rewriting data
 *   healthCheck()    — verify Redis connectivity
 *   closeRedis()     — graceful shutdown
 */

let redisClient = null;

/**
 * Get or create the singleton Redis client.
 * Never create multiple clients — connection pool exhaustion risk.
 */
function getRedis() {
  if (redisClient) { return redisClient; }

  redisClient = new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      const delay = Math.min(times * 100, 3000);
      logger.warn('redis_retry', { attempt: times, delay_ms: delay });
      return delay;
    },
    lazyConnect: false,
    enableReadyCheck: true,
  });

  redisClient.on('connect', () => {
    logger.info('redis_connected', { url: config.redis.url.replace(/\/\/.*@/, '//***@') });
  });

  redisClient.on('ready', () => {
    logger.info('redis_ready');
  });

  redisClient.on('error', (err) => {
    logger.error('redis_error', { error: err.message });
  });

  redisClient.on('close', () => {
    logger.warn('redis_connection_closed');
  });

  redisClient.on('reconnecting', () => {
    logger.warn('redis_reconnecting');
  });

  return redisClient;
}

/**
 * Build the namespaced session key.
 *
 * CRITICAL: always include company_id — prevents cross-tenant session bleed.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @returns {string} e.g. 'artha:session:uuid-company:uuid-session'
 */
function sessionKey(companyId, sessionId) {
  if (!companyId || typeof companyId !== 'string') {
    throw new Error('sessionKey requires a valid companyId — tenant safety violation prevented');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionKey requires a valid sessionId');
  }
  return `artha:session:${companyId}:${sessionId}`;
}

/**
 * Write session data to Redis with TTL.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @param {object} data       — must be JSON-serializable
 * @param {number} [ttlSeconds] — defaults to config.redis.sessionTtl
 */
async function setSession(companyId, sessionId, data, ttlSeconds = null) {
  const key = sessionKey(companyId, sessionId);
  const ttl = ttlSeconds || config.redis.sessionTtl;
  const serialized = JSON.stringify({
    ...data,
    _updated_at: new Date().toISOString(),
  });
  await getRedis().setex(key, ttl, serialized);
}

/**
 * Read session data from Redis.
 * Returns null if session does not exist or has expired.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @returns {object|null}
 */
async function getSession(companyId, sessionId) {
  const key = sessionKey(companyId, sessionId);
  const raw = await getRedis().get(key);

  if (!raw) { return null; }

  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('session_parse_error', { key, error: err.message });
    return null;
  }
}

/**
 * Delete a session from Redis.
 * Called on logout, explicit reset, or session invalidation.
 *
 * @param {string} companyId
 * @param {string} sessionId
 */
async function deleteSession(companyId, sessionId) {
  const key = sessionKey(companyId, sessionId);
  await getRedis().del(key);
}

/**
 * Extend session TTL without rewriting the data.
 * Call on every user activity to keep active sessions alive.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @param {number} [ttlSeconds]
 */
async function touchSession(companyId, sessionId, ttlSeconds = null) {
  const key = sessionKey(companyId, sessionId);
  const ttl = ttlSeconds || config.redis.sessionTtl;
  await getRedis().expire(key, ttl);
}

/**
 * Verify Redis is reachable.
 * Used by /ready health endpoint.
 *
 * @returns {{ alive: boolean, pong: string }}
 */
async function healthCheck() {
  const pong = await getRedis().ping();
  return { alive: pong === 'PONG', pong };
}

/**
 * Gracefully close the Redis connection.
 * Called during process shutdown.
 */
async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('redis_closed');
  }
}

module.exports = {
  getRedis,
  setSession,
  getSession,
  deleteSession,
  touchSession,
  healthCheck,
  closeRedis,
};