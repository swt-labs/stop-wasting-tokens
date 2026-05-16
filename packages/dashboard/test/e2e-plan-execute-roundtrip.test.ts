/**
 * Phase 03 / Plan 03-01 Task 4 — End-to-end regression test for the
 * dashboard cook bar's Plan + Execute mode handoff.
 *
 * Three narrative-style contract tests drive `createDashboardStore`
 * directly with mocked api + SSE modules (same harness pattern as
 * `dashboard-store-cook-events.test.ts`). The Hono server is NOT in
 * the loop here — the sibling `e2e-scope-seed-roundtrip.test.ts`
 * already covers the askUser ↔ /api/prompts/* surface end-to-end; this
 * file targets the dashboard-store state machine that sits between
 * the SSE stream and the SPA panels.
 *
 *   A. "vibeSession is replaced on a second startVibeSession" —
 *      proves GAP-01's replace-on-new-spawn lifecycle: a second cook
 *      session starts with a fresh session_id, empty conversation, and
 *      status='running'. The prior session's conversation does NOT
 *      leak.
 *
 *   B. "agent.prompt for the active cook session reaches the
 *      conversation thread even when vibeSession.session_id is stale" —
 *      proves GAP-01's relaxed dual-source guard. After a
 *      cook.completion + new cook.priority_decision, the
 *      vibeSession.session_id and activeSessionId diverge for the 10s
 *      clear window. Pre-Phase-03 the agent.prompt for the new session
 *      was silently dropped; the relaxed guard MUST accept it.
 *
 *   C. "cook.resume cancels the clear timer AND emits a log line" —
 *      proves GAP-03's handler: a resumed cook fires cook.resume
 *      while a previous cook.completion is mid-clear-window. The
 *      handler must cancel the clear and append a "[cook] resuming
 *      session {sid8} from {from_task}" line to recentLogLines.
 *
 * Hermetic by construction:
 *   - No API key required (no LLM in the loop).
 *   - No real Hono server (the prompts route is covered separately).
 *   - Each test runs in <1s; whole file completes well under the
 *     vitest default budget.
 */

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

