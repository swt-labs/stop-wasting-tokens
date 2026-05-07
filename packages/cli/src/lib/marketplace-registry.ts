import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { z } from 'zod';

const DEFAULT_CACHE_TTL_HOURS = 24;
const DEFAULT_TIMEOUT_MS = 5000;

export interface MarketplaceQueryOptions {
  readonly endpoint: string;
  readonly packageName: string;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly noCache?: boolean;
  readonly cachePath?: string;
  readonly now?: () => number;
  readonly cacheTtlHours?: number;
  readonly timeoutMs?: number;
}

export interface MarketplaceVersion {
  readonly version: string;
  readonly source: 'marketplace';
  readonly fetchedAt: number;
  readonly fromCache: boolean;
}

export class MarketplaceQueryError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'MarketplaceQueryError';
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

const MarketplaceResponseSchema = z.object({
  latest_version: z.string().min(1),
});

export function defaultMarketplaceCachePath(): string {
  return join(homedir(), '.swt', 'marketplace-cache.json');
}

interface CacheEntry {
  at: number;
  version: string;
}

type CacheShape = Record<string, CacheEntry>;

function readCache(cachePath: string): CacheShape {
  if (!existsSync(cachePath)) return {};
  try {
    const raw = readFileSync(cachePath, 'utf8');
    return JSON.parse(raw) as CacheShape;
  } catch {
    return {};
  }
}

function writeCache(cachePath: string, cache: CacheShape): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
  } catch {
    // cache write failure — non-fatal
  }
}

function cacheKey(endpoint: string, packageName: string): string {
  return `${endpoint}#${packageName}`;
}

export async function queryMarketplaceVersion(
  opts: MarketplaceQueryOptions,
): Promise<MarketplaceVersion> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const cachePath = opts.cachePath ?? defaultMarketplaceCachePath();
  const now = opts.now ?? Date.now;
  const ttlHours = opts.cacheTtlHours ?? DEFAULT_CACHE_TTL_HOURS;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const key = cacheKey(opts.endpoint, opts.packageName);

  if (opts.noCache !== true) {
    const cache = readCache(cachePath);
    const entry = cache[key];
    if (entry !== undefined && now() - entry.at < ttlMs) {
      return {
        version: entry.version,
        source: 'marketplace',
        fetchedAt: entry.at,
        fromCache: true,
      };
    }
  }

  const url = `${opts.endpoint.replace(/\/$/, '')}/${encodeURIComponent(opts.packageName)}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new MarketplaceQueryError(
      `Marketplace fetch failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new MarketplaceQueryError(
      `Marketplace responded ${response.status} ${response.statusText}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new MarketplaceQueryError('Marketplace returned non-JSON body', { cause });
  }

  const parsed = MarketplaceResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new MarketplaceQueryError('Marketplace response missing required fields', {
      cause: parsed.error,
    });
  }

  const fetchedAt = now();
  const result: MarketplaceVersion = {
    version: parsed.data.latest_version,
    source: 'marketplace',
    fetchedAt,
    fromCache: false,
  };

  const cache = readCache(cachePath);
  cache[key] = { at: fetchedAt, version: result.version };
  writeCache(cachePath, cache);

  return result;
}
