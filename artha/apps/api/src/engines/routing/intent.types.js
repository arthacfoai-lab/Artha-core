'use strict';

/**
 * ARTHA Intent Types
 *
 * Canonical constants for every intent the routing engine can classify.
 * These are DETERMINISTIC string constants — never AI-generated at runtime.
 *
 * Naming convention: DOMAIN.ACTION
 *   Domain  → which engine handles it (accounting, gst, report, memory, system)
 *   Action  → what operation to perform
 *
 * How intents flow through the system:
 *   1. User sends message (WhatsApp/Telegram/API)
 *   2. normalizer.js  — cleans + normalizes raw text
 *   3. confidence.engine.js — scores each intent by keyword signal strength
 *   4. routing.engine.js   — selects top intent, decides dispatch path
 *   5. accounting.engine.js / gst.engine.js / etc — executes the intent
 *
 * Day 4 (Understanding Engine) will add AI-assisted parsing BEFORE step 3.
 * The AI output resolves to one of these exact intent codes.
 * AI never invents new intents — it classifies into this fixed taxonomy.
 *
 * Day 5 (OpenClaw) — message arrives via webhook, flows into normalizer.
 * Day 10 (Paperclip) — confirmation/approval intents used in workflows.
 *
 * Adding a new intent:
 *   1. Add constant here
 *   2. Add signal keywords in confidence.engine.js INTENT_SIGNALS map
 *   3. Add dispatch case in routing.engine.js
 *   4. Implement handler in the target engine
 */

// ── Accounting intents ─────────────────────────────────────────────────────────
const INTENT = Object.freeze({
  // Write intents — require validation + optional confirmation
  ACCOUNTING_RECORD_INCOME:   'accounting.record_income',
  ACCOUNTING_RECORD_EXPENSE:  'accounting.record_expense',
  ACCOUNTING_RECORD_PAYMENT:  'accounting.record_payment',
  ACCOUNTING_RECORD_RECEIPT:  'accounting.record_receipt',
  ACCOUNTING_RECORD_TRANSFER: 'accounting.record_transfer',
  ACCOUNTING_REVERSE_ENTRY:   'accounting.reverse_entry',

  // Read intents — no confirmation needed
  ACCOUNTING_VIEW_BALANCE:    'accounting.view_balance',
  ACCOUNTING_VIEW_LEDGER:     'accounting.view_ledger',
  ACCOUNTING_VIEW_SUMMARY:    'accounting.view_summary',

  // ── GST intents ─────────────────────────────────────────────────────────────
  GST_RECORD_SALE:            'gst.record_sale',
  GST_RECORD_PURCHASE:        'gst.record_purchase',
  GST_VIEW_LIABILITY:         'gst.view_liability',
  GST_VIEW_ITC:               'gst.view_itc',
  GST_FILING_STATUS:          'gst.filing_status',

  // ── Report intents ───────────────────────────────────────────────────────────
  REPORT_PROFIT_LOSS:         'report.profit_loss',
  REPORT_CASHFLOW:            'report.cashflow',
  REPORT_BALANCE_SHEET:       'report.balance_sheet',
  REPORT_TRIAL_BALANCE:       'report.trial_balance',

  // ── Memory intents ───────────────────────────────────────────────────────────
  MEMORY_ADD_VENDOR:          'memory.add_vendor',
  MEMORY_ADD_CUSTOMER:        'memory.add_customer',
  MEMORY_VIEW_VENDOR:         'memory.view_vendor',
  MEMORY_VIEW_CUSTOMER:       'memory.view_customer',

  // ── System intents ───────────────────────────────────────────────────────────
  SYSTEM_HELP:                'system.help',
  SYSTEM_STATUS:              'system.status',

  // ── Confirmation intents ─────────────────────────────────────────────────────
  // Used when session state is AWAITING_CONFIRMATION
  CONFIRM_YES:                'confirm.yes',
  CONFIRM_NO:                 'confirm.no',
  CONFIRM_MODIFY:             'confirm.modify',

  // ── Fallback ─────────────────────────────────────────────────────────────────
  UNKNOWN:                    'unknown',
});

