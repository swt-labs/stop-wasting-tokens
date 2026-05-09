import { DebugEmitBodySchema, type DebugEmitResponse } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

import type { EventBus } from '../event-bus.js';

/**
 * Spike-only route. Lets a vitest test (or a curl one-liner) inject a fake
 * SnapshotEvent so the SSE channel can be smoke-tested end-to-end without
 * the chokidar watcher (Phase 02) being wired yet. Remove in Phase 02 once
 * the real watcher is producing events.
 */
export function registerDebugEmitRoute(app: Hono, bus: EventBus): void {
  app.post('/api/_debug/emit', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = DebugEmitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_event', details: parsed.error.flatten() }, 400);
    }
    bus.publish(parsed.data);
    const response: DebugEmitResponse = { queued: true };
    return c.json(response);
  });
}
