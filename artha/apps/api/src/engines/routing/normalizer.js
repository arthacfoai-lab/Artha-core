'use strict';

/**
 * ARTHA Multilingual Normalizer
 *
 * Deterministic preprocessing of raw user input.
 * No AI calls — pure string processing.
 *
 * Supports:
 *   Hindi (Devanagari script)
 *   Hinglish (Hindi words in Latin script)
 *   English
 *
 * Pipeline:
 *   1. Unicode NFC normalization
 *   2. Lowercase
 *   3. Collapse whitespace
 *   4. Hinglish → English canonical term substitution
 *   5. Amount extraction (₹/Rs/lakh/crore → integer paise)
 *   6. Language detection (heuristic)
 *   7. Confirmation detection (haan/yes/ok → yes | nahi/no → no)
 *
 * Output: NormalizedInput object consumed by confidence.engine.js
 *
 * Day 4 (Understanding Engine) builds ON TOP of this.
 * The Understanding Engine receives the normalized text + detected
 * language and applies AI-assisted entity extraction (party names,
 * dates, ledger hints). This normalizer runs first, always.
 *
 * Integration points:
 *   - routing.engine.js  — calls normalize() on every inbound message
 *   - understanding.engine.js (Day 4) — receives normalized output
 *   - OpenClaw (Day 5) — raw WhatsApp/Telegram text passed here
 */

// ── Hinglish → English financial term map ─────────────────────────────────────
const HINGLISH_MAP = Object.freeze({
  // Income / received
  'aaya':        'received',
  'aayi':        'received',
  'mila':        'received',
  'mile':        'received',
  'milega':      'received',
  'amdani':      'income',
  'kamai':       'income',
  'bikri':       'sale',
  'becha':       'sold',
  'beche':       'sold',
  'biki':        'sold',

  // Expense / paid
  'gaya':        'paid',
  'gayi':        'paid',
  'diya':        'paid',
  'diye':        'paid',
  'kharcha':     'expense',
  'kharch':      'expense',
  'kharchha':    'expense',
  'bhugtan':     'payment',

  // Transfer
  'bheja':       'transferred',
  'bheje':       'transferred',
  'transfer':    'transfer',

  // Cash / bank
  'nakad':       'cash',
  'nakit':       'cash',
  'haath':       'cash',
  'khata':       'account',

  // Purchase / buy
  'kharida':     'purchased',
  'kharide':     'purchased',
  'liya':        'purchased',
  'liye':        'purchased',
  'kharidari':   'purchase',

  // Invoice / receipt
  'bill':        'invoice',
  'rasid':       'receipt',
  'raseed':      'receipt',

  // Party
  'grahak':      'customer',
  'supplier':    'vendor',

  // GST
  'tax':         'tax',
  'gst':         'gst',

  // Balance / report
  'hisab':       'account summary',
  'bakaya':      'balance',
  'nafa':        'profit',
  'nuksan':      'loss',
  'kitna':       'how much',
  'kitne':       'how much',
  'batao':       'show',
  'dikhao':      'show',
});

// ── Confirmation word sets ─────────────────────────────────────────────────────
const YES_WORDS = new Set([
  'yes', 'haan', 'han', 'ha', 'ok', 'okay', 'confirm', 'correct',
  'sahi', 'theek', 'bilkul', 'zaroor', 'proceed', 'done', 'go', 'y',
  'haa', 'ji', 'ji haan',
]);

const NO_WORDS = new Set([
  'no', 'nahi', 'na', 'nope', 'cancel', 'band', 'ruk', 'stop',
  'galat', 'wrong', 'n', 'mat', 'nahin',
]);

const MODIFY_WORDS = new Set([
  'change', 'badlo', 'update', 'modify', 'edit', 'alag',
  'different', 'uss nahi', 'woh nahi', 'correction',
]);

