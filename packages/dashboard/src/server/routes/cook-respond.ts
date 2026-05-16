/**
 * Plan 02-01 (milestone 13, Phase 02) — POST /api/cook/respond.
 *
 * Cook-aware wrapper around the existing `POST /api/prompts/:id/respond`
 * write-back. The dashboard SPA (Phase 03 consumer) needs a stable endpoint
 * that:
 *   1. Validates the cook-session correlation up front (so a SPA bug never
 *      resolves a /vbw subagent's or init-Lead's prompt as if it were a
 *      cook askUser).
 *   2. Delegates to the same in-process publish-on-bus + drop-from-pending
 *      logic that `POST /api/prompts/:id/respond` runs — preserving the
 *      existing prompts route's public contract.
 *
 * No `cook.user_responded` event is emitted: the `prompt.response` event
 * already published is sufficient. The dashboard reducer (Phase 02 P02)
 * keys on `prompt.response` to mark the matching `CookAskUserEntry`
 * `status: 'answered'`. Adding a parallel cook variant would create a
 * duplicate translation layer (Scout §5 Option A + Cross-cutting #6).
 *
 * Body shape:
 *   {
 *     cook_session_id: string,
 *     askUserId: string,                          // == prompt_id semantically
 *     response: { selectedOption: string|null, freeform: string|null }
 *   }
 *
 * Validation order (each step returns immediately on failure):
 *   1. Body parses against CookRespondBodySchema → 400 invalid_body.
 *   2. askUserId exists in pendingPrompts → 404 unknown_ask_user_id.
 *   3. pending.session_id === body.cook_session_id → 400 cook_session_mismatch.
 *   4. Publish prompt.response on bus + drop the pending entry; respond
 *      200 with the published event body so the SPA can optimistically
 *      dismiss the card without waiting for the SSE round-trip.
 */

import type { SnapshotEvent } from '@swt-labs/shared';
import type { Hono } from 'hono';
import { z } from 'zod';

import type { EventBus } from '../event-bus.js';

import { dropPendingPrompt, getPendingPrompts } from './prompts.js';

const CookRespondBodySchema = z.object({
  cook_session_id: z.string().min(1),
  askUserId: z.string().min(1),
  response: z.object({
    selectedOption: z.string().nullable(),
    freeform: z.string().nullable(),
  }),
});

export type CookRespondBody = z.infer<typeof CookRespondBodySchema>;

export function registerCookRespondRoute(app: Hono, bus: EventBus): void {
  app.post('/api/cook/respond', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = CookRespondBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;

    // Look up the pending prompt by askUserId (== prompt_id). Reading
    // through getPendingPrompts() keeps the pendingPrompts Map encapsulated
    // inside prompts.ts.
    const pending = getPendingPrompts().find((p) => p.prompt_id === body.askUserId);
    if (pending === undefined) {
      return c.json(
        {
          error: 'unknown_ask_user_id',
          detail: 'No pending prompt matches askUserId',
        },
        404,
      );
    }

    // Cook-session correlation gate. Critical: the SPA may have stale state
    // (e.g., a verb-chip switch dropped the cook context) and a permissive
    // route would resolve a non-cook prompt as if it were one. Match the
    // pending prompt's originating session_id against the supplied
    // cook_session_id.
    if (pending.session_id !== body.cook_session_id) {
      return c.json(
        {
          error: 'cook_session_mismatch',
          detail: 'askUserId is not associated with the supplied cook_session_id',
        },
        400,
      );
    }

    const responseEvent: SnapshotEvent = {
      type: 'prompt.response',
      ts: new Date().toISOString(),
      session_id: pending.session_id,
      prompt_id: body.askUserId,
      selectedOption: body.response.selectedOption,
      freeform: body.response.freeform,
    };
    bus.publish(responseEvent);
    dropPendingPrompt(body.askUserId);
    return c.json(responseEvent);
  });
}
