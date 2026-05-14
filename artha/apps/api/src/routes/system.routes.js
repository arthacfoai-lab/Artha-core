'use strict';

const express = require('express');
const config  = require('@artha/config');
const { healthCheck: dbHealth } = require('@artha/database');
const { healthCheck: redisHealth } = require('@artha/session');

const router = express.Router();

/**
 * ARTHA System Routes
 *
 * Infrastructure probes — no auth required.
 *
 * GET /health  — liveness probe
 *   Returns 200 if process is alive.
 *   Kubernetes/Docker use this to restart dead containers.
 *   Never checks DB or Redis — just proves the process responds.
 *
 * GET /ready   — readiness probe
 *   Returns 200 if service can handle traffic.
 *   Returns 503 if DB or Redis unreachable.
 *   Kubernetes uses this to stop routing traffic during startup/recovery.
 *
 * GET /version — build metadata
 *   Returns app name, version, env.
 *   Used to verify correct version deployed after CI/CD.
 */

router.get('/health', (_req, res) => {
  res.status(200).json({
    ok:        true,
    status:    'alive',
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (req, res) => {
  const checks = {};
  let allHealthy = true;

  // Database check
  try {
    checks.database = await dbHealth();
  } catch (err) {
    const log = req.log || console;
    log.error && log.error('readiness_db_fail', { error: err.message });
    checks.database = { alive: false, error: err.message };
    allHealthy = false;
  }

  // Redis check
  try {
    checks.redis = await redisHealth();
  } catch (err) {
    const log = req.log || console;
    log.error && log.error('readiness_redis_fail', { error: err.message });
    checks.redis = { alive: false, error: err.message };
    allHealthy = false;
  }

  const statusCode = allHealthy ? 200 : 503;

  res.status(statusCode).json({
    ok:        allHealthy,
    status:    allHealthy ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

router.get('/version', (_req, res) => {
  res.status(200).json({
    ok:        true,
    name:      config.app.name,
    version:   config.app.version,
    env:       config.env,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;