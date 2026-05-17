/**
 * Milestone 13 / Phase 03 — `actions.respondToCookAskUser` coverage.
 *
 * Mirrors `dashboard-store-cook-events.test.ts`: vi.mock services/api.js
 * + services/sse.js, createRoot, drive the store. The Phase 02 reducer
 * side (prompt.request/response/timeout) is covered by
 * `cook-ask-user-roundtrip.test.ts`; this file targets the Phase 03
 * ACTION side — the user-dispatched respond path with optimistic mark +
 * optimistic clear + revert-on-error (Scout §7).
 *
 * Coverage (5 cases, plan target ≥ 4):
 *   - Case A: optimistic mark + clear before await resolves
 *   - Case B: postCookRespond receives the canonical {cook_session_id,
 *             askUserId, response} body
 *   - Case C: no-active-session early-return + pushError (no POST)
 *   - Case D: no-pending-entry early-return + pushError (no POST)
 *   - Case E: revert-on-error — entry status reverts to 'pending',
 *             cookAwaitingUser snapshot restored, a system LogEntry is
 *             appended + an error pushed
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchSnapshotMock = vi.fn();
const postInitMock = vi.fn();
const postCommandMock = vi.fn();
const postUatCheckpointMock = vi.fn();
const fetchArtifactRenderedMock = vi.fn();
const postCookStartMock = vi.fn();
const postCookRespondMock = vi.fn();
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
  postCookRespond: (...args: unknown[]) => postCookRespondMock(...args),
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
  postOAuthStart: vi.fn(),
  postOAuthCode: vi.fn(),
  postChatStart: vi.fn(),
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

beforeEach(() => {
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Seed an active cook session + a pending CookAskUserEntry by replaying
 * the same SSE sequence the production code uses (cook.priority_decision
 * → prompt.request). This keeps the test driving the store through its
 * public reducer surface, not via private setState hooks.
 */
function seedPendingPrompt(
  actions: ReturnType<typeof createDashboardStore>[1],
  sessionId = 'sess-1',
  promptId = 'prompt-1',
): void {
  actions.applyEvent({
    type: 'cook.priority_decision',
    ts: '2026-05-17T10:00:00Z',
    session_id: sessionId,
    priority: 5,
    mode: 'execute',
  });
  actions.applyEvent({
    type: 'prompt.request',
    ts: '2026-05-17T10:00:01Z',
    session_id: sessionId,
    prompt_id: promptId,
    question: 'Which migration strategy?',
    options: [
      { label: 'Schema first' },
      { label: 'Data first', isRecommended: true },
    ],
  });
}

describe('actions.respondToCookAskUser', () => {
  it('Case A: optimistically marks the matching entry answered + clears cookAwaitingUser BEFORE the POST resolves', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      seedPendingPrompt(actions);

      // Hold the postCookRespond promise so we can inspect the optimistic
      // state in the gap between dispatch and resolution.
      let resolvePost: (() => void) | undefined;
      postCookRespondMock.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolvePost = resolve;
        }),
      );

      // Dispatch but do NOT await yet — we want to peek mid-flight.
      const pending = actions.respondToCookAskUser('prompt-1', {
        selectedOption: 'Schema first',
        freeform: null,
      });

      // Optimistic state has already landed (synchronous setState).
      const idx = state.unifiedLog.findIndex(
        (e) => e.kind === 'cook-ask-user' && e.prompt_id === 'prompt-1',
      );
      expect(idx).toBeGreaterThanOrEqual(0);
      const entry = state.unifiedLog[idx];
      expect(entry?.kind).toBe('cook-ask-user');
      if (entry?.kind === 'cook-ask-user') {
        expect(entry.status).toBe('answered');
        expect(entry.reply).toBe('Schema first');
      }
      expect(state.cookAwaitingUser).toBe(null);

      // Resolve the POST and let the action complete.
      resolvePost?.();
      await pending;
      dispose();
    });
  });

  it('Case B: calls postCookRespond with the canonical {cook_session_id, askUserId, response} body', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      seedPendingPrompt(actions, 'sess-42', 'prompt-99');
      postCookRespondMock.mockResolvedValueOnce(undefined);

      await actions.respondToCookAskUser('prompt-99', {
        selectedOption: null,
        freeform: 'a custom answer',
      });

      expect(postCookRespondMock).toHaveBeenCalledTimes(1);
      expect(postCookRespondMock).toHaveBeenCalledWith({
        cook_session_id: 'sess-42',
        askUserId: 'prompt-99',
        response: { selectedOption: null, freeform: 'a custom answer' },
      });
      dispose();
    });
  });

  it('Case C: early-returns + pushError when there is no active cook session (does NOT POST)', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // No cook.priority_decision, no prompt.request — state.activeSessionId is null.
      await actions.respondToCookAskUser('prompt-1', {
        selectedOption: 'a',
        freeform: null,
      });
      expect(postCookRespondMock).not.toHaveBeenCalled();
      expect(state.errors.length).toBe(1);
      expect(state.errors[0]?.message).toMatch(/no active cook session/);
      dispose();
    });
  });

  it('Case D: no-op + pushError when no pending entry matches the askUserId (does NOT POST, leaves cookAwaitingUser intact)', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      seedPendingPrompt(actions);
      const awaitingBefore = state.cookAwaitingUser;
      expect(awaitingBefore).not.toBe(null);

      await actions.respondToCookAskUser('prompt-DOES-NOT-EXIST', {
        selectedOption: 'a',
        freeform: null,
      });

      expect(postCookRespondMock).not.toHaveBeenCalled();
      expect(state.cookAwaitingUser).toEqual(awaitingBefore);
      const errs = state.errors;
      expect(errs.length).toBe(1);
      expect(errs[0]?.message).toMatch(/no pending entry/);
      dispose();
    });
  });

  it('Case E: revert-on-error — entry reverts to pending, cookAwaitingUser is restored, system LogEntry + pushError surface the failure', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      seedPendingPrompt(actions);

      // Snapshot the slot for explicit equality.
      const awaitingBefore = state.cookAwaitingUser;
      expect(awaitingBefore).not.toBe(null);

      postCookRespondMock.mockRejectedValueOnce(new Error('network down'));
      await actions.respondToCookAskUser('prompt-1', {
        selectedOption: 'Schema first',
        freeform: null,
      });

      // Revert: entry back to pending, reply cleared.
      const reverted = state.unifiedLog.find(
        (e) => e.kind === 'cook-ask-user' && e.prompt_id === 'prompt-1',
      );
      expect(reverted?.kind).toBe('cook-ask-user');
      if (reverted?.kind === 'cook-ask-user') {
        expect(reverted.status).toBe('pending');
        expect(reverted.reply).toBeUndefined();
      }
      // Slot restored.
      expect(state.cookAwaitingUser).toEqual(awaitingBefore);
      // pushError pill appended.
      const errs = state.errors;
      expect(errs.length).toBeGreaterThanOrEqual(1);
      expect(errs[errs.length - 1]?.message).toMatch(/cook askUser respond failed.*network down/);
      // System inline log entry appended (channel: 'internal').
      const sysEntry = state.unifiedLog.find(
        (e) => e.kind === 'system' && e.line.includes('respond failed'),
      );
      expect(sysEntry).toBeDefined();
      dispose();
    });
  });
});
