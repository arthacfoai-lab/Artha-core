'use strict';

const { createContextLogger } = require('@artha/logger');
const {
  INTENT,
  ROUTING_OUTCOME,
  CONFIDENCE,
  SESSION_STATE,
  getDomain,
  isWriteIntent,
} = require('./intent.types');
const { normalize }              = require('./normalizer');
const { getTopIntent }           = require('./confidence.engine');
const {
  getRoutingSession,
  resetRoutingSession,
  setPendingConfirmation,
  setClarificationNeeded,
  isStuck,
} = require('./session.context');
const {
  buildConfirmationPrompt,
  buildClarificationPrompt,
  buildFallbackMessage,
  resolveConfirmation,
} = require('./confirmation.flow');

/**
 * ARTHA Routing Engine
 *
 * Central message dispatcher. Every inbound user message passes through here.
 * Deterministic — zero AI calls at this layer.
 * AI (Understanding Engine, Day 4) pre-processes before routing.
 *
 * Responsibilities:
 *   1. Normalize raw input (multilingual → canonical)
 *   2. Load session state from Redis
 *   3. Handle blocked states (AWAITING_CONFIRMATION / CLARIFICATION)
 *   4. Score intent confidence deterministically
 *   5. Route to correct outcome: dispatch | confirm | clarify | fallback
 *   6. Emit structured RoutingResult with full observability context
 *
 * This engine does NOT:
 *   - Execute accounting logic (Day 3)
 *   - Call GST engine (Day 6)
 *   - Write to database
 *   - Call any AI model
 *
 * RoutingResult shape:
 *   {
 *     outcome:        string  — dispatched | awaiting_confirmation | ...
 *     intent:         string  — canonical intent code
 *     domain:         string  — accounting | gst | report | ...
 *     score:          number  — confidence 0.0–1.0
 *     payload:        object  — extracted data for downstream engine
 *     message:        string|null — response to show user
 *     normalizedInput: object — for Understanding Engine (Day 4)
 *     session:        object  — session state snapshot
 *     trace:          object  — observability context
 *   }
 *
 * payload shape (passed to accounting.engine on DISPATCHED):
 *   {
 *     amountPaise:  number|null
 *     language:     string
 *     narration:    string|null
 *     originalText: string
 *     intent:       string
 *     userId:       string
 *     entryDate:    string  — YYYY-MM-DD
 *     party:        null    — populated by Understanding Engine (Day 4)
 *     referenceNo:  null    — populated by Understanding Engine (Day 4)
 *   }
 *
 * Integration points:
 *   - normalizer.js         — text normalization
 *   - confidence.engine.js  — intent scoring
 *   - session.context.js    — Redis session state
 *   - confirmation.flow.js  — confirmation prompts + resolution
 *   - message.routes.js     — HTTP entry point
 *   - understanding.engine.js (Day 4) — AI pre-processing enriches payload
 *   - accounting.engine.js (Day 3)    — receives dispatched payload
 *   - OpenClaw (Day 5)               — sends raw messages to this engine
 */

/**
 * Route a user message through the ARTHA pipeline.
 *
 * @param {object} input
 * @param {string} input.raw        — raw user message text
 * @param {string} input.companyId  — tenant UUID
 * @param {string} input.userId     — authenticated user UUID
 * @param {string} input.sessionId  — session UUID (from OpenClaw / API client)
 * @param {string} input.traceId    — request trace UUID
 * @param {string} [input.source]   — 'whatsapp' | 'telegram' | 'api'
 * @returns {Promise<RoutingResult>}
 */
