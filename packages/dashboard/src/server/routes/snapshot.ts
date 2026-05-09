import type { Hono } from 'hono';

import { emptySnapshot } from '../snapshot/empty.js';
import type { Snapshotter } from '../snapshot/snapshotter.js';

/**
 * Registers `GET /api/snapshot` unconditionally. The getter is resolved on
 * each request so a snapshotter that lights up after a successful
 * `POST /api/init` is picked up without needing to re-register the route.
 * When the getter returns null, serve a synthetic snapshot with
 * `is_initialized: false` so the SPA can render the InitScreen instead of
 * treating the failure as a connectivity error.
 */
export function registerSnapshotRoute(app: Hono, getSnapshotter: () => Snapshotter | null): void {
  app.get('/api/snapshot', (c) => {
    const snapshotter = getSnapshotter();
    const snapshot = snapshotter ? snapshotter.current() : emptySnapshot();
    return c.json(snapshot);
  });
}
