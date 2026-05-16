'use strict';

const { createContextLogger } = require('@artha/logger');
const { withTransaction }     = require('@artha/database');
const journalRepository       = require('@artha/database').journalRepository;
const auditRepository         = require('@artha/database').auditRepository;
const { validateBalance }     = require('./balance.engine');
const { adjustBalances }      = require('./ledger.engine');
const {
  AccountingError,
  NotFoundError,
  ValidationError,
} = require('@artha/errors');

/**
 * ARTHA Journal Engine
 *
 * Handles all journal entry operations.
 * Enforces double-entry bookkeeping at every step.
 *
 * CRITICAL RULES:
 *   1. validateBalance() ALWAYS called before any DB write
 *   2. createWithLines() ALWAYS inside withTransaction
 *   3. Ledger balances adjusted in SAME transaction as journal entry
 *   4. Journal entries are APPEND ONLY — no mutation after posting
 *   5. Corrections via reversal entries — never UPDATE/DELETE
 *   6. All amounts in BIGINT paise — never float arithmetic
 *
 * Transaction flow for postEntry():
 *   1. validateBalance() — verify DR=CR (no DB call, pure arithmetic)
 *   2. BEGIN transaction
 *   3. journalRepository.createWithLines() — insert entry + lines
 *   4. ledger.engine.adjustBalances() — atomic balance updates
 *   5. auditRepository.writeSilent() — audit log
 *   6. COMMIT
 *   (any error → ROLLBACK — nothing written)
 *
 * Integration points (existing):
 *   - journalRepository (Day 1) — DB operations
 *   - auditRepository (Day 1)   — compliance audit trail
 *   - balance.engine (Day 3)    — validateBalance, computeLineDelta
 *   - ledger.engine (Day 3)     — adjustBalances
 *   - withTransaction (Day 1)   — ACID guarantees
 *
 * Integration points (future):
 *   - gst.engine (Day 6)        — posts GST entries alongside
 *   - accounting.engine (Day 3) — orchestrates this engine
 *   - reporting (Day 9)         — reads journal for P&L
 */

/**
 * Post a new journal entry.
 * Core accounting write operation.
 * Validates balance, creates entry + lines, adjusts ledger balances.
 * All operations atomic — COMMIT or full ROLLBACK.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.entryDate    — YYYY-MM-DD
 * @param {string} params.narration    — human description
 * @param {string} [params.referenceNo]
 * @param {string} params.source       — 'manual'|'whatsapp'|'api'|'system'
 * @param {string} params.createdBy    — user UUID
 * @param {Array}  params.lines        — [{ ledgerId, type: 'DR'|'CR', amount }]
 * @param {object} [params.metadata]
 * @param {string} traceId
 * @returns {Promise<{ entry, lines, balanceUpdates }>}
 */
async function postEntry(params, traceId) {
  const {
    companyId,
    entryDate,
    narration,
    referenceNo,
    source,
    createdBy,
    lines,
    metadata,
  } = params;

  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.info('journal_post_start', {
    entry_date:  entryDate,
    line_count:  lines ? lines.length : 0,
    source,
  });

  // ── Pre-transaction validation ─────────────────────────────────────────────
  if (!companyId) { throw new ValidationError('companyId is required'); }
  if (!entryDate) { throw new ValidationError('entryDate is required'); }
  if (!narration) { throw new ValidationError('narration is required'); }
  if (!source)    { throw new ValidationError('source is required'); }
  if (!createdBy) { throw new ValidationError('createdBy (userId) is required'); }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    throw new ValidationError(`entryDate must be YYYY-MM-DD format — received '${entryDate}'`);
  }

  // Validate date is not in the far future (sanity check)
  const entryDateObj = new Date(entryDate);
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 1);
  if (entryDateObj > maxDate) {
    throw new ValidationError('entryDate cannot be more than 1 year in the future');
  }

  // Double-entry balance validation — BEFORE any DB operation
  // This is pure arithmetic — throws AccountingError if DR ≠ CR
  const { totalDr, totalCr } = validateBalance(lines);

  log.debug('journal_balance_validated', { total_dr: totalDr, total_cr: totalCr });

  // ── Atomic transaction ─────────────────────────────────────────────────────
  const result = await withTransaction(async (client) => {

    // 1. Create journal entry + lines
    const { entry, lines: createdLines } = await journalRepository.createWithLines(
      {
        companyId,
        entryDate,
        narration,
        referenceNo: referenceNo || null,
        source:      source      || 'api',
        createdBy,
        status:      'posted',
        metadata:    metadata    || {},
      },
      lines,
      client
    );

    // 2. Adjust ledger balances atomically in same transaction
    const balanceUpdates = await adjustBalances(companyId, lines, client);

    // 3. Audit log — silent, never fails transaction
    await auditRepository.writeSilent(
      {
        companyId,
        userId:       createdBy,
        traceId,
        action:       'journal_entry.posted',
        resourceType: 'journal_entry',
        resourceId:   entry.id,
        payload: {
          entryDate,
          narration,
          referenceNo,
          source,
          totalDr,
          totalCr,
          lineCount: lines.length,
        },
      },
      client
    );

    return { entry, lines: createdLines, balanceUpdates };
  });

  log.info('journal_post_complete', {
    entry_id:    result.entry.id,
    entry_date:  entryDate,
    total_dr:    totalDr,
    total_cr:    totalCr,
  });

  return result;
}

