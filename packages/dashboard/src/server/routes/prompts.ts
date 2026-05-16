/**
 * Plan 01-05 (Phase 1) — POST /api/prompts/* + GET /api/prompts/pending.
 *
 * The dashboard server's contribution to the `swt:askUser` IPC contract:
 *
 *   - `POST /api/prompts/publish` — the orchestrator (or any process that
 *     wants to surface a card on the dashboard) posts a `prompt.request`
 *     body; this route publishes the event onto the in-process EventBus
 *     (which `/api/events` SSE clients are subscribed to) AND records it in a
 *     small pending map so a freshly-reconnected dashboard can replay
 *     unresolved prompts.
 *
 *   - `POST /api/prompts/:id/respond` — the dashboard SPA posts the user's
 *     choice; this route publishes a `prompt.response` event onto the bus
 *     and removes the matching prompt from the pending map. The orchestrator
 *     subscribes to the SSE stream (or the in-process bus when both halves
 *     live in the same process) and resolves the awaited Promise.
 *
 *   - `GET /api/prompts/pending` — returns the list of unresolved prompts so
 *     a reconnecting dashboard can re-render its card stack.
 *
 * The route NEVER mutates files. All state is in-memory; Phase D's Unix-socket
 * transport upgrade replaces the REST hop without changing payload shapes
 * (research §5).
 *
 * No filesystem mutation = no atomic-write discipline required here; the
 * test pattern is "POST then assert bus.publish was called" (see
 * `packages/dashboard/test/routes/prompts.test.ts`).
 *
 * Plan 02-01 (milestone 13, Phase 02) — `dropPendingPrompt(promptId)` is
 * a small sibling export consumed by the cook-aware response route at
 * `./cook-respond.ts`. It returns the removed PromptRequestEvent (or
 * undefined when no match) so the cook-respond handler can read the
 * originating `session_id` AND drop the entry in one call. The existing
 * `POST /api/prompts/*` public contract is unchanged.
 */

import {
  PromptRequestEventSchema,
  type PromptRequestEvent,
  type SnapshotEvent,
} from '@swt-labs/shared';
import type { Hono } from 'hono';
import { z } from 'zod';

import type { EventBus } from '../event-bus.js';

/**
 * POST /api/prompts/:id/respond body shape. The orchestrator and headless
 * fallback both rely on `selectedOption` + `freeform` returning as either a
 * string or null — the dashboard sends `selectedOption: string, freeform:
 * null` when the user clicks a card button, and the reverse when the user
 * picks "Other" and submits the textarea.
 */
const PromptRespondBodySchema = z.object({
  prompt_id: z.string().min(1),
  selectedOption: z.string().nullable(),
  freeform: z.string().nullable(),
});

export type PromptRespondBody = z.infer<typeof PromptRespondBodySchema>;

/**
 * Module-scoped pending-prompt map. Keyed by prompt_id so the dashboard can
 * fetch the unresolved set on reconnect AND the response route can ignore
 * duplicate submissions for the same prompt_id (idempotent — first response
 * wins).
 *
 * The Phase D Unix-socket transport replaces this with a per-orchestrator-
 * process in-memory queue keyed off the socket connection; no persistence
 * needed in either generation.
 */
const pendingPrompts = new Map<string, PromptRequestEvent>();

/**
 * Test-only — clear the pending map between cases without exporting the
 * Map handle itself. Production code never calls this.
 */
export function __resetPendingPromptsForTest(): void {
  pendingPrompts.clear();
}

/**
 * Read-only snapshot of pending prompts. Useful for the GET handler and for
 * tests that want to assert on the queue without poking the closed-over Map.
 */
export function getPendingPrompts(): PromptRequestEvent[] {
  return Array.from(pendingPrompts.values());
}

/**
 * Plan 02-01 (milestone 13, Phase 02) — drop a single pending prompt by
 * id, returning the removed entry (or `undefined` when no match). Consumed
 * by the cook-aware response route at `./cook-respond.ts` so it can read
 * the originating prompt's `session_id` AND drop the entry in one call,
 * keeping the pendingPrompts Map encapsulated.
 */
export function dropPendingPrompt(promptId: string): PromptRequestEvent | undefined {
  const existing = pendingPrompts.get(promptId);
  if (existing === undefined) return undefined;
  pendingPrompts.delete(promptId);
  return existing;
}

export function registerPromptsRoute(app: Hono, bus: EventBus): void {
  // POST /api/prompts/publish — orchestrator → dashboard direction. Validates
  // the body as a prompt.request event, records it in the pending map, and
  // republishes onto the bus so live SSE listeners (the dashboard SPA) see
  // it. The orchestrator typically calls this via fetch(); the in-process
  // bus alternative is also valid but less symmetric for Phase D.
  app.post('/api/prompts/publish', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = PromptRequestEventSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const event: PromptRequestEvent = parsed.data;
    pendingPrompts.set(event.prompt_id, event);
    bus.publish(event);
    return c.json({ published: true, prompt_id: event.prompt_id });
  });

  // POST /api/prompts/:id/respond — dashboard → orchestrator direction.
  // Validates body, asserts prompt_id matches the URL param, publishes a
  // prompt.response event, drops the matching pending entry. Returns 200 with
  // the published event body so the SPA can optimistically dismiss the card
  // without waiting for the SSE round-trip.
  app.post('/api/prompts/:id/respond', async (c) => {
    const promptId = c.req.param('id');
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = PromptRespondBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    if (parsed.data.prompt_id !== promptId) {
      return c.json(
        {
          error: 'prompt_id_mismatch',
          detail: `URL :id ("${promptId}") does not match body prompt_id ("${parsed.data.prompt_id}").`,
        },
        400,
      );
    }
    // Look up the originating prompt to read its session_id. Missing pending
    // entry isn't fatal — the response can still flow, but session_id falls
    // back to 'unknown' so the SSE filter ?session_id= path works
    // gracefully. The orchestrator matches on prompt_id, not session_id.
    const originating = pendingPrompts.get(promptId);
    const sessionId = originating?.session_id ?? 'unknown';

    const responseEvent: SnapshotEvent = {
      type: 'prompt.response',
      ts: new Date().toISOString(),
      session_id: sessionId,
      prompt_id: promptId,
      selectedOption: parsed.data.selectedOption,
      freeform: parsed.data.freeform,
    };
    bus.publish(responseEvent);
    pendingPrompts.delete(promptId);
    return c.json(responseEvent);
  });

  // GET /api/prompts/pending — replay endpoint for dashboard reconnects. The
  // SPA reads this on mount + on every successful SSE reconnect so the card
  // stack survives a network blip.
  app.get('/api/prompts/pending', (c) => {
    return c.json({ pending: getPendingPrompts() });
  });
}
