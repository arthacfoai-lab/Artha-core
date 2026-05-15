'use strict';

/**
 * ARTHA Entity Extractor
 *
 * Deterministic extraction of financial entities from normalized text.
 * No AI calls at Day 2 — pure regex + pattern matching.
 *
 * Extracts:
 *   - Amounts  (handled by normalizer.js — not duplicated here)
 *   - Dates    (today, yesterday, DD/MM/YYYY, DD-MM-YYYY)
 *   - Party names (vendor/customer names — heuristic extraction)
 *   - Reference numbers (invoice numbers, bill numbers)
 *   - GSTIN   (15-char pattern match)
 *   - Ledger hints (cash, bank, account type mentions)
 *
 * Day 4 (Understanding Engine) will replace heuristic party extraction
 * with AI-assisted NER (Named Entity Recognition). The output shape
 * of this module is designed to be backward-compatible with Day 4 output.
 *
 * ExtractedEntities shape:
 *   {
 *     date:         string|null  — YYYY-MM-DD
 *     party:        string|null  — vendor/customer name
 *     referenceNo:  string|null  — invoice/bill/receipt number
 *     gstin:        string|null  — GSTIN if mentioned
 *     ledgerHint:   string|null  — 'cash' | 'bank' | null
 *     confidence:   number       — 0.0–1.0 extraction confidence
 *   }
 *
 * Called by:
 *   - understanding.engine.js — enriches routing payload
 *   - accounting.engine.js (Day 3) — receives enriched payload
 *   - ocr.handler.js (Day 7) — extracts from invoice text
 */

// ── Date patterns ──────────────────────────────────────────────────────────────
const DATE_PATTERNS = [
  // DD/MM/YYYY or DD-MM-YYYY
  { re: /\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/, fn: (m) => `${m[3]}-${m[2]}-${m[1]}` },
  // DD/MM/YY or DD-MM-YY
  { re: /\b(\d{2})[\/\-](\d{2})[\/\-](\d{2})\b/, fn: (m) => `20${m[3]}-${m[2]}-${m[1]}` },
  // YYYY-MM-DD (ISO)
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, fn: (m) => `${m[1]}-${m[2]}-${m[3]}` },
];

const RELATIVE_DATES = {
  'today':       0,
  'aaj':         0,
  'yesterday':   -1,
  'kal':         -1,
  'kal ka':      -1,
  'parso':       -2,
  'day before':  -2,
};

// ── Reference number patterns ──────────────────────────────────────────────────
// Matches: INV-001, BILL-2024-001, REC/001, #001, No. 001
const REFERENCE_PATTERNS = [
  /\b(?:inv|invoice|bill|rec|receipt|ref|no\.?|#)\s*[-\/]?\s*(\w{2,20})\b/gi,
  /\b([A-Z]{2,5}[-\/]\d{2,10})\b/g,
];

// ── GSTIN pattern ──────────────────────────────────────────────────────────────
const GSTIN_RE = /\b([0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/g;

// ── Ledger hint keywords ───────────────────────────────────────────────────────
const CASH_KEYWORDS  = new Set(['cash', 'nakad', 'nakit', 'haath', 'hand']);
const BANK_KEYWORDS  = new Set(['bank', 'upi', 'neft', 'imps', 'rtgs', 'online', 'transfer', 'account']);

// ── Party extraction — stop words to exclude ───────────────────────────────────
// Common words that should not be extracted as party names
const PARTY_STOP_WORDS = new Set([
  'received', 'paid', 'payment', 'income', 'expense', 'sale', 'purchase',
  'today', 'yesterday', 'transfer', 'balance', 'cash', 'bank', 'account',
  'invoice', 'bill', 'receipt', 'gst', 'tax', 'rupees', 'paise', 'amount',
  'help', 'show', 'view', 'report', 'summary', 'aaya', 'gaya', 'diya',
  'mila', 'kharcha', 'hisab', 'ledger', 'entry', 'record',
]);

/**
 * Extract date from text.
 * Returns ISO date string YYYY-MM-DD or null.
 *
 * @param {string} text — normalized text
 * @returns {string|null}
 */
function extractDate(text) {
  if (!text) { return null; }
  const lower = text.toLowerCase();

  // Relative dates first
  for (const [keyword, offset] of Object.entries(RELATIVE_DATES)) {
    if (lower.includes(keyword)) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toISOString().split('T')[0];
    }
  }

  // Absolute date patterns
  for (const { re, fn } of DATE_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      try {
        const dateStr = fn(match);
        // Validate the date is real
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) { return dateStr; }
      } catch { /* ignore invalid dates */ }
    }
  }

  return null;
}

