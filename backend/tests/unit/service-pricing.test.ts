import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `servicePricing` is the one place that decides what a service row's price MEANS, and every
 * surface that shows or banks a price reads it. The cases below are the ones that were
 * previously each decided independently and wrongly: an unpriced service rendered as "₹0", and
 * a service the shop could only quote as a band derived silently to its floor at checkout.
 *
 * `domain/money` pulls in the zod-validated env, so the module is imported after a stubbed
 * process.env — the same shape whatsapp-webhook.test.ts uses.
 */
describe('servicePricing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      S3_ENDPOINT: 'https://example.storageapi.dev',
      S3_ACCESS_KEY_ID: 'test-access-key-id',
      S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
      S3_BUCKET: 'test-bucket',
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      CUSTOMER_TOKEN_SECRET: 'test-customer-secret',
      TICKET_URL_HMAC_SECRET: 'test-ticket-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const load = async () => (await import('../../src/domain/money')).servicePricing;

  it('reads a fixed service as one amount with no ceiling', async () => {
    const servicePricing = await load();
    const p = servicePricing({ price_type: 'fixed', price_paise: 35000, price_max_paise: null }, 'INR');

    expect(p.priceType).toBe('fixed');
    expect(p.price).toEqual({ amount: 35000, currency: 'INR' });
    expect(p.priceMax).toBeNull();
    // The only mode a checkout may derive a total for.
    expect(p.amountRequired).toBe(false);
  });

  it('reads a range service as a floor plus a ceiling', async () => {
    const servicePricing = await load();
    const p = servicePricing({ price_type: 'range', price_paise: 200000, price_max_paise: 600000 }, 'INR');

    expect(p.priceType).toBe('range');
    expect(p.price).toEqual({ amount: 200000, currency: 'INR' });
    expect(p.priceMax).toEqual({ amount: 600000, currency: 'INR' });
  });

  it('makes checkout ask for the amount on a range, so the floor is never banked as the total', async () => {
    const servicePricing = await load();
    expect(servicePricing({ price_type: 'range', price_paise: 200000, price_max_paise: 600000 }).amountRequired).toBe(true);
  });

  it('carries the store currency through both ends of a band', async () => {
    const servicePricing = await load();
    const p = servicePricing({ price_type: 'range', price_paise: 1000, price_max_paise: 5000 }, 'USD');

    expect(p.price.currency).toBe('USD');
    expect(p.priceMax?.currency).toBe('USD');
  });

  it('reads a legacy unpriced row as unset rather than as free', async () => {
    const servicePricing = await load();
    const p = servicePricing({ price_type: 'unset', price_paise: 0, price_max_paise: null }, 'INR');

    expect(p.priceType).toBe('unset');
    expect(p.priceMax).toBeNull();
    // The zero is a carrier, not a price — deriving it would bank ₹0 as the day's takings.
    expect(p.amountRequired).toBe(true);
  });

  it('ignores a stray ceiling on a fixed row instead of rendering half a band', async () => {
    const servicePricing = await load();
    // The check constraint refuses this shape, but a row written before 0024 by a hand-run
    // update could still arrive; showing "₹350" beats showing "₹350–₹?".
    expect(servicePricing({ price_type: 'fixed', price_paise: 35000, price_max_paise: 60000 }).priceMax).toBeNull();
  });

  it('falls back to the pre-0024 rule when the column is absent', async () => {
    const servicePricing = await load();
    // A backend deployed ahead of its migration reads rows with no price_type at all. Priced
    // ⇒ fixed, unpriced ⇒ unset, which is what every surface assumed before this shipped.
    expect(servicePricing({ price_paise: 35000 }).priceType).toBe('fixed');
    expect(servicePricing({ price_paise: 0 }).priceType).toBe('unset');
  });

  it('accepts the string amounts pg returns for bigint-ish columns', async () => {
    const servicePricing = await load();
    const p = servicePricing({ price_type: 'range', price_paise: '200000', price_max_paise: '600000' }, 'INR');

    expect(p.price.amount).toBe(200000);
    expect(p.priceMax?.amount).toBe(600000);
  });
});
