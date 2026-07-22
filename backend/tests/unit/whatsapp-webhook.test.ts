import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

describe('WhatsApp webhook', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-12345',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
      WHATSAPP_VERIFY_TOKEN: 'meta-verify-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function app() {
    const { webhooksRouter } = await import('../../src/modules/webhooks/webhooks.routes');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/webhooks', webhooksRouter);
    return a;
  }

  it('GET verifies and returns hub.challenge when token matches', async () => {
    const res = await request(await app())
      .get('/api/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'meta-verify-secret',
        'hub.challenge': '1234567890',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('1234567890');
  });

  it('GET returns 403 when verify token is wrong', async () => {
    const res = await request(await app())
      .get('/api/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong',
        'hub.challenge': '1234567890',
      });

    expect(res.status).toBe(403);
  });

  it('GET returns 403 when WHATSAPP_VERIFY_TOKEN is unset', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = '';
    vi.resetModules();

    const res = await request(await app())
      .get('/api/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'meta-verify-secret',
        'hub.challenge': '1234567890',
      });

    expect(res.status).toBe(403);
  });

  it('POST acknowledges webhook payloads', async () => {
    const res = await request(await app())
      .post('/api/v1/webhooks/whatsapp')
      .send({ object: 'whatsapp_business_account', entry: [{ id: '1' }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
