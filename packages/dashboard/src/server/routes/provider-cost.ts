import { computeCostByProvider, type CostByProvider, type TokenMeter } from '@swt-labs/runtime';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

/**
 * `GET /api/provider-cost/sse` — live per-provider cost attribution
 * per TDD2 §12.3.4 + Plan 05-01 PR-43.
 *
 * Accepts a `getMeter: () => TokenMeter | null` getter at registration
 * (symmetric with PR-33's cache-hit route and PR-35's budget route).
 * Returns empty rows when the meter isn't wired (greenfield daemon).
 * Re-emits on every `METER_UPDATED` event so the panel reflects
 * fallback-chain transitions in real time.
 */

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface ProviderCostFrame {
  readonly type: 'provider-cost.snapshot';
  readonly ts: string;
  readonly rows: ReadonlyArray<CostByProvider>;
}

export function registerProviderCostRoute(app: Hono, getMeter: () => TokenMeter | null): void {
  app.get('/api/provider-cost/sse', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const emit = async (): Promise<void> => {
        if (closed) return;
        const meter = getMeter();
        const rows = meter !== null ? computeCostByProvider(meter.snapshot()) : [];
        const frame: ProviderCostFrame = {
          type: 'provider-cost.snapshot',
          ts: new Date().toISOString(),
          rows,
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

      await emit();

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
