import type { Hono } from 'hono';

import type { Snapshotter } from '../snapshot/snapshotter.js';

export function registerSnapshotRoute(app: Hono, snapshotter: Snapshotter): void {
  app.get('/api/snapshot', (c) => {
    const snapshot = snapshotter.current();
    return c.json(snapshot);
  });
}
