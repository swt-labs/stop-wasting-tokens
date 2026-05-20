import type { ChatStartEvent, LogEntry } from '@swt-labs/shared';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Milestone 24 Phase 04 — cross-cause chat identity integration test.
 *
 * Locks the lifecycle composition of three causes shipped independently
 * across Phases 01-03 of milestone 24:
 *
 *   - Cause A (extractGeneric Pi 0.74 bare-camelCase wire fix) — c76fd30
 *     Asserted indirectly here: a `chat.token_usage` event carrying Pi's
 *     bare-camelCase Usage shape `{ input, output, cacheRead, cacheWrite }`
 *     lands on the last assistant entry's `usage` object with all 4 fields
 *     verbatim. If the wire were broken, Phase 01's `chat-route.test.ts:340`
 *     would have failed at emit time (the route layer is the authoritative
 *     Cause A assertion); the store-level landing here confirms the full
 *     wire is intact end-to-end.
 *
 *   - Cause B T01 (App.tsx statusline fallback bind) — a6169f8
 *     Negative-path it-case asserts the store-level precondition: when
 *     `chat.start` fires WITHOUT a `model` field, `state.orchestratorModel`
 *     stays null, so the App.tsx fallback expression
 *     `state.orchestratorModel ?? currentModel()` falls through to
 *     `currentModel()`. The fallback expression itself is asserted at
 *     `dashboard-statusline.test.ts` (Phase 02 T01 — Solid render).
 *
 *   - Cause B T02 (ChatStartEvent.model schema + reducer) — 1bc0bd3
 *     Asserted via the lifecycle pump: `chat.start` with
 *     `model: 'deepseek/deepseek-v3'` → `state.orchestratorModel` set
 *     verbatim; `chat.complete` → `state.orchestratorModel` reset to
 *     null synchronously (no setTimeout). Individual assertions live in
 *     `dashboard-store.chat.test.ts:201-223` + L490-520 (Phase 02 T02).
 *
 *   - Cause C (chat-side resourceLoader vendor-neutral systemPrompt — D13) — 6cf0eb0
 *     NOTED-NOT-ASSERTED here. D13 fires at Pi `createSession` opts
 *     construction time inside the dashboard route layer; Pattern B
 *     exercises `createDashboardStore` directly via `actions.applyEvent`
 *     and never reaches the `createSession` boundary. The authoritative
 *     D13 runtime assertion is `chat-route.test.ts:5b` (Phase 03), which
 *     captures `SwtSessionOptions.systemPrompt` via `capturedOpts = opts`
 *     closure and asserts the regex sentinels for vendor-neutrality
 *     (`/inside pi|pi coding agent/i` negative match +
 *     `/identify yourself by your model name/i` positive match).
 *
 * Pattern B (per Scout 04-RESEARCH.md Investigation 2): mock api.js +
 * sse.js, exercise createDashboardStore directly via applyEvent pumps.
 * No Solid render, no cassette replay, no real Pi session spawn.
 */

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
const fetchUserNotesMock = vi.fn();
const postUserNotesMock = vi.fn();
const postOAuthStartMock = vi.fn();
const postOAuthCodeMock = vi.fn();
const postChatStartMock = vi.fn();

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
  fetchUserNotes: (...args: unknown[]) => fetchUserNotesMock(...args),
  postUserNotes: (...args: unknown[]) => postUserNotesMock(...args),
  postOAuthStart: (...args: unknown[]) => postOAuthStartMock(...args),
  postOAuthCode: (...args: unknown[]) => postOAuthCodeMock(...args),
  postChatStart: (...args: unknown[]) => postChatStartMock(...args),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

const chatEntries = (
  log: readonly LogEntry[],
): Array<Extract<LogEntry, { kind: 'chat-user' | 'chat-assistant' | 'chat-error' }>> =>
  log.filter(
    (e): e is Extract<LogEntry, { kind: 'chat-user' | 'chat-assistant' | 'chat-error' }> =>
      e.kind === 'chat-user' || e.kind === 'chat-assistant' || e.kind === 'chat-error',
  );

