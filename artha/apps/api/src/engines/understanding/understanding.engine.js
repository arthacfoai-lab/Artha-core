'use strict';

const { createContextLogger } = require('@artha/logger');
const { normalize }           = require('../routing/normalizer');
const { detectLanguageWithConfidence } = require('./language.detector');
const { extractEntities }     = require('./entity.extractor');

/**
 * ARTHA Understanding Engine — Day 2 Foundation
 *
 * Converts raw user input into a structured UnderstandingResult.
 * Day 2 implementation: deterministic pipeline only (no AI calls).
 * Day 4 implementation: AI-assisted NLP layer added on top.
 *
 * Day 2 pipeline:
 *   raw text
 *     → normalize() — multilingual normalization
 *     → detectLanguageWithConfidence() — language detection
 *     → extractEntities() — date, party, reference, GSTIN, ledger hint
 *     → UnderstandingResult
 *
 * Day 4 additions (do not implement yet):
 *   → AI intent pre-classification (Claude/GPT) — boosts confidence.engine scores
 *   → AI entity NER — replaces heuristic party extraction
 *   → AI narration generation — structured narration for journal entries
 *
 * UnderstandingResult shape:
 *   {
 *     normalizedInput:  object    — from normalizer.normalize()
 *     language:         string    — 'hindi' | 'hinglish' | 'english'
 *     languageConfidence: number  — 0.0–1.0
 *     entities:         object    — { date, party, referenceNo, gstin, ledgerHint }
 *     narration:        string    — generated narration for journal entry
 *     aiEnriched:       boolean   — false until Day 4
 *     processingMs:     number    — time taken
 *   }
 *
 * Called by:
 *   - routing.engine.js (Day 2) — understand() called before routing
 *     NOTE: Day 2 routing.engine calls normalizer directly.
 *     Day 4 routes through understanding.engine first.
 *   - message.routes.js (Day 4+) — full understanding pipeline
 *   - accounting.engine.js (Day 3) — receives UnderstandingResult in payload
 *
 * Integration points:
 *   - normalizer.js        — text normalization (routing package)
 *   - language.detector.js — language detection
 *   - entity.extractor.js  — entity extraction
 *   - AI provider (Day 4)  — optional AI enrichment
 */

/**
 * Process raw user input through the understanding pipeline.
 *
 * @param {object} input
 * @param {string} input.raw       — raw user message
 * @param {string} input.traceId   — for observability
 * @param {string} [input.source]  — 'whatsapp' | 'telegram' | 'api'
 * @returns {Promise<UnderstandingResult>}
 */
async function understand(input) {
  const { raw, traceId, source = 'api' } = input;
  const log = createContextLogger({ trace_id: traceId });
  const startTime = Date.now();

  log.debug('understanding_start', { source, raw_length: (raw || '').length });

  // ── Step 1: Normalize ────────────────────────────────────────────────────
  const normalizedInput = normalize(raw);

  // ── Step 2: Language detection ───────────────────────────────────────────
  const { language, confidence: languageConfidence } =
    detectLanguageWithConfidence(normalizedInput.original || raw || '');

  // ── Step 3: Entity extraction ────────────────────────────────────────────
  const entities = extractEntities(normalizedInput);

  // ── Step 4: Generate narration ───────────────────────────────────────────
  // Deterministic narration from normalized text.
  // Day 4: AI will generate richer, structured narrations.
  const narration = _generateNarration(normalizedInput, entities, language);

  const processingMs = Date.now() - startTime;

  log.debug('understanding_complete', {
    language,
    language_confidence: languageConfidence,
    entities_found:      Object.values(entities).filter(Boolean).length,
    has_amount:          !!normalizedInput.amountPaise,
    processing_ms:       processingMs,
  });

  return {
    normalizedInput,
    language,
    languageConfidence,
    entities,
    narration,
    aiEnriched:   false,    // set to true in Day 4 when AI enrichment applied
    processingMs,
  };
}

/**
 * Generate a human-readable narration string for journal entries.
 * Deterministic — built from extracted entities + normalized text.
 * Day 4 will replace with AI-generated narrations.
 *
 * @param {object} normalizedInput
 * @param {object} entities
 * @param {string} language
 * @returns {string}
 */
function _generateNarration(normalizedInput, entities, language) {
  const parts = [];

  // Use normalized text as base (already cleaned)
  const base = normalizedInput.normalized || normalizedInput.original || '';

  if (base && base.length > 0) {
    // Capitalize first letter for narration
    parts.push(base.charAt(0).toUpperCase() + base.slice(1));
  }

  if (entities.party && !base.toLowerCase().includes(entities.party.toLowerCase())) {
    parts.push(`(${entities.party})`);
  }

  if (entities.referenceNo) {
    parts.push(`Ref: ${entities.referenceNo}`);
  }

  const narration = parts.join(' ').trim();

  // Truncate to 500 chars (narration column limit)
  return narration.length > 500 ? narration.slice(0, 497) + '...' : narration;
}

/**
 * Quick understand — synchronous, no async operations.
 * Used when full understanding pipeline not needed (e.g. confirmation responses).
 *
 * @param {string} raw
 * @returns {object} { normalizedInput, language, entities }
 */
function quickUnderstand(raw) {
  const normalizedInput = normalize(raw);
  const { language }    = detectLanguageWithConfidence(raw || '');
  const entities        = extractEntities(normalizedInput);

  return { normalizedInput, language, entities };
}

module.exports = {
  understand,
  quickUnderstand,
};