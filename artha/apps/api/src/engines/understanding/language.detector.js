'use strict';

/**
 * ARTHA Language Detector
 *
 * Deterministic language detection for Hindi, Hinglish, English.
 * Lightweight — no model dependency at Day 2.
 *
 * Day 4 (Understanding Engine) will use a proper language model
 * for detection confidence. This module provides the fast
 * deterministic baseline used by the normalizer and routing engine.
 *
 * Detection strategy:
 *   1. Devanagari Unicode presence → 'hindi' (high confidence)
 *   2. Known Hinglish financial term presence → 'hinglish'
 *   3. Default → 'english'
 *
 * Exported detectLanguage() is also used by:
 *   - normalizer.js (Day 2) — language-aware text processing
 *   - confirmation.flow.js  — language-aware prompt generation
 *   - understanding.engine.js (Day 4) — feeds into NLP pipeline
 *   - OpenClaw (Day 5) — detect language before routing
 */

// Devanagari Unicode block U+0900–U+097F
const DEVANAGARI_RE = /[\u0900-\u097F]/;

// Common Hinglish financial terms (Latin script)
const HINGLISH_INDICATORS = new Set([
  'aaya', 'aayi', 'mila', 'mile', 'gaya', 'gayi', 'diya', 'diye',
  'kharcha', 'kharch', 'amdani', 'kamai', 'bikri', 'becha', 'beche',
  'nakad', 'nakit', 'khata', 'kharida', 'liya', 'bheja', 'bheje',
  'hisab', 'bakaya', 'nafa', 'nuksan', 'kitna', 'kitne', 'batao',
  'dikhao', 'grahak', 'rasid', 'raseed', 'bhugtan',
]);

// Devanagari financial terms
const HINDI_FINANCIAL_TERMS = new Set([
  'रुपये', 'रुपया', 'पैसे', 'पैसा', 'खर्च', 'आमदनी',
  'बिक्री', 'भुगतान', 'नकद', 'बैंक', 'लेखा',
]);

/**
 * Detect language of input text.
 * Returns one of: 'hindi' | 'hinglish' | 'english'
 *
 * @param {string} text — raw or normalized input
 * @returns {string} detected language
 */
function detectLanguage(text) {
  if (!text || typeof text !== 'string') { return 'english'; }

  const trimmed = text.trim();
  if (trimmed.length === 0) { return 'english'; }

  // Devanagari script → hindi
  if (DEVANAGARI_RE.test(trimmed)) { return 'hindi'; }

  // Count Hinglish indicators in lowercase
  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/);

  let hinglishCount = 0;
  for (const word of words) {
    if (HINGLISH_INDICATORS.has(word)) { hinglishCount++; }
  }

  if (hinglishCount >= 1) { return 'hinglish'; }

  return 'english';
}

/**
 * Detect language with confidence score.
 * Returns { language, confidence } — for Day 4 Understanding Engine.
 *
 * @param {string} text
 * @returns {{ language: string, confidence: number }}
 */
function detectLanguageWithConfidence(text) {
  if (!text || typeof text !== 'string') {
    return { language: 'english', confidence: 0.5 };
  }

  const trimmed = text.trim();

  if (DEVANAGARI_RE.test(trimmed)) {
    // Count Devanagari chars for confidence
    const devanagariChars = (trimmed.match(/[\u0900-\u097F]/g) || []).length;
    const confidence = Math.min(0.70 + (devanagariChars / trimmed.length) * 0.28, 0.98);
    return { language: 'hindi', confidence: Math.round(confidence * 100) / 100 };
  }

  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/);

  let hinglishCount = 0;
  for (const word of words) {
    if (HINGLISH_INDICATORS.has(word)) { hinglishCount++; }
  }

  if (hinglishCount >= 2) {
    return { language: 'hinglish', confidence: Math.min(0.65 + hinglishCount * 0.05, 0.90) };
  }
  if (hinglishCount === 1) {
    return { language: 'hinglish', confidence: 0.60 };
  }

  return { language: 'english', confidence: 0.75 };
}

/**
 * Check if text contains Devanagari script.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasDevanagari(text) {
  return typeof text === 'string' && DEVANAGARI_RE.test(text);
}

/**
 * Get appropriate reply language for a detected input language.
 * Currently 1:1 — future: user preference override.
 *
 * @param {string} detectedLanguage
 * @returns {string}
 */
function getReplyLanguage(detectedLanguage) {
  if (detectedLanguage === 'hindi')    { return 'hinglish'; }
  if (detectedLanguage === 'hinglish') { return 'hinglish'; }
  return 'english';
}

module.exports = {
  detectLanguage,
  detectLanguageWithConfidence,
  hasDevanagari,
  getReplyLanguage,
  HINGLISH_INDICATORS,
  HINDI_FINANCIAL_TERMS,
};