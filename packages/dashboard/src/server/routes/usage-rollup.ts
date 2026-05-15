/**
 * Plan 01-01 T3 (milestone 08, Phase 01) — `GET /api/usage-rollup`.
 *
 * Plain-JSON (NOT SSE) Hono route that returns the current
 * `UsageRollup` from the in-memory aggregator. Response shape mirrors
 * `UsageRollupSchema` exactly so external consumers (CLI tooling,
 * future `swt usage` verb, etc.) can validate against the shared
 * schema.
 *
 * Status code is ALWAYS 200 — even when both windows are null
 * (empty-state convention per Scout Q7, matching `scanCostSummary`:
 * the data is intentionally absent, not the endpoint).
 *
 * Wiring note (Plan 01-01 Decision 9): this module only creates the
 * route factory. The dashboard server entrypoint instantiation of the
 * aggregator + mount of this route is out of scope for Phase 01 (would
 * require >5 LOC across the entrypoint + lifecycle). Phase 02 / the
 * statusline UI wiring can mount the route alongside aggregator
 * instantiation in a single dedicated commit.
 */

import { Hono } from 'hono';

import type { UsageAggregator } from '../usage-aggregator.js';

export interface UsageRollupRouteOptions {
  /** Anything with a `.compute()` returning the current rollup. */
  readonly aggregator: Pick<UsageAggregator, 'compute'>;
}

export function createUsageRollupRoute(opts: UsageRollupRouteOptions): Hono {
  const app = new Hono();
  app.get('/api/usage-rollup', (c) => {
    const result = opts.aggregator.compute();
    // Always 200; empty state returns { window_7d: null, window_30d: null,
    // generated_at } per UsageRollupSchema (the aggregator handles that shape).
    return c.json(result);
  });
  return app;
}
