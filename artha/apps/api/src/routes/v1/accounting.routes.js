'use strict';

const express = require('express');
const { authenticateMiddleware } = require('../../middleware/auth.middleware');
const { tenantMiddleware }       = require('../../middleware/tenant.middleware');
const { requireRole }            = require('../../middleware/auth.middleware');
const { validateBody, validateQuery, validateParams } =
  require('../../middleware/validate.middleware');
const { ok, created, paginated, buildPaginationMeta } =
  require('../../helpers/response.helper');
const accountingEngine  = require('../../engines/accounting/accounting.engine');
const journalEngine     = require('../../engines/accounting/journal.engine');
const ledgerEngine      = require('../../engines/accounting/ledger.engine');
const reconciliationEngine = require('../../engines/accounting/reconciliation.engine');
const {
  createJournalSchema,
  reverseJournalSchema,
  listJournalSchema,
  dateRangeQuerySchema,
  createLedgerSchema,
  uuidParamsSchema,
} = require('../../validators/journal.validator');

const router = express.Router();

/**
 * ARTHA Accounting Routes — /api/v1/accounting
 *
 * All routes require authentication + tenant context.
 * Write operations (POST) require role: owner | accountant.
 * Read operations (GET) accessible to all roles.
 *
 * Routes:
 *
 *   Journal:
 *     POST   /journal                    — post a new journal entry
 *     GET    /journal                    — list journal entries (date range)
 *     GET    /journal/:id                — get single entry with lines
 *     POST   /journal/:id/reverse        — reverse a posted entry
 *
 *   Ledger:
 *     GET    /ledgers                    — list all ledgers
 *     POST   /ledgers                    — create custom ledger
 *     GET    /ledgers/:id/balance        — get ledger balance
 *     GET    /ledgers/:id/statement      — get ledger statement (date range)
 *     GET    /ledgers/trial-balance      — get trial balance
 *
 *   Reconciliation:
 *     GET    /reconciliation/summary     — get reconciliation summary
 *     GET    /reconciliation/:id/verify  — verify ledger balance integrity
 *
 * Integration points:
 *   - accounting.engine  — dispatch(), all operations
 *   - journal.engine     — postEntry, reverseEntry, getEntry, listEntries
 *   - ledger.engine      — listLedgers, createLedger, getBalance, getTrialBalance
 *   - reconciliation.engine — summary, verify
 *   - response.helper    — ok(), created(), paginated()
 *   - validate.middleware — validateBody(), validateQuery(), validateParams()
 */

// ── All accounting routes require auth + tenant ───────────────────────────────
router.use(authenticateMiddleware);
router.use(tenantMiddleware);

// ════════════════════════════════════════════════════════════════════════════
// JOURNAL ROUTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/accounting/journal
 *
 * Post a new double-entry journal entry.
 * Validates: structure (schema), balance (engine).
 * Creates entry + lines + adjusts ledger balances atomically.
 *
 * Body: { entryDate, narration, source, lines: [{ ledgerId, type, amount }], referenceNo? }
 */
