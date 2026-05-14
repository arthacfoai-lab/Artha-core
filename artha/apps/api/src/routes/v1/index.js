'use strict';

const express = require('express');

const router = express.Router();

/**
 * ARTHA API v1 Router
 *
 * Routes wired progressively per implementation day.
 * Stubs return 501 with clear day-label until implemented.
 *
 * Day 1:  /health /ready /version (system routes — not here)
 * Day 3:  /auth    — auth.routes.js
 * Day 3:  /accounting — accounting.routes.js
 * Day 4:  /message — message.routes.js (routing engine)
 * Day 5:  /webhooks — webhook.routes.js (OpenClaw)
 * Day 6:  /gst     — gst.routes.js
 * Day 8:  /vendors, /customers — memory routes
 * Day 9:  /reports — report.routes.js
 * Day 10: /reminders — reminder.routes.js (Paperclip)
 */

// ── Day 3: Auth ───────────────────────────────────────────────────────────────
router.use('/auth', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Auth engine — Day 3' },
  });
});

// ── Day 3: Accounting ─────────────────────────────────────────────────────────
router.use('/accounting', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Accounting engine — Day 3' },
  });
});

// ── Day 4: Message routing ────────────────────────────────────────────────────
router.use('/message', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: { code: 'NOT_IMPLEMENTED', message: 'Routing engine — Day 4' },
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