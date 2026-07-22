import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTtlCache } from '../../src/lib/ttl-cache';

describe('createTtlCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined on miss', () => {
    const cache = createTtlCache<string>(5_000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns the value on hit within TTL', () => {
    const cache = createTtlCache<{ n: number }>(5_000);
    cache.set('a', { n: 1 });
    expect(cache.get('a')).toEqual({ n: 1 });
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    const cache = createTtlCache<string>(5_000);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');

    vi.advanceTimersByTime(4_999);
    expect(cache.get('k')).toBe('v');

    vi.advanceTimersByTime(1);
    expect(cache.get('k')).toBeUndefined();
  });

  it('overwrites an existing key and resets TTL', () => {
    vi.useFakeTimers();
    const cache = createTtlCache<string>(5_000);
    cache.set('k', 'first');
    vi.advanceTimersByTime(4_000);
    cache.set('k', 'second');
    vi.advanceTimersByTime(4_000);
    expect(cache.get('k')).toBe('second');
    vi.advanceTimersByTime(1_000);
    expect(cache.get('k')).toBeUndefined();
  });

  it('clear removes all entries', () => {
    const cache = createTtlCache<number>(5_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