router.post(
  '/journal',
  requireRole('owner', 'accountant'),
  validateBody(createJournalSchema),
  async (req, res, next) => {
    try {
      const body = req.validatedBody;

      const result = await journalEngine.postEntry(
        {
          companyId:   req.tenantContext.companyId,
          entryDate:   body.entryDate,
          narration:   body.narration,
          referenceNo: body.referenceNo || null,
          source:      body.source      || 'api',
          createdBy:   req.tenantContext.userId,
          lines:       body.lines,
          metadata:    body.metadata    || {},
        },
        req.traceId
      );

      req.log && req.log.info('journal_posted', {
        entry_id:   result.entry.id,
        line_count: result.lines.length,
      });

      return created(res, req, {
        entry:          result.entry,
        lines:          result.lines,
        balanceUpdates: result.balanceUpdates,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/accounting/journal
 *
 * List journal entries by date range.
 * Query: { fromDate, toDate, limit?, offset?, source?, status? }
 */
router.get(
  '/journal',
  validateQuery(listJournalSchema),
  async (req, res, next) => {
    try {
      const q = req.validatedQuery;

      // Default date range: current month
      const today      = new Date().toISOString().split('T')[0];
      const monthStart = today.slice(0, 8) + '01';
      const fromDate   = q.fromDate || monthStart;
      const toDate     = q.toDate   || today;

      const { entries, total } = await journalEngine.listEntries(
        req.tenantContext.companyId,
        fromDate,
        toDate,
        { limit: q.limit, offset: q.offset },
        req.traceId
      );

      return paginated(res, req, entries, buildPaginationMeta(q, total));
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/accounting/journal/:id
 *
 * Get a single journal entry with all its lines.
 */
router.get(
  '/journal/:id',
  validateParams(uuidParamsSchema),
  async (req, res, next) => {
    try {
      const result = await journalEngine.getEntry(
        req.tenantContext.companyId,
        req.validatedParams.id,
        req.traceId
      );
      return ok(res, req, { entry: result.entry, lines: result.lines });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/v1/accounting/journal/:id/reverse
 *
 * Reverse a posted journal entry.
 * Creates reversal entry with flipped DR↔CR lines.
 * Original entry marked status='reversed'.
 * Both entry + ledger balance adjustments atomic.
 *
 * Body: { narration? }
 */
router.post(
  '/journal/:id/reverse',
  requireRole('owner', 'accountant'),
  validateParams(uuidParamsSchema),
  validateBody(reverseJournalSchema),
  async (req, res, next) => {
    try {
      const result = await journalEngine.reverseEntry(
        req.tenantContext.companyId,
        req.validatedParams.id,
        req.tenantContext.userId,
        req.validatedBody.narration || null,
        req.traceId
      );

      req.log && req.log.info('journal_reversed', {
        original_id: req.validatedParams.id,
        reversal_id: result.entry.id,
      });

      return created(res, req, {
        reversalEntry:   result.entry,
        lines:           result.lines,
        originalEntryId: result.originalEntryId || req.validatedParams.id,
        balanceUpdates:  result.balanceUpdates,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// LEDGER ROUTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/accounting/ledgers/trial-balance
 *
 * Get trial balance — all ledger balances grouped by type.
 * MUST be before /:id routes to avoid param conflict.
 */
router.get(
  '/ledgers/trial-balance',
  async (req, res, next) => {
    try {
      const result = await ledgerEngine.getTrialBalance(
        req.tenantContext.companyId,
        req.traceId
      );
      return ok(res, req, result);
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/accounting/ledgers
 *
 * List all ledgers for the tenant.
 * Query: { type? } — filter by asset|liability|equity|revenue|expense
 */
router.get(
  '/ledgers',
  async (req, res, next) => {
    try {
      const ledgers = await ledgerEngine.listLedgers(
        req.tenantContext.companyId,
        { type: req.query.type || null },
        req.traceId
      );
      return ok(res, req, { ledgers });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /api/v1/accounting/ledgers
 *
 * Create a custom ledger account.
 * Body: { name, type, code?, subType?, description? }
 */
router.post(
  '/ledgers',
  requireRole('owner', 'accountant'),
  validateBody(createLedgerSchema),
  async (req, res, next) => {
    try {
      const ledger = await ledgerEngine.createLedger(
        req.tenantContext.companyId,
        req.validatedBody,
        req.tenantContext.userId,
        req.traceId
      );
      return created(res, req, { ledger });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/accounting/ledgers/:id/balance
 *
 * Get current balance for a ledger.
 */
router.get(
  '/ledgers/:id/balance',
  validateParams(uuidParamsSchema),
  async (req, res, next) => {
    try {
      const result = await ledgerEngine.getBalance(
        req.tenantContext.companyId,
        req.validatedParams.id,
        req.traceId
      );
      return ok(res, req, result);
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/accounting/ledgers/:id/statement
 *
 * Get ledger statement for a date range.
 * Query: { fromDate, toDate }
 */
router.get(
  '/ledgers/:id/statement',
  validateParams(uuidParamsSchema),
  validateQuery(dateRangeQuerySchema),
  async (req, res, next) => {
    try {
      const result = await reconciliationEngine.getLedgerStatement(
        req.tenantContext.companyId,
        req.validatedParams.id,
        req.validatedQuery.fromDate,
        req.validatedQuery.toDate,
        req.traceId
      );
      return ok(res, req, result);
    } catch (err) {
      return next(err);
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// RECONCILIATION ROUTES
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/accounting/reconciliation/summary
 *
 * Get reconciliation summary for last 30 days.
 */
router.get(
  '/reconciliation/summary',
  async (req, res, next) => {
    try {
      const result = await reconciliationEngine.getUnreconciledSummary(
        req.tenantContext.companyId,
        req.traceId
      );
      return ok(res, req, result);
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /api/v1/accounting/reconciliation/:id/verify
 *
 * Verify ledger balance integrity.
 * Compares stored balance against computed balance from journal lines.
 * Used for audit and data integrity checks.
 */
router.get(
  '/reconciliation/:id/verify',
  validateParams(uuidParamsSchema),
  async (req, res, next) => {
    try {
      const result = await reconciliationEngine.verifyLedgerBalance(
        req.tenantContext.companyId,
        req.validatedParams.id,
        req.traceId
      );
      return ok(res, req, result);
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;