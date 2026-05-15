'use strict';

const { getSession, setSession, deleteSession } = require('@artha/session');
const { SESSION_STATE }                          = require('./intent.types');

/**
 * ARTHA Routing Session Context
 *
 * Manages per-user routing state across multi-turn conversations.
 * Built on the Redis session abstraction from packages/session (Day 1).
 *
 * Session key format (from packages/session):
 *   artha:session:{company_id}:{session_id}
 *
 * company_id namespacing is enforced by packages/session.
 * This module never constructs keys directly.
 *
 * Routing session shape:
 *   {
 *     sessionId:            string
 *     companyId:            string
 *     state:                SESSION_STATE.*
 *     pendingIntent:        string|null   — intent awaiting confirmation
 *     pendingPayload:       object|null   — parsed data awaiting commit
 *     confirmMessage:       string|null   — message shown to user
 *     clarificationQuestion: string|null  — clarification prompt shown
 *     turnCount:            number        — loop detection counter
 *     createdAt:            string        — ISO timestamp
 *     updatedAt:            string        — ISO timestamp
 *   }
 *
 * TTL: ROUTING_SESSION_TTL_SECONDS (10 minutes of inactivity)
 * Active sessions are touched on every message via setSession.
 *
 * Integration points:
 *   - packages/session (Day 1) — getSession, setSession, deleteSession
 *   - routing.engine.js        — reads/writes session on every message
 *   - OpenClaw (Day 5)         — session_id comes from WhatsApp/Telegram channel
 *   - Paperclip (Day 10)       — workflow_id stored in session for approval flows
 */

const ROUTING_SESSION_TTL = 600; // 10 minutes

/**
 * Get current routing session.
 * Returns default IDLE session if none exists in Redis.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @returns {Promise<object>} session data
 */
async function getRoutingSession(companyId, sessionId) {
  const data = await getSession(companyId, sessionId);
  if (!data) { return _defaultSession(sessionId, companyId); }
  return data;
}

/**
 * Persist routing session to Redis.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @param {object} sessionData
 */
async function saveRoutingSession(companyId, sessionId, sessionData) {
  await setSession(companyId, sessionId, sessionData, ROUTING_SESSION_TTL);
}

/**
 * Reset session to IDLE state.
 * Called after successful dispatch or user cancellation.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @returns {Promise<object>} fresh idle session
 */
async function resetRoutingSession(companyId, sessionId) {
  const fresh = _defaultSession(sessionId, companyId);
  await setSession(companyId, sessionId, fresh, ROUTING_SESSION_TTL);
  return fresh;
}

/**
 * Delete session entirely.
 * Called on logout or explicit session clear.
 *
 * @param {string} companyId
 * @param {string} sessionId
 */
async function clearRoutingSession(companyId, sessionId) {
  await deleteSession(companyId, sessionId);
}

/**
 * Transition session to AWAITING_CONFIRMATION.
 * Stores pending intent + payload for later commit.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @param {string} intent
 * @param {object} payload
 * @param {string} confirmMessage
 * @returns {Promise<object>} updated session
 */
async function setPendingConfirmation(companyId, sessionId, intent, payload, confirmMessage) {
  const session = await getRoutingSession(companyId, sessionId);
  const updated = {
    ...session,
    state:          SESSION_STATE.AWAITING_CONFIRMATION,
    pendingIntent:  intent,
    pendingPayload: payload,
    confirmMessage,
    turnCount:      (session.turnCount || 0) + 1,
    updatedAt:      new Date().toISOString(),
  };
  await saveRoutingSession(companyId, sessionId, updated);
  return updated;
}

/**
 * Transition session to AWAITING_CLARIFICATION.
 * Stores what was asked and partial payload so far.
 *
 * @param {string} companyId
 * @param {string} sessionId
 * @param {string} intent
 * @param {string} question
 * @param {object} partialPayload
 * @returns {Promise<object>} updated session
 */
async function setClarificationNeeded(companyId, sessionId, intent, question, partialPayload = {}) {
  const session = await getRoutingSession(companyId, sessionId);
  const updated = {
    ...session,
    state:                 SESSION_STATE.AWAITING_CLARIFICATION,
    pendingIntent:         intent,
    pendingPayload:        partialPayload,
    clarificationQuestion: question,
    turnCount:             (session.turnCount || 0) + 1,
    updatedAt:             new Date().toISOString(),
  };
  await saveRoutingSession(companyId, sessionId, updated);
  return updated;
}

/**
 * Check if session is in a blocking state (not IDLE).
 *
 * @param {object} session
 * @returns {boolean}
 */
function isBlocked(session) {
  return session.state !== SESSION_STATE.IDLE;
}

/**
 * Check if session is stuck in a loop.
 * Prevents infinite confirmation/clarification cycles.
 *
 * @param {object} session
 * @param {number} maxTurns
 * @returns {boolean}
 */
function isStuck(session, maxTurns = 5) {
  return (session.turnCount || 0) >= maxTurns &&
    session.state !== SESSION_STATE.IDLE;
}

/**
 * Create default IDLE session object.
 *
 * @param {string} sessionId
 * @param {string} companyId
 * @returns {object}
 */
function _defaultSession(sessionId, companyId) {
  return {
    sessionId,
    companyId,
    state:                 SESSION_STATE.IDLE,
    pendingIntent:         null,
    pendingPayload:        null,
    confirmMessage:        null,
    clarificationQuestion: null,
    turnCount:             0,
    createdAt:             new Date().toISOString(),
    updatedAt:             new Date().toISOString(),
  };
}

module.exports = {
  getRoutingSession,
  saveRoutingSession,
  resetRoutingSession,
  clearRoutingSession,
  setPendingConfirmation,
  setClarificationNeeded,
  isBlocked,
  isStuck,
  ROUTING_SESSION_TTL,
};