/**
 * Plan 02-01 (milestone 13, Phase 02) P03 — POST /api/cook/respond tests.
 *
 * Mirrors the prompts.test.ts pattern: each case mounts a fresh Hono app
 * with a fresh EventBus, subscribes a publishedEvents capture, and clears
 * the prompts route's module-scoped pending map via the exported test
 * reset helper. No filesystem mutation.
 *
 * Coverage:
 *   D.1 valid body + matching cook session → 200, prompt.response published,
 *       pending prompt dropped.
 *   D.2 missing askUserId → 400 invalid_body.
 *   D.3 missing cook_session_id → 400 invalid_body.
 *   D.4 response.selectedOption not nullable string → 400 invalid_body.
 *   D.5 unknown askUserId → 404 unknown_ask_user_id.
 *   D.6 askUserId exists but cook_session_id mismatch → 400 cook_session_mismatch.
 *   D.7 happy-path published event shape matches contract.
 *   D.8 happy-path drops the prompt from GET /api/prompts/pending.
 *   D.9 freeform-only Other path: selectedOption=null + freeform="..." 200.
 */

import type { SnapshotEvent } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../../src/server/event-bus.ts';
import { registerCookRespondRoute } from '../../src/server/routes/cook-respond.ts';
import {
  __resetPendingPromptsForTest,
  registerPromptsRoute,
} from '../../src/server/routes/prompts.ts';

let app: Hono;
let bus: EventBus;
let publishedEvents: SnapshotEvent[];
let unsubscribe: () => void;

const COOK_SID = 'cook-session-X';

beforeEach(() => {
  __resetPendingPromptsForTest();
  app = new Hono();
  bus = createEventBus();
  publishedEvents = [];
  unsubscribe = bus.subscribe((evt) => {
    publishedEvents.push(evt);
  });
  // Register BOTH routes so /api/prompts/publish can seed pending state and
  // /api/cook/respond can consume it.
  registerPromptsRoute(app, bus);
  registerCookRespondRoute(app, bus);
});

afterEach(() => {
  unsubscribe();
});

async function publishPrompt(promptId: string, sessionId: string = COOK_SID): Promise<void> {
  await app.request('/api/prompts/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'prompt.request',
      ts: '2026-05-17T00:00:00.000Z',
      session_id: sessionId,
      prompt_id: promptId,
      question: 'Q?',
      options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
    }),
  });
}

describe('POST /api/cook/respond', () => {
  it('D.1 — valid body + matching cook session publishes prompt.response on bus + returns 200 + drops pending', async () => {
    await publishPrompt('p-1');
    // Clear the prompt.request from publishedEvents so the assertion below
    // only counts the prompt.response coming through the cook-respond path.
    publishedEvents = [];
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-1',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe('prompt.response');
    const responses = publishedEvents.filter((e) => e.type === 'prompt.response');
    expect(responses).toHaveLength(1);
  });

  it('D.2 — missing askUserId returns 400 invalid_body', async () => {
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('D.3 — missing cook_session_id returns 400 invalid_body', async () => {
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        askUserId: 'p-3',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('D.4 — response.selectedOption non-nullable wrong type returns 400 invalid_body', async () => {
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-4',
        response: { selectedOption: 42, freeform: null },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_body');
  });

  it('D.5 — unknown askUserId returns 404 unknown_ask_user_id', async () => {
    // No publishPrompt — pending map is empty.
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-missing',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unknown_ask_user_id');
  });

  it('D.6 — askUserId exists but cook_session_id mismatch returns 400 cook_session_mismatch', async () => {
    await publishPrompt('p-6', 'a-different-session');
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-6',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cook_session_mismatch');
  });

  it('D.7 — happy-path published event shape: type=prompt.response, session_id from pending, fields preserved', async () => {
    await publishPrompt('p-7');
    publishedEvents = [];
    await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-7',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    const response = publishedEvents.find((e) => e.type === 'prompt.response');
    expect(response).toBeDefined();
    expect(response).toMatchObject({
      type: 'prompt.response',
      session_id: COOK_SID,
      prompt_id: 'p-7',
      selectedOption: 'Yes',
      freeform: null,
    });
  });

  it('D.8 — happy path removes the prompt from GET /api/prompts/pending', async () => {
    await publishPrompt('p-8');
    // Confirm baseline: the prompt is pending.
    const pendingBefore = await app.request('/api/prompts/pending');
    const beforeBody = (await pendingBefore.json()) as { pending: Array<{ prompt_id: string }> };
    expect(beforeBody.pending.map((p) => p.prompt_id)).toEqual(['p-8']);
    // Respond via the cook-aware route.
    await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-8',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    const pendingAfter = await app.request('/api/prompts/pending');
    const afterBody = (await pendingAfter.json()) as { pending: unknown[] };
    expect(afterBody.pending).toEqual([]);
  });

  it('D.9 — happy path with selectedOption=null + freeform="custom" carries freeform through', async () => {
    await publishPrompt('p-9');
    publishedEvents = [];
    const res = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-9',
        response: { selectedOption: null, freeform: 'custom answer' },
      }),
    });
    expect(res.status).toBe(200);
    const response = publishedEvents.find((e) => e.type === 'prompt.response');
    expect(response).toMatchObject({
      type: 'prompt.response',
      session_id: COOK_SID,
      prompt_id: 'p-9',
      selectedOption: null,
      freeform: 'custom answer',
    });
  });
});
