import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MarketplaceQueryError,
  queryMarketplaceVersion,
} from '../../src/lib/marketplace-registry.js';

let tempDir: string;
let cachePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'swt-marketplace-'));
  cachePath = join(tempDir, 'marketplace-cache.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function fetchReturning(body: unknown, ok = true, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  }) as typeof globalThis.fetch;
}

describe('queryMarketplaceVersion', () => {
  it('happy path: stub fetch returns latest_version → MarketplaceVersion result', async () => {
    const fetchMock = fetchReturning({ latest_version: '1.2.3' });
    const result = await queryMarketplaceVersion({
      endpoint: 'https://stub-marketplace.test',
      packageName: '@swt-labs/cli',
      fetchImpl: fetchMock,
      cachePath,
      now: () => 1000,
    });

    expect(result.version).toBe('1.2.3');
    expect(result.source).toBe('marketplace');
    expect(result.fromCache).toBe(false);
    expect(result.fetchedAt).toBe(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(cache['https://stub-marketplace.test#@swt-labs/cli']).toEqual({
      at: 1000,
      version: '1.2.3',
    });
  });

  it('cache hit within TTL → fromCache: true; fetch not called', async () => {
    // Pre-populate cache
    const fetchMock1 = fetchReturning({ latest_version: '1.2.3' });
    await queryMarketplaceVersion({
      endpoint: 'https://stub.test',
      packageName: 'pkg',
      fetchImpl: fetchMock1,
      cachePath,
      now: () => 1000,
    });

    const fetchMock2 = vi.fn();
    const result = await queryMarketplaceVersion({
      endpoint: 'https://stub.test',
      packageName: 'pkg',
      fetchImpl: fetchMock2,
      cachePath,
      now: () => 1500, // within TTL of 24h
    });

    expect(result.version).toBe('1.2.3');
    expect(result.fromCache).toBe(true);
    expect(fetchMock2).not.toHaveBeenCalled();
  });

  it('cache stale (now > fetchedAt + ttl) → fetch called, cache refreshed', async () => {
    const fetchMock1 = fetchReturning({ latest_version: '1.2.3' });
    await queryMarketplaceVersion({
      endpoint: 'https://stub.test',
      packageName: 'pkg',
      fetchImpl: fetchMock1,
      cachePath,
      now: () => 1000,
      cacheTtlHours: 1,
    });

    const fetchMock2 = fetchReturning({ latest_version: '2.0.0' });
    const result = await queryMarketplaceVersion({
      endpoint: 'https://stub.test',
      packageName: 'pkg',
      fetchImpl: fetchMock2,
      cachePath,
      now: () => 1000 + 2 * 60 * 60 * 1000, // 2h later, exceeds 1h TTL
      cacheTtlHours: 1,
    });

    expect(result.version).toBe('2.0.0');
    expect(result.fromCache).toBe(false);
    expect(fetchMock2).toHaveBeenCalledTimes(1);
  });

  it('non-2xx response → MarketplaceQueryError thrown', async () => {
    const fetchMock = fetchReturning({}, false, 500);

    await expect(
      queryMarketplaceVersion({
        endpoint: 'https://stub.test',
        packageName: 'pkg',
        fetchImpl: fetchMock,
        cachePath,
        now: () => 1000,
      }),
    ).rejects.toThrow(MarketplaceQueryError);
  });

  it('malformed JSON (missing latest_version) → MarketplaceQueryError', async () => {
    const fetchMock = fetchReturning({ wrong_field: 'x' });

    await expect(
      queryMarketplaceVersion({
        endpoint: 'https://stub.test',
        packageName: 'pkg',
        fetchImpl: fetchMock,
        cachePath,
        now: () => 1000,
      }),
    ).rejects.toThrow(MarketplaceQueryError);
  });
});
