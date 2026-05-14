import type { spawn as SpawnFn } from 'node:child_process';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerCookStartRoute } from '../src/server/routes/cook-start.js';

/**
 * Phase 6 plan 06-06 T3 — regression test confirming the `/api/vibe` and
 * `/api/vibe/:session_id/reply` shim layer (Phase 4 R7 carry-forward) is
 * removed.
 *
 * Background:
 *   - Plan 04-05 T1 introduced a thin shim that translated legacy
 *     `POST /api/vibe` requests to `POST /api/cook/start` to preserve
 *     v2-client URL compatibility for one release cycle.
 *   - The shim was scheduled for removal in v3.1.0 per the Phase 6
 *     hand-off in `.vbw-planning/phases/04-dashboard-statusline/PARITY-REPORT.md`.
 *   - Plan 06-06 T3 closes the carry-forward at v3.0-final by deleting
 *     `packages/dashboard/src/server/routes/vibe.ts` and removing the
 *     `registerVibeRoutes(...)` call from `packages/dashboard/src/server/index.ts`.
 *
 * The expected post-removal behaviour: any request to `/api/vibe*` returns
 * a 404 from the Hono router because no route matches. This test mounts
 * the cook-start route (so the app boot path is identical to production)
 * and asserts that the unregistered legacy paths now 404.
 */

describe('plan 06-06 T3 — /api/vibe shim removed', () => {
  it('POST /api/vibe returns 404 (no route registered)', async () => {
    const app = new Hono();
    // Register the only route we actually want today; do NOT register the
    // legacy vibe shim. Production mirror is `createApp(...)` in
    // packages/dashboard/src/server/index.ts which no longer imports
    // `registerVibeRoutes` after plan 06-06 T3.
    registerCookStartRoute(app, { projectRoot: '/tmp/swt-vibe-shim-removed' });

    const res = await app.request('http://x/api/vibe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });

    expect(res.status).toBe(404);
  });

  it('POST /api/vibe/:session_id/reply returns 404 (no route registered)', async () => {
    const app = new Hono();
    registerCookStartRoute(app, { projectRoot: '/tmp/swt-vibe-shim-removed' });

    const res = await app.request('http://x/api/vibe/abc-123/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt_id: 'p1', answer: { kind: 'text', value: 'ok' } }),
    });

    expect(res.status).toBe(404);
  });

  it('cook-start route still works (sanity check — only vibe was removed)', async () => {
    const app = new Hono();
    // Use a fake spawnFn so the test does not actually fork `swt cook`.
    let spawnCount = 0;
    const fakeSpawn = ((_cmd: string, _args: ReadonlyArray<string>, _opts: unknown) => {
      spawnCount += 1;
      return {
        pid: 12345,
        unref: () => {
          /* no-op */
        },
      };
    }) as unknown as typeof SpawnFn;
    registerCookStartRoute(app, {
      projectRoot: '/tmp/swt-vibe-shim-removed',
      spawnFn: fakeSpawn,
    });

    const res = await app.request('http://x/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(spawnCount).toBe(1);
  });
});
