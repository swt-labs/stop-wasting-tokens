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
  // Phase 3 — dashboard-store.ts now imports these; the mock must export
  // them or createDashboardStore() throws at the toolsFetchers map.
  fetchProviderAuth: (...args: unknown[]) => fetchProviderAuthMock(...args),
  postProviderAuth: (...args: unknown[]) => postProviderAuthMock(...args),
  // User Notes — dashboard-store.ts imports these for the userNotes cell;
  // the mock must export them or createDashboardStore() throws.
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

describe('cook event reducer', () => {
  it('cook.priority_decision sets activeSessionId', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        priority: 5,
        mode: 'execute',
      });
      expect(state.activeSessionId).toBe('sess-1');
      dispose();
    });
  });

  it('cook.agent_spawn creates a running row keyed by sub_session_id', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      const row = state.activeAgents.get('sub-X');
      expect(row).toBeDefined();
      expect(row?.role).toBe('dev');
      expect(row?.status).toBe('running');
      expect(row?.tokens_in).toBe(0);
      expect(row?.tokens_out).toBe(0);
      expect(row?.cost_usd).toBe(0);
      expect(row?.started_at).toBe('2026-05-13T10:00:00Z');
      // Statusline-extension milestone — without an explicit `model` on
      // the event, the AgentLiveState row should NOT carry one either
      // (the optional schema field stays undefined).
      expect(row?.model).toBeUndefined();
      dispose();
    });
  });

  it('cook.agent_spawn populates AgentLiveState.model when the event carries one', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-17T10:00:00Z',
        session_id: 'sess-1',
        role: 'orchestrator',
        sub_session_id: 'sess-1',
        model: 'claude-opus-4-7',
      });
      const row = state.activeAgents.get('sess-1');
      expect(row).toBeDefined();
      expect(row?.role).toBe('orchestrator');
      expect(row?.model).toBe('claude-opus-4-7');
      dispose();
    });
  });

  it('cook.tool_call sets current_tool + excerpt on the existing row', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      actions.applyEvent({
        type: 'cook.tool_call',
        ts: '2026-05-13T10:00:01Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-X',
        tool: 'Read',
        input_excerpt: 'src/foo.ts',
      });
      expect(state.activeAgents.get('sub-X')?.current_tool).toBe('Read');
      expect(state.activeAgents.get('sub-X')?.current_tool_input_excerpt).toBe('src/foo.ts');
      dispose();
    });
  });

  it('cook.tool_result clears current_tool when tool matches', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      actions.applyEvent({
        type: 'cook.tool_call',
        ts: '2026-05-13T10:00:01Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-X',
        tool: 'Read',
        input_excerpt: 'src/foo.ts',
      });
      actions.applyEvent({
        type: 'cook.tool_result',
        ts: '2026-05-13T10:00:02Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-X',
        tool: 'Read',
        result_excerpt: 'file contents',
        duration_ms: 12,
      });
      expect(state.activeAgents.get('sub-X')?.current_tool).toBeUndefined();
      expect(state.activeAgents.get('sub-X')?.current_tool_input_excerpt).toBeUndefined();
      dispose();
    });
  });

  it('cook.tool_result for a stale tool name leaves current_tool intact', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      actions.applyEvent({
        type: 'cook.tool_call',
        ts: '2026-05-13T10:00:01Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-X',
        tool: 'Edit',
        input_excerpt: 'foo',
      });
      // Stale result for a different tool — should not clear.
      actions.applyEvent({
        type: 'cook.tool_result',
        ts: '2026-05-13T10:00:02Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-X',
        tool: 'Read',
        result_excerpt: '...',
        duration_ms: 5,
      });
      expect(state.activeAgents.get('sub-X')?.current_tool).toBe('Edit');
      dispose();
    });
  });

  it('cook.agent_result accumulates tokens and marks status completed', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: '2026-05-13T10:00:30Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-X',
        status: 'completed',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 200,
          cost_usd: 0.0123,
        },
      });
      const row = state.activeAgents.get('sub-X');
      expect(row?.status).toBe('completed');
      expect(row?.tokens_in).toBe(1000);
      expect(row?.tokens_out).toBe(500);
      expect(row?.cache_creation).toBe(100);
      expect(row?.cache_read).toBe(200);
      expect(row?.cost_usd).toBeCloseTo(0.0123);
      expect(row?.elapsed_ms).toBe(30_000);
      // Final state has no in-flight tool.
      expect(row?.current_tool).toBeUndefined();
      dispose();
    });
  });

  it('cook.agent_result with status=failed marks the row failed', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'qa',
        sub_session_id: 'sub-Y',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: '2026-05-13T10:00:05Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-Y',
        status: 'failed',
        usage: { input_tokens: 50, output_tokens: 0 },
      });
      expect(state.activeAgents.get('sub-Y')?.status).toBe('failed');
      dispose();
    });
  });

  it('cook.completion clears agents after 10s via the timer', () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-13T10:01:00Z',
        session_id: 'sess-1',
        status: 'success',
      });
      // Before the 10s timer fires, the rows + session id are still visible
      // for inspection.
      expect(state.activeAgents.size).toBe(1);
      expect(state.activeSessionId).toBe('sess-1');
      vi.advanceTimersByTime(10_000);
      expect(state.activeAgents.size).toBe(0);
      expect(state.activeSessionId).toBeNull();
      dispose();
    });
  });

  it('cook.priority_decision cancels a pending post-completion clear', () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-13T10:00:10Z',
        session_id: 'sess-1',
        status: 'success',
      });
      // Mid-clear-window a new cook starts.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-13T10:00:15Z',
        session_id: 'sess-2',
        priority: 5,
        mode: 'execute',
      });
      vi.advanceTimersByTime(10_000);
      // Previous session's row survives — the new cook is in-flight.
      expect(state.activeAgents.size).toBe(1);
      expect(state.activeSessionId).toBe('sess-2');
      dispose();
    });
  });

  it('cook.tool_call against an unknown sub_session_id is a no-op (no row created)', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.tool_call',
        ts: '2026-05-13T10:00:01Z',
        session_id: 'sess-1',
        sub_session_id: 'sub-unknown',
        tool: 'Read',
        input_excerpt: 'x',
      });
      expect(state.activeAgents.size).toBe(0);
      dispose();
    });
  });

  it('cook.file_write / cook.commit / cook.error do not mutate activeAgents', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: '2026-05-13T10:00:00Z',
        session_id: 'sess-1',
        role: 'dev',
        sub_session_id: 'sub-X',
      });
      const snapshotBefore = state.activeAgents.get('sub-X');
      actions.applyEvent({
        type: 'cook.file_write',
        ts: '2026-05-13T10:00:01Z',
        session_id: 'sess-1',
        path: 'foo.ts',
        bytes: 42,
      });
      actions.applyEvent({
        type: 'cook.commit',
        ts: '2026-05-13T10:00:02Z',
        session_id: 'sess-1',
        commit_sha: 'abc123',
        message: 'feat: ...',
      });
      actions.applyEvent({
        type: 'cook.error',
        ts: '2026-05-13T10:00:03Z',
        session_id: 'sess-1',
        code: 'E_FOO',
        message: 'boom',
      });
      // Row is unchanged.
      expect(state.activeAgents.get('sub-X')).toEqual(snapshotBefore);
      dispose();
    });
  });

  /* ── Phase 03 / Plan 03-01 — extended cases ────────────────────────────
   * Four new it() blocks that target the store's GAP-01 + GAP-03 fixes
   * at unit granularity (no Hono server in the loop — the sibling e2e
   * test exercises the prompt-publish route separately). Mirror the
   * existing harness: createRoot + applyEvent + mocked postCookStart
   * for startVibeSession.
   */

  it('cook.resume: sets activeSessionId, cancels clear timer, appends log line', () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      // Seed a pending clear by completing a prior session first.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-15T10:00:00Z',
        session_id: 'sess-old',
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:00:30Z',
        session_id: 'sess-old',
        status: 'success',
      });
      // Mid-clear-window, cook.resume fires for the recovered session.
      actions.applyEvent({
        type: 'cook.resume',
        ts: '2026-05-15T10:00:35Z',
        session_id: 'sess-resume-abc12345',
        from_task: 'task-7',
        last_commit_hash: 'abc123',
      });
      // Side effect 1: activeSessionId switched.
      expect(state.activeSessionId).toBe('sess-resume-abc12345');
      // Side effect 2: clear timer cancelled — advancing past 10s does
      // not null activeSessionId (which is the cancel signal).
      vi.advanceTimersByTime(15_000);
      expect(state.activeSessionId).toBe('sess-resume-abc12345');
      // Side effect 3: cook-status resumed entry emitted with sid8 + from_task.
      // Milestone 13 / Phase 01 — the legacy `appendLogLine` write is gone;
      // the resume breadcrumb is now a cook-status LogEntry in unifiedLog.
      const cookStatusMessages = state.unifiedLog
        .filter((e) => e.kind === 'cook-status')
        .map((e) => (e.kind === 'cook-status' ? e.message : ''));
      expect(
        cookStatusMessages.some(
          (m) => m.includes('resuming session sess-res') && m.includes('task-7'),
        ),
      ).toBe(true);
      dispose();
    });
  });

  it('cook.completion sets vibeSession.status to "completed" without nulling vibeSession', async () => {
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'sess-1',
      started_at: '2026-05-15T10:00:00Z',
    });
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startVibeSession('build a snake game');
      expect(state.vibeSession?.session_id).toBe('sess-1');
      expect(state.vibeSession?.status).toBe('running');
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:01:00Z',
        session_id: 'sess-1',
        status: 'success',
      });
      // vibeSession stays truthy — the 10s clear window must keep the
      // conversation readable.
      expect(state.vibeSession).not.toBeNull();
      expect(state.vibeSession?.session_id).toBe('sess-1');
      expect(state.vibeSession?.status).toBe('completed');
      dispose();
    });
  });

  it('cook.error sets vibeSession.status to "crashed"', async () => {
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'sess-2',
      started_at: '2026-05-15T10:00:00Z',
    });
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startVibeSession('hello world');
      expect(state.vibeSession?.status).toBe('running');
      actions.applyEvent({
        type: 'cook.error',
        ts: '2026-05-15T10:00:05Z',
        session_id: 'sess-2',
        code: 'COOK_SPAWN_FAILED',
        message: 'cook process exited within 5s of spawn',
      });
      expect(state.vibeSession).not.toBeNull();
      expect(state.vibeSession?.status).toBe('crashed');
      dispose();
    });
  });

  it('agent.prompt is accepted when session_id matches activeSessionId even if vibeSession.session_id differs', async () => {
    postCookStartMock.mockResolvedValueOnce({
      session_id: 'sess-A',
      started_at: '2026-05-15T10:00:00Z',
    });
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      await actions.startVibeSession('first prompt');
      // First session completes; vibeSession.session_id is still 'sess-A'.
      actions.applyEvent({
        type: 'cook.completion',
        ts: '2026-05-15T10:01:00Z',
        session_id: 'sess-A',
        status: 'success',
      });
      // A NEW cook session (sess-B) starts — cook.priority_decision
      // arrives BEFORE the user has called startVibeSession again,
      // which is the race the relaxed guard exists to handle.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: '2026-05-15T10:01:01Z',
        session_id: 'sess-B',
        priority: 9,
        mode: 'plan-and-execute',
      });
      expect(state.activeSessionId).toBe('sess-B');
      // agent.prompt for sess-B arrives — vibeSession.session_id is
      // still 'sess-A' but activeSessionId === 'sess-B', so the
      // relaxed dual-source guard MUST accept it (pre-Phase-03 this
      // was silently dropped).
      const lengthBefore = state.vibeSession?.conversation.length ?? 0;
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-15T10:01:02Z',
        session_id: 'sess-B',
        prompt_id: 'p-2',
        subtype: 'choice',
        question: 'Phase 01 needs planning and execution. Start?',
        options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
      });
      expect(state.vibeSession?.conversation.length ?? 0).toBe(lengthBefore + 1);
      const entry = state.vibeSession?.conversation[lengthBefore];
      expect(entry?.session_id).toBe('sess-B');
      expect(entry?.prompt_id).toBe('p-2');
      expect(entry?.status).toBe('pending');
      dispose();
    });
  });

  it('snapshot.replace hydrates activeAgents from snapshot.active_agents[]', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      // Plan 04-02 T1 landed `active_agents[]` on the shared schema.
      const snap = {
        schema_version: '1',
        generated_at: '2026-05-13T10:00:00Z',
        project: null,
        milestone: null,
        phases: [],
        recent_events: [],
        cost_summary: null,
        is_initialized: true,
        active_agents: [
          {
            sub_session_id: 'sub-A',
            role: 'dev',
            status: 'running',
            tokens_in: 100,
            tokens_out: 50,
            cache_read: 0,
            cache_creation: 0,
            cost_usd: 0.001,
            elapsed_ms: 1234,
            started_at: '2026-05-13T09:59:00Z',
          },
        ],
      } as unknown as Parameters<typeof actions.applyEvent>[0] extends infer T ? T : never;
      actions.applyEvent({ type: 'snapshot.replace', snapshot: snap as never });
      expect(state.activeAgents.size).toBe(1);
      expect(state.activeAgents.get('sub-A')?.role).toBe('dev');
      dispose();
    });
  });

  // ── Statusline-extension milestone — cook.provider_selected.model ────────
  // The cook callsite emits the resolved orchestrator model on
  // cook.provider_selected when it knows it (today: `strategy.model` on
  // cost-optimized-rate-card strategies). The reducer captures that into
  // `state.orchestratorModel` for the statusline cell.
  describe('cook.provider_selected → state.orchestratorModel', () => {
    it('sets orchestratorModel when payload carries a non-empty model', () => {
      createRoot((dispose) => {
        const [state, actions] = createDashboardStore();
        expect(state.orchestratorModel).toBeNull();
        actions.applyEvent({
          type: 'cook.provider_selected',
          ts: '2026-05-17T10:00:00Z',
          session_id: 'sess-1',
          sub_session_id: 'sess-1',
          selected_provider: 'anthropic',
          selected_via: 'pinned',
          model: 'claude-sonnet-4-6',
        });
        expect(state.orchestratorModel).toBe('claude-sonnet-4-6');
        dispose();
      });
    });

    it('leaves orchestratorModel unchanged when payload omits model', () => {
      createRoot((dispose) => {
        const [state, actions] = createDashboardStore();
        actions.applyEvent({
          type: 'cook.provider_selected',
          ts: '2026-05-17T10:00:00Z',
          session_id: 'sess-1',
          sub_session_id: 'sess-1',
          selected_provider: 'anthropic',
          selected_via: 'pinned',
          model: 'claude-opus-4-7',
        });
        expect(state.orchestratorModel).toBe('claude-opus-4-7');
        // Second event without `model` — must NOT clobber to null.
        actions.applyEvent({
          type: 'cook.provider_selected',
          ts: '2026-05-17T10:00:05Z',
          session_id: 'sess-1',
          sub_session_id: 'sess-1',
          selected_provider: 'anthropic',
          selected_via: 'tier-routed',
          tier: 'quality',
        });
        expect(state.orchestratorModel).toBe('claude-opus-4-7');
        dispose();
      });
    });

    it('treats empty-string model as omitted (does not clobber existing value)', () => {
      createRoot((dispose) => {
        const [state, actions] = createDashboardStore();
        actions.applyEvent({
          type: 'cook.provider_selected',
          ts: '2026-05-17T10:00:00Z',
          session_id: 'sess-1',
          sub_session_id: 'sess-1',
          selected_provider: 'anthropic',
          selected_via: 'pinned',
          model: 'claude-haiku-4-5',
        });
        expect(state.orchestratorModel).toBe('claude-haiku-4-5');
        // Empty string would be a Zod-rejected runtime payload but we
        // defend at the reducer too.
        actions.applyEvent({
          type: 'cook.provider_selected',
          ts: '2026-05-17T10:00:05Z',
          session_id: 'sess-1',
          sub_session_id: 'sess-1',
          selected_provider: 'anthropic',
          selected_via: 'pinned',
          // @ts-expect-error — defensively tested even though Zod rejects ''
          model: '',
        });
        expect(state.orchestratorModel).toBe('claude-haiku-4-5');
        dispose();
      });
    });
  });
});