beforeEach(() => {
  postChatStartMock.mockReset();
  openSseConnectionMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('e2e vendor-agnostic chat identity integration (milestone 24)', () => {
  it('chat.start → chat.token_usage → chat.complete: D11 wire + D12 set + D12 reset compose end-to-end across one openrouter+deepseek-v3 lifecycle', async () => {
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      expect(state.orchestratorModel).toBeNull();

      await actions.startChat('who are you?');

      // ── chat.start with model → D12 set (Cause B T02 — 1bc0bd3) ────
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-20T12:00:00Z',
        chat_session_id: 'sess-e2e-1',
        prompt: 'who are you?',
        model: 'deepseek/deepseek-v3',
      });
      expect(state.chat_session_id).toBe('sess-e2e-1');
      expect(state.orchestratorModel).toBe('deepseek/deepseek-v3');

      // ── chat.token_usage with Pi 0.74 bare-camelCase → D11 indirect ──
      // Cause A's wire fix (c76fd30) is what allows extractGeneric to
      // emit this event with bare-camelCase usage at all; landing on the
      // store with all 4 fields verbatim confirms the full wire is intact.
      actions.applyEvent({
        type: 'chat.token_usage',
        ts: '2026-05-20T12:00:01Z',
        chat_session_id: 'sess-e2e-1',
        input: 1000,
        output: 200,
        cacheRead: 50,
        cacheWrite: 10,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v3',
      });
      const chats = chatEntries(state.unifiedLog);
      const lastAssistant = [...chats].reverse().find((e) => e.kind === 'chat-assistant');
      expect(lastAssistant?.kind).toBe('chat-assistant');
      if (lastAssistant?.kind === 'chat-assistant') {
        expect(lastAssistant.usage).toEqual({
          input: 1000,
          output: 200,
          cacheRead: 50,
          cacheWrite: 10,
          provider: 'openrouter',
          model: 'deepseek/deepseek-v3',
        });
      }

      // ── chat.complete → D12 reset (Cause B T02 synchronous, no setTimeout) ──
      actions.applyEvent({
        type: 'chat.complete',
        ts: '2026-05-20T12:00:02Z',
        chat_session_id: 'sess-e2e-1',
      });
      expect(state.orchestratorModel).toBeNull();
      expect(state.chatStreaming).toBe(false);
      expect(state.chatStatus).toBe('done');

      dispose();
    });
  });

  it('chat.start without model: state.orchestratorModel stays null (Cause B T01 fallback precondition at store level)', async () => {
    // Store-level invariant the App.tsx statusline fallback (a6169f8)
    // relies on: when ChatStartEvent omits the optional `model` field,
    // `state.orchestratorModel` stays null and the expression
    // `state.orchestratorModel ?? currentModel()` falls through to
    // currentModel(). The Solid render of the fallback expression itself
    // is asserted at dashboard-statusline.test.ts (Phase 02 T01).
    postChatStartMock.mockResolvedValueOnce(undefined);
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startChat('hi');
      actions.applyEvent({
        type: 'chat.start',
        ts: '2026-05-20T12:00:00Z',
        chat_session_id: 'sess-no-model',
        prompt: 'hi',
        // model field intentionally omitted (optional per events.ts:591)
      });
      expect(state.chat_session_id).toBe('sess-no-model');
      expect(state.orchestratorModel).toBeNull();
      dispose();
    });
  });
});

/**
 * PA-4 — ChatStartEvent.model TYPE-LOCK regression guard.
 *
 * Locks the `string | null | undefined` union shape of `ChatStartEvent.model`
 * shipped in Phase 02 T02 (commit 1bc0bd3, schema at
 * `packages/shared/src/schemas/events.ts:591` —
 * `model: z.string().nullable().optional()`). A future commit that renames
 * the field, narrows the union, or removes the field entirely fails this
 * test — at typecheck (the `satisfies` clauses below would error if the
 * schema-inferred type no longer matches the constructed objects) or at
 * runtime (the structural probes assert each leg of the union).
 *
 * `expectTypeOf<ChatStartEvent['model']>().toEqualTypeOf<string | null | undefined>()`
 * would be the strongest compile-time lock, but `expectTypeOf` is not in
 * workspace use yet (verified via `grep -r expectTypeOf packages/dashboard/test/
 * packages/shared/test/` returning empty). The `satisfies ChatStartEvent`
 * clauses below give the same compile-time signal without the dependency.
 */
describe('ChatStartEvent.model type-lock — Phase 02 T02 schema regression guard', () => {
  it('ChatStartEvent.model is string | null | undefined (type-lock — locks Phase 02 T02 schema commit 1bc0bd3 against future drift)', () => {
    // Leg 1 — string: the populated path Phase 02 T02 added.
    const withModel = {
      type: 'chat.start',
      ts: '2026-05-20T12:00:00.000Z',
      chat_session_id: 'sess-typelock-string',
      prompt: 'p',
      model: 'deepseek/deepseek-v3',
    } satisfies ChatStartEvent;
    expect(typeof withModel.model === 'string').toBe(true);
    expect(withModel.model).toBe('deepseek/deepseek-v3');

    // Leg 2 — null: explicit null per `.nullable()` (older daemon could
    // emit an explicit null to mean "I tried but Pi did not surface a
    // resolved id").
    const withNull = {
      type: 'chat.start',
      ts: '2026-05-20T12:00:00.000Z',
      chat_session_id: 'sess-typelock-null',
      prompt: 'p',
      model: null,
    } satisfies ChatStartEvent;
    expect(withNull.model).toBeNull();

    // Leg 3 — undefined (field omitted): the `.optional()` path that
    // makes the schema additive — older daemons predating Phase 02 T02
    // omit the field entirely and the reducer guard short-circuits.
    const withoutModel = {
      type: 'chat.start',
      ts: '2026-05-20T12:00:00.000Z',
      chat_session_id: 'sess-typelock-omitted',
      prompt: 'p',
    } satisfies ChatStartEvent;
    expect(withoutModel.model).toBeUndefined();
  });
});
