'use strict';

const config = require('@artha/config');
const { logger } = require('@artha/logger');
const { closePool } = require('@artha/database');
const { closeRedis } = require('@artha/session');
const { createApp } = require('./app');

/**
 * ARTHA API Server Entry Point
 *
 * Boots the Express app and starts the HTTP server.
 * Handles graceful shutdown on SIGTERM + SIGINT.
 * Handles uncaught exceptions + unhandled promise rejections.
 *
 * Graceful shutdown sequence:
 *   1. Stop accepting new HTTP connections (server.close)
 *   2. Close PostgreSQL pool (drain in-flight queries)
 *   3. Close Redis connection
 *   4. Exit process cleanly
 *
 * Force-kill after 10s if graceful shutdown hangs.
 * Production process manager (PM2/K8s) sends SIGTERM on deploy.
 *
 * Never call this file directly in tests — import createApp() instead.
 */

const app = createApp();
let server;

async function start() {
  server = app.listen(config.app.port, () => {
    logger.info('artha_api_started', {
      port:    config.app.port,
      env:     config.env,
      version: config.app.version,
      name:    config.app.name,
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('port_in_use', { port: config.app.port });
    } else {
      logger.error('server_error', { error: err.message, code: err.code });
    }
    process.exit(1);
  });
}

async function shutdown(signal) {
  logger.info('shutdown_initiated', { signal });

  // Stop accepting new connections
  if (server) {
    server.close(async () => {
      logger.info('http_server_closed');

      try {
        await closePool();
        await closeRedis();
        logger.info('shutdown_complete');
        process.exit(0);
      } catch (err) {
        logger.error('shutdown_cleanup_error', { error: err.message });
        process.exit(1);
      }
    });
  }

  // Force exit after 10s — prevents hanging on stuck connections
  setTimeout(() => {
    logger.error('shutdown_timeout_force_exit');
    process.exit(1);
  }, 10000).unref();
}

// ── Process signal handlers ───────────────────────────────────────────────────
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ── Uncaught exception handler ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', {
    error:   err.message,
    name:    err.name,
    stack:   err.stack,
  });
  process.exit(1);
});

// ── Unhandled promise rejection handler ───────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  logger.error('unhandled_rejection', {
    reason: String(reason),
    promise: String(promise),
  });
  process.exit(1);
});

// ── Boot ──────────────────────────────────────────────────────────────────────
start().catch((err) => {
  logger.error('startup_failed', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});