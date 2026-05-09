import {
  VibeReplyBodySchema,
  VibeStartBodySchema,
  type VibeReplyResponse,
  type VibeStartResponse,
} from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

import type { SessionRegistry } from '../vibe/session.js';

export interface RegisterVibeRoutesOptions {
  registry: SessionRegistry;
  /** Project root for the spawned methodology loop. Frozen for the session's lifetime. */
  project_root: string;
}

/**
 * Registers `POST /api/vibe` and `POST /api/vibe/:session_id/reply`.
 *
 * `POST /api/vibe` accepts a prompt, creates a new session via the registry,
 * returns the session_id. The methodology-loop integration that actually
 * spawns Scout/Architect/Lead/Dev lands in Plan 02-03; until then the
 * session is created in `idle` state and stays there until something else
 * (a test, future loop wiring) emits prompts via `registry.emitPrompt()`.
 *
 * `POST /api/vibe/:session_id/reply` validates the prompt_id matches the
 * currently-blocking prompt and resolves the registry's pending awaiter.
 * Returns 200 on accept and 4xx on the typed error envelopes.
 */
export function registerVibeRoutes(app: Hono, opts: RegisterVibeRoutesOptions): void {
  const { registry, project_root } = opts;

  app.post('/api/vibe', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = VibeStartBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const session = registry.create({
      project_root,
      initial_prompt: parsed.data.prompt,
      ...(parsed.data.prompt_timeouts?.clarification_ms !== undefined
        ? { clarification_timeout_ms: parsed.data.prompt_timeouts.clarification_ms }
        : {}),
      ...(parsed.data.prompt_timeouts?.permission_ms !== undefined
        ? { permission_timeout_ms: parsed.data.prompt_timeouts.permission_ms }
        : {}),
    });
    const response: VibeStartResponse = {
      session_id: session.id,
      state: session.state,
    };
    return c.json(response);
  });

  app.post('/api/vibe/:session_id/reply', async (c) => {
    const session_id = c.req.param('session_id');
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = VibeReplyBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: 'invalid_body', details: parsed.error.flatten() },
        400,
      );
    }
    const result = registry.reply(session_id, parsed.data.prompt_id, parsed.data.answer);
    if (result.ok) {
      const response: VibeReplyResponse = { ok: true, accepted: true };
      return c.json(response);
    }
    const status = errorToStatus(result.error);
    const body: Record<string, unknown> = { ok: false, error: result.error };
    if (result.expected_prompt_id !== undefined) {
      body.expected_prompt_id = result.expected_prompt_id;
    }
    return c.json(body, status);
  });
}

function errorToStatus(error: string | undefined): 400 | 404 | 409 | 410 {
  switch (error) {
    case 'session_not_found':
      return 404;
    case 'prompt_expired':
      return 410;
    case 'invalid_answer_kind':
      return 400;
    case 'session_not_blocking':
    case 'prompt_id_mismatch':
      return 409;
    default:
      return 400;
  }
}
