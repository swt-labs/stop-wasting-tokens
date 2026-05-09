import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import type { Snapshot, SnapshotEvent } from '@swt-labs/dashboard-core';

import type { EventBus } from '../event-bus.js';
import { snapshotsEqual } from './diff.js';
import { createEventsTailer, type EventsTailer } from './events-tailer.js';
import { buildSnapshot } from './reducer.js';

const WATCH_GLOBS = (projectRoot: string): string[] => [
  path.join(projectRoot, '.swt-planning', 'STATE.md'),
  path.join(projectRoot, '.swt-planning', 'ROADMAP.md'),
  path.join(projectRoot, '.swt-planning', 'PROJECT.md'),
  path.join(projectRoot, '.swt-planning', 'REQUIREMENTS.md'),
  path.join(projectRoot, '.swt-planning', 'CONTEXT.md'),
  path.join(projectRoot, '.swt-planning', 'phases'),
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

  const watcher: FSWatcher = chokidar.watch(WATCH_GLOBS(projectRoot), {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 25, pollInterval: 10 },
    ignored: ['**/node_modules/**', '**/.git/**', '**/.cache/**'],
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
    cached = next;
    const evt: SnapshotEvent = {
      type: 'state.changed',
      ts: new Date().toISOString(),
      changed: ['phase', 'artifacts'],
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
