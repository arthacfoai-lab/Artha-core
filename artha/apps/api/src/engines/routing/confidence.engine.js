'use strict';

const { INTENT, CONFIDENCE } = require('./intent.types');

/**
 * ARTHA Confidence Engine
 *
 * Scores routing decisions from 0.0 to 1.0.
 * Fully deterministic — no model calls, no randomness.
 *
 * Scoring factors:
 *   + Keyword signal count (how many intent signals matched)
 *   + Session context boost (pending intent matches → +0.15)
 *   − Amount missing penalty (write intents without amount → -0.20)
 *   − Very short input penalty (< 5 chars → -0.15)
 *   − Very long input penalty (> 300 chars → -0.05)
 *
 * Thresholds (from intent.types.js CONFIDENCE):
 *   >= 0.85 → direct dispatch (no confirmation)
 *   >= 0.60 → show confirmation prompt
 *   >= 0.40 → ask for clarification
 *   <  0.40 → fallback to help message
 *
 * Ambiguity detection:
 *   If top-2 scores within 0.15 of each other → isAmbiguous=true
 *   Ambiguous write intents always go to confirmation even if score >= DIRECT
 *
 * Called by:
 *   - routing.engine.js — getTopIntent() on every IDLE session message
 *
 * Integration points (Day 4):
 *   - understanding.engine.js will pre-classify intent using AI
 *   - AI output score will BOOST (not replace) this deterministic score
 *   - Final score = deterministic_base + ai_boost (capped at 0.97)
 */

// ── Intent signal keyword maps ─────────────────────────────────────────────────
// Each intent has an array of trigger phrases.
// More matches in a single message = higher confidence.
const INTENT_SIGNALS = Object.freeze({

  [INTENT.ACCOUNTING_RECORD_INCOME]: [
    'received', 'income', 'amdani', 'sale', 'sold', 'collected',
    'payment received', 'got paid', 'inflow', 'credited', 'receipt',
    'customer paid', 'client paid',
  ],

  [INTENT.ACCOUNTING_RECORD_EXPENSE]: [
    'paid', 'expense', 'kharcha', 'spent', 'cost', 'purchased',
    'bought', 'outflow', 'debited', 'payment made', 'bill paid',
  ],

  [INTENT.ACCOUNTING_RECORD_PAYMENT]: [
    'paid to', 'payment to', 'vendor payment', 'supplier payment',
    'transferred to', 'sent to', 'gave to', 'bheja',
  ],

  [INTENT.ACCOUNTING_RECORD_RECEIPT]: [
    'received from', 'customer paid', 'collected from',
    'client payment', 'grahak ne diya', 'receipt from',
  ],

  [INTENT.ACCOUNTING_RECORD_TRANSFER]: [
    'transfer', 'move funds', 'cash to bank', 'bank to cash',
    'account to account', 'shift money',
  ],

  [INTENT.ACCOUNTING_REVERSE_ENTRY]: [
    'reverse', 'cancel entry', 'undo entry', 'wrong entry',
    'galat entry', 'reversal', 'correction', 'mistake entry',
  ],

  [INTENT.ACCOUNTING_VIEW_BALANCE]: [
    'balance', 'kitna hai', 'how much', 'current balance',
    'account balance', 'hisab', 'bakaya', 'show balance',
    'what is balance', 'total balance',
  ],

  [INTENT.ACCOUNTING_VIEW_LEDGER]: [
    'ledger', 'transactions', 'history', 'statement',
    'activity', 'khata', 'all entries', 'show entries',
  ],

  [INTENT.ACCOUNTING_VIEW_SUMMARY]: [
    'summary', 'overview', 'today summary', 'aaj ka hisab',
    'daily summary', 'quick summary',
  ],

  [INTENT.GST_RECORD_SALE]: [
    'gst sale', 'sale with gst', 'taxable sale', 'gst invoice',
    'with gst', 'invoice raised', 'tax invoice',
  ],

  [INTENT.GST_RECORD_PURCHASE]: [
    'gst purchase', 'purchase with gst', 'taxable purchase',
    'itc', 'input tax', 'gst bill', 'with tax purchase',
  ],

  [INTENT.GST_VIEW_LIABILITY]: [
    'gst due', 'tax liability', 'gst payable', 'how much gst',
    'gst pending', 'tax due',
  ],

  [INTENT.GST_VIEW_ITC]: [
    'itc balance', 'input tax credit', 'gst credit',
    'tax credit available', 'itc available',
  ],

  [INTENT.GST_FILING_STATUS]: [
    'gst filing', 'return filed', 'gstr status', 'gst return',
    'filing status', 'gstr1', 'gstr3b',
  ],

  [INTENT.REPORT_PROFIT_LOSS]: [
    'profit loss', 'p&l', 'pnl', 'profit and loss',
    'nafa nuksan', 'income statement', 'profitability report',
  ],

  [INTENT.REPORT_CASHFLOW]: [
    'cashflow', 'cash flow', 'money flow',
    'paise ka flow', 'liquidity', 'cash position',
  ],

  [INTENT.REPORT_BALANCE_SHEET]: [
    'balance sheet', 'assets liabilities', 'net worth', 'financial position',
  ],

  [INTENT.REPORT_TRIAL_BALANCE]: [
    'trial balance', 'tb report', 'debit credit total',
  ],

  [INTENT.MEMORY_ADD_VENDOR]: [
    'add vendor', 'new vendor', 'add supplier', 'new supplier',
    'nayi vendor', 'register vendor', 'save vendor',
  ],

  [INTENT.MEMORY_ADD_CUSTOMER]: [
    'add customer', 'new customer', 'new grahak',
    'nayi customer', 'register customer', 'save customer',
  ],

  [INTENT.MEMORY_VIEW_VENDOR]: [
    'vendor list', 'show vendors', 'all vendors',
    'vendor details', 'supplier list',
  ],

  [INTENT.MEMORY_VIEW_CUSTOMER]: [
    'customer list', 'show customers', 'all customers',
    'customer details', 'grahak list',
  ],

  [INTENT.SYSTEM_HELP]: [
    'help', 'madad', 'what can you do', 'kya kar sakte',
    'commands', 'how to use', 'instructions', 'guide',
  ],

  [INTENT.SYSTEM_STATUS]: [
    'status', 'system status', 'aaj ka', 'today overview',
    'quick update', 'whats happening',
  ],
});

