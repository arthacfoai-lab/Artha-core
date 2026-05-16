'use strict';

const { createContextLogger } = require('@artha/logger');
const { INTENT }              = require('../routing/intent.types');
const journalEngine           = require('./journal.engine');
const ledgerEngine            = require('./ledger.engine');
const reconciliationEngine    = require('./reconciliation.engine');
const { formatPaise }         = require('./balance.engine');
const {
  AccountingError,
  ValidationError,
  NotFoundError,
} = require('@artha/errors');

/**
 * ARTHA Accounting Engine — Main Orchestrator
 *
 * Top-level engine that handles all accounting operations.
 * Called by:
 *   - accounting.routes.js (HTTP handlers)
 *   - message.routes.js (after routing engine dispatches accounting intent)
 *
 * Dispatches intents received from routing.engine (Day 2) to the
 * correct sub-engine (journal, ledger, reconciliation).
 *
 * Intent dispatch map:
 *   accounting.record_income   → recordIncome()
 *   accounting.record_expense  → recordExpense()
 *   accounting.record_payment  → recordPayment()
 *   accounting.record_receipt  → recordReceipt()
 *   accounting.record_transfer → recordTransfer()
 *   accounting.reverse_entry   → reverseEntry()
 *   accounting.view_balance    → viewBalance()
 *   accounting.view_ledger     → viewLedger()
 *
 * FINANCIAL CORRECTNESS RULES:
 *   - All amounts in BIGINT paise
 *   - All writes inside transactions (journal.engine handles this)
 *   - All entries validated for DR=CR before DB write
 *   - All ledger IDs resolved from sub_type — never hardcoded
 *   - Ledger sub_type resolution: 'cash' | 'bank' | 'sales' | 'purchases' etc.
 *
 * Default ledger mappings for quick-entry intents:
 *   record_income:   DR cash (1001) / CR sales (4001)
 *   record_expense:  DR misc_expense (5010) / CR cash (1001)
 *   record_payment:  DR trade_payable (2001) / CR cash (1001)
 *   record_receipt:  DR cash (1001) / CR trade_receivable (1003)
 *   record_transfer: DR bank (1002) / CR cash (1001)
 *
 * User can override ledger mappings by providing ledgerHint in payload.
 *   ledgerHint: 'bank' → uses bank instead of cash
 *
 * Integration points (existing):
 *   - journal.engine (Day 3)        — postEntry, reverseEntry, getEntry, listEntries
 *   - ledger.engine (Day 3)         — resolveBySubType, getBalance, listLedgers
 *   - reconciliation.engine (Day 3) — getLedgerStatement, verifyBalance
 *   - INTENT constants (Day 2)      — intent codes from routing.engine
 *
 * Integration points (future):
 *   - gst.engine (Day 6)     — GST intents add GST lines to journal entries
 *   - memory.engine (Day 8)  — vendor/customer names in narration
 *   - intelligence (Day 9)   — reads journal entries for P&L
 */

/**
 * Dispatch a routing intent to the correct accounting operation.
 * Called by message.routes.js after routing engine returns DISPATCHED.
 *
 * @param {string} intent    — canonical intent code from INTENT
 * @param {object} payload   — routing payload { amountPaise, narration, userId, entryDate, ledgerHint, party }
 * @param {string} companyId
 * @param {string} traceId
 * @returns {Promise<AccountingResult>}
 */
async function dispatch(intent, payload, companyId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.info('accounting_dispatch', { intent, amount_paise: payload.amountPaise });

  switch (intent) {
    case INTENT.ACCOUNTING_RECORD_INCOME:
      return recordIncome(payload, companyId, traceId);

    case INTENT.ACCOUNTING_RECORD_EXPENSE:
      return recordExpense(payload, companyId, traceId);

    case INTENT.ACCOUNTING_RECORD_PAYMENT:
      return recordPayment(payload, companyId, traceId);

    case INTENT.ACCOUNTING_RECORD_RECEIPT:
      return recordReceipt(payload, companyId, traceId);

    case INTENT.ACCOUNTING_RECORD_TRANSFER:
      return recordTransfer(payload, companyId, traceId);

    case INTENT.ACCOUNTING_REVERSE_ENTRY:
      return reverseEntry(payload, companyId, traceId);

    case INTENT.ACCOUNTING_VIEW_BALANCE:
      return viewBalance(payload, companyId, traceId);

    case INTENT.ACCOUNTING_VIEW_LEDGER:
      return viewLedger(payload, companyId, traceId);

    case INTENT.ACCOUNTING_VIEW_SUMMARY:
      return viewSummary(companyId, traceId);

    default:
      throw new AccountingError(
        `accounting.engine cannot handle intent '${intent}'`,
        { intent }
      );
  }
}

/**
 * Record income received.
 * Default: DR Cash / CR Sales Revenue
 * ledgerHint 'bank' → DR Bank instead of Cash
 *
 * @param {object} payload
 * @param {string} companyId
 * @param {string} traceId
 */
