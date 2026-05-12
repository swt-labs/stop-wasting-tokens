import type { TokenMeter } from '@swt-labs/runtime';
import { computeCacheHitRatio, type CacheHitSummary } from '@swt-labs/runtime';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

/**
 * `GET /api/cache-hits/sse` — live cache-hit ratio per provider per
 * TDD2 §12.3.2 + Plan 04-01 PR-33.
 *
 * The route accepts a `getMeter: () => TokenMeter | null` getter so the
 * dashboard server can register the route before the methodology layer
 * has a meter to subscribe to (greenfield daemon). When `getMeter()`
 * returns null, the route emits a single `cache-hit.snapshot` frame
 * with an empty summary array and keeps the connection open via
 * heartbeat — the panel renders an empty state.
 *
 * When the meter is wired (M4 plumbing follow-up, separate from this
 * route's mechanics), the route subscribes to `METER_UPDATED` events
 * and re-emits a recomputed `CacheHitSummary[]` frame on every tick.
 * No throttling — cache-hit ratio moves slowly, and Pi turns happen
 * at ~5-30s cadence.
 *
 * Empty state is the correct UX for a fresh project or any project
 * before its first session.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface CacheHitSnapshotFrame {
  readonly type: 'cache-hit.snapshot';
  readonly ts: string;
  readonly summaries: ReadonlyArray<CacheHitSummary>;
}

export function registerCacheHitsRoute(app: Hono, getMeter: () => TokenMeter | null): void {
  app.get('/api/cache-hits/sse', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const emit = async (): Promise<void> => {
        if (closed) return;
        const meter = getMeter();
        const summaries = meter !== null ? computeCacheHitRatio(meter.snapshot()) : [];
        const frame: CacheHitSnapshotFrame = {
          type: 'cache-hit.snapshot',
          ts: new Date().toISOString(),
          summaries,
        };
        await stream.writeSSE({
          event: frame.type,
          data: JSON.stringify(frame),
        });
      };

      const finish = (): void => {
        if (closed) return;
        closed = true;
        if (unsubscribe !== null) {
          unsubscribe();
          unsubscribe = null;
        }
      };

      stream.onAbort(finish);

      // Initial frame on connect (covers the empty + populated cases).
      await emit();

      // Wire to the live meter when one is available. Re-emit on every
      // METER_UPDATED tick.
      const initialMeter = getMeter();
      if (initialMeter !== null) {
        unsubscribe = initialMeter.subscribe(() => {
          void emit();
        });
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        stream.writeSSE({ data: '', event: 'keep-alive' }).catch(() => finish());
      }, HEARTBEAT_INTERVAL_MS);

      // Keep the stream open until aborted. Polling sleep is cheap.
      try {
        while (!closed) {
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        clearInterval(heartbeat);
        finish();
      }
    }),
  );
}
