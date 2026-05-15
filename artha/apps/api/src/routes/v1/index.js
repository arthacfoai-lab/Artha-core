'use strict';

const express = require('express');

const authRoutes    = require('./auth.routes');
const messageRoutes = require('./message.routes');

const router = express.Router();

/**
 * ARTHA API v1 Router
 *
 * Mounts all versioned routes.
 * Auth middleware is applied per-sub-router — not globally here.
 * This allows public routes (auth register/login) alongside protected routes.
 *
 * Wired routes (Day 2):
 *   /auth    — register, login, refresh, me
 *   /message — route messages, session management
 *
 * Stub routes (future days):
 *   /accounting — Day 3
 *   /gst        — Day 6
 *   /vendors    — Day 8
 *   /customers  — Day 8
 *   /reports    — Day 9
 *   /reminders  — Day 10
 *   /webhooks   — Day 5 (OpenClaw + Paperclip)
 *
 * Stub responses return 501 with implementation day label.
 * Allows API consumers to discover endpoints early.
 * Replaced with real routers as days progress.
 */

// ── Day 2: Live routes ─────────────────────────────────────────────────────────
router.use('/auth',    authRoutes);
router.use('/message', messageRoutes);

// ── Day 3: Accounting ──────────────────────────────────────────────────────────
router.use('/accounting', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Accounting engine — Day 3',
    },
  });
});

// ── Day 5: Webhooks (OpenClaw + Paperclip) ─────────────────────────────────────
router.use('/webhooks', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Webhook routes — Day 5',
    },
  });
});

// ── Day 6: GST ────────────────────────────────────────────────────────────────
router.use('/gst', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'GST engine — Day 6',
    },
  });
});

// ── Day 8: Business memory ────────────────────────────────────────────────────
router.use('/vendors', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Business memory engine — Day 8',
    },
  });
});

router.use('/customers', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Business memory engine — Day 8',
    },
  });
});

// ── Day 9: Reports ────────────────────────────────────────────────────────────
router.use('/reports', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Intelligence engine — Day 9',
    },
  });
});

// ── Day 10: Reminders (Paperclip) ─────────────────────────────────────────────
router.use('/reminders', (_req, res) => {
  res.status(501).json({
    ok:    false,
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Paperclip orchestration — Day 10',
    },
  });
});

module.exports = router;