import type { Snapshot, SnapshotEvent } from '@swt-labs/shared';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { EventBus } from '../event-bus.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
// B-10: cap the in-memory queue to prevent unbounded growth when the bus
// emits faster than the SSE consumer drains. 1000 entries × ~500 bytes/event
// = ~500KB worst case per connected client.
const MAX_QUEUE = 1000;

export function registerEventsRoute(
  app: Hono,
  bus: EventBus,
  /**
   * Resolves the current snapshot for the SSE initial-frame replay (B-09).
   * Returns null when no snapshotter is attached (greenfield daemon); in
   * that case we skip the initial frame and clients fall back to their
   * existing fetchSnapshot bootstrap.
   */
  getSnapshot: () => Snapshot | null = () => null,
): void {
  app.get('/api/events', (c) => {
    // v2.0: optional ?session_id= filter. When present, only events that
    // either have no session_id (global) or have a matching session_id
    // (vibe session events) reach this client. Absent param = legacy
    // firehose behavior (all events delivered to all clients).
    const sessionFilter = c.req.query('session_id') ?? null;
    const matchesSession = (event: SnapshotEvent): boolean => {
      if (sessionFilter === null) return true;
      const evtSessionId = (event as { session_id?: unknown }).session_id;
      if (typeof evtSessionId !== 'string') return true; // global event, always pass
      return evtSessionId === sessionFilter;
    };

    return streamSSE(c, async (stream) => {
      const queue: SnapshotEvent[] = [];
      let resolveNext: ((event: SnapshotEvent | null) => void) | null = null;
      let closed = false;
      let overflowEmitted = false;

      // B-09: initial-frame replay — write a snapshot.replace before the
      // event loop starts so reconnecting clients can drop their post-open
      // fetchSnapshot bootstrap call. Skip when no snapshotter is attached
      // (greenfield daemon) — clients still fetchSnapshot in that case.
      const initialSnapshot = getSnapshot();
      if (initialSnapshot !== null) {
        const initialFrame: SnapshotEvent = {
          type: 'snapshot.replace',
          ts: new Date().toISOString(),
          snapshot: initialSnapshot,
        };
        await stream.writeSSE({
          event: initialFrame.type,
          data: JSON.stringify(initialFrame),
        });
      }

      const unsubscribe = bus.subscribe((event) => {
        if (closed) return;
        if (!matchesSession(event)) return;
        if (resolveNext) {
          const fn = resolveNext;
          resolveNext = null;
          fn(event);
        } else {
          // B-10: queue cap — drop the oldest non-error event and emit one
          // synthetic E_QUEUE_OVERFLOW error event per session so the client
          // knows it lost data without flooding stderr on every overflow.
          if (queue.length >= MAX_QUEUE) {
            const dropIdx = queue.findIndex((e) => e.type !== 'error');
            if (dropIdx >= 0) queue.splice(dropIdx, 1);
            if (!overflowEmitted) {
              overflowEmitted = true;
              queue.push({
                type: 'error',
                ts: new Date().toISOString(),
                code: 'E_QUEUE_OVERFLOW',
                message: `Event queue exceeded ${MAX_QUEUE} pending events; oldest non-error events dropped.`,
              });
            }
          }
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
