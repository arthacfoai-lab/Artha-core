'use strict';

const { createContextLogger } = require('@artha/logger');

const {
  ledgerRepository,
  auditRepository,
} = require('@artha/database');

const { getDefaultAccounts } = require('./chart-of-accounts');
const { computeLineDelta } = require('./balance.engine');

const {
  AccountingError,
  NotFoundError,
  ValidationError,
} = require('@artha/errors');

/**
 * Seed default chart of accounts for a company.
 */
async function seedDefaultAccounts(companyId, client) {
  if (!companyId) {
    throw new AccountingError(
      'seedDefaultAccounts requires companyId'
    );
  }

  if (!client) {
    throw new AccountingError(
      'seedDefaultAccounts requires transaction client'
    );
  }

  const accounts = getDefaultAccounts();
  const created = [];

  for (const account of accounts) {
    const ledger = await ledgerRepository.create(
      {
        companyId,
        name:        account.name,
        code:        account.code,
        type:        account.type,
        subType:     account.subType,
        isSystem:    account.isSystem,
        currency:    'INR',
        description: account.description,
      },
      client
    );

    created.push(ledger);
  }

  return created;
}

/**
 * Resolve system ledger by subtype.
 */
async function resolveBySubType(
  companyId,
  subType,
  client = null
) {
  const ledger =
    await ledgerRepository.findSystemBySubType(
      companyId,
      subType,
      client
    );

  if (!ledger) {
    throw new NotFoundError(
      `Ledger with sub_type '${subType}'`
    );
  }

  return ledger;
}

/**
 * Adjust balances atomically.
 */
async function adjustBalances(
  companyId,
  lines,
  client
) {
  if (!client) {
    throw new AccountingError(
      'adjustBalances must be called inside a transaction'
    );
  }

  const results = [];

  for (const line of lines) {
    const ledger =
      await ledgerRepository.findById(
        companyId,
        line.ledgerId,
        client
      );

    if (!ledger) {
      throw new NotFoundError(
        `Ledger ${line.ledgerId}`
      );
    }

    const delta = computeLineDelta(
      ledger.type,
      line.type,
      line.amount
    );

    const updated =
      await ledgerRepository.adjustBalance(
        companyId,
        line.ledgerId,
        delta,
        client
      );

    results.push(updated);
  }

  return results;
}

/**
 * Get ledger balance.
 */
async function getBalance(
  companyId,
  ledgerId,
  traceId
) {
  const log = createContextLogger({
    trace_id: traceId,
    company_id: companyId,
  });

  log.debug('ledger_get_balance', {
    ledger_id: ledgerId,
  });

  const ledger =
    await ledgerRepository.getBalance(
      companyId,
      ledgerId
    );

  return {
    ledger: {
      id: ledger.id,
      balance: ledger.balance,
      currency: ledger.currency,
    },
    balancePaise: ledger.balance,
    balanceRupees: (
      ledger.balance / 100
    ).toFixed(2),
  };
}

/**
 * List ledgers.
 */
async function listLedgers(
  companyId,
  opts = {},
  traceId
) {
  const log = createContextLogger({
    trace_id: traceId,
    company_id: companyId,
  });

  log.debug('ledger_list', {
    type: opts.type,
  });

  if (opts.type) {
    return ledgerRepository.findByType(
      companyId,
      opts.type
    );
  }

  return ledgerRepository.findAll(
    companyId,
    {
      limit:  opts.limit  || 100,
      offset: opts.offset || 0,
    }
  );
}

/**
 * Create custom ledger.
 */
async function createLedger(
  companyId,
  params,
  userId,
  traceId
) {
  const log = createContextLogger({
    trace_id: traceId,
    company_id: companyId,
  });

  const {
    name,
    code,
    type,
    subType,
    description,
  } = params;

  if (!name || !type) {
    throw new ValidationError(
      'Ledger name and type are required'
    );
  }

  const VALID_TYPES = new Set([
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense',
  ]);

  if (!VALID_TYPES.has(type)) {
    throw new ValidationError(
      `Invalid ledger type '${type}'`
    );
  }

  const ledger =
    await ledgerRepository.create({
      companyId,
      name,
      code:        code || null,
      type,
      subType:     subType || null,
      isSystem:    false,
      description: description || null,
    });

  await auditRepository.writeSilent({
    companyId,
    userId,
    traceId,
    action: 'ledger.created',
    resourceType: 'ledger',
    resourceId: ledger.id,
    payload: {
      name,
      code,
      type,
      subType,
    },
  });

  log.info('ledger_created', {
    ledger_id: ledger.id,
    name,
    type,
  });

  return ledger;
}

/**
 * Get trial balance.
 */
async function getTrialBalance(
  companyId,
  traceId
) {
  const log = createContextLogger({
    trace_id: traceId,
    company_id: companyId,
  });

  log.debug('ledger_trial_balance');

  const allLedgers =
    await ledgerRepository.findAll(
      companyId,
      {
        limit: 500,
        offset: 0,
      }
    );

  const grouped = {
    asset:     [],
    liability: [],
    equity:    [],
    revenue:   [],
    expense:   [],
  };

  let totalDr = 0;
  let totalCr = 0;

  for (const ledger of allLedgers) {
    const group = grouped[ledger.type];

    if (!group) {
      continue;
    }

    const balance = ledger.balance;

    group.push({
      id: ledger.id,
      code: ledger.code,
      name: ledger.name,
      subType: ledger.sub_type,
      balance,
      isSystem: ledger.is_system,
    });

    if (
      ledger.type === 'asset' ||
      ledger.type === 'expense'
    ) {
      totalDr += Math.max(balance, 0);
      totalCr += Math.max(-balance, 0);
    } else {
      totalCr += Math.max(balance, 0);
      totalDr += Math.max(-balance, 0);
    }
  }

  return {
    ledgers: grouped,
    totals: {
      totalDr,
      totalCr,
      isBalanced: totalDr === totalCr,
      difference: Math.abs(totalDr - totalCr),
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  seedDefaultAccounts,
  resolveBySubType,
  adjustBalances,
  getBalance,
  listLedgers,
  createLedger,
  getTrialBalance,
}