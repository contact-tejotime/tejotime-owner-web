import { Router } from 'express';
import { pool } from '../db/pool';

export const healthRouter = Router();

/** Liveness — the process is up. */
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/** Readiness — the database is reachable. */
healthRouter.get('/readyz', async (_req, res) => {
  try {
    await pool.query('select 1');
  } catch {
    res.status(503).json({ status: 'unavailable', db: false });
    return;
  }
  res.json({ status: 'ok', db: true });
});
