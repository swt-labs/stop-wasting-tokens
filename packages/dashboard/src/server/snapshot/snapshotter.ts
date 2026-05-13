import path from 'node:path';

import type { Snapshot, SnapshotEvent } from '@swt-labs/shared';
import chokidar, { type FSWatcher } from 'chokidar';

import type { EventBus } from '../event-bus.js';

import { snapshotsEqual } from './diff.js';
import { createEventsTailer, type EventsTailer } from './events-tailer.js';
import { buildSnapshot } from './reducer.js';

/**
 * B-12: emit only the top-level snapshot keys that actually changed,
 * instead of the v1.6.0–v1.6.7 hardcoded `['phase', 'artifacts']`. Maps
 * snapshot fields to the SnapshotEvent.changed enum:
 *   phases       → 'phase' + 'artifacts' (phases contain artifacts)
 *   active_agents + recent_events → 'agents'
 *   cost_summary → 'cost'
 * Falls back to ['phase'] if nothing structurally changed (snapshotsEqual
 * returned false on a non-trivial diff that doesn't hit any of the buckets
 * above — e.g., generated_at timestamp drift). The schema requires .min(1)
 * on `changed`, so an empty array is invalid.
 */
function diffChangedKeys(
  prev: Snapshot,
  next: Snapshot,
): Array<'phase' | 'agents' | 'artifacts' | 'cost'> {
  const changed = new Set<'phase' | 'agents' | 'artifacts' | 'cost'>();
  if (JSON.stringify(prev.phases) !== JSON.stringify(next.phases)) {
    changed.add('phase');
    changed.add('artifacts');
  }
  if (
    JSON.stringify(prev.active_agents) !== JSON.stringify(next.active_agents) ||
    JSON.stringify(prev.recent_events) !== JSON.stringify(next.recent_events)
  ) {
    changed.add('agents');
  }
  if (JSON.stringify(prev.cost_summary) !== JSON.stringify(next.cost_summary)) {
    changed.add('cost');
  }
  if (changed.size === 0) {
    // Fallback for cases where snapshotsEqual returned false but no key-level
    // structural diff was detected (timestamp-only drifts shouldn't reach here
    // because snapshotsEqual filters generated_at, but be defensive).
    changed.add('phase');
  }
  return [...changed];
}

const WATCH_GLOBS = (projectRoot: string): string[] => [
  path.join(projectRoot, '.swt-planning', 'STATE.md'),
  path.join(projectRoot, '.swt-planning', 'ROADMAP.md'),
  path.join(projectRoot, '.swt-planning', 'PROJECT.md'),
  path.join(projectRoot, '.swt-planning', 'REQUIREMENTS.md'),
  path.join(projectRoot, '.swt-planning', 'CONTEXT.md'),
  path.join(projectRoot, '.swt-planning', 'phases'),
  // Plan 04-02 T2 — directories the new reducer reads. Chokidar v4 watches
  // directories recursively by default; the existing 25ms stability window
  // + 50ms debounce already coalesce burst writes.
  path.join(projectRoot, '.swt-planning', '.sessions'),
  path.join(projectRoot, '.swt-planning', '.metrics'),
  path.join(projectRoot, '.swt-planning', '.cook-controls'),
  path.join(projectRoot, '.swt-planning', '.events'),
];

export interface SnapshotterOptions {
  projectRoot: string;
  bus: EventBus;
  /** Override the FS-event coalesce window. Defaults to 50ms. */
  debounceMs?: number;
}

export interface Snapshotter {
  current(): Snapshot;
  close(): Promise<void>;
}

export function createSnapshotter(opts: SnapshotterOptions): Snapshotter {
  const { projectRoot, bus } = opts;
  const debounceMs = opts.debounceMs ?? 50;

  let cached: Snapshot = buildSnapshot(projectRoot);
  let pending: NodeJS.Timeout | null = null;

  // Chokidar v4 dropped built-in glob support — pass concrete file +
  // directory paths only. WATCH_GLOBS already returns concrete paths. The
  // `ignored` config accepts a regex or a predicate in v4 (the v2-era
  // glob form `'**/node_modules/**'` no longer matches). Keep the
  // `awaitWriteFinish` stability guard from v2 — the AC-03 500ms budget
  // accommodates the ~25ms delay.
  const watcher: FSWatcher = chokidar.watch(WATCH_GLOBS(projectRoot), {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 25, pollInterval: 10 },
    ignored: (filePath: string): boolean =>
      filePath.includes('/node_modules/') ||
      filePath.includes('/.git/') ||
      filePath.includes('/.cache/'),
  });

  const eventsTailer: EventsTailer = createEventsTailer({ projectRoot, bus });

  const tick = (): void => {
    pending = null;
    let next: Snapshot;
    try {
      next = buildSnapshot(projectRoot);
    } catch (err: unknown) {
      const errEvent: SnapshotEvent = {
        type: 'error',
        ts: new Date().toISOString(),
        code: 'E_REDUCER_FAILED',
        message: err instanceof Error ? err.message : String(err),
      };
      bus.publish(errEvent);
      return;
    }
    if (snapshotsEqual(cached, next)) return;
    const changed = diffChangedKeys(cached, next);
    cached = next;
    const evt: SnapshotEvent = {
      type: 'state.changed',
      ts: new Date().toISOString(),
      changed,
      snapshot: next,
    };
    bus.publish(evt);
  };

  const onFsEvent = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(tick, debounceMs);
  };

  watcher.on('add', onFsEvent);
  watcher.on('change', onFsEvent);
  watcher.on('unlink', onFsEvent);
  watcher.on('addDir', onFsEvent);
  watcher.on('unlinkDir', onFsEvent);

  return {
    current: () => cached,
    close: async () => {
      if (pending) clearTimeout(pending);
      pending = null;
      await watcher.close();
      await eventsTailer.close();
    },
  };
}