/**
 * Extract party name (vendor/customer) from text.
 * Heuristic — looks for capitalized proper nouns after keywords like
 * "from", "to", "by", "se", "ko".
 *
 * Day 4 Understanding Engine replaces this with AI NER.
 * This method provides a deterministic fallback.
 *
 * @param {string} text — original text (before lowercasing — needs case info)
 * @returns {string|null}
 */
function extractParty(text) {
  if (!text || typeof text !== 'string') { return null; }

  // Pattern: "from/to/by <Name>" — captures capitalized words after preposition
  const patterns = [
    /\b(?:from|to|by|se|ko|ne)\s+([A-Z][a-zA-Z\s]{1,30}?)(?:\s+(?:for|on|of|rs|₹|\d)|$)/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:paid|sent|gave|received)/g,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    const match = re.exec(text);
    if (match) {
      const candidate = match[1].trim();
      const words     = candidate.toLowerCase().split(/\s+/);
      // Check none of the words are stop words
      const isStop = words.some((w) => PARTY_STOP_WORDS.has(w));
      if (!isStop && candidate.length >= 2 && candidate.length <= 50) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Extract reference/invoice number from text.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractReferenceNo(text) {
  if (!text) { return null; }

  for (const re of REFERENCE_PATTERNS) {
    re.lastIndex = 0;
    const match = re.exec(text);
    if (match) {
      const ref = (match[1] || match[0]).trim().toUpperCase();
      if (ref.length >= 2 && ref.length <= 30) { return ref; }
    }
  }

  return null;
}

/**
 * Extract GSTIN from text.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractGSTIN(text) {
  if (!text) { return null; }
  GSTIN_RE.lastIndex = 0;
  const match = GSTIN_RE.exec(text.toUpperCase());
  return match ? match[1] : null;
}

/**
 * Extract ledger hint — which account type the user mentioned.
 * Returns 'cash' | 'bank' | null
 *
 * @param {string} text — normalized text (lowercase)
 * @returns {string|null}
 */
function extractLedgerHint(text) {
  if (!text) { return null; }
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  for (const word of words) {
    if (CASH_KEYWORDS.has(word))  { return 'cash'; }
    if (BANK_KEYWORDS.has(word))  { return 'bank'; }
  }

  return null;
}

/**
 * Extract all entities from a normalized input object.
 * Primary entry point — called by understanding.engine.js.
 *
 * @param {object} normalizedInput — from normalizer.normalize()
 * @returns {ExtractedEntities}
 */
function extractEntities(normalizedInput) {
  const { original, normalized } = normalizedInput;

  const date        = extractDate(normalized);
  const party       = extractParty(original);   // use original for case info
  const referenceNo = extractReferenceNo(original);
  const gstin       = extractGSTIN(original);
  const ledgerHint  = extractLedgerHint(normalized);

  // Confidence: more entities found = higher confidence in extraction
  const found = [date, party, referenceNo, gstin, ledgerHint].filter(Boolean).length;
  const confidence = Math.min(0.40 + found * 0.12, 0.90);

  return {
    date:        date        || null,
    party:       party       || null,
    referenceNo: referenceNo || null,
    gstin:       gstin       || null,
    ledgerHint:  ledgerHint  || null,
    confidence:  Math.round(confidence * 100) / 100,
  };
}

module.exports = {
  extractEntities,
  extractDate,
  extractParty,
  extractReferenceNo,
  extractGSTIN,
  extractLedgerHint,
  PARTY_STOP_WORDS,
};