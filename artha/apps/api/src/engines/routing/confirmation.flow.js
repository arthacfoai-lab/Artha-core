'use strict';

const { INTENT, ROUTING_OUTCOME } = require('./intent.types');
const { resetRoutingSession }     = require('./session.context');

/**
 * ARTHA Confirmation Flow
 *
 * Builds human-readable confirmation prompts and resolves user responses.
 * Supports Hindi, Hinglish, and English output.
 *
 * IMPORTANT:
 *   This module NEVER commits financial data.
 *   It stores intent + payload in session and waits for user confirmation.
 *   The accounting engine (Day 3) writes to DB only AFTER confirmation resolves.
 *
 * Flow:
 *   1. routing.engine detects write intent at 'confirm' confidence level
 *   2. buildConfirmationPrompt() generates human-readable summary
 *   3. session.context.setPendingConfirmation() stores intent + payload
 *   4. User replies yes / no / modify
 *   5. resolveConfirmation() processes reply, returns dispatch or cancel
 *
 * Integration points:
 *   - routing.engine.js    — calls buildConfirmationPrompt + resolveConfirmation
 *   - session.context.js   — stores/retrieves pending confirmation state
 *   - accounting.engine.js (Day 3) — receives confirmed payload and commits
 *   - Paperclip (Day 10)   — high-value approval flow uses similar pattern
 */

/**
 * Format integer paise as Indian rupee string.
 * e.g. 150000 → "₹1,500.00"
 *
 * @param {number} paise
 * @returns {string}
 */
