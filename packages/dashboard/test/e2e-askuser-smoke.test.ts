/**
 * Plan 04-05 T2 — End-to-end smoke test for the askUser round-trip.
 *
 * What this validates:
 *
 *   1. Orchestrator publishes a `prompt.request` event via
 *      `POST /api/prompts/publish` — the canonical askUser → dashboard channel
 *      from Phase 1 01-05 (research §3.5).
 *   2. The dashboard's in-process EventBus republishes the event so the SPA's
 *      SSE listener sees a card to render.
 *   3. The dashboard SPA `POST /api/prompts/:id/respond` with a selection;
 *      the route publishes a `prompt.response` event onto the bus AND clears
 *      the pending map so a reconnecting client wouldn't redraw the card.
 *
 * This is the WHOLE askUser IPC contract end-to-end: orchestrator → publish →
 * bus → SPA respond → bus → orchestrator. Phase 4 reuses Phase 1's primitive
 * unchanged (research §1.6); no new IPC. The test catches regressions in the
 * shared schema, the publish/respond routes, or the pending-map bookkeeping.
 */

import type { PromptRequestEvent, SnapshotEvent } from '@swt-labs/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus, type EventBus } from '../src/server/event-bus.js';
import {
  __resetPendingPromptsForTest,
  registerPromptsRoute,
} from '../src/server/routes/prompts.js';

describe('e2e: askUser round-trip (publish → bus → respond → bus + pending cleared)', () => {
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
    __resetPendingPromptsForTest();
  });

  it('full round-trip: publish prompt.request → SPA respond → prompt.response event + pending cleared', async () => {
    // STEP 1: Orchestrator publishes the askUser question. This is the exact
    // payload the Phase 3 verify INLINE handler emits per UAT checkpoint, and
    // the same payload the cook orchestrator emits at decision points.
    const requestBody: PromptRequestEvent = {
      type: 'prompt.request',
      ts: new Date().toISOString(),
      session_id: 'sess-e2e',
      prompt_id: 'p-e2e-1',
      header: 'Phase 04 UAT checkpoint',
      question: 'Does the cook control surface behave as expected?',
      options: [
        { label: 'PASS', isRecommended: true },
        { label: 'FAIL' },
      ],
    };
    const publishRes = await app.request('http://x/api/prompts/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    expect(publishRes.status).toBe(200);
    const publishBody = (await publishRes.json()) as {
      published: boolean;
      prompt_id: string;
    };
    expect(publishBody.published).toBe(true);
    expect(publishBody.prompt_id).toBe('p-e2e-1');

    // STEP 2: Bus saw the prompt.request — this is what SSE clients would
    // receive and what the SPA reducer would fold into the card stack.
    const requestEvents = publishedEvents.filter((e) => e.type === 'prompt.request');
    expect(requestEvents).toHaveLength(1);
    expect(requestEvents[0]?.prompt_id).toBe('p-e2e-1');

    // STEP 3: The pending GET endpoint returns the unanswered prompt so a
    // reconnecting dashboard would redraw the card stack.
    const pendingRes = await app.request('http://x/api/prompts/pending');
    expect(pendingRes.status).toBe(200);
    const pendingBody = (await pendingRes.json()) as { pending: PromptRequestEvent[] };
    expect(pendingBody.pending).toHaveLength(1);
    expect(pendingBody.pending[0]?.prompt_id).toBe('p-e2e-1');

    // STEP 4: SPA POSTs the user's selection. This is the response side of
    // the contract — selectedOption mirrors the clicked option label.
    const respondRes = await app.request('http://x/api/prompts/p-e2e-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: 'p-e2e-1',
        selectedOption: 'PASS',
        freeform: null,
      }),
    });
    expect(respondRes.status).toBe(200);
    const respondBody = (await respondRes.json()) as {
      type: string;
      selectedOption: string;
      session_id: string;
    };
    expect(respondBody.type).toBe('prompt.response');
    expect(respondBody.selectedOption).toBe('PASS');
    // The respond route looks up the originating prompt's session_id from
    // the pending map; verifying it routes through means the publish step
    // wrote into the map correctly.
    expect(respondBody.session_id).toBe('sess-e2e');

    // STEP 5: Bus saw the response. This is what the orchestrator's SSE
    // listener (or in-process bus subscriber) would see to resolve its
    // awaited askUser Promise.
    const responseEvents = publishedEvents.filter((e) => e.type === 'prompt.response');
    expect(responseEvents).toHaveLength(1);
    expect(responseEvents[0]).toMatchObject({
      type: 'prompt.response',
      prompt_id: 'p-e2e-1',
      session_id: 'sess-e2e',
      selectedOption: 'PASS',
      freeform: null,
    });

    // STEP 6: Pending map is cleared. A reconnecting dashboard would NOT
    // redraw the resolved card.
    const pendingAfterRes = await app.request('http://x/api/prompts/pending');
    const pendingAfter = (await pendingAfterRes.json()) as { pending: unknown[] };
    expect(pendingAfter.pending).toHaveLength(0);
  });

  it('freeform response: SPA submits text answer when user selects "Other"', async () => {
    await app.request('http://x/api/prompts/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'prompt.request',
        ts: new Date().toISOString(),
        session_id: 'sess-e2e-free',
        prompt_id: 'p-free-1',
        question: 'Free-form scenario?',
        options: [{ label: 'A' }, { label: 'B' }],
      } satisfies PromptRequestEvent),
    });

    const res = await app.request('http://x/api/prompts/p-free-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt_id: 'p-free-1',
        selectedOption: null,
        freeform: 'Custom answer text',
      }),
    });
    expect(res.status).toBe(200);
    const responseEvts = publishedEvents.filter((e) => e.type === 'prompt.response');
    expect(responseEvts).toHaveLength(1);
    expect(responseEvts[0]).toMatchObject({
      selectedOption: null,
      freeform: 'Custom answer text',
    });
  });
});