/**
 * Plan 02-01 (milestone 13, Phase 02) — cook askUser SSE bridge reducer.
 *
 * Three reducer cases drive the CookAskUserEntry lifecycle:
 *   - prompt.request (cook-session-correlated) → push entry `pending` + set slot
 *   - prompt.response (prompt_id match)        → mutate entry `answered` + clear slot
 *   - cook.ask_user_timeout (prompt_id match)  → mutate entry `expired`  + clear slot
 *
 * Correlation key: `evt.session_id === state.activeSessionId` (cook session)
 * for the emit half; `prompt_id` for both response halves. Non-cook prompts
 * (init Lead, /vbw subagents, init-test seams) MUST NOT pollute the unified
 * log (Scout Cross-cutting #8).
 *
 * Single-card invariant (Scout §7): a second prompt.request while the slot
 * is still set OVERWRITES the slot; the older CookAskUserEntry is NOT
 * auto-mutated (Phase 03 may render as 'missed' visually).
 */
describe('cook askUser reducer — prompt.request / prompt.response / cook.ask_user_timeout', () => {
  const TS = '2026-05-17T00:00:00Z';
  const COOK_SID = 'cook-session-1';

  const seedActiveSession = (
    actions: ReturnType<typeof createDashboardStore>[1],
    session_id: string,
  ): void => {
    actions.applyEvent({
      type: 'cook.priority_decision',
      ts: TS,
      session_id,
      priority: 5,
      mode: 'execute',
    });
  };

  it('C.1 — prompt.request with session_id === activeSessionId appends CookAskUserEntry + sets cookAwaitingUser', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      const baseLogLen = state.unifiedLog.length;
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-1',
        question: 'Proceed with scope?',
        options: [{ label: 'Yes', isRecommended: true }, { label: 'No' }],
      });
      expect(state.unifiedLog.length).toBe(baseLogLen + 1);
      const entry = state.unifiedLog[state.unifiedLog.length - 1];
      expect(entry.kind).toBe('cook-ask-user');
      if (entry.kind === 'cook-ask-user') {
        expect(entry.prompt_id).toBe('p-1');
        expect(entry.session_id).toBe(COOK_SID);
        expect(entry.question).toBe('Proceed with scope?');
        expect(entry.status).toBe('pending');
        expect(entry.options).toEqual([
          { value: 'Yes', label: 'Yes', description: 'Recommended' },
          { value: 'No', label: 'No' },
        ]);
      }
      expect(state.cookAwaitingUser).not.toBeNull();
      expect(state.cookAwaitingUser?.askUserId).toBe('p-1');
      expect(state.cookAwaitingUser?.question).toBe('Proceed with scope?');
      expect(state.cookAwaitingUser?.allowFreeform).toBe(true);
      dispose();
    });
  });

  it('C.2 — prompt.request with session_id !== activeSessionId is IGNORED (no entry, no slot)', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      const baseLogLen = state.unifiedLog.length;
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: 'init-lead-session',
        prompt_id: 'p-init-1',
        question: 'Init Lead question?',
        options: [{ label: 'OK' }],
      });
      expect(state.unifiedLog.length).toBe(baseLogLen);
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });

  it('C.3 — prompt.response with matching prompt_id mutates entry to answered + clears slot', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-3',
        question: 'Q?',
        options: [{ label: 'Yes' }, { label: 'No' }],
      });
      actions.applyEvent({
        type: 'prompt.response',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-3',
        selectedOption: 'Yes',
        freeform: null,
      });
      const entry = state.unifiedLog[state.unifiedLog.length - 1];
      expect(entry.kind).toBe('cook-ask-user');
      if (entry.kind === 'cook-ask-user') {
        expect(entry.status).toBe('answered');
        expect(entry.reply).toBe('Yes');
      }
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });

  it('C.4 — prompt.response with freeform (Other path) carries freeform into reply', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-4',
        question: 'Q?',
        options: [{ label: 'A' }],
      });
      actions.applyEvent({
        type: 'prompt.response',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-4',
        selectedOption: null,
        freeform: 'custom text',
      });
      const entry = state.unifiedLog[state.unifiedLog.length - 1];
      expect(entry.kind).toBe('cook-ask-user');
      if (entry.kind === 'cook-ask-user') {
        expect(entry.status).toBe('answered');
        expect(entry.reply).toBe('custom text');
      }
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });

  it('C.5 — cook.ask_user_timeout with matching prompt_id mutates entry to expired + clears slot', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-5',
        question: 'Q?',
        options: [{ label: 'A' }],
      });
      actions.applyEvent({
        type: 'cook.ask_user_timeout',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-5',
      });
      const entry = state.unifiedLog[state.unifiedLog.length - 1];
      expect(entry.kind).toBe('cook-ask-user');
      if (entry.kind === 'cook-ask-user') {
        expect(entry.status).toBe('expired');
        expect(entry.reply).toBeUndefined();
      }
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });

  it('C.6 — cook.ask_user_timeout with unknown prompt_id is a no-op', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-6',
        question: 'Q?',
        options: [{ label: 'A' }],
      });
      const beforeLogLen = state.unifiedLog.length;
      actions.applyEvent({
        type: 'cook.ask_user_timeout',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-does-not-exist',
      });
      expect(state.unifiedLog.length).toBe(beforeLogLen);
      // The original 'p-6' entry is still pending; slot unchanged.
      const entry = state.unifiedLog[state.unifiedLog.length - 1];
      if (entry.kind === 'cook-ask-user') {
        expect(entry.status).toBe('pending');
      }
      expect(state.cookAwaitingUser?.askUserId).toBe('p-6');
      dispose();
    });
  });

  it('C.7 — second prompt.request for same cook session OVERWRITES slot but does NOT mutate prior entry status', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-7a',
        question: 'First?',
        options: [{ label: 'A' }],
      });
      const firstEntryAfterAppend = state.unifiedLog[state.unifiedLog.length - 1];
      expect(firstEntryAfterAppend.kind).toBe('cook-ask-user');
      actions.applyEvent({
        type: 'prompt.request',
        ts: TS,
        session_id: COOK_SID,
        prompt_id: 'p-7b',
        question: 'Second?',
        options: [{ label: 'B' }],
      });
      // Slot now points at the second prompt.
      expect(state.cookAwaitingUser?.askUserId).toBe('p-7b');
      // The first entry is still in the log AND still pending.
      const firstStill = state.unifiedLog.find(
        (e) => e.kind === 'cook-ask-user' && e.prompt_id === 'p-7a',
      );
      expect(firstStill?.kind).toBe('cook-ask-user');
      if (firstStill?.kind === 'cook-ask-user') {
        expect(firstStill.status).toBe('pending');
      }
      // The second entry is present and pending.
      const secondEntry = state.unifiedLog.find(
        (e) => e.kind === 'cook-ask-user' && e.prompt_id === 'p-7b',
      );
      if (secondEntry?.kind === 'cook-ask-user') {
        expect(secondEntry.status).toBe('pending');
      }
      dispose();
    });
  });

  it('C.8 — chat.* reducers continue to work unchanged (no CookAskUserEntry side-effects)', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      seedActiveSession(actions, COOK_SID);
      actions.applyEvent({
        type: 'chat.start',
        ts: TS,
        chat_session_id: 'chat-1',
        prompt: 'hi',
      });
      actions.applyEvent({
        type: 'chat.message_delta',
        ts: TS,
        chat_session_id: 'chat-1',
        text: 'hello back',
      });
      // No CookAskUserEntry was created by the chat flow.
      const cookAskEntries = state.unifiedLog.filter((e) => e.kind === 'cook-ask-user');
      expect(cookAskEntries.length).toBe(0);
      // cookAwaitingUser is still null — chat does NOT touch it.
      expect(state.cookAwaitingUser).toBeNull();
      dispose();
    });
  });
});