/**
 * Reverse a posted journal entry.
 * Creates a new entry with all DR↔CR lines flipped.
 * Marks original entry status = 'reversed'.
 * Adjusts ledger balances to undo original entry effect.
 * All operations atomic.
 *
 * @param {string} companyId
 * @param {string} entryId    — UUID of entry to reverse
 * @param {string} createdBy  — user performing reversal
 * @param {string} [narration] — optional custom narration
 * @param {string} traceId
 * @returns {Promise<{ entry, lines, balanceUpdates }>}
 */
async function reverseEntry(companyId, entryId, createdBy, narration, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.info('journal_reverse_start', { entry_id: entryId });

  if (!companyId) { throw new ValidationError('companyId is required'); }
  if (!entryId)   { throw new ValidationError('entryId is required'); }
  if (!createdBy) { throw new ValidationError('createdBy (userId) is required'); }

  const result = await withTransaction(async (client) => {

    // 1. Load original entry + lines — verify it exists and is not already reversed
    const original = await journalRepository.findByIdWithLines(companyId, entryId, client);
    if (!original) { throw new NotFoundError('Journal entry'); }

    if (original.entry.status === 'reversed') {
      throw new AccountingError(
        'Journal entry has already been reversed',
        { entryId }
      );
    }

    if (original.entry.status === 'draft') {
      throw new AccountingError(
        'Draft journal entries cannot be reversed — post first',
        { entryId }
      );
    }

    // 2. Build reversal lines (flip DR↔CR)
    const reversalLines = original.lines.map((line) => ({
      ledgerId: line.ledger_id,
      type:     line.type === 'DR' ? 'CR' : 'DR',
      amount:   line.amount,
      currency: line.currency,
    }));

    // 3. Validate reversal balance (should always pass — symmetric flip)
    validateBalance(reversalLines);

    // 4. Create reversal journal entry
    const reversalNarration = narration || `Reversal: ${original.entry.narration}`;
    const { entry, lines: createdLines } = await journalRepository.createWithLines(
      {
        companyId,
        entryDate:   new Date().toISOString().split('T')[0],
        narration:   reversalNarration,
        referenceNo: original.entry.reference_no,
        source:      'system',
        createdBy,
        status:      'posted',
        metadata:    { reversal_of: entryId },
      },
      reversalLines,
      client
    );

    // 5. Mark original as reversed
    await journalRepository.createReversal(
      companyId,
      entryId,
      createdBy,
      narration,
      client
    );

    // 6. Adjust ledger balances to undo original entry
    const balanceUpdates = await adjustBalances(companyId, reversalLines, client);

    // 7. Audit
    await auditRepository.writeSilent(
      {
        companyId,
        userId:       createdBy,
        traceId,
        action:       'journal_entry.reversed',
        resourceType: 'journal_entry',
        resourceId:   entry.id,
        payload:      { originalEntryId: entryId, reversalEntryId: entry.id },
      },
      client
    );

    return { entry, lines: createdLines, balanceUpdates, originalEntryId: entryId };
  });

  log.info('journal_reverse_complete', {
    original_entry_id: entryId,
    reversal_entry_id: result.entry.id,
  });

  return result;
}

/**
 * Get a journal entry with all its lines.
 * Tenant-scoped.
 *
 * @param {string} companyId
 * @param {string} entryId
 * @param {string} traceId
 * @returns {Promise<{ entry, lines }>}
 */
async function getEntry(companyId, entryId, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('journal_get_entry', { entry_id: entryId });

  const result = await journalRepository.findByIdWithLines(companyId, entryId);
  if (!result) { throw new NotFoundError('Journal entry'); }
  return result;
}

/**
 * List journal entries by date range.
 * Tenant-scoped, paginated.
 *
 * @param {string} companyId
 * @param {string} fromDate  — YYYY-MM-DD
 * @param {string} toDate    — YYYY-MM-DD
 * @param {{ limit, offset, source, status }} opts
 * @param {string} traceId
 * @returns {Promise<{ entries, total }>}
 */
async function listEntries(companyId, fromDate, toDate, opts = {}, traceId) {
  const log = createContextLogger({ trace_id: traceId, company_id: companyId });
  log.debug('journal_list_entries', { fromDate, toDate });

  if (!fromDate || !toDate) {
    throw new ValidationError('fromDate and toDate are required');
  }

  const [entries, total] = await Promise.all([
    journalRepository.findByDateRange(companyId, fromDate, toDate, {
      limit:  opts.limit  || 50,
      offset: opts.offset || 0,
    }),
    journalRepository.countByDateRange(companyId, fromDate, toDate),
  ]);

  return { entries, total };
}

module.exports = {
  postEntry,
  reverseEntry,
  getEntry,
  listEntries,
};