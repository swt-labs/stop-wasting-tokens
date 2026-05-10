import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { queryLatestVersion } from '../../src/lib/npm-registry.js';

function makeCacheFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swt-cache-'));
  return join(dir, 'update-cache.json');
}

function fakeFetch(version: string): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ version }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

describe('queryLatestVersion cache invalidation', () => {
  it('returns the cached value when current matches and TTL is fresh', async () => {
    const cachePath = makeCacheFile();
    mkdirSync(join(cachePath, '..'), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        'stop-wasting-tokens': {
          at: 1_000_000,
          value: { current: '2.3.1', latest: '2.3.1', status: 'up-to-date' },
        },
      }),
    );

    let fetchCalls = 0;
    const result = await queryLatestVersion('stop-wasting-tokens', '2.3.1', {
      cachePath,
      now: () => 1_000_500, // 500ms later, well within TTL
      fetchImpl: ((..._args: unknown[]) => {
        fetchCalls++;
        throw new Error('should not have been called');
      }) as unknown as typeof fetch,
    });

    expect(result.cached).toBe(true);
    expect(result.latest).toBe('2.3.1');
    expect(result.status).toBe('up-to-date');
    expect(fetchCalls).toBe(0);
  });

  it('invalidates the cache when the installed version differs from the cached current', async () => {
    // Regression for v2.3.3: a cache entry written when the user was on
    // 2.0.2 was being returned after they upgraded to 2.3.1 because the
    // freshness check only compared TTL, not `current`. Result: `swt
    // update` reported `up-to-date (v2.3.1)` while npm latest was 2.3.2.
    const cachePath = makeCacheFile();
    mkdirSync(join(cachePath, '..'), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        'stop-wasting-tokens': {
          at: 1_000_000,
          value: { current: '2.0.2', latest: '2.0.2', status: 'up-to-date' },
        },
      }),
    );

    let fetchCalls = 0;
    const result = await queryLatestVersion('stop-wasting-tokens', '2.3.1', {
      cachePath,
      now: () => 1_000_500,
      fetchImpl: ((..._args: unknown[]) => {
        fetchCalls++;
        return Promise.resolve(
          new Response(JSON.stringify({ version: '2.3.2' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }) as unknown as typeof fetch,
    });

    expect(fetchCalls).toBe(1);
    expect(result.cached).toBeUndefined();
    expect(result.current).toBe('2.3.1');
    expect(result.latest).toBe('2.3.2');
    expect(result.status).toBe('outdated');
  });

  it('invalidates the cache when TTL has elapsed (current matches)', async () => {
    const cachePath = makeCacheFile();
    mkdirSync(join(cachePath, '..'), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        'stop-wasting-tokens': {
          at: 1_000_000,
          value: { current: '2.3.1', latest: '2.3.1', status: 'up-to-date' },
        },
      }),
    );

    const result = await queryLatestVersion('stop-wasting-tokens', '2.3.1', {
      cachePath,
      now: () => 1_000_000 + 25 * 60 * 60 * 1000, // 25h later
      fetchImpl: fakeFetch('2.3.2'),
    });

    expect(result.cached).toBeUndefined();
    expect(result.latest).toBe('2.3.2');
    expect(result.status).toBe('outdated');
  });

  it('rewrites the cache with the new current/latest pair after a fresh query', async () => {
    const cachePath = makeCacheFile();
    mkdirSync(join(cachePath, '..'), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        'stop-wasting-tokens': {
          at: 1_000_000,
          value: { current: '2.0.2', latest: '2.0.2', status: 'up-to-date' },
        },
      }),
    );

    await queryLatestVersion('stop-wasting-tokens', '2.3.1', {
      cachePath,
      now: () => 1_000_500,
      fetchImpl: fakeFetch('2.3.2'),
    });

    const { readFileSync } = await import('node:fs');
    const updatedCache = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<
      string,
      { at: number; value: { current: string; latest: string; status: string } }
    >;
    expect(updatedCache['stop-wasting-tokens']?.value.current).toBe('2.3.1');
    expect(updatedCache['stop-wasting-tokens']?.value.latest).toBe('2.3.2');
    expect(updatedCache['stop-wasting-tokens']?.value.status).toBe('outdated');
  });
});
