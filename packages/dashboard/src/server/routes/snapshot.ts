import type { Hono } from 'hono';

import { detectBrownfield } from '../lib/detect-brownfield.js';
import { emptySnapshot } from '../snapshot/empty.js';
import type { Snapshotter } from '../snapshot/snapshotter.js';

/**
 * Registers `GET /api/snapshot` unconditionally. The getter is resolved on
 * each request so a snapshotter that lights up after a successful
 * `POST /api/init` is picked up without needing to re-register the route.
 * When the getter returns null, serve a synthetic snapshot with
 * `is_initialized: false` so the SPA can render the InitScreen instead of
 * treating the failure as a connectivity error.
 *
 * `cwd` is the directory the daemon was launched from — used once at
 * registration to detect whether this is a brownfield project (existing
 * source files but no `.swt-planning/`) so the InitScreen can adapt its
 * copy. Daemon cwd doesn't change for the process's lifetime, so caching
 * the detection here is correct.
 */
export function registerSnapshotRoute(
  app: Hono,
  getSnapshotter: () => Snapshotter | null,
  cwd: string,
): void {
  const brownfield = detectBrownfield(cwd);
  app.get('/api/snapshot', (c) => {
    const snapshotter = getSnapshotter();
    const snapshot = snapshotter ? snapshotter.current() : emptySnapshot(brownfield);
    return c.json(snapshot);
  });
}