// ── Statusline v2 Wave 2 — orchestrator-model + per-session input-tokens ─
//
// Wave 2 introduces `state.orchestratorSessionInputTokens` and threads
// resets through `cook.priority_decision` (new session start) + the 10s
// post-`cook.completion` cookClearTimer. The orchestratorModel slot
// gets the same 10s clear so it doesn't bleed across sessions.
describe('statusline v2 Wave 2 — orchestrator session resets', () => {
  const SID_A = 'sess-A';
  const SID_B = 'sess-B';
  const TS_W2 = '2026-05-20T19:00:00Z';

  it('initial state: orchestratorSessionInputTokens starts at 0, orchestratorModel null', () => {
    createRoot((dispose) => {
      const [state] = createDashboardStore();
      expect(state.orchestratorSessionInputTokens).toBe(0);
      expect(state.orchestratorModel).toBeNull();
      dispose();
    });
  });

  it('cook.priority_decision resets orchestratorSessionInputTokens to 0 on every new session', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      // Seed: session A spawn + agent_result so the counter is non-zero.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS_W2,
        session_id: SID_A,
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: TS_W2,
        session_id: SID_A,
        role: 'dev',
        sub_session_id: 'sub-1',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: TS_W2,
        session_id: SID_A,
        sub_session_id: 'sub-1',
        status: 'completed',
        usage: {
          input_tokens: 12_345,
          output_tokens: 3_000,
        },
      });
      expect(state.orchestratorSessionInputTokens).toBe(12_345);

      // A new session arrives — counter resets to 0.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS_W2,
        session_id: SID_B,
        priority: 5,
        mode: 'execute',
      });
      expect(state.orchestratorSessionInputTokens).toBe(0);
      expect(state.activeSessionId).toBe(SID_B);
      dispose();
    });
  });

  it('cook.agent_result accumulates input_tokens across multiple agents within one session', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS_W2,
        session_id: SID_A,
        priority: 5,
        mode: 'execute',
      });
      // Two agents, two result events. Counter sums.
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: TS_W2,
        session_id: SID_A,
        role: 'scout',
        sub_session_id: 'sub-scout',
      });
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: TS_W2,
        session_id: SID_A,
        role: 'dev',
        sub_session_id: 'sub-dev',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: TS_W2,
        session_id: SID_A,
        sub_session_id: 'sub-scout',
        status: 'completed',
        usage: { input_tokens: 5_000, output_tokens: 1_000 },
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: TS_W2,
        session_id: SID_A,
        sub_session_id: 'sub-dev',
        status: 'completed',
        usage: { input_tokens: 8_500, output_tokens: 2_500 },
      });
      expect(state.orchestratorSessionInputTokens).toBe(13_500);
      dispose();
    });
  });

  it('cook.completion 10s timer clears orchestratorModel + orchestratorSessionInputTokens', () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS_W2,
        session_id: SID_A,
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'cook.provider_selected',
        ts: TS_W2,
        session_id: SID_A,
        provider: 'anthropic',
        tier: 'sonnet',
        model: 'claude-sonnet-4-6',
      });
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: TS_W2,
        session_id: SID_A,
        role: 'dev',
        sub_session_id: 'sub-1',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: TS_W2,
        session_id: SID_A,
        sub_session_id: 'sub-1',
        status: 'completed',
        usage: { input_tokens: 7_777, output_tokens: 1_000 },
      });
      expect(state.orchestratorModel).toBe('claude-sonnet-4-6');
      expect(state.orchestratorSessionInputTokens).toBe(7_777);

      // Completion arrives — both values stay non-null for the 10s
      // hold window so the user can glance at them.
      actions.applyEvent({
        type: 'cook.completion',
        ts: TS_W2,
        session_id: SID_A,
        status: 'success',
      });
      expect(state.orchestratorModel).toBe('claude-sonnet-4-6');
      expect(state.orchestratorSessionInputTokens).toBe(7_777);

      // Advance just under the timer — values still hold.
      vi.advanceTimersByTime(9_999);
      expect(state.orchestratorModel).toBe('claude-sonnet-4-6');
      expect(state.orchestratorSessionInputTokens).toBe(7_777);

      // Cross the 10s boundary — both clear.
      vi.advanceTimersByTime(2);
      expect(state.orchestratorModel).toBeNull();
      expect(state.orchestratorSessionInputTokens).toBe(0);
      expect(state.activeSessionId).toBeNull();
      dispose();
    });
  });

  it('Locked Decision #16 — new session before the 10s clear fires still zeroes the counter', () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      // Session A completes with 1234 tokens accumulated.
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS_W2,
        session_id: SID_A,
        priority: 5,
        mode: 'execute',
      });
      actions.applyEvent({
        type: 'cook.agent_spawn',
        ts: TS_W2,
        session_id: SID_A,
        role: 'dev',
        sub_session_id: 'sub-A',
      });
      actions.applyEvent({
        type: 'cook.agent_result',
        ts: TS_W2,
        session_id: SID_A,
        sub_session_id: 'sub-A',
        status: 'completed',
        usage: { input_tokens: 1_234, output_tokens: 100 },
      });
      actions.applyEvent({
        type: 'cook.completion',
        ts: TS_W2,
        session_id: SID_A,
        status: 'success',
      });

      // Session B arrives BEFORE the 10s timer fires. The
      // cook.priority_decision reset path (Locked Decision #16 defensive
      // guard) must zero the counter even though the cookClearTimer
      // was cancelled before clearing the prior session's tail.
      vi.advanceTimersByTime(3_000);
      actions.applyEvent({
        type: 'cook.priority_decision',
        ts: TS_W2,
        session_id: SID_B,
        priority: 5,
        mode: 'execute',
      });
      expect(state.activeSessionId).toBe(SID_B);
      expect(state.orchestratorSessionInputTokens).toBe(0);

      // Advance past the cancelled timer's original deadline — counter
      // stays clean (the timer was cancelled, the new session is fresh).
      vi.advanceTimersByTime(10_000);
      expect(state.orchestratorSessionInputTokens).toBe(0);
      expect(state.activeSessionId).toBe(SID_B);
      dispose();
    });
  });
});
