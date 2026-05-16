/**
 * Plan 02-01 P04 (milestone 13, Phase 02) — cook askUser end-to-end SSE
 * roundtrip integration test.
 *
 * Exercises the FULL dashboard side of the bridge:
 *   E.1 HTTP-layer happy path — POST /api/prompts/publish → bus publishes
 *       prompt.request → GET /api/prompts/pending returns it → POST
 *       /api/cook/respond with matching askUserId → bus publishes
 *       prompt.response → GET /api/prompts/pending returns empty.
 *   E.2 Store-layer happy path — drive the dashboard store through
 *       cook.priority_decision (set activeSessionId) → prompt.request
 *       (entry pending + slot set) → prompt.response (entry answered +
 *       slot cleared).
 *   E.3 Timeout path — drive cook.ask_user_timeout (synthetic, no
 *       10-minute wait): entry marked expired + slot cleared.
 *   E.4 Non-cook prompt ignored — prompt.request with session_id !==
 *       activeSessionId is silently dropped at the store layer.
 *   E.5 Overlap — two prompt.request events for the same active cook
 *       session produce two entries; slot tracks the latest; the first
 *       entry's status remains pending.
 *
 * The test does NOT spawn a real cook subprocess — that's covered by
 * `packages/runtime/test/ask-user/ask-user.test.ts` (which Phase 02
 * deliberately does NOT modify). We exercise the dashboard side that
 * Phase 02 builds: server route bridge + client store reducer.
 */

import type { SnapshotEvent } from '@swt-labs/shared';
import { Hono } from 'hono';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardStore } from '../src/client/state/dashboard-store.js';
import { createEventBus, type EventBus } from '../src/server/event-bus.ts';
import { registerCookRespondRoute } from '../src/server/routes/cook-respond.ts';
import {
  __resetPendingPromptsForTest,
  registerPromptsRoute,
} from '../src/server/routes/prompts.ts';

// ────────────────────────────────────────────────────────────────────────────
// Store-side test scaffolding — mirrors the mock setup in
// dashboard-store-cook-events.test.ts so createDashboardStore() can be
// instantiated without the production api.ts module. vi.mock() is hoisted
// to the top of the file at compile time, so even though createDashboardStore
// is imported above the mocks for lint's `import/order` rule, the mocks
// are installed before the store module is evaluated.
// ────────────────────────────────────────────────────────────────────────────

const fetchSnapshotMock = vi.fn();
const postInitMock = vi.fn();
const postCommandMock = vi.fn();
const postUatCheckpointMock = vi.fn();
const fetchArtifactRenderedMock = vi.fn();
const postCookStartMock = vi.fn();
const postPromptRespondMock = vi.fn();
const openSseConnectionMock = vi.fn();
const fetchConfigMock = vi.fn();
const fetchDoctorMock = vi.fn();
const fetchDetectPhaseMock = vi.fn();
const fetchUpdateMock = vi.fn();
const fetchCommandsMock = vi.fn();
const postConfigMock = vi.fn();
const postUpdateApplyMock = vi.fn();
const fetchProviderAuthMock = vi.fn();
const postProviderAuthMock = vi.fn();

vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  postInit: (...args: unknown[]) => postInitMock(...args),
  postCommand: (...args: unknown[]) => postCommandMock(...args),
  postUatCheckpoint: (...args: unknown[]) => postUatCheckpointMock(...args),
  fetchArtifactRendered: (...args: unknown[]) => fetchArtifactRenderedMock(...args),
  postCookStart: (...args: unknown[]) => postCookStartMock(...args),
  postPromptRespond: (...args: unknown[]) => postPromptRespondMock(...args),
  fetchConfig: (...args: unknown[]) => fetchConfigMock(...args),
  fetchDoctor: (...args: unknown[]) => fetchDoctorMock(...args),
  fetchDetectPhase: (...args: unknown[]) => fetchDetectPhaseMock(...args),
  fetchUpdate: (...args: unknown[]) => fetchUpdateMock(...args),
  fetchCommands: (...args: unknown[]) => fetchCommandsMock(...args),
  postConfig: (...args: unknown[]) => postConfigMock(...args),
  postUpdateApply: (...args: unknown[]) => postUpdateApplyMock(...args),
  fetchProviderAuth: (...args: unknown[]) => fetchProviderAuthMock(...args),
  postProviderAuth: (...args: unknown[]) => postProviderAuthMock(...args),
  fetchUserNotes: vi.fn(),
  postUserNotes: vi.fn(),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

