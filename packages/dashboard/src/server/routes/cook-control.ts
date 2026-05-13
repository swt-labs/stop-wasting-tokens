/**
 * Plan 04-02 T3 — `POST /api/cook/:sessionId/control`.
 *
 * Translate a dashboard control action into the signal-file protocol from
 * plan 04-01 (`packages/methodology/src/state/cook-controls.ts`). Cook reads
 * the file at every priority-decision boundary and honors the action on the
 * next mode dispatch (R2: no mid-turn pause — that lives in Phase 6's
 * crash-recovery checkpoint primitives).
 *
 * `new_state` in the response reflects the dashboard's *intent* — the
 * actual cook transition lags by up to one mode-boundary poll. Plan 04-03
 * UI shows a "transitioning…" state until the next cook.priority_decision
 * event lands on the SSE stream.
 */

import { writePendingSignal, type CookControlAction } from '@swt-labs/methodology';
import type { Hono } from 'hono';

const VALID_ACTIONS: ReadonlySet<CookControlAction> = new Set(['pause', 'resume', 'cancel']);

export interface CookControlOptions {
  projectRoot: string;
}

interface CookControlBody {
  action?: unknown;
}

export function registerCookControlRoute(app: Hono, opts: CookControlOptions): void {
  app.post('/api/cook/:sessionId/control', async (c) => {
    const sessionId = c.req.param('sessionId');
    if (!sessionId || sessionId.length === 0) {
      return c.json({ ok: false, error: 'missing sessionId' }, 400);
    }
    // sessionId is part of the URL path Hono already decoded — guard the
    // signal-file lookup against path traversal by requiring a UUID-shaped
    // (or otherwise safe-character-only) id.
    if (!/^[A-Za-z0-9_.-]+$/.test(sessionId)) {
      return c.json({ ok: false, error: 'invalid sessionId' }, 400);
    }

    const body: CookControlBody = await c.req
      .json<CookControlBody>()
      .catch(() => ({} as CookControlBody));
    const action = body.action;
    if (typeof action !== 'string' || !VALID_ACTIONS.has(action as CookControlAction)) {
      return c.json({ ok: false, error: 'invalid action' }, 400);
    }

    try {
      writePendingSignal(sessionId, action as CookControlAction, opts.projectRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: `failed to write signal: ${message}` }, 500);
    }

    const newState =
      action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'running';
    return c.json({ ok: true, new_state: newState });
  });
}