async function recordIncome(payload, companyId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });

  const amountPaise = _requireAmount(payload);
  const debitSubType  = payload.ledgerHint === 'bank' ? 'bank' : 'cash';
  const creditSubType = 'sales';

  const [debitLedger, creditLedger] = await Promise.all([
    ledgerEngine.resolveBySubType(companyId, debitSubType),
    ledgerEngine.resolveBySubType(companyId, creditSubType),
  ]);

  const narration = payload.narration ||
    `Income received${payload.party ? ` from ${payload.party}` : ''}`;

  const result = await journalEngine.postEntry(
    {
      companyId,
      entryDate:   payload.entryDate   || _today(),
      narration,
      referenceNo: payload.referenceNo || null,
      source:      payload.source      || 'api',
      createdBy:   payload.userId,
      lines: [
        { ledgerId: debitLedger.id,  type: 'DR', amount: amountPaise },
        { ledgerId: creditLedger.id, type: 'CR', amount: amountPaise },
      ],
      metadata: {
        intent:      INTENT.ACCOUNTING_RECORD_INCOME,
        party:       payload.party      || null,
        ledgerHint:  payload.ledgerHint || null,
      },
    },
    traceId
  );

  log.info('accounting_income_recorded', {
    entry_id:    result.entry.id,
    amount_paise: amountPaise,
    debit_ledger: debitLedger.name,
  });

  return _buildResult('income_recorded', result, amountPaise);
}

/**
 * Record an expense paid.
 * Default: DR Misc Expense / CR Cash
 * ledgerHint 'bank' → CR Bank instead of Cash
 */
async function recordExpense(payload, companyId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });

  const amountPaise   = _requireAmount(payload);
  const debitSubType  = 'misc_expense';
  const creditSubType = payload.ledgerHint === 'bank' ? 'bank' : 'cash';

  const [debitLedger, creditLedger] = await Promise.all([
    ledgerEngine.resolveBySubType(companyId, debitSubType),
    ledgerEngine.resolveBySubType(companyId, creditSubType),
  ]);

  const narration = payload.narration ||
    `Expense paid${payload.party ? ` to ${payload.party}` : ''}`;

  const result = await journalEngine.postEntry(
    {
      companyId,
      entryDate:   payload.entryDate   || _today(),
      narration,
      referenceNo: payload.referenceNo || null,
      source:      payload.source      || 'api',
      createdBy:   payload.userId,
      lines: [
        { ledgerId: debitLedger.id,  type: 'DR', amount: amountPaise },
        { ledgerId: creditLedger.id, type: 'CR', amount: amountPaise },
      ],
      metadata: {
        intent:     INTENT.ACCOUNTING_RECORD_EXPENSE,
        party:      payload.party      || null,
        ledgerHint: payload.ledgerHint || null,
      },
    },
    traceId
  );

  log.info('accounting_expense_recorded', {
    entry_id:     result.entry.id,
    amount_paise: amountPaise,
  });

  return _buildResult('expense_recorded', result, amountPaise);
}

/**
 * Record a payment made to a vendor/supplier.
 * Default: DR Trade Payables / CR Cash
 * Reduces outstanding payable, reduces cash.
 */
async function recordPayment(payload, companyId, traceId) {
  const amountPaise   = _requireAmount(payload);
  const creditSubType = payload.ledgerHint === 'bank' ? 'bank' : 'cash';

  const [debitLedger, creditLedger] = await Promise.all([
    ledgerEngine.resolveBySubType(companyId, 'trade_payable'),
    ledgerEngine.resolveBySubType(companyId, creditSubType),
  ]);

  const narration = payload.narration ||
    `Payment made${payload.party ? ` to ${payload.party}` : ''}`;

  const result = await journalEngine.postEntry(
    {
      companyId,
      entryDate:   payload.entryDate   || _today(),
      narration,
      referenceNo: payload.referenceNo || null,
      source:      payload.source      || 'api',
      createdBy:   payload.userId,
      lines: [
        { ledgerId: debitLedger.id,  type: 'DR', amount: amountPaise },
        { ledgerId: creditLedger.id, type: 'CR', amount: amountPaise },
      ],
      metadata: { intent: INTENT.ACCOUNTING_RECORD_PAYMENT, party: payload.party || null },
    },
    traceId
  );

  return _buildResult('payment_recorded', result, amountPaise);
}

/**
 * Record a receipt from a customer.
 * Default: DR Cash / CR Trade Receivables
 * Increases cash, reduces outstanding receivable.
 */
async function recordReceipt(payload, companyId, traceId) {
  const amountPaise  = _requireAmount(payload);
  const debitSubType = payload.ledgerHint === 'bank' ? 'bank' : 'cash';

  const [debitLedger, creditLedger] = await Promise.all([
    ledgerEngine.resolveBySubType(companyId, debitSubType),
    ledgerEngine.resolveBySubType(companyId, 'trade_receivable'),
  ]);

  const narration = payload.narration ||
    `Receipt received${payload.party ? ` from ${payload.party}` : ''}`;

  const result = await journalEngine.postEntry(
    {
      companyId,
      entryDate:   payload.entryDate   || _today(),
      narration,
      referenceNo: payload.referenceNo || null,
      source:      payload.source      || 'api',
      createdBy:   payload.userId,
      lines: [
        { ledgerId: debitLedger.id,  type: 'DR', amount: amountPaise },
        { ledgerId: creditLedger.id, type: 'CR', amount: amountPaise },
      ],
      metadata: { intent: INTENT.ACCOUNTING_RECORD_RECEIPT, party: payload.party || null },
    },
    traceId
  );

  return _buildResult('receipt_recorded', result, amountPaise);
}

