import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// v2.3.5: shorter default for background pollers (dashboard /api/update) so
// active sessions don't see stale `latest` for hours after a release. The
// CLI's `swt update` defaults to `noCache: true` (no cache at all), so the
// CACHE_TTL_MS only matters when `cacheTtlMs` is not overridden.
export const SHORT_CACHE_TTL_MS = 5 * 60 * 1000;

export type RegistryStatus = 'up-to-date' | 'outdated' | 'unreachable';

export interface RegistryResult {
  current: string;
  latest: string;
  status: RegistryStatus;
  error?: string;
  cached?: boolean;
}

export interface QueryOptions {
  registry?: string;
  cachePath?: string;
  noCache?: boolean;
  /**
   * Cache TTL in milliseconds. Defaults to 24 hours. Background pollers
   * (e.g. the dashboard `/api/update` route) should pass a shorter value
   * like `SHORT_CACHE_TTL_MS` (5 min) so active sessions don't see stale
   * `latest` for long after a real release. Has no effect when
   * `noCache: true`.
   */
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function defaultCachePath(): string {
  return join(homedir(), '.swt', 'update-cache.json');
}

export async function queryLatestVersion(
  packageName: string,
  current: string,
  opts: QueryOptions = {},
): Promise<RegistryResult> {
  const cachePath = opts.cachePath ?? defaultCachePath();
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const fetchFn = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  const ttl = opts.cacheTtlMs ?? CACHE_TTL_MS;
  if (!opts.noCache && existsSync(cachePath)) {
    try {
      const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<
        string,
        { at: number; value: { current: string; latest: string; status: RegistryStatus } }
      >;
      const entry = cache[packageName];
      // Cache hit is valid only when both:
      //   1. TTL has not elapsed.
      //   2. The cached snapshot was written for the SAME installed version
      //      (`current`). Without this guard, a cache written when the user
      //      was on v2.0.2 would still satisfy the TTL after they upgrade
      //      to v2.3.1, returning the morning's `latest: 2.0.2` +
      //      `status: up-to-date` — flatly wrong. Re-querying after a
      //      version change is cheap and matches the user's mental model
      //      ("I just upgraded; tell me if there's anything newer").
      if (entry && now() - entry.at < ttl && entry.value.current === current) {
        return { ...entry.value, current, cached: true };
      }
    } catch {
      // corrupted cache — fall through to fresh query
    }
  }

  const url = `${registry}/${encodeURIComponent(packageName)}/latest`;

  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      return {
        current,
        latest: current,
        status: 'unreachable',
        error: `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as { version: string };
    const latest = json.version;
    const status: RegistryStatus = latest === current ? 'up-to-date' : 'outdated';
    const result: RegistryResult = { current, latest, status };

    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      const existing = existsSync(cachePath)
        ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>)
        : {};
      (existing as Record<string, { at: number; value: typeof result }>)[packageName] = {
        at: now(),
        value: result,
      };
      writeFileSync(cachePath, JSON.stringify(existing, null, 2) + '\n');
    } catch {
      // cache write failure — return result regardless
    }

    return result;
  } catch (err) {
    return {
      current,
      latest: current,
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
