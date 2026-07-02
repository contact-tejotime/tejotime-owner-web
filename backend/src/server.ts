import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { initRealtime } from './realtime/io';
import { startScheduler } from './jobs/scheduler';

const app = createApp();
const httpServer = createServer(app);

initRealtime(httpServer);
startScheduler();

httpServer.listen(env.PORT, () => {
  logger.info(`TejoTime API listening on :${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