const TS = '2026-05-17T00:00:00.000Z';

beforeEach(() => {
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ────────────────────────────────────────────────────────────────────────────
// E.1 — HTTP-layer happy path through the in-process app.
// ────────────────────────────────────────────────────────────────────────────

describe('E.1 — HTTP roundtrip: prompt.request → /api/cook/respond → prompt.response', () => {
  let app: Hono;
  let bus: EventBus;
  let publishedEvents: SnapshotEvent[];
  let unsubscribe: () => void;
  const COOK_SID = 'cook-session-1';

  beforeEach(() => {
    __resetPendingPromptsForTest();
    app = new Hono();
    bus = createEventBus();
    publishedEvents = [];
    unsubscribe = bus.subscribe((evt) => publishedEvents.push(evt));
    registerPromptsRoute(app, bus);
    registerCookRespondRoute(app, bus);
  });

  afterEach(() => {
    unsubscribe();
  });

  it('publishes a prompt.request, then /api/cook/respond delivers a matching prompt.response + drops the pending entry', async () => {
    // 1. Cook publishes prompt.request.
    const publishRes = await app.request('/api/prompts/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-test-1',
        question: 'Proceed with scope?',
        options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
      }),
    });
    expect(publishRes.status).toBe(200);

    // 2. Bus saw exactly one prompt.request.
    const requests = publishedEvents.filter((e) => e.type === 'prompt.request');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: 'prompt.request',
      session_id: COOK_SID,
      prompt_id: 'p-test-1',
    });

    // 3. /api/prompts/pending returns it.
    const pendingRes = await app.request('/api/prompts/pending');
    const pending = (await pendingRes.json()) as { pending: Array<{ prompt_id: string }> };
    expect(pending.pending.map((p) => p.prompt_id)).toEqual(['p-test-1']);

    // 4. Dashboard SPA POSTs the response via the cook-aware route.
    publishedEvents = []; // Filter to events emitted by the cook-respond path.
    const respondRes = await app.request('/api/cook/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cook_session_id: COOK_SID,
        askUserId: 'p-test-1',
        response: { selectedOption: 'Yes', freeform: null },
      }),
    });
    expect(respondRes.status).toBe(200);
    const respondBody = (await respondRes.json()) as Record<string, unknown>;
    expect(respondBody).toMatchObject({
      type: 'prompt.response',
      session_id: COOK_SID,
      prompt_id: 'p-test-1',
      selectedOption: 'Yes',
      freeform: null,
    });

    // 5. Bus saw exactly one prompt.response with the right fields.
    const responses = publishedEvents.filter((e) => e.type === 'prompt.response');
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      type: 'prompt.response',
      session_id: COOK_SID,
      prompt_id: 'p-test-1',
      selectedOption: 'Yes',
      freeform: null,
    });

    // 6. /api/prompts/pending is empty.
    const pendingAfter = await app.request('/api/prompts/pending');
    const pendingAfterBody = (await pendingAfter.json()) as { pending: unknown[] };
    expect(pendingAfterBody.pending).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// E.2..E.5 — Store-layer roundtrips. Drive applyEvent directly with the same
// events the SSE channel would carry; assert on state.unifiedLog +
// state.cookAwaitingUser lifecycle.
// ────────────────────────────────────────────────────────────────────────────

