import {
  CURRENT_VERSION,
  queryLatestVersion,
  type QueryOptions,
  type RegistryResult,
} from '@swt-labs/cli';
import type { UpdateReport } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

const PACKAGE_NAME = 'stop-wasting-tokens';

export interface RegisterUpdateRouteOptions {
  /** Test seam for fetch — defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Override `~/.swt/update-cache.json` location. */
  readonly cachePath?: string;
  /** Test seam for `Date.now()` (timestamp + cache TTL). */
  readonly now?: () => number;
  /**
   * Override the version we report as "current". Defaults to the
   * `CURRENT_VERSION` constant the CLI defines (build-time-substituted via
   * tsup `define`). Tests pin a known version so assertions are stable.
   */
  readonly currentVersion?: string;
  /** Allow disabling the on-disk cache — matches `swt update --no-cache`. */
  readonly noCache?: boolean;
}

/**
 * Registers `GET /api/update`. Mirrors the CLI's `swt update --json` data
 * access for the dashboard panel:
 *
 *   GET /api/update →
 *     {
 *       current_version,
 *       latest_version,            // null on registry error
 *       update_available,
 *       registry: 'npm',
 *       last_checked,
 *       error                      // null on success
 *     }
 *
 * Hits the npm registry with the CLI's existing 24 h on-disk cache (so a
 * 60 s panel refresh doesn't spam npmjs). Network failures are folded into
 * the response body — never crash the daemon, never 500. v2.3 ships
 * npm-only; the marketplace registry support the CLI added in 2.0.x is
 * out of scope here.
 */
export function registerUpdateRoute(app: Hono, opts: RegisterUpdateRouteOptions = {}): void {
  app.get('/api/update', async (c) => {
    const current = opts.currentVersion ?? CURRENT_VERSION;
    const queryOpts: QueryOptions = {
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.cachePath !== undefined ? { cachePath: opts.cachePath } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      ...(opts.noCache === true ? { noCache: true } : {}),
    };

    let result: RegistryResult;
    try {
      result = await queryLatestVersion(PACKAGE_NAME, current, queryOpts);
    } catch (err) {
      // queryLatestVersion already swallows failures into `status:
      // 'unreachable'`, but a defensive try/catch protects against
      // unexpected throws (file-system errors on the cache path, etc.).
      const message = err instanceof Error ? err.message : String(err);
      const response: UpdateReport = {
        current_version: current,
        latest_version: null,
        update_available: false,
        registry: 'npm',
        last_checked: new Date().toISOString(),
        error: message,
      };
      return c.json(response);
    }

    const response: UpdateReport =
      result.status === 'unreachable'
        ? {
            current_version: result.current,
            latest_version: null,
            update_available: false,
            registry: 'npm',
            last_checked: new Date().toISOString(),
            error: result.error ?? 'registry unreachable',
          }
        : {
            current_version: result.current,
            latest_version: result.latest,
            update_available: result.status === 'outdated',
            registry: 'npm',
            last_checked: new Date().toISOString(),
            error: null,
          };
    return c.json(response);
  });
}
