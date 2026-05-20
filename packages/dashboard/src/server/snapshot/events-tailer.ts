import path from 'node:path';

import { SnapshotEventSchema, type SnapshotEvent } from '@swt-labs/shared';

import type { EventBus } from '../event-bus.js';
import { createFileTailer, type FileTailer } from '../lib/tail-file.js';

export interface EventsTailerOptions {
  projectRoot: string;
  bus: EventBus;
  /** Override the log.append rate limit. Default 100 lines/sec. */
  logRateLimitPerSec?: number;
  /** Override clock for tests. */
  now?: () => number;
}

export interface EventsTailer {
  close(): Promise<void>;
  /**
   * Resolves once the underlying chokidar watcher's initial scan has
   * completed. Tests that write event JSONL files immediately after
   * construction MUST await this before expecting the bus to publish.
   */
  readonly ready: Promise<void>;
}

const DEFAULT_LOG_RATE_LIMIT = 100;
const RATE_LIMIT_WINDOW_MS = 1000;

/**
 * Watch `.swt-planning/.events/*.jsonl` for append-only writes. Each line is
 * parsed as JSON, validated against {@link SnapshotEventSchema}, and
 * published through the dashboard's in-process EventBus (which the SSE route
 * already subscribes to). Invalid JSON or schema violations are skipped — a
 * single corrupt line must not stop event delivery for the rest of the
 * session's events.
 */
export function createEventsTailer(options: EventsTailerOptions): EventsTailer {
  const { projectRoot, bus } = options;
  const limit = options.logRateLimitPerSec ?? DEFAULT_LOG_RATE_LIMIT;
  const now = options.now ?? (() => Date.now());
  const eventsGlob = path.join(projectRoot, '.swt-planning', '.events', '*.jsonl');

  let windowStart = now();
  let consumed = 0;
  let droppedSinceFlush = 0;

  const flushDropNotice = (): void => {
    if (droppedSinceFlush <= 0) return;
    const synthetic: SnapshotEvent = {
      type: 'log.append',
      ts: new Date(now()).toISOString(),
      channel: 'stderr',
      line: `[swt] ${droppedSinceFlush} log lines dropped due to rate limit`,
    };
    bus.publish(synthetic);
    droppedSinceFlush = 0;
  };

  const allowLogAppend = (): boolean => {
    const t = now();
    if (t - windowStart >= RATE_LIMIT_WINDOW_MS) {
      flushDropNotice();
      windowStart = t;
      consumed = 0;
    }
    if (consumed >= limit) {
      droppedSinceFlush += 1;
      return false;
    }
    consumed += 1;
    return true;
  };

  const tailer: FileTailer = createFileTailer({
    pattern: eventsGlob,
    onLine: (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // skip corrupt JSON
      }
      const result = SnapshotEventSchema.safeParse(parsed);
      if (!result.success) return; // skip schema violations (e.g. CLI uses different shape)
      const event: SnapshotEvent = result.data;
      // alpha.47 — chat.* lines on disk are the route's own write
      // shadow (`chat.ts emit()` directly calls `bus.publish(evt)` AND
      // appends to `chat-<id>.jsonl`). Republishing them through the
      // tailer here would double-fire every chat event for every
      // connected SSE client. Skip the tailer republish for chat.* —
      // the on-disk channel exists ONLY to support `GET /api/chat/history`
      // (boot-time rehydration); live fan-out runs through bus.publish
      // already.
      if (event.type.startsWith('chat.')) return;
      if (event.type === 'log.append' && !allowLogAppend()) return;
      bus.publish(event);
    },
  });

  return {
    ready: tailer.ready,
    close: async () => {
      flushDropNotice();
      await tailer.close();
    },
  };
}
