/**
 * Budget Gate dashboard routes per TDD2 §12.3.3 + Plan 04-01 PR-35.
 *
 *   - `GET /api/budget/sse` — live `BudgetGateState` stream. Emits a
 *     `budget.snapshot` initial frame with the current state, then
 *     re-emits a fresh snapshot on every `budget.warning` / `budget.pause`
 *     / `budget.resume` event from the gate.
 *   - `POST /api/budget/bump` — accepts `{delta_usd: number}` and calls
 *     `gate.bumpCeiling(delta_usd)`. Returns the new state.
 *
 * Both routes take a `getGate: () => BudgetGate | null` getter so the
 * dashboard server can register before the methodology layer has wired
 * a live gate (greenfield daemon). When null, `/api/budget/sse` keeps
 * the connection open with a heartbeat + empty snapshot; the panel
 * renders an empty state. `/api/budget/bump` returns 503.
 */

import type { BudgetGate, BudgetGateState } from '@swt-labs/runtime';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

const HEARTBEAT_INTERVAL_MS = 30_000;

export interface BudgetSnapshotFrame {
  readonly type: 'budget.snapshot';
  readonly ts: string;
  readonly state: BudgetGateState | null;
}

interface BumpRequest {
  delta_usd?: unknown;
}

export function registerBudgetRoute(app: Hono, getGate: () => BudgetGate | null): void {
  app.get('/api/budget/sse', (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const emit = async (): Promise<void> => {
        if (closed) return;
        const gate = getGate();
        const frame: BudgetSnapshotFrame = {
          type: 'budget.snapshot',
          ts: new Date().toISOString(),
          state: gate?.state() ?? null,
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

      const gate = getGate();
      if (gate !== null) {
        unsubscribe = gate.subscribe(() => {
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

  app.post('/api/budget/bump', async (c) => {
    const gate = getGate();
    if (gate === null) {
      return c.json({ error: 'budget gate not wired' }, 503);
    }
    let body: BumpRequest;
    try {
      body = await c.req.json<BumpRequest>();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.delta_usd !== 'number' || !Number.isFinite(body.delta_usd)) {
      return c.json({ error: 'delta_usd must be a finite number' }, 400);
    }
    gate.bumpCeiling(body.delta_usd);
    return c.json({ state: gate.state() });
  });
}
