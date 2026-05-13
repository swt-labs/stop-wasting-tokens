/**
 * Plan 01-05 (Phase 1) Task 5 — POST /api/prompts/* route tests.
 *
 * Four assertions per the plan's verify block:
 *   B.1 POST /api/prompts/:id/respond with a valid body returns 200 and
 *       publishes a prompt.response event on the bus.
 *   B.2 POST with mismatched prompt_id in body vs URL returns 400.
 *   B.3 POST with missing fields returns 400.
 *   B.4 POST /api/prompts/publish accepts a prompt.request body, publishes
 *       it on the bus, AND GET /api/prompts/pending returns it.
 *
 * Each test mounts a fresh Hono app with a fresh EventBus + clears the
 * route's module-scoped pending map via the exported test reset helper.
 * No filesystem mutation; matches research §1.5's "no IO" expectation.
 */

import type { SnapshotEvent } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../../src/server/event-bus.ts';
import {
  registerPromptsRoute,
  __resetPendingPromptsForTest,
} from '../../src/server/routes/prompts.ts';

let app: Hono;
let bus: EventBus;
let publishedEvents: SnapshotEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  __resetPendingPromptsForTest();
  app = new Hono();
  bus = createEventBus();
  publishedEvents = [];
  unsubscribe = bus.subscribe((evt) => {
    publishedEvents.push(evt);
  });
  registerPromptsRoute(app, bus);
});

afterEach(() => {
  unsubscribe();
});

function makePromptRequest(promptId: string): unknown {
  return {
    type: 'prompt.request',
    ts: '2026-05-13T12:00:00.000Z',
    session_id: 'sess-test',
    prompt_id: promptId,
    header: 'Confirm',
    question: 'Continue with phase 03 now?',
    options: [
      { label: 'Execute phase 03', isRecommended: true },
      { label: 'Review plans first' },
    ],
  };
}

describe('POST /api/prompts/:id/respond', () => {
  it('B.1 — valid body publishes a prompt.response event and returns 200', async () => {
    // Pre-publish a matching prompt.request so the response can resolve its
    // session_id from the pending map.
    await app.request('/api/prompts/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makePromptRequest('p-1')),
    });

    const res = await app.request('/api/prompts/p-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: 'p-1',
        selectedOption: 'Execute phase 03',
        freeform: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; selectedOption: string };
    expect(body.type).toBe('prompt.response');
    expect(body.selectedOption).toBe('Execute phase 03');

    // Assert the bus actually saw a prompt.response event.
    const responseEvts = publishedEvents.filter((e) => e.type === 'prompt.response');
    expect(responseEvts).toHaveLength(1);
    expect(responseEvts[0]).toMatchObject({
      type: 'prompt.response',
      prompt_id: 'p-1',
      session_id: 'sess-test',
      selectedOption: 'Execute phase 03',
      freeform: null,
    });
  });

  it('B.2 — mismatched prompt_id (URL vs body) returns 400', async () => {
    const res = await app.request('/api/prompts/p-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: 'p-2',
        selectedOption: 'X',
        freeform: null,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('prompt_id_mismatch');
  });

  it('B.3 — missing required fields returns 400', async () => {
    // Missing selectedOption + freeform both — schema requires both keys
    // even if nullable.
    const res = await app.request('/api/prompts/p-3/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt_id: 'p-3' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_body');
  });
});

describe('POST /api/prompts/publish + GET /api/prompts/pending', () => {
  it('B.4 — publish stores in pending map + publishes prompt.request', async () => {
    const res = await app.request('/api/prompts/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makePromptRequest('p-publish')),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published: boolean; prompt_id: string };
    expect(body).toEqual({ published: true, prompt_id: 'p-publish' });

    // Bus received the prompt.request.
    const requests = publishedEvents.filter((e) => e.type === 'prompt.request');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: 'prompt.request',
      prompt_id: 'p-publish',
      question: 'Continue with phase 03 now?',
    });

    // GET /pending replays the stored prompt for a reconnecting dashboard.
    const pendingRes = await app.request('/api/prompts/pending');
    expect(pendingRes.status).toBe(200);
    const pending = (await pendingRes.json()) as { pending: Array<{ prompt_id: string }> };
    expect(pending.pending.map((p) => p.prompt_id)).toEqual(['p-publish']);

    // After a matching respond, the prompt is dropped from /pending.
    await app.request('/api/prompts/p-publish/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: 'p-publish',
        selectedOption: 'Execute phase 03',
        freeform: null,
      }),
    });
    const pendingAfter = await app.request('/api/prompts/pending');
    const pendingBody = (await pendingAfter.json()) as { pending: unknown[] };
    expect(pendingBody.pending).toEqual([]);
  });
});