// ── Amount patterns (ordered by specificity) ───────────────────────────────────
const AMOUNT_PATTERNS = [
  // ₹5,000 or ₹5000
  { re: /₹\s*([\d,]+(?:\.\d{1,2})?)/g,          mult: 1 },
  // Rs 5000 or rs5000
  { re: /(?:rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/gi, mult: 1 },
  // 5 lakh / 5.5 lakh / 5lac
  { re: /([\d,]+(?:\.\d{1,2})?)\s*(?:lakh|lac)\b/gi, mult: 100000 },
  // 2 crore
  { re: /([\d,]+(?:\.\d{1,2})?)\s*crore\b/gi,   mult: 10000000 },
  // 5000 rupees / 5000 rupee
  { re: /([\d,]+(?:\.\d{1,2})?)\s*rupees?\b/gi, mult: 1 },
  // 500/- pattern
  { re: /([\d,]+)\s*\/-/g,                        mult: 1 },
  // 500 rs (trailing)
  { re: /([\d,]+(?:\.\d{1,2})?)\s*rs\b/gi,       mult: 1 },
];

/**
 * Extract first monetary amount from text as integer paise.
 * Returns null if no amount found.
 * Returns INTEGER — never float.
 *
 * @param {string} text
 * @returns {number|null} paise
 */
function extractAmountPaise(text) {
  if (!text || typeof text !== 'string') { return null; }

  for (const { re, mult } of AMOUNT_PATTERNS) {
    re.lastIndex = 0;
    const match = re.exec(text);
    if (match) {
      const numStr = match[1].replace(/,/g, '');
      const rupees = parseFloat(numStr) * mult;
      if (!isNaN(rupees) && rupees > 0) {
        // Convert to paise — round to avoid float drift
        return Math.round(rupees * 100);
      }
    }
  }

  return null;
}

/**
 * Detect language of raw input — deterministic heuristic.
 * Returns: 'hindi' | 'hinglish' | 'english'
 *
 * Day 4 Understanding Engine will use a proper language model.
 * This heuristic is fast and good enough for routing decisions.
 *
 * @param {string} raw
 * @returns {string}
 */
function detectLanguage(raw) {
  if (!raw || typeof raw !== 'string') { return 'english'; }

  // Devanagari Unicode block U+0900–U+097F
  if (/[\u0900-\u097F]/.test(raw)) { return 'hindi'; }

  // Count Hinglish term matches
  const lower = raw.toLowerCase();
  let hinglishCount = 0;
  for (const term of Object.keys(HINGLISH_MAP)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(lower)) {
      hinglishCount++;
    }
  }

  return hinglishCount >= 1 ? 'hinglish' : 'english';
}

/**
 * Detect if input is a confirmation response.
 * Returns 'yes' | 'no' | 'modify' | null
 *
 * @param {string} raw
 * @returns {string|null}
 */
function detectConfirmation(raw) {
  if (!raw || typeof raw !== 'string') { return null; }
  const norm = raw.normalize('NFC').toLowerCase().trim();

  if (YES_WORDS.has(norm))    { return 'yes'; }
  if (NO_WORDS.has(norm))     { return 'no'; }
  if (MODIFY_WORDS.has(norm)) { return 'modify'; }

  // Multi-word partial match
  for (const w of YES_WORDS)    { if (norm.includes(w) && norm.length < 20) { return 'yes'; } }
  for (const w of NO_WORDS)     { if (norm.includes(w) && norm.length < 20) { return 'no'; } }
  for (const w of MODIFY_WORDS) { if (norm.includes(w) && norm.length < 20) { return 'modify'; } }

  return null;
}

/**
 * Normalize raw text — Hinglish terms → English canonical.
 * Does NOT remove amounts — extractAmountPaise handles those.
 *
 * @param {string} raw
 * @returns {string} normalized text
 */
function normalizeText(raw) {
  if (!raw || typeof raw !== 'string') { return ''; }

  let text = raw.normalize('NFC').toLowerCase().trim();

  // Collapse multiple whitespace
  text = text.replace(/\s+/g, ' ');

  // Replace Hinglish → English (word boundary replacement)
  for (const [hinglish, english] of Object.entries(HINGLISH_MAP)) {
    const escaped = hinglish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\b${escaped}\\b`, 'g'), english);
  }

  return text.trim();
}

/**
 * Full normalization pipeline.
 * Returns a structured NormalizedInput object.
 *
 * @param {string} raw — raw user input
 * @returns {NormalizedInput}
 *
 * NormalizedInput shape:
 *   {
 *     original:     string   — unchanged raw input
 *     normalized:   string   — lowercased, Hinglish → English
 *     amountPaise:  number|null  — first detected amount in paise
 *     language:     string   — 'hindi' | 'hinglish' | 'english'
 *     confirmation: string|null  — 'yes' | 'no' | 'modify' | null
 *     length:       number   — trimmed character count
 *     isEmpty:      boolean
 *   }
 */
function normalize(raw) {
  const text = typeof raw === 'string' ? raw : '';

  const normalized   = normalizeText(text);
  const amountPaise  = extractAmountPaise(text);
  const language     = detectLanguage(text);
  const confirmation = detectConfirmation(text);
  const trimmed      = text.trim();

  return {
    original:     text,
    normalized,
    amountPaise,
    language,
    confirmation,
    length:       trimmed.length,
    isEmpty:      trimmed.length === 0,
  };
}

module.exports = {
  normalize,
  normalizeText,
  extractAmountPaise,
  detectLanguage,
  detectConfirmation,
  HINGLISH_MAP,
  YES_WORDS,
  NO_WORDS,
  MODIFY_WORDS,
};