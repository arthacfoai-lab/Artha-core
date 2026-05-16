'use strict';

const express = require('express');
const authRoutes       = require('./auth.routes');
const accountingRoutes = require('./accounting.routes');

const router = express.Router();

/**
 * ARTHA API v1 Router — UPDATED Day 3
 *
 * Day 3 changes:
 *   - /auth routes now wired (was stub)
 *   - /accounting routes now wired (was stub)
 *
 * Wired routes:
 *   /auth        — Day 3: register, login, refresh, me
 *   /accounting  — Day 3: journal CRUD, ledger ops, reconciliation
 *
 * Stub routes (future days):
 *   /message     — Day 4 (routing engine HTTP entry)
 *   /webhooks    — Day 5 (OpenClaw + Paperclip)
 *   /gst         — Day 6
 *   /vendors     — Day 8
 *   /customers   — Day 8
 *   /reports     — Day 9
 *   /reminders   — Day 10
 */

// ── Day 3: Live routes ─────────────────────────────────────────────────────────
router.use('/auth',       authRoutes);
router.use('/accounting', accountingRoutes);

// ── Day 4: Message routing ────────────────────────────────────────────────────
router.use('/message', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Routing engine HTTP — Day 4' },
  });
});

// ── Day 5: Webhooks ───────────────────────────────────────────────────────────
router.use('/webhooks', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Webhook routes — Day 5' },
  });
});

// ── Day 6: GST ────────────────────────────────────────────────────────────────
router.use('/gst', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'GST engine — Day 6' },
  });
});

// ── Day 8: Business memory ────────────────────────────────────────────────────
router.use('/vendors', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Business memory — Day 8' },
  });
});

router.use('/customers', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Business memory — Day 8' },
  });
});

// ── Day 9: Reports ────────────────────────────────────────────────────────────
router.use('/reports', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Intelligence engine — Day 9' },
  });
});

// ── Day 10: Reminders ─────────────────────────────────────────────────────────
router.use('/reminders', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Paperclip orchestration — Day 10' },
  });
});

module.exports = router;