function formatRupees(paise) {
  if (!paise || !Number.isInteger(paise) || paise < 0) { return '₹0.00'; }
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Build confirmation prompt for a detected intent + payload.
 * Language-aware: generates Hindi/Hinglish for non-English input.
 *
 * @param {string} intent
 * @param {object} payload  — { amountPaise, party, narration, entryId, ... }
 * @param {string} language — 'hindi' | 'hinglish' | 'english'
 * @returns {string} confirmation message to show user
 */
function buildConfirmationPrompt(intent, payload, language = 'english') {
  const amount  = payload.amountPaise ? formatRupees(payload.amountPaise) : null;
  const party   = payload.party   || null;
  const isHindi = language === 'hindi' || language === 'hinglish';

  const amtStr  = amount || (isHindi ? 'amount unknown' : 'amount not detected');

  const templates = {
    [INTENT.ACCOUNTING_RECORD_INCOME]: {
      en: `Record income of ${amtStr}${party ? ` from ${party}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} ki income record karein${party ? ` ${party} se` : ''}?\n\nReply: haan / nahi / badlo`,
    },
    [INTENT.ACCOUNTING_RECORD_EXPENSE]: {
      en: `Record expense of ${amtStr}${party ? ` to ${party}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} ka kharcha record karein${party ? ` ${party} ko` : ''}?\n\nReply: haan / nahi / badlo`,
    },
    [INTENT.ACCOUNTING_RECORD_PAYMENT]: {
      en: `Record payment of ${amtStr}${party ? ` to ${party}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} ka payment record karein${party ? ` ${party} ko` : ''}?\n\nReply: haan / nahi / badlo`,
    },
    [INTENT.ACCOUNTING_RECORD_RECEIPT]: {
      en: `Record receipt of ${amtStr}${party ? ` from ${party}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} ki receipt record karein${party ? ` ${party} se` : ''}?\n\nReply: haan / nahi / badlo`,
    },
    [INTENT.ACCOUNTING_RECORD_TRANSFER]: {
      en: `Transfer ${amtStr}${payload.fromLedger ? ` from ${payload.fromLedger}` : ''}${payload.toLedger ? ` to ${payload.toLedger}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} transfer karein?\n\nReply: haan / nahi / badlo`,
    },
    [INTENT.ACCOUNTING_REVERSE_ENTRY]: {
      en: `Reverse this journal entry? This action cannot be undone directly.\n\nReply: yes / no`,
      hi: `Yeh journal entry reverse karein? Yeh wapas nahi hogi.\n\nReply: haan / nahi`,
    },
    [INTENT.GST_RECORD_SALE]: {
      en: `Record GST sale of ${amtStr}${party ? ` to ${party}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} ki GST sale record karein${party ? ` ${party} ko` : ''}?\n\nReply: haan / nahi / badlo`,
    },
    [INTENT.GST_RECORD_PURCHASE]: {
      en: `Record GST purchase of ${amtStr}${party ? ` from ${party}` : ''}?\n\nReply: yes / no / change`,
      hi: `${amtStr} ki GST kharid record karein${party ? ` ${party} se` : ''}?\n\nReply: haan / nahi / badlo`,
    },
  };

  const template = templates[intent];
  if (!template) {
    const action = intent.replace(/[._]/g, ' ');
    return isHindi
      ? `${action} confirm karein (${amtStr})?\n\nReply: haan / nahi`
      : `Confirm: ${action} (${amtStr})?\n\nReply: yes / no`;
  }

  return isHindi ? template.hi : template.en;
}

/**
 * Build clarification prompt when intent is ambiguous.
 *
 * @param {string} topIntent
 * @param {string|null} secondIntent
 * @param {string} language
 * @returns {string}
 */
function buildClarificationPrompt(topIntent, secondIntent, language = 'english') {
  const a = topIntent   ? topIntent.replace(/[._]/g,   ' ') : 'first option';
  const b = secondIntent ? secondIntent.replace(/[._]/g, ' ') : 'something else';
  const isHindi = language === 'hindi' || language === 'hinglish';

  if (isHindi) {
    return `Mujhe samajh nahi aaya. Kya aap yeh karna chahte hain:\n1. ${a}\n2. ${b}\n\n1 ya 2 type karein, ya dobara likhein.`;
  }
  return `I'm not sure what you meant. Did you want to:\n1. ${a}\n2. ${b}\n\nType 1 or 2, or rephrase your message.`;
}

/**
 * Build fallback / help message when routing fails.
 *
 * @param {string} language
 * @returns {string}
 */
function buildFallbackMessage(language = 'english') {
  const isHindi = language === 'hindi' || language === 'hinglish';

  if (isHindi) {
    return `Maafi chahta hoon, main samajh nahi paya.\n\nAap keh sakte hain:\n• "₹500 aaya" — income record karein\n• "₹1000 diya" — expense record karein\n• "Balance batao" — balance dekhein\n• "GST sale ₹5000" — GST sale\n• "Help" — puri list dekhein`;
  }
  return `Sorry, I didn't understand that.\n\nYou can say:\n• "Received ₹500" — record income\n• "Paid ₹1000" — record expense\n• "Show balance" — view balance\n• "GST sale ₹5000" — record GST sale\n• "Help" — full command list`;
}

/**
 * Resolve a confirmation response from the user.
 * Called by routing.engine when session is AWAITING_CONFIRMATION.
 *
 * @param {string|null} confirmation — 'yes' | 'no' | 'modify' | null
 * @param {object}      session      — current routing session
 * @param {string}      companyId
 * @param {string}      sessionId
 * @returns {Promise<object>} resolution result
 */
async function resolveConfirmation(confirmation, session, companyId, sessionId) {

  if (confirmation === 'yes') {
    const { pendingIntent, pendingPayload } = session;
    await resetRoutingSession(companyId, sessionId);
    return {
      outcome:   ROUTING_OUTCOME.DISPATCHED,
      intent:    pendingIntent,
      payload:   pendingPayload,
      confirmed: true,
    };
  }

  if (confirmation === 'no') {
    await resetRoutingSession(companyId, sessionId);
    return {
      outcome:   ROUTING_OUTCOME.REJECTED,
      intent:    session.pendingIntent,
      payload:   {},
      message:   'Cancelled. What else can I help you with?',
      confirmed: false,
    };
  }

  if (confirmation === 'modify') {
    await resetRoutingSession(companyId, sessionId);
    return {
      outcome:   ROUTING_OUTCOME.CLARIFICATION_NEEDED,
      intent:    session.pendingIntent,
      payload:   {},
      message:   'Sure, please rephrase with the correct details.',
      confirmed: false,
    };
  }

  // Not a valid confirmation response — re-show prompt
  return {
    outcome:   ROUTING_OUTCOME.AWAITING_CONFIRMATION,
    intent:    session.pendingIntent,
    payload:   session.pendingPayload || {},
    message:   session.confirmMessage || 'Please reply yes or no.',
    confirmed: false,
  };
}

module.exports = {
  buildConfirmationPrompt,
  buildClarificationPrompt,
  buildFallbackMessage,
  resolveConfirmation,
  formatRupees,
};