/**
 * Record a transfer between accounts.
 * Default: DR Bank / CR Cash (cash deposited to bank)
 * ledgerHint 'cash_to_bank': DR Bank / CR Cash
 * ledgerHint 'bank_to_cash': DR Cash / CR Bank
 */
async function recordTransfer(payload, companyId, traceId) {
  const amountPaise = _requireAmount(payload);

  let debitSubType  = 'bank';
  let creditSubType = 'cash';

  if (payload.ledgerHint === 'bank_to_cash') {
    debitSubType  = 'cash';
    creditSubType = 'bank';
  }

  const [debitLedger, creditLedger] = await Promise.all([
    ledgerEngine.resolveBySubType(companyId, debitSubType),
    ledgerEngine.resolveBySubType(companyId, creditSubType),
  ]);

  const narration = payload.narration ||
    `Transfer: ${creditSubType} to ${debitSubType}`;

  const result = await journalEngine.postEntry(
    {
      companyId,
      entryDate:   payload.entryDate || _today(),
      narration,
      source:      payload.source    || 'api',
      createdBy:   payload.userId,
      lines: [
        { ledgerId: debitLedger.id,  type: 'DR', amount: amountPaise },
        { ledgerId: creditLedger.id, type: 'CR', amount: amountPaise },
      ],
      metadata: { intent: INTENT.ACCOUNTING_RECORD_TRANSFER },
    },
    traceId
  );

  return _buildResult('transfer_recorded', result, amountPaise);
}

/**
 * Reverse a posted journal entry.
 * Requires entryId in payload.
 */
async function reverseEntry(payload, companyId, traceId) {
  if (!payload.entryId) {
    throw new ValidationError('entryId is required for reversal');
  }

  const result = await journalEngine.reverseEntry(
    companyId,
    payload.entryId,
    payload.userId,
    payload.narration || null,
    traceId
  );

  return {
    action:          'entry_reversed',
    reversalEntryId: result.entry.id,
    originalEntryId: result.originalEntryId,
    entry:           result.entry,
    lines:           result.lines,
  };
}

/**
 * View balance for a ledger or sub_type.
 */
async function viewBalance(payload, companyId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });

  // Resolve ledger — by ID or sub_type
  let ledger;
  if (payload.ledgerId) {
    const bal = await ledgerEngine.getBalance(companyId, payload.ledgerId, traceId);
    ledger = bal.ledger;
  } else {
    const subType = payload.ledgerHint || 'cash';
    ledger = await ledgerEngine.resolveBySubType(companyId, subType);
  }

  const balance = await ledgerEngine.getBalance(companyId, ledger.id, traceId);

  log.info('accounting_balance_viewed', {
    ledger_id:    ledger.id,
    balance_paise: balance.balancePaise,
  });

  return {
    action:         'balance_viewed',
    ledgerId:       ledger.id,
    balancePaise:   balance.balancePaise,
    balanceRupees:  balance.balanceRupees,
    balanceFormatted: formatPaise(balance.balancePaise),
  };
}

/**
 * View ledger statement for a date range.
 */
async function viewLedger(payload, companyId, traceId) {
  const subType = payload.ledgerHint || 'cash';
  const ledger  = await ledgerEngine.resolveBySubType(companyId, subType);

  const fromDate = payload.fromDate || _monthStart();
  const toDate   = payload.toDate   || _today();

  return reconciliationEngine.getLedgerStatement(
    companyId, ledger.id, fromDate, toDate, traceId
  );
}

/**
 * View accounting summary — trial balance.
 */
async function viewSummary(companyId, traceId) {
  return ledgerEngine.getTrialBalance(companyId, traceId);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _requireAmount(payload) {
  if (!payload.amountPaise || !Number.isInteger(payload.amountPaise) || payload.amountPaise <= 0) {
    throw new ValidationError(
      'Amount is required and must be a positive integer (paise)',
      { amountPaise: payload.amountPaise }
    );
  }
  return payload.amountPaise;
}

function _today() {
  return new Date().toISOString().split('T')[0];
}

function _monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function _buildResult(action, journalResult, amountPaise) {
  return {
    action,
    entryId:          journalResult.entry.id,
    entryDate:        journalResult.entry.entry_date,
    narration:        journalResult.entry.narration,
    amountPaise,
    amountRupees:     (amountPaise / 100).toFixed(2),
    amountFormatted:  formatPaise(amountPaise),
    entry:            journalResult.entry,
    lines:            journalResult.lines,
    balanceUpdates:   journalResult.balanceUpdates,
  };
}

module.exports = {
  dispatch,
  recordIncome,
  recordExpense,
  recordPayment,
  recordReceipt,
  recordTransfer,
  reverseEntry,
  viewBalance,
  viewLedger,
  viewSummary,
};