'use strict';

const crypto = require('crypto');

/**
 * ARTHA Password Service
 *
 * scrypt-based password hashing using Node.js built-in crypto.
 * Zero external dependencies — scrypt is in Node core since v10.
 *
 * Hash format stored in DB: {salt}:{hash}
 *   salt — 32 random bytes hex-encoded  (64 chars)
 *   hash — 64 bytes scrypt output hex-encoded (128 chars)
 *   total stored string length: 193 chars (fits TEXT column)
 *
 * scrypt parameters (OWASP minimum 2024):
 *   N = 16384  — CPU/memory cost factor (2^14)
 *   r = 8      — block size
 *   p = 1      — parallelization factor
 *   keylen = 64 — output length in bytes
 *
 * Security properties:
 *   - Memory-hard — resists GPU/ASIC brute-force attacks
 *   - timingSafeEqual on verify — resists timing attacks
 *   - Random salt per hash — resists rainbow table attacks
 *   - Never stores plaintext — only hash+salt stored in DB
 *
 * Called by:
 *   - auth.engine.js register() — hash new password
 *   - auth.engine.js login()    — verify submitted password
 *   - auth.engine.js changePassword() — future Day 3+ endpoint
 */

const SCRYPT_PARAMS = {
  N:      16384,
  r:      8,
  p:      1,
  keylen: 64,
};

const SALT_BYTES = 32;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Promisified scrypt wrapper.
 *
 * @param {string} password
 * @param {string} salt — hex string
 * @returns {Promise<string>} hex-encoded derived key
 */
function _scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_PARAMS.keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
      },
      (err, derivedKey) => {
        if (err) { return reject(err); }
        resolve(derivedKey.toString('hex'));
      }
    );
  });
}

/**
 * Hash a plain-text password.
 * Returns string in format: {salt}:{hash}
 * Store this entire string in users.password_hash column.
 *
 * @param {string} plaintext — user-submitted password
 * @returns {Promise<string>} stored hash string
 * @throws {Error} if plaintext is invalid
 */
async function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('hashPassword: password must be a non-empty string');
  }
  if (plaintext.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `hashPassword: password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = await _scryptAsync(plaintext, salt);
  return `${salt}:${hash}`;
}

/**
 * Verify a plain-text password against a stored hash string.
 *
 * Uses crypto.timingSafeEqual — prevents timing-based side-channel attacks.
 * Returns false on ANY failure — never throws on invalid hash format.
 *
 * @param {string} plaintext   — user-submitted password
 * @param {string} storedHash  — value from users.password_hash column
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plaintext, storedHash) {
  if (!plaintext || !storedHash) { return false; }

  const parts = storedHash.split(':');
  if (parts.length !== 2) { return false; }

  const [salt, expectedHash] = parts;
  if (!salt || !expectedHash) { return false; }

  try {
    const actualHash = await _scryptAsync(plaintext, salt);

    const actualBuf   = Buffer.from(actualHash,   'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');

    // Buffer lengths must match before timingSafeEqual
    if (actualBuf.length !== expectedBuf.length) { return false; }

    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    // Never throw — return false on any error
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
};