describe('E.2 — store roundtrip: priority_decision → prompt.request → prompt.response', () => {
  it('drives the full happy-path lifecycle through the dashboard store', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      const COOK_SID = 'cook-session-2';

      // Seed the active cook session.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS,
        session_id: COOK_SID,
        priority: 5,
        mode: 'execute',
      });
      expect(state.activeSessionId).toBe(COOK_SID);

      // Emit the prompt.request — matching session_id should append an entry
      // and set the awaiting slot.
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-2',
        question: 'Q?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      });
      const askEntries = state.unifiedLog.filter((e) => e.kind === 'cook-ask-user');
      expect(askEntries).toHaveLength(1);
      const entry = askEntries[0];
      if (entry.kind === 'cook-ask-user') {
        expect(entry.status).toBe('pending');
        expect(entry.prompt_id).toBe('p-2');
      }
      expect(state.cookAwaitingUser?.askUserId).toBe('p-2');

      // Emit the prompt.response — entry mutates to 'answered' with reply,
      // slot clears.
      actions.applyEvent({
        type: 'prompt.response',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-2',
        selectedOption: 'Yes',
        freeform: null,
      });
      const after = state.unifiedLog.find(
        (e) => e.kind === 'cook-ask-user' && e.prompt_id === 'p-2',
      );
      if (after?.kind === 'cook-ask-user') {
        expect(after.status).toBe('answered');
        expect(after.reply).toBe('Yes');
      }
      expect(state.cookAwaitingUser).toBeNull();

      dispose();
    });
  });
});

describe('E.3 — store timeout path: cook.ask_user_timeout marks entry expired + clears slot', () => {
  it('handles the synthetic timeout event without waiting for the 10-minute window', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      const COOK_SID = 'cook-session-3';

      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS,
        session_id: COOK_SID,
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-3',
        question: 'Q?',
        options: [{ label: 'A' }],
      });
      expect(state.cookAwaitingUser?.askUserId).toBe('p-3');

      actions.applyEvent({
        type: 'cook.ask_user_timeout',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-3',
      });
      const after = state.unifiedLog.find(
        (e) => e.kind === 'cook-ask-user' && e.prompt_id === 'p-3',
      );
      if (after?.kind === 'cook-ask-user') {
        expect(after.status).toBe('expired');
        expect(after.reply).toBeUndefined();
      }
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });
});

describe('E.4 — non-cook prompt is ignored (cook-session correlation gate)', () => {
  it('drops prompt.request events whose session_id != activeSessionId', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      const COOK_SID = 'cook-session-4';

      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS,
        session_id: COOK_SID,
        priority: 5,
        mode: 'execute',
      });
      // A prompt from some other source (init Lead, /vbw subagent, ...).
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: 'some-other-session',
        prompt_id: 'p-other',
        question: 'Q?',
        options: [{ label: 'X' }],
      });
      const askEntries = state.unifiedLog.filter((e) => e.kind === 'cook-ask-user');
      expect(askEntries).toHaveLength(0);
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });
});

describe('E.5 — overlap: second prompt.request overwrites slot but does not mutate the first entry', () => {
  it('keeps both entries in unifiedLog; slot tracks the latest', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      const COOK_SID = 'cook-session-5';

      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS,
        session_id: COOK_SID,
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-5a',
        question: 'First?',
        options: [{ label: 'A' }],
      });
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-5b',
        question: 'Second?',
        options: [{ label: 'B' }],
      });
      const askEntries = state.unifiedLog.filter((e) => e.kind === 'cook-ask-user');
      expect(askEntries).toHaveLength(2);
      // Slot tracks the latest prompt.
      expect(state.cookAwaitingUser?.askUserId).toBe('p-5b');
      // The first entry is still pending — Phase 03 may render as 'missed'
      // visually, but Phase 02 leaves the status untouched.
      const first = askEntries.find((e) => e.kind === 'cook-ask-user' && e.prompt_id === 'p-5a');
      if (first?.kind === 'cook-ask-user') {
        expect(first.status).toBe('pending');
      }
      const second = askEntries.find((e) => e.kind === 'cook-ask-user' && e.prompt_id === 'p-5b');
      if (second?.kind === 'cook-ask-user') {
        expect(second.status).toBe('pending');
      }
      dispose();
    });
  });
});