// ── Intent domains ─────────────────────────────────────────────────────────────
const INTENT_DOMAIN = Object.freeze({
  ACCOUNTING: 'accounting',
  GST:        'gst',
  REPORT:     'report',
  MEMORY:     'memory',
  SYSTEM:     'system',
  CONFIRM:    'confirm',
  UNKNOWN:    'unknown',
});

// ── Routing outcomes ───────────────────────────────────────────────────────────
const ROUTING_OUTCOME = Object.freeze({
  DISPATCHED:             'dispatched',
  AWAITING_CONFIRMATION:  'awaiting_confirmation',
  CLARIFICATION_NEEDED:   'clarification_needed',
  FALLBACK:               'fallback',
  REJECTED:               'rejected',
});

// ── Confidence thresholds ──────────────────────────────────────────────────────
const CONFIDENCE = Object.freeze({
  DIRECT:  0.85,  // dispatch immediately without confirmation
  CONFIRM: 0.60,  // show confirmation prompt before dispatch
  MINIMUM: 0.40,  // below this: ask for clarification
  // below MINIMUM: fallback to help message
});

// ── Session routing states ─────────────────────────────────────────────────────
const SESSION_STATE = Object.freeze({
  IDLE:                    'idle',
  AWAITING_CONFIRMATION:   'awaiting_confirmation',
  AWAITING_CLARIFICATION:  'awaiting_clarification',
  AWAITING_AMOUNT:         'awaiting_amount',
  AWAITING_LEDGER:         'awaiting_ledger',
});

// ── Write intents — require financial validation ───────────────────────────────
const WRITE_INTENTS = new Set([
  INTENT.ACCOUNTING_RECORD_INCOME,
  INTENT.ACCOUNTING_RECORD_EXPENSE,
  INTENT.ACCOUNTING_RECORD_PAYMENT,
  INTENT.ACCOUNTING_RECORD_RECEIPT,
  INTENT.ACCOUNTING_RECORD_TRANSFER,
  INTENT.ACCOUNTING_REVERSE_ENTRY,
  INTENT.GST_RECORD_SALE,
  INTENT.GST_RECORD_PURCHASE,
  INTENT.MEMORY_ADD_VENDOR,
  INTENT.MEMORY_ADD_CUSTOMER,
]);

// ── Confirmation intents set ───────────────────────────────────────────────────
const CONFIRM_INTENTS = new Set([
  INTENT.CONFIRM_YES,
  INTENT.CONFIRM_NO,
  INTENT.CONFIRM_MODIFY,
]);

/**
 * Extract domain from full intent code.
 * 'accounting.record_income' → 'accounting'
 *
 * @param {string} intent
 * @returns {string}
 */
function getDomain(intent) {
  if (!intent || typeof intent !== 'string') {
    return INTENT_DOMAIN.UNKNOWN;
  }
  const dot = intent.indexOf('.');
  return dot > 0 ? intent.slice(0, dot) : INTENT_DOMAIN.UNKNOWN;
}

/**
 * Check if intent requires DB write (journal entry, memory record, etc.)
 *
 * @param {string} intent
 * @returns {boolean}
 */
function isWriteIntent(intent) {
  return WRITE_INTENTS.has(intent);
}

/**
 * Check if intent is a confirmation response.
 *
 * @param {string} intent
 * @returns {boolean}
 */
function isConfirmIntent(intent) {
  return CONFIRM_INTENTS.has(intent);
}

/**
 * Check if intent is a read-only operation.
 *
 * @param {string} intent
 * @returns {boolean}
 */
function isReadIntent(intent) {
  return !isWriteIntent(intent) && !isConfirmIntent(intent) && intent !== INTENT.UNKNOWN;
}

module.exports = {
  INTENT,
  INTENT_DOMAIN,
  ROUTING_OUTCOME,
  CONFIDENCE,
  SESSION_STATE,
  WRITE_INTENTS,
  CONFIRM_INTENTS,
  getDomain,
  isWriteIntent,
  isConfirmIntent,
  isReadIntent,
};