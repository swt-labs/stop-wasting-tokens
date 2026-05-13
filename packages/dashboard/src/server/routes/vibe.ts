/**
 * Plan 04-05 T1 — `POST /api/vibe` and `POST /api/vibe/:session_id/reply`
 * are now LEGACY shims, not full implementations.
 *
 * Background:
 *   - The v2 `MethodologyAgent` factory plumbing in `packages/dashboard/src/server/vibe/`
 *     was decisively gutted at plan 04-05 (R7 decision). With ADR-001 + the v3
 *     reset, the only supported orchestrator entry point is `swt cook` (Phase 3
 *     03-02). The dashboard's REST cook surface lives at `/api/cook/start` +
 *     `/api/cook/:sessionId/control` (Phase 4 04-02).
 *   - This shim translates the legacy `POST /api/vibe` body shape to the new
 *     `/api/cook/start` handler so v2-era clients keep working through one
 *     release cycle (v3.0.0-alpha.x). The shim is removed in v3.1.0 per the
 *     Phase 6 hand-off in `.vbw-planning/phases/04-dashboard-statusline/PARITY-REPORT.md`.
 *   - `POST /api/vibe/:session_id/reply` returns a `410 Gone` body pointing
 *     callers at `/api/prompts/:id/respond` — the canonical askUser response
 *     channel per Phase 1 01-05.
 *
 * Implementation note: the shim does an in-process `app.request(...)` re-dispatch
 * rather than instantiating its own spawner. This keeps the cook-start handler
 * authoritative (no duplicated env-var or PATH-resolution logic) at the cost of
 * one extra Hono routing hop — acceptable for a shim with a documented removal
 * date.
 */

import type { Hono } from 'hono';

export interface RegisterVibeRouteOptions {
  /** Project root forwarded to the cook-start handler. */
  projectRoot: string;
}

export function registerVibeRoutes(app: Hono, _opts: RegisterVibeRouteOptions): void {
  // POST /api/vibe — translate to POST /api/cook/start.
  //
  // The legacy body shape is `{ prompt?: string, prompt_timeouts?: {...} }`. The
  // cook-start route accepts `{ args?: string[] }`; we forward `prompt` (when
  // present) as a positional arg so `swt cook <prompt>` lines up. Timeouts are
  // dropped — cook does not honour them (askUser timeouts come from the
  // session registry which the gutted vibe layer owned).
  app.post('/api/vibe', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const prompt = typeof raw['prompt'] === 'string' ? raw['prompt'] : null;
    const args: string[] = prompt && prompt.length > 0 ? [prompt] : [];

    // Re-dispatch into the same app via app.request(); cook-start returns
    // `{ session_id, pid, started_at }` which already satisfies the v2
    // `{ session_id }`-shaped response contract. We preserve the response body
    // verbatim so any v2 client reading `session_id` keeps working, and any new
    // client reading the extra fields gets them.
    const forwarded = await app.request('/api/cook/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    const result = (await forwarded.json()) as Record<string, unknown>;
    return c.json(result, forwarded.status as 200);
  });

  // POST /api/vibe/:session_id/reply — 410 Gone with a forward pointer.
  app.post('/api/vibe/:session_id/reply', (c) => {
    return c.json(
      {
        error: 'gone',
        message:
          'POST /api/vibe/:session_id/reply was removed in v3 (R7). Use POST /api/prompts/:id/respond for askUser responses (see Phase 1 01-05).',
        replacement: '/api/prompts/:id/respond',
      },
      410,
    );
  });
}
