import { Router } from 'express';
import { supabase } from '../db/supabase';

export const healthRouter = Router();

/** Liveness — the process is up. */
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/** Readiness — the database is reachable. */
healthRouter.get('/readyz', async (_req, res) => {
  const { error } = await supabase.from('business').select('id', { head: true, count: 'exact' }).limit(1);
  if (error) {
    res.status(503).json({ status: 'unavailable', db: false });
    return;
  }
  res.json({ status: 'ok', db: true });
});
