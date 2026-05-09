import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { SnapshotEvent } from '@swt-labs/dashboard-core';

import type { EventBus } from '../event-bus.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

export function registerEventsRoute(app: Hono, bus: EventBus): void {
  app.get('/api/events', (c) => {
    return streamSSE(c, async (stream) => {
      const queue: SnapshotEvent[] = [];
      let resolveNext: ((event: SnapshotEvent | null) => void) | null = null;
      let closed = false;

      const unsubscribe = bus.subscribe((event) => {
        if (closed) return;
        if (resolveNext) {
          const fn = resolveNext;
          resolveNext = null;
          fn(event);
        } else {
          queue.push(event);
        }
      });

      const finish = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (resolveNext) {
          resolveNext(null);
          resolveNext = null;
        }
      };

      stream.onAbort(finish);

      const heartbeat = setInterval(() => {
        if (closed) return;
        stream.writeSSE({ data: '', event: 'keep-alive' }).catch(() => finish());
      }, HEARTBEAT_INTERVAL_MS);

      try {
        while (!closed) {
          let nextEvent: SnapshotEvent | null;
          const queued = queue.shift();
          if (queued) {
            nextEvent = queued;
          } else {
            nextEvent = await new Promise<SnapshotEvent | null>((resolve) => {
              resolveNext = resolve;
            });
          }
          if (!nextEvent) break;
          await stream.writeSSE({
            event: nextEvent.type,
            data: JSON.stringify(nextEvent),
          });
        }
      } finally {
        clearInterval(heartbeat);
        finish();
      }
    });
  });
}
