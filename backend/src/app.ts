import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './config/logger';
import { corsOrigins } from './config/env';
import { API_PREFIX } from './config/constants';
import { requestId } from './middleware/request-id';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { limiters } from './middleware/rate-limit';
import { healthRouter } from './observability/health';
import { authRouter } from './modules/auth/auth.routes';
import { businessRouter } from './modules/business/business.routes';
import { servicesRouter } from './modules/services/services.routes';
import { staffRouter } from './modules/staff/staff.routes';
import { queueRouter } from './modules/queue/queue.routes';
import { appointmentsRouter } from './modules/appointments/appointments.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { subscriptionRouter } from './modules/subscription/subscription.routes';
import { uploadsRouter } from './modules/uploads/uploads.routes';
import { publicRouter } from './modules/public/public.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';
import { adminRouter } from './modules/admin/admin.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true, maxAge: 86400 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);
  app.use(pinoHttp({ logger, customProps: (req) => ({ requestId: (req as any).requestId }) }));
  app.use(limiters.global);

  // Health (unversioned).
  app.use('/', healthRouter);

  // Versioned API.
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/business`, businessRouter);
  app.use(`${API_PREFIX}/services`, servicesRouter);
  app.use(`${API_PREFIX}/staff`, staffRouter);
  app.use(`${API_PREFIX}/queue`, queueRouter);
  app.use(`${API_PREFIX}/appointments`, appointmentsRouter);
  app.use(`${API_PREFIX}/customers`, customersRouter);
  app.use(`${API_PREFIX}/dashboard`, dashboardRouter);
  app.use(`${API_PREFIX}/notifications`, notificationsRouter);
  app.use(`${API_PREFIX}/subscription`, subscriptionRouter);
  app.use(`${API_PREFIX}/uploads`, uploadsRouter);
  app.use(`${API_PREFIX}/public`, publicRouter);
  app.use(`${API_PREFIX}/webhooks`, webhooksRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
