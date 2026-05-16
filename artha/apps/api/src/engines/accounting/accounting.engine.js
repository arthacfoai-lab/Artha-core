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
} = require('@artha/errors');

/**
 * ARTHA Accounting Engine
 * Main orchestration layer for accounting operations.
 */

async function dispatch(intent, payload, companyId, traceId) {

  const log = createContextLogger({
    trace_id: traceId,
    company_id: companyId,
  });

  log.info('accounting_dispatch', {
    intent,
    amount_paise: payload.amountPaise,
  });

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
 * RECORD INCOME
 * DR Cash/Bank
 * CR Sales
 */
async function recordIncome(payload, companyId, traceId) {

  const amountPaise =
    _requireAmount(payload);

  const debitSubType =
    payload.ledgerHint === 'bank'
      ? 'bank'
      : 'cash';

  const creditSubType =
    'sales';

  const [debitLedger, creditLedger] =
    await Promise.all([
      ledgerEngine.resolveBySubType(
        companyId,
        debitSubType
      ),

      ledgerEngine.resolveBySubType(
        companyId,
        creditSubType
      ),
    ]);

  const narration =
    payload.narration ||
    `Income received${
      payload.party
        ? ` from ${payload.party}`
        : ''
    }`;

  const result =
    await journalEngine.postEntry(
      {
        companyId,

        entryDate:
          payload.entryDate || _today(),

        narration,

        referenceNo:
          payload.referenceNo || null,

        source:
          payload.source || 'api',

        createdBy:
          payload.userId,

        lines: [
          {
            ledgerId:
              debitLedger.id,

            type: 'DR',

            amount:
              amountPaise,
          },

          {
            ledgerId:
              creditLedger.id,

            type: 'CR',

            amount:
              amountPaise,
          },
        ],

        metadata: {
          intent:
            INTENT.ACCOUNTING_RECORD_INCOME,

          party:
            payload.party || null,

          ledgerHint:
            payload.ledgerHint || null,
        },
      },

      traceId
    );

  return _buildResult(
    'income_recorded',
    result,
    amountPaise
  );
}

/**
 * RECORD EXPENSE
 * DR Expense
 * CR Cash/Bank
 */
async function recordExpense(payload, companyId, traceId) {

  const amountPaise =
    _requireAmount(payload);

  const debitSubType =
    'misc_expense';

  const creditSubType =
    payload.ledgerHint === 'bank'
      ? 'bank'
      : 'cash';

  const [debitLedger, creditLedger] =
    await Promise.all([
      ledgerEngine.resolveBySubType(
        companyId,
        debitSubType
      ),

      ledgerEngine.resolveBySubType(
        companyId,
        creditSubType
      ),
    ]);

  const narration =
    payload.narration ||
    `Expense paid${
      payload.party
        ? ` to ${payload.party}`
        : ''
    }`;

  const result =
    await journalEngine.postEntry(
      {
        companyId,

        entryDate:
          payload.entryDate || _today(),

        narration,

        referenceNo:
          payload.referenceNo || null,

        source:
          payload.source || 'api',

        createdBy:
          payload.userId,

        lines: [
          {
            ledgerId:
              debitLedger.id,

            type: 'DR',

            amount:
              amountPaise,
          },

          {
            ledgerId:
              creditLedger.id,

            type: 'CR',

            amount:
              amountPaise,
          },
        ],

        metadata: {
          intent:
            INTENT.ACCOUNTING_RECORD_EXPENSE,

          party:
            payload.party || null,

          ledgerHint:
            payload.ledgerHint || null,
        },
      },

      traceId
    );

  return _buildResult(
    'expense_recorded',
    result,
    amountPaise
  );
}

/**
 * RECORD PAYMENT
 */
async function recordPayment(payload, companyId, traceId) {

  const amountPaise =
    _requireAmount(payload);

  const creditSubType =
    payload.ledgerHint === 'bank'
      ? 'bank'
      : 'cash';

  const [debitLedger, creditLedger] =
    await Promise.all([
      ledgerEngine.resolveBySubType(
        companyId,
        'trade_payable'
      ),

      ledgerEngine.resolveBySubType(
        companyId,
        creditSubType
      ),
    ]);

  const narration =
    payload.narration ||
    `Payment made${
      payload.party
        ? ` to ${payload.party}`
        : ''
    }`;

  const result =
    await journalEngine.postEntry(
      {
        companyId,

        entryDate:
          payload.entryDate || _today(),

        narration,

        referenceNo:
          payload.referenceNo || null,

        source:
          payload.source || 'api',

        createdBy:
          payload.userId,

        lines: [
          {
            ledgerId:
              debitLedger.id,

            type: 'DR',

            amount:
              amountPaise,
          },

          {
            ledgerId:
              creditLedger.id,

            type: 'CR',

            amount:
              amountPaise,
          },
        ],

        metadata: {
          intent:
            INTENT.ACCOUNTING_RECORD_PAYMENT,

          party:
            payload.party || null,
        },
      },

      traceId
    );

  return _buildResult(
    'payment_recorded',
    result,
    amountPaise
  );
}

/**
 * RECORD RECEIPT
 */
async function recordReceipt(payload, companyId, traceId) {

  const amountPaise =
    _requireAmount(payload);

  const debitSubType =
    payload.ledgerHint === 'bank'
      ? 'bank'
      : 'cash';

  const [debitLedger, creditLedger] =
    await Promise.all([
      ledgerEngine.resolveBySubType(
        companyId,
        debitSubType
      ),

      ledgerEngine.resolveBySubType(
        companyId,
        'trade_receivable'
      ),
    ]);

  const narration =
    payload.narration ||
    `Receipt received${
      payload.party
        ? ` from ${payload.party}`
        : ''
    }`;

  const result =
    await journalEngine.postEntry(
      {
        companyId,

        entryDate:
          payload.entryDate || _today(),

        narration,

        referenceNo:
          payload.referenceNo || null,

        source:
          payload.source || 'api',

        createdBy:
          payload.userId,

        lines: [
          {
            ledgerId:
              debitLedger.id,

            type: 'DR',

            amount:
              amountPaise,
          },

          {
            ledgerId:
              creditLedger.id,

            type: 'CR',

            amount:
              amountPaise,
          },
        ],

        metadata: {
          intent:
            INTENT.ACCOUNTING_RECORD_RECEIPT,

          party:
            payload.party || null,
        },
      },

      traceId
    );

  return _buildResult(
    'receipt_recorded',
    result,
    amountPaise
  );
}

/**
 * RECORD TRANSFER
 */
async function recordTransfer(payload, companyId, traceId) {

  const amountPaise =
    _requireAmount(payload);

  let debitSubType  = 'bank';
  let creditSubType = 'cash';

  if (
    payload.ledgerHint ===
    'bank_to_cash'
  ) {
    debitSubType  = 'cash';
    creditSubType = 'bank';
  }

  const [debitLedger, creditLedger] =
    await Promise.all([
      ledgerEngine.resolveBySubType(
        companyId,
        debitSubType
      ),

      ledgerEngine.resolveBySubType(
        companyId,
        creditSubType
      ),
    ]);

  const narration =
    payload.narration ||
    `Transfer: ${creditSubType} to ${debitSubType}`;

  const result =
    await journalEngine.postEntry(
      {
        companyId,

        entryDate:
          payload.entryDate || _today(),

        narration,

        source:
          payload.source || 'api',

        createdBy:
          payload.userId,

        lines: [
          {
            ledgerId:
              debitLedger.id,

            type: 'DR',

            amount:
              amountPaise,
          },

          {
            ledgerId:
              creditLedger.id,

            type: 'CR',

            amount:
              amountPaise,
          },
        ],

        metadata: {
          intent:
            INTENT.ACCOUNTING_RECORD_TRANSFER,
        },
      },

      traceId
    );

  return _buildResult(
    'transfer_recorded',
    result,
    amountPaise
  );
}

/**
 * REVERSE ENTRY
 */
async function reverseEntry(payload, companyId, traceId) {

  if (!payload.entryId) {
    throw new ValidationError(
      'entryId is required for reversal'
    );
  }

  const result =
    await journalEngine.reverseEntry(
      companyId,
      payload.entryId,
      payload.userId,
      null,
      traceId
    );

  return {
    action: 'entry_reversed',

    reversalEntryId:
      result.entry.id,

    originalEntryId:
      result.originalEntryId,

    entry:
      result.entry,

    lines:
      result.lines,
  };
}

/**
 * VIEW BALANCE
 */
async function viewBalance(payload, companyId, traceId) {

  let ledgerId;

  if (payload.ledgerId) {

    ledgerId = payload.ledgerId;

  } else {

    const subType =
      payload.ledgerHint || 'cash';

    const ledger =
      await ledgerEngine.resolveBySubType(
        companyId,
        subType
      );

    ledgerId = ledger.id;
  }

  const balance =
    await ledgerEngine.getBalance(
      companyId,
      ledgerId,
      traceId
    );

  return {
    action: 'balance_viewed',

    ledgerId,

    balancePaise:
      balance.balancePaise,

    balanceRupees:
      balance.balanceRupees,

    balanceFormatted:
      formatPaise(balance.balancePaise),
  };
}

/**
 * VIEW LEDGER
 */
async function viewLedger(payload, companyId, traceId) {

  const subType =
    payload.ledgerHint || 'cash';

  const ledger =
    await ledgerEngine.resolveBySubType(
      companyId,
      subType
    );

  const fromDate =
    payload.fromDate || _monthStart();

  const toDate =
    payload.toDate || _today();

  return reconciliationEngine.getLedgerStatement(
    companyId,
    ledger.id,
    fromDate,
    toDate,
    traceId
  );
}

/**
 * VIEW SUMMARY
 */
async function viewSummary(companyId, traceId) {

  return ledgerEngine.getTrialBalance(
    companyId,
    traceId
  );
}

/* ───────────────────────────────────────── */

function _requireAmount(payload) {

  if (
    !payload.amountPaise ||
    !Number.isInteger(payload.amountPaise) ||
    payload.amountPaise <= 0
  ) {
    throw new ValidationError(
      'Amount is required and must be a positive integer (paise)',
      {
        amountPaise:
          payload.amountPaise,
      }
    );
  }

  return payload.amountPaise;
}

function _today() {

  return new Date()
    .toISOString()
    .split('T')[0];
}

function _monthStart() {

  const d = new Date();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, '0')}-01`;
}

function _buildResult(
  action,
  journalResult,
  amountPaise
) {

  return {
    action,

    entryId:
      journalResult.entry.id,

    entryDate:
      journalResult.entry.entry_date,

    narration:
      journalResult.entry.narration,

    amountPaise,

    amountRupees:
      (amountPaise / 100).toFixed(2),

    amountFormatted:
      formatPaise(amountPaise),

    entry:
      journalResult.entry,

    lines:
      journalResult.lines,

    balanceUpdates:
      journalResult.balanceUpdates,
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