async function route(input) {
  const {
    raw,
    companyId,
    userId,
    sessionId,
    traceId,
    source = 'api',
  } = input;

  const log = createContextLogger({
    trace_id:   traceId,
    company_id: companyId,
    session_id: sessionId,
  });

  const startTime = Date.now();
  log.info('routing_start', { source, raw_length: (raw || '').length });

  // ── Step 1: Normalize input ──────────────────────────────────────────────
  const normalizedInput = normalize(raw);

  log.debug('routing_normalized', {
    language:     normalizedInput.language,
    amount_paise: normalizedInput.amountPaise,
    is_empty:     normalizedInput.isEmpty,
    length:       normalizedInput.length,
  });

  // ── Step 2: Load session state ───────────────────────────────────────────
  const session = await getRoutingSession(companyId, sessionId);

  log.debug('routing_session', {
    state:          session.state,
    pending_intent: session.pendingIntent,
    turn_count:     session.turnCount,
  });

  // ── Step 3: Loop / stuck detection ──────────────────────────────────────
  if (isStuck(session)) {
    log.warn('routing_session_stuck', { turn_count: session.turnCount });
    await resetRoutingSession(companyId, sessionId);
    return _buildResult({
      outcome:        ROUTING_OUTCOME.FALLBACK,
      intent:         INTENT.UNKNOWN,
      domain:         'unknown',
      score:          0,
      payload:        {},
      message:        buildFallbackMessage(normalizedInput.language),
      normalizedInput,
      session,
      traceId,
      startTime,
    });
  }

  // ── Step 4: Empty input ──────────────────────────────────────────────────
  if (normalizedInput.isEmpty) {
    return _buildResult({
      outcome:        ROUTING_OUTCOME.FALLBACK,
      intent:         INTENT.UNKNOWN,
      domain:         'unknown',
      score:          0,
      payload:        {},
      message:        buildFallbackMessage(normalizedInput.language),
      normalizedInput,
      session,
      traceId,
      startTime,
    });
  }

  // ── Step 5: Handle AWAITING_CONFIRMATION state ───────────────────────────
  if (session.state === SESSION_STATE.AWAITING_CONFIRMATION) {
    const confirmation = normalizedInput.confirmation;

    log.info('routing_confirmation_response', {
      confirmation,
      pending_intent: session.pendingIntent,
    });

    const resolution = await resolveConfirmation(
      confirmation,
      session,
      companyId,
      sessionId
    );

    const durationMs = Date.now() - startTime;
    log.info('routing_confirmation_resolved', {
      outcome:     resolution.outcome,
      duration_ms: durationMs,
    });

    return _buildResult({
      outcome:        resolution.outcome,
      intent:         resolution.intent  || INTENT.UNKNOWN,
      domain:         getDomain(resolution.intent || INTENT.UNKNOWN),
      score:          resolution.confirmed ? 1.0 : 0,
      payload:        resolution.payload  || {},
      message:        resolution.message  || null,
      normalizedInput,
      session,
      traceId,
      startTime,
    });
  }

  // ── Step 6: Handle AWAITING_CLARIFICATION state ──────────────────────────
  if (session.state === SESSION_STATE.AWAITING_CLARIFICATION) {
    const { intent, score, level, ranked } = getTopIntent(normalizedInput, session);

    if (score >= CONFIDENCE.CONFIRM) {
      // Got enough signal — reset clarification state and dispatch normally
      await resetRoutingSession(companyId, sessionId);
      return _dispatchOrConfirm({
        intent, score, level, ranked,
        normalizedInput, session, companyId,
        sessionId, userId, traceId, log, startTime,
      });
    }

    // Still ambiguous — increment turn and re-ask
    const question = buildClarificationPrompt(
      ranked[0] && ranked[0].intent,
      ranked[1] && ranked[1].intent,
      normalizedInput.language
    );

    const updatedSession = await setClarificationNeeded(
      companyId, sessionId, intent, question, {}
    );

    return _buildResult({
      outcome:        ROUTING_OUTCOME.CLARIFICATION_NEEDED,
      intent,
      domain:         getDomain(intent),
      score,
      payload:        {},
      message:        question,
      normalizedInput,
      session:        updatedSession,
      traceId,
      startTime,
    });
  }

  // ── Step 7: Fresh intent detection (IDLE session) ────────────────────────
  const { intent, score, level, ranked, isAmbiguous } =
    getTopIntent(normalizedInput, session);

  log.info('routing_intent_detected', {
    intent,
    score,
    level,
    is_ambiguous: isAmbiguous,
    top_count:    ranked.length,
  });

  return _dispatchOrConfirm({
    intent, score, level, ranked, isAmbiguous,
    normalizedInput, session, companyId,
    sessionId, userId, traceId, log, startTime,
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Decide final routing outcome based on intent + confidence level.
 * Handles: direct dispatch, confirmation prompt, clarification, fallback.
 */
async function _dispatchOrConfirm(ctx) {
  const {
    intent, score, level, ranked, isAmbiguous,
    normalizedInput, session, companyId,
    sessionId, userId, traceId, log, startTime,
  } = ctx;

  const domain  = getDomain(intent);
  const payload = _buildPayload(normalizedInput, intent, userId);

  // ── Fallback ─────────────────────────────────────────────────────────────
  if (level === 'fallback' || intent === INTENT.UNKNOWN) {
    return _buildResult({
      outcome:        ROUTING_OUTCOME.FALLBACK,
      intent:         INTENT.UNKNOWN,
      domain:         'unknown',
      score,
      payload:        {},
      message:        buildFallbackMessage(normalizedInput.language),
      normalizedInput,
      session,
      traceId,
      startTime,
    });
  }

  // ── Clarification needed ─────────────────────────────────────────────────
  if (level === 'clarify' || (isAmbiguous && level !== 'direct')) {
    const second   = ranked[1] && ranked[1].intent;
    const question = buildClarificationPrompt(intent, second, normalizedInput.language);

    const updatedSession = await setClarificationNeeded(
      companyId, sessionId, intent, question, payload
    );

    log.info('routing_clarification_needed', { intent, second });

    return _buildResult({
      outcome:        ROUTING_OUTCOME.CLARIFICATION_NEEDED,
      intent,
      domain,
      score,
      payload,
      message:        question,
      normalizedInput,
      session:        updatedSession,
      traceId,
      startTime,
    });
  }

  // ── Confirmation required (write intent at confirm level) ────────────────
  if (level === 'confirm' && isWriteIntent(intent)) {
    const confirmMessage = buildConfirmationPrompt(
      intent, payload, normalizedInput.language
    );

    const updatedSession = await setPendingConfirmation(
      companyId, sessionId, intent, payload, confirmMessage
    );

    log.info('routing_awaiting_confirmation', { intent, score });

    return _buildResult({
      outcome:        ROUTING_OUTCOME.AWAITING_CONFIRMATION,
      intent,
      domain,
      score,
      payload,
      message:        confirmMessage,
      normalizedInput,
      session:        updatedSession,
      traceId,
      startTime,
    });
  }

  // ── Direct dispatch ──────────────────────────────────────────────────────
  log.info('routing_dispatched', { intent, score, domain });

  return _buildResult({
    outcome:        ROUTING_OUTCOME.DISPATCHED,
    intent,
    domain,
    score,
    payload,
    message:        null,
    normalizedInput,
    session,
    traceId,
    startTime,
  });
}

/**
 * Build structured payload for downstream engines.
 * Day 4 Understanding Engine will enrich: party, referenceNo, ledgerHint.
 */
function _buildPayload(normalizedInput, intent, userId) {
  return {
    amountPaise:  normalizedInput.amountPaise  || null,
    language:     normalizedInput.language,
    narration:    normalizedInput.normalized   || null,
    originalText: normalizedInput.original     || null,
    intent,
    userId,
    entryDate:    new Date().toISOString().split('T')[0],
    // Day 4 Understanding Engine populates these:
    party:        null,
    referenceNo:  null,
    ledgerHint:   null,
  };
}

/**
 * Build standardized RoutingResult object.
 */
function _buildResult({
  outcome,
  intent,
  domain,
  score,
  payload,
  message,
  normalizedInput,
  session,
  traceId,
  startTime,
}) {
  return {
    outcome,
    intent,
    domain,
    score,
    payload:         payload || {},
    message:         message || null,
    normalizedInput,
    session: {
      state:     session.state,
      sessionId: session.sessionId,
      turnCount: session.turnCount,
    },
    trace: {
      traceId,
      durationMs: Date.now() - startTime,
      scoredAt:   new Date().toISOString(),
    },
  };
}

module.exports = { route };