beforeEach(() => {
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('e2e: dashboard Plan + Execute roundtrip (Phase 03 / Plan 03-01)', () => {
  it('A. vibeSession is replaced atomically on a second startVibeSession', async () => {
    // First cook bar Enter — scope mode.
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'sess-A',
      started_at: '2026-05-15T10:00:00Z',
    });
    // Second cook bar Enter — plan-and-execute mode (after Scope completed).
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'sess-B',
      started_at: '2026-05-15T10:05:00Z',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();

      // First Enter: vibeSession is born, status='running', empty
      // conversation.
      await actions.startVibeSession('build a snake game');
      expect(state.vibeSession?.session_id).toBe('sess-A');
      expect(state.vibeSession?.status).toBe('running');
      expect(state.vibeSession?.conversation.length).toBe(0);
      expect(state.vibeSession?.initial_prompt).toBe('build a snake game');

      // Seed the first session's conversation with an agent.prompt so
      // we can prove it doesn't leak into the next session.
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-15T10:00:01Z',
        session_id: 'sess-A',
        prompt_id: 'p-A',
        subtype: 'free_form',
        question: 'What do you want to build?',
        options: [{ label: 'a snake game', isRecommended: true }],
      });
      expect(state.vibeSession?.conversation.length).toBe(1);

      // Scope completes — status flips to 'completed', vibeSession
      // stays truthy for the 10s clear window.
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:01:00Z',
        session_id: 'sess-A',
        status: 'success',
      });
      expect(state.vibeSession).not.toBeNull();
      expect(state.vibeSession?.session_id).toBe('sess-A');
      expect(state.vibeSession?.status).toBe('completed');

      // Second Enter: vibeSession is REPLACED atomically. The new
      // object literal in startVibeSession resets session_id,
      // started_at, conversation (empty), and status='running'.
      await actions.startVibeSession('plan it');
      expect(state.vibeSession?.session_id).toBe('sess-B');
      expect(state.vibeSession?.status).toBe('running');
      expect(state.vibeSession?.conversation.length).toBe(0);
      expect(state.vibeSession?.initial_prompt).toBe('plan it');
      expect(state.vibeSession?.started_at).toBe('2026-05-15T10:05:00Z');

      dispose();
    });
  });

  it('B. agent.prompt for activeSessionId is accepted when it diverges from vibeSession.session_id', async () => {
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'sess-A',
      started_at: '2026-05-15T10:00:00Z',
    });

    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startVibeSession('build a snake game');

      // Scope completes — sess-A's status -> 'completed'. The clear
      // timer is now running but activeAgents/activeSessionId stay
      // populated until it fires (10s later).
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:01:00Z',
        session_id: 'sess-A',
        status: 'success',
      });

      // Cook spawns a NEW session (sess-B) — its first event is
      // cook.priority_decision, which moves activeSessionId to
      // 'sess-B'. The user has NOT pressed Enter again yet, so
      // vibeSession.session_id is still 'sess-A'.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-15T10:01:02Z',
        session_id: 'sess-B',
        priority: 9,
        mode: 'plan-and-execute',
      });
      expect(state.vibeSession?.session_id).toBe('sess-A');
      expect(state.activeSessionId).toBe('sess-B');

      // The Priority 9 confirmation gate fires — an agent.prompt for
      // sess-B. Pre-Phase-03 this was silently dropped (the single
      // session_id guard rejected it). The relaxed dual-source guard
      // MUST accept it because state.activeSessionId === 'sess-B'.
      // The chosen assertion: the entry lands in
      // vibeSession.conversation (it is NOT silently dropped at the
      // store layer). The render-path's per-session filtering is
      // Phase 04's territory; this test gates the store contract
      // only.
      const lenBefore = state.vibeSession?.conversation.length ?? 0;
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-15T10:01:03Z',
        session_id: 'sess-B',
        prompt_id: 'p-priority9',
        subtype: 'choice',
        question: 'Phase 01 needs planning and execution. Start?',
        options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
      });
      expect(state.vibeSession?.conversation.length).toBe(lenBefore + 1);
      const entry = state.vibeSession?.conversation[lenBefore];
      expect(entry?.prompt_id).toBe('p-priority9');
      expect(entry?.session_id).toBe('sess-B');
      expect(entry?.status).toBe('pending');
      expect(entry?.subtype).toBe('choice');

      dispose();
    });
  });

  it('C. cook.resume cancels the post-completion clear AND emits a log line', () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();

      // Set up: a cook session ran and completed (10s clear scheduled).
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-15T10:00:00Z',
        session_id: 'sess-original',
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-15T10:00:01Z',
        session_id: 'sess-original',
        role: 'orchestrator',
        sub_session_id: 'orch-1',
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:00:30Z',
        session_id: 'sess-original',
        status: 'success',
      });
      // Clear is now armed.
      expect(state.activeSessionId).toBe('sess-original');
      expect(state.activeAgents.size).toBe(1);

      // Mid-clear-window, cook.resume fires (crash-recovery path).
      // Schema requires from_task; the handler uses it in the log line.
      const resumedSessionId = 'sess-resumed-12345678ab';
      actions.applyEvent({
        type: 'cook.resume',
        ts: '2026-05-15T10:00:32Z',
        session_id: resumedSessionId,
        from_task: 'task-7',
        last_commit_hash: 'abc123',
        reason: 'prior_in_progress',
      });

      // activeSessionId moved to the resumed session.
      expect(state.activeSessionId).toBe(resumedSessionId);

      // Advancing past the original 10s clear window proves the timer
      // was cancelled — activeSessionId is still the resumed one, and
      // activeAgents was NOT wiped (the cancel kept the prior rows
      // visible while the resumed cook stabilises).
      vi.advanceTimersByTime(15_000);
      expect(state.activeSessionId).toBe(resumedSessionId);
      expect(state.activeAgents.size).toBe(1);

      // Milestone 13 / Phase 01 — the legacy `appendLogLine` write is gone;
      // the resume breadcrumb is now a cook-status LogEntry in unifiedLog.
      // Format is "resuming session {sid8} from {from_task}" where
      // sid8 = resumedSessionId.slice(0, 8) = 'sess-res'.
      const cookStatusMessages = state.unifiedLog
        .filter((e) => e.kind === 'cook-status')
        .map((e) => (e.kind === 'cook-status' ? e.message : ''));
      const expectedSid8 = resumedSessionId.slice(0, 8);
      expect(
        cookStatusMessages.some(
          (m) => m.includes(`resuming session ${expectedSid8}`) && m.includes('from task-7'),
        ),
      ).toBe(true);

      dispose();
    });
  });
});