// ── Write intents that require amount ──────────────────────────────────────────
const AMOUNT_REQUIRED = new Set([
  INTENT.ACCOUNTING_RECORD_INCOME,
  INTENT.ACCOUNTING_RECORD_EXPENSE,
  INTENT.ACCOUNTING_RECORD_PAYMENT,
  INTENT.ACCOUNTING_RECORD_RECEIPT,
  INTENT.ACCOUNTING_RECORD_TRANSFER,
  INTENT.GST_RECORD_SALE,
  INTENT.GST_RECORD_PURCHASE,
]);

/**
 * Score a single intent against normalized input.
 *
 * @param {string} intent
 * @param {object} normalizedInput — from normalizer.normalize()
 * @param {object|null} sessionCtx — optional session context for boost
 * @returns {number} score 0.0–1.0
 */
function scoreIntent(intent, normalizedInput, sessionCtx = null) {
  const signals = INTENT_SIGNALS[intent];
  if (!signals || signals.length === 0) { return 0; }

  const text = normalizedInput.normalized || '';
  if (!text) { return 0; }

  // Count matched signals
  let matchCount = 0;
  for (const signal of signals) {
    if (text.includes(signal)) { matchCount++; }
  }

  if (matchCount === 0) { return 0; }

  // Base score: 0.50 for 1 match, +0.12 per additional match, cap 0.95
  let score = Math.min(0.50 + (matchCount - 1) * 0.12, 0.95);

  // Amount penalty — write intents without amount are less actionable
  if (AMOUNT_REQUIRED.has(intent) && !normalizedInput.amountPaise) {
    score -= 0.20;
  }

  // Input length penalties
  if (normalizedInput.length < 5)   { score -= 0.15; }
  if (normalizedInput.length > 300) { score -= 0.05; }

  // Session context boost — pending intent matches current scoring intent
  if (sessionCtx && sessionCtx.pendingIntent === intent) {
    score = Math.min(score + 0.15, 0.97);
  }

  return Math.max(0, Math.round(score * 100) / 100);
}

/**
 * Score all intents and return ranked array.
 * Excludes meta-intents (UNKNOWN, CONFIRM_*).
 *
 * @param {object} normalizedInput
 * @param {object|null} sessionCtx
 * @returns {Array<{ intent, score }>} sorted descending
 */
function rankIntents(normalizedInput, sessionCtx = null) {
  const SKIP = new Set([
    INTENT.UNKNOWN,
    INTENT.CONFIRM_YES,
    INTENT.CONFIRM_NO,
    INTENT.CONFIRM_MODIFY,
  ]);

  const scores = [];

  for (const intent of Object.values(INTENT)) {
    if (SKIP.has(intent)) { continue; }
    const score = scoreIntent(intent, normalizedInput, sessionCtx);
    if (score > 0) { scores.push({ intent, score }); }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

/**
 * Get top intent with confidence level assessment.
 *
 * @param {object} normalizedInput
 * @param {object|null} sessionCtx
 * @returns {{
 *   intent: string,
 *   score: number,
 *   level: 'direct'|'confirm'|'clarify'|'fallback',
 *   isAmbiguous: boolean,
 *   ranked: Array<{ intent, score }>
 * }}
 */
function getTopIntent(normalizedInput, sessionCtx = null) {
  const ranked = rankIntents(normalizedInput, sessionCtx);

  if (ranked.length === 0) {
    return {
      intent:      INTENT.UNKNOWN,
      score:       0,
      level:       'fallback',
      isAmbiguous: false,
      ranked:      [],
    };
  }

  const top    = ranked[0];
  const second = ranked[1];

  // Ambiguous when top-2 scores within 0.15 of each other
  const isAmbiguous = !!(second && (top.score - second.score) < 0.15);

  let level;
  if (top.score >= CONFIDENCE.DIRECT && !isAmbiguous) {
    level = 'direct';
  } else if (top.score >= CONFIDENCE.CONFIRM) {
    level = 'confirm';
  } else if (top.score >= CONFIDENCE.MINIMUM) {
    level = 'clarify';
  } else {
    level = 'fallback';
  }

  return {
    intent:      top.intent,
    score:       top.score,
    level,
    isAmbiguous,
    ranked:      ranked.slice(0, 5),
  };
}

module.exports = {
  scoreIntent,
  rankIntents,
  getTopIntent,
  INTENT_SIGNALS,
  AMOUNT_REQUIRED,
};