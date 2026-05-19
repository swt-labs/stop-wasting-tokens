import type {
  CommandResponse,
  ConfigSnapshot,
  DetectPhaseReport,
  DoctorReport,
  InitResponse,
  ProviderAuthSnapshot,
  Snapshot,
  UpdateReport,
} from '@swt-labs/shared';
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
const fetchUserNotesMock = vi.fn();
const postUserNotesMock = vi.fn();

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
}));

vi.mock('../src/client/services/sse.js', () => ({
  openSseConnection: (...args: unknown[]) => openSseConnectionMock(...args),
}));

import { createDashboardStore } from '../src/client/state/dashboard-store.js';

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema_version: '1',
    generated_at: '2026-05-09T00:00:00Z',
    project: null,
    milestone: null,
    phases: [],
    active_agents: [],
    recent_events: [],
    cost_summary: null,
    is_initialized: true,
    ...overrides,
  };
}

beforeEach(() => {
  fetchSnapshotMock.mockReset();
  postInitMock.mockReset();
  postCommandMock.mockReset();
  postUatCheckpointMock.mockReset();
  fetchArtifactRenderedMock.mockReset();
  postCookStartMock.mockReset();
  postPromptRespondMock.mockReset();
  openSseConnectionMock.mockReset();
  fetchConfigMock.mockReset();
  fetchDoctorMock.mockReset();
  fetchDetectPhaseMock.mockReset();
  fetchUpdateMock.mockReset();
  fetchCommandsMock.mockReset();
  postConfigMock.mockReset();
  postUpdateApplyMock.mockReset();
  fetchProviderAuthMock.mockReset();
  postProviderAuthMock.mockReset();
  fetchUserNotesMock.mockReset();
  postUserNotesMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initProject', () => {
  // Plan 03-01 T2 — the old optimistic `is_initialized: true` flip was
  // removed. On POST success, `initSession` is set to a `detecting` slot;
  // `is_initialized` stays false until `init.complete` arrives via SSE.
  // These tests are the regression cover for that contract change.
  it('sets initSession to detecting on POST success without flipping is_initialized', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // Seed the previous snapshot via snapshot.replace so we can verify
      // is_initialized stays false through the whole action.
      const previous = makeSnapshot({ is_initialized: false });
      actions.applyEvent({ type: 'snapshot.replace', snapshot: previous });
      expect(state.snapshot?.is_initialized).toBe(false);

      const initResponse: InitResponse = {
        initialized: true,
        root: '/tmp/proj',
        files: ['.swt-planning/PROJECT.md'],
      };
      // Resolve postInit only after we observe the in-flight state.
      let resolveInit: (v: InitResponse) => void = () => {};
      postInitMock.mockReturnValue(
        new Promise<InitResponse>((resolve) => {
          resolveInit = resolve;
        }),
      );

      const initPromise = actions.initProject({ name: 'proj', description: 'desc' });
      // After awaiting a microtask, the in-flight `submitting` is on but
      // the snapshot is NOT optimistically flipped — the old behaviour
      // (immediate is_initialized=true) is what this regression covers.
      await Promise.resolve();
      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.initSubmitting).toBe(true);
      // initSession is null until postInit resolves (the setter fires
      // after the await).
      expect(state.initSession).toBeNull();

      resolveInit(initResponse);
      await initPromise;
      // After the await: initSession is set to detecting, is_initialized
      // still false. The init.complete SSE handler is what flips it true
      // — covered by the e2e-greenfield-init-smoke regression test.
      expect(state.initSubmitting).toBe(false);
      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.initSession?.status).toBe('detecting');
      expect(state.initSession?.name).toBe('proj');
      expect(state.initSession?.description).toBe('desc');
      // No follow-up fetchSnapshot — the snapshot fetch is gone with the
      // optimistic flip; the daemon's SSE drives the rest.
      expect(fetchSnapshotMock).toHaveBeenCalledTimes(0);
      dispose();
    });
  });

  it('clears initSession and pushes an error when postInit rejects (no snapshot rollback needed)', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const previous = makeSnapshot({ is_initialized: false });
      actions.applyEvent({ type: 'snapshot.replace', snapshot: previous });
      expect(state.snapshot?.is_initialized).toBe(false);

      postInitMock.mockRejectedValue(new Error('init_failed: EACCES'));

      await expect(actions.initProject({ name: 'proj' })).rejects.toThrow('init_failed');

      // is_initialized stays false (it was never optimistically flipped).
      expect(state.snapshot?.is_initialized).toBe(false);
      // initSession is cleared by the catch path (defensive — covers the
      // case where a prior submission left a stale slot).
      expect(state.initSession).toBeNull();
      expect(state.errors.at(-1)?.message).toContain('init_failed');
      dispose();
    });
  });
});

describe('log.append → initSession.lastMessage', () => {
  // Plan 19-03-01 T01 — log.append reducer attributes evt.line to
  // state.initSession.lastMessage iff initSession !== null && status === 'detecting'.
  // The renderer (InitScreen.tsx T02) reads this field and classifies it via
  // classifyInitLine to surface a live progress block above the submit button.
  // Temporal-correlation invariant: log.append carries no session_id; init + cook
  // do not overlap, so attributing every detecting-state log.append is sound.
  async function seedDetectingInitSession(): Promise<{
    state: ReturnType<typeof createDashboardStore>[0];
    actions: ReturnType<typeof createDashboardStore>[1];
    dispose: () => void;
  }> {
    let captured: {
      state: ReturnType<typeof createDashboardStore>[0];
      actions: ReturnType<typeof createDashboardStore>[1];
      dispose: () => void;
    } = null as never;
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      captured = { state, actions, dispose };
    });
    const initResponse: InitResponse = {
      initialized: true,
      root: '/tmp/proj',
      files: ['.swt-planning/PROJECT.md'],
    };
    postInitMock.mockResolvedValue(initResponse);
    await captured.actions.initProject({ name: 'proj' });
    return captured;
  }

  it('sets initSession.lastMessage to evt.line when status === detecting (TC-A)', async () => {
    const { state, actions, dispose } = await seedDetectingInitSession();
    expect(state.initSession?.status).toBe('detecting');
    expect(state.initSession?.lastMessage).toBeUndefined();

    actions.applyEvent({
      type: 'log.append',
      ts: '2026-05-19T00:00:01Z',
      channel: 'stderr',
      line: '[tool] Read',
    });
    expect(state.initSession?.lastMessage).toBe('[tool] Read');

    // Multiple lines: most recent wins (AC-2 — block updates ≥4× on each log.append).
    actions.applyEvent({
      type: 'log.append',
      ts: '2026-05-19T00:00:02Z',
      channel: 'stderr',
      line: '[llm turn 1] scanning project files',
    });
    expect(state.initSession?.lastMessage).toBe('[llm turn 1] scanning project files');
    dispose();
  });

  it('is a no-op when initSession === null (TC-B)', () => {
    createRoot((dispose) => {
      const [state, actions] = createDashboardStore();
      expect(state.initSession).toBeNull();
      actions.applyEvent({
        type: 'log.append',
        ts: '2026-05-19T00:00:00Z',
        channel: 'stderr',
        line: '[tool] Read',
      });
      // Reducer guard is `state.initSession !== null && status === 'detecting'`;
      // when initSession is null the setter never fires, no implicit mutation.
      expect(state.initSession).toBeNull();
      dispose();
    });
  });

  it('is a no-op after init.complete clears initSession (TC-C)', async () => {
    const { state, actions, dispose } = await seedDetectingInitSession();
    expect(state.initSession?.status).toBe('detecting');

    actions.applyEvent({
      type: 'init.complete',
      session_id: state.initSession?.session_id ?? '',
      ts: '2026-05-19T00:00:05Z',
    });
    // init.complete sets initSession to null (dashboard-store.ts:1179).
    expect(state.initSession).toBeNull();

    actions.applyEvent({
      type: 'log.append',
      ts: '2026-05-19T00:00:06Z',
      channel: 'stderr',
      line: '[tool] Write',
    });
    expect(state.initSession).toBeNull();
    dispose();
  });

  it('is a no-op while initSession.status === "error" (TC-D)', async () => {
    const { state, actions, dispose } = await seedDetectingInitSession();
    expect(state.initSession?.status).toBe('detecting');

    actions.applyEvent({
      type: 'init.error',
      session_id: state.initSession?.session_id ?? '',
      ts: '2026-05-19T00:00:03Z',
      message: 'init Lead crashed',
    });
    // init.error transitions status to 'error' but keeps initSession set so
    // the InitScreen error paragraph can surface (dashboard-store.ts:1194-1196).
    expect(state.initSession?.status).toBe('error');
    const lastMessageBefore = state.initSession?.lastMessage;

    actions.applyEvent({
      type: 'log.append',
      ts: '2026-05-19T00:00:04Z',
      channel: 'stderr',
      line: '[tool] Read',
    });
    // Gate is strict-equal to 'detecting' — status === 'error' must not write.
    expect(state.initSession?.lastMessage).toBe(lastMessageBefore);
    dispose();
  });
});

describe('runCommand verb-aware refresh', () => {
  function makeCommandResponse(): CommandResponse {
    return {
      ok: true,
      command_id: 'cmd-1',
      stdout: 'ok\n',
      stderr: '',
      exit_code: 0,
      duration_ms: 12,
    };
  }

  it('re-fetches snapshot for mutating verbs (init, vibe, archive, fix)', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCommandMock.mockResolvedValue(makeCommandResponse());
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      for (const verb of ['init my-proj', 'vibe', 'archive', 'fix something']) {
        fetchSnapshotMock.mockClear();
        await actions.runCommand(verb);
        expect(fetchSnapshotMock, `verb=${verb}`).toHaveBeenCalledTimes(1);
      }
      dispose();
    });
  });

  it('does NOT re-fetch snapshot for read verbs (status, help, doctor, version, update, detect-phase)', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCommandMock.mockResolvedValue(makeCommandResponse());
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      for (const verb of ['status', 'help', 'doctor', 'version', 'update', 'detect-phase']) {
        fetchSnapshotMock.mockClear();
        await actions.runCommand(verb);
        expect(fetchSnapshotMock, `verb=${verb}`).not.toHaveBeenCalled();
      }
      dispose();
    });
  });

  it('treats verb matching as case-insensitive on the first token', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCommandMock.mockResolvedValue(makeCommandResponse());
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.runCommand('INIT myproj --description hi');
      expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});

describe('vibe session lifecycle', () => {
  // G-D3 — `startVibeSession` now ports to `POST /api/cook/start`
  // (`postCookStart`) and `replyToActivePrompt` ports to
  // `POST /api/prompts/:id/respond` (`postPromptRespond`). The legacy
  // `/api/vibe` shim + its `postVibeStart` / `postVibeReply` helpers were
  // removed; these tests exercise the cook/prompts wiring.
  it('startVibeSession starts a cook session and clears stale state', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-123',
        pid: 4242,
        started_at: '2026-05-14T00:00:00Z',
      });

      const id = await actions.startVibeSession('build me a snake game');
      expect(id).toBe('sess-123');
      expect(postCookStartMock).toHaveBeenCalledTimes(1);
      expect(state.vibeSession?.session_id).toBe('sess-123');
      expect(state.vibeSession?.initial_prompt).toBe('build me a snake game');
      expect(state.vibeSession?.conversation).toEqual([]);
      // v3 ships Pi as the sole agent backend — a successful cook spawn
      // implies `agent_backend: 'pi'` (cook/start carries no backend field).
      expect(state.vibeSession?.agent_backend).toBe('pi');
      expect(state.vibeStarting).toBe(false);
      dispose();
    });
  });

  it('startVibeSession returns null on rejection and pushes an error', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockRejectedValue(new Error('cook_start_failed'));
      const id = await actions.startVibeSession('test');
      expect(id).toBeNull();
      expect(state.vibeSession).toBeNull();
      expect(state.errors.at(-1)?.message).toContain('cook_start_failed');
      dispose();
    });
  });

  it('agent.prompt event appends to conversation as pending when session_id matches', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      await actions.startVibeSession('test');

      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'What goal?',
      });
      expect(state.vibeSession?.conversation).toHaveLength(1);
      expect(state.vibeSession?.conversation[0]).toMatchObject({
        prompt_id: 'p-1',
        question: 'What goal?',
        status: 'pending',
      });
      dispose();
    });
  });

  it('agent.prompt for a different session_id is ignored', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      await actions.startVibeSession('test');

      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-B',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'cross-session',
      });
      expect(state.vibeSession?.conversation).toHaveLength(0);
      dispose();
    });
  });

  it('replyToActivePrompt POSTs reply, updates conversation entry to answered', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      postPromptRespondMock.mockResolvedValue(undefined);
      await actions.startVibeSession('test');
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'q?',
      });

      const ok = await actions.replyToActivePrompt({ kind: 'free_form', text: 'a snake game' });
      expect(ok).toBe(true);
      // G-D3 — the UI answer union maps onto the prompts route's
      // `{prompt_id, selectedOption, freeform}` wire body: free_form text
      // rides `freeform`, `selectedOption` is null.
      expect(postPromptRespondMock).toHaveBeenCalledWith({
        prompt_id: 'p-1',
        selectedOption: null,
        freeform: 'a snake game',
      });
      const entry = state.vibeSession?.conversation[0];
      expect(entry?.status).toBe('answered');
      expect(entry?.reply).toEqual({ kind: 'free_form', text: 'a snake game' });
      dispose();
    });
  });

  it('replyToActivePrompt maps choice + permission answers onto the prompts wire body', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      postPromptRespondMock.mockResolvedValue(undefined);
      await actions.startVibeSession('test');

      // choice → selectedOption set, freeform null
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-choice',
        subtype: 'clarification',
        question: 'pick one',
      });
      await actions.replyToActivePrompt({ kind: 'choice', value: 'option-b' });
      expect(postPromptRespondMock).toHaveBeenLastCalledWith({
        prompt_id: 'p-choice',
        selectedOption: 'option-b',
        freeform: null,
      });

      // permission → decision rides selectedOption, note rides freeform
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:01:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-perm',
        subtype: 'permission',
        question: 'allow write?',
      });
      await actions.replyToActivePrompt({
        kind: 'permission',
        decision: 'once',
        user_note: 'looks fine',
      });
      expect(postPromptRespondMock).toHaveBeenLastCalledWith({
        prompt_id: 'p-perm',
        selectedOption: 'once',
        freeform: 'looks fine',
      });
      dispose();
    });
  });

  it('replyToActivePrompt returns false when no pending prompt exists', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      await actions.startVibeSession('test');
      const ok = await actions.replyToActivePrompt({ kind: 'free_form', text: 'a' });
      expect(ok).toBe(false);
      expect(postPromptRespondMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('agent.prompt.timeout flips matching pending entry to expired', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      await actions.startVibeSession('test');
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'q?',
      });
      actions.applyEvent({
        type: 'agent.prompt.timeout',
        ts: '2026-05-09T10:05:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        expired_at: '2026-05-09T10:05:00Z',
      });
      const entry = state.vibeSession?.conversation[0];
      expect(entry?.status).toBe('expired');
      expect(entry?.resolved_at).toBe('2026-05-09T10:05:00Z');
      dispose();
    });
  });

  it('multiple sequential prompts stack as a conversation thread', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postCookStartMock.mockResolvedValue({
        session_id: 'sess-A',
        pid: 1,
        started_at: '2026-05-14T00:00:00Z',
      });
      postPromptRespondMock.mockResolvedValue(undefined);
      await actions.startVibeSession('test');

      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:00:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-1',
        subtype: 'clarification',
        question: 'goal?',
      });
      await actions.replyToActivePrompt({ kind: 'free_form', text: 'snake' });
      actions.applyEvent({
        type: 'agent.prompt',
        ts: '2026-05-09T10:01:00Z',
        session_id: 'sess-A',
        prompt_id: 'p-2',
        subtype: 'clarification',
        question: 'color?',
      });

      const conv = state.vibeSession!.conversation;
      expect(conv).toHaveLength(2);
      expect(conv[0]?.status).toBe('answered');
      expect(conv[1]?.status).toBe('pending');
      dispose();
    });
  });
});

describe('connection state transitions', () => {
  it('transitions connecting -> syncing -> connected on the happy path', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      expect(state.connection).toBe('connecting');

      let onOpen: (() => void) | undefined;
      openSseConnectionMock.mockImplementation(
        (_url: unknown, handlers: { onOpen?: () => void }) => {
          onOpen = handlers.onOpen;
          return { close: () => {} };
        },
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.bootstrap();
      // After fetchSnapshot resolves and SSE opens (handlers wired but onOpen
      // not yet fired), connection is 'syncing'.
      expect(state.connection).toBe('syncing');

      onOpen?.();
      expect(state.connection).toBe('connected');
      dispose();
    });
  });

  it('stays in syncing on a transient SSE error before the first onOpen', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      let onError: ((err: unknown) => void) | undefined;
      openSseConnectionMock.mockImplementation(
        (_url: unknown, handlers: { onError?: (err: unknown) => void }) => {
          onError = handlers.onError;
          return { close: () => {} };
        },
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.bootstrap();
      expect(state.connection).toBe('syncing');

      onError?.(new Error('boom'));
      expect(state.connection).toBe('syncing');
      dispose();
    });
  });

  it('flips to error after a successful open then a drop', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      let onOpen: (() => void) | undefined;
      let onError: ((err: unknown) => void) | undefined;
      openSseConnectionMock.mockImplementation(
        (_url: unknown, handlers: { onOpen?: () => void; onError?: (err: unknown) => void }) => {
          onOpen = handlers.onOpen;
          onError = handlers.onError;
          return { close: () => {} };
        },
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot());

      await actions.bootstrap();
      onOpen?.();
      expect(state.connection).toBe('connected');
      onError?.(new Error('drop'));
      expect(state.connection).toBe('error');
      dispose();
    });
  });
});

/* ── v2.3 Phase 02: tools sub-state ───────────────────────────────── */

function makeConfigSnapshot(): ConfigSnapshot {
  return {
    is_initialized: true,
    config: { effort: 'thorough', autonomy: 'pure-vibe' },
    source: 'file',
    generated_at: '2026-05-10T12:00:00.000Z',
  };
}

function makeDoctorReport(): DoctorReport {
  return {
    checks: [
      { id: 'node-version', name: 'Node ≥ 20', status: 'pass', detail: 'Node 22.0.0' },
      { id: 'codex-cli', name: 'Codex CLI on PATH', status: 'pass', detail: 'Codex 0.124.0' },
      { id: 'planning-dir', name: '.swt-planning/ present', status: 'pass', detail: 'found' },
    ],
    overall_status: 'pass',
    generated_at: '2026-05-10T12:00:00.000Z',
  };
}

function makeDetectPhaseReport(): DetectPhaseReport {
  return {
    result: { phase_count: 4, next_phase_state: 'needs_plan_and_execute' },
    is_initialized: true,
    generated_at: '2026-05-10T12:00:00.000Z',
  };
}

function makeUpdateReport(): UpdateReport {
  return {
    current_version: '2.3.0',
    latest_version: '2.3.0',
    update_available: false,
    registry: 'npm',
    last_checked: '2026-05-10T12:00:00.000Z',
    error: null,
  };
}

function makeProviderAuthSnapshot(
  overrides: Partial<ProviderAuthSnapshot> = {},
): ProviderAuthSnapshot {
  return {
    selected_provider: 'anthropic',
    strategy_kind: 'pinned',
    keychain_available: true,
    keychain_reason: null,
    statuses: [
      {
        provider: 'anthropic',
        configured: true,
        mode: 'api_key',
        source: 'keychain',
        label: 'Keychain',
      },
      {
        provider: 'openai',
        configured: false,
        mode: null,
        source: null,
        label: null,
      },
    ],
    generated_at: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('tools sub-state', () => {
  it('initializes all six cells empty (config, doctor, detectPhase, update, commands, providerAuth)', async () => {
    await createRoot(async (dispose) => {
      const [state] = createDashboardStore();
      expect(state.tools.config.data).toBeNull();
      expect(state.tools.config.loading).toBe(false);
      expect(state.tools.config.error).toBeNull();
      expect(state.tools.config.lastFetched).toBeNull();
      expect(state.tools.doctor.data).toBeNull();
      expect(state.tools.detectPhase.data).toBeNull();
      expect(state.tools.update.data).toBeNull();
      expect(state.tools.commands.data).toBeNull();
      expect(state.tools.providerAuth.data).toBeNull();
      expect(state.tools.providerAuth.loading).toBe(false);
      expect(state.tools.providerAuth.error).toBeNull();
      expect(state.tools.providerAuth.lastFetched).toBeNull();
      dispose();
    });
  });

  it('bootstrap on initialized snapshot triggers refreshTools (all 6 cells fetch)', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      fetchDoctorMock.mockResolvedValue(makeDoctorReport());
      fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
      fetchUpdateMock.mockResolvedValue(makeUpdateReport());
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      fetchCommandsMock.mockResolvedValue({
        verbs: [
          {
            name: 'doctor',
            description: 'Check prereqs',
            usage: null,
            category: 'core',
            dashboard_safe: true,
          },
        ],
        generated_at: '2026-05-10T12:00:00.000Z',
      });
      await actions.bootstrap();
      // Wait one microtask for the void refreshTools() Promise chain to settle.
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchConfigMock).toHaveBeenCalledTimes(1);
      expect(fetchDoctorMock).toHaveBeenCalledTimes(1);
      expect(fetchDetectPhaseMock).toHaveBeenCalledTimes(1);
      expect(fetchUpdateMock).toHaveBeenCalledTimes(1);
      expect(fetchCommandsMock).toHaveBeenCalledTimes(1);
      expect(fetchProviderAuthMock).toHaveBeenCalledTimes(1);
      expect(state.tools.config.data).not.toBeNull();
      expect(state.tools.commands.data?.verbs).toHaveLength(1);
      expect(state.tools.providerAuth.data).not.toBeNull();
      expect(state.tools.config.lastFetched).toBeTypeOf('string');
      actions.shutdown();
      dispose();
    });
  });

  it('bootstrap on greenfield snapshot does NOT fetch tools', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: false }));
      await actions.bootstrap();
      await Promise.resolve();
      expect(fetchConfigMock).not.toHaveBeenCalled();
      expect(fetchDoctorMock).not.toHaveBeenCalled();
      expect(fetchDetectPhaseMock).not.toHaveBeenCalled();
      expect(fetchUpdateMock).not.toHaveBeenCalled();
      expect(state.tools.config.data).toBeNull();
      actions.shutdown();
      dispose();
    });
  });

  it("refreshToolsCell('config') only triggers fetchConfig (not the others)", async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      await actions.refreshToolsCell('config');
      expect(fetchConfigMock).toHaveBeenCalledTimes(1);
      expect(fetchDoctorMock).not.toHaveBeenCalled();
      expect(fetchDetectPhaseMock).not.toHaveBeenCalled();
      expect(fetchUpdateMock).not.toHaveBeenCalled();
      expect(fetchProviderAuthMock).not.toHaveBeenCalled();
      expect(state.tools.config.data).not.toBeNull();
      expect(state.tools.config.loading).toBe(false);
      dispose();
    });
  });

  it('error in one cell does not pollute the others', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      fetchDoctorMock.mockRejectedValue(new Error('codex missing'));
      fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
      fetchUpdateMock.mockResolvedValue(makeUpdateReport());
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      await actions.bootstrap();
      await Promise.resolve();
      await Promise.resolve();
      expect(state.tools.config.error).toBeNull();
      expect(state.tools.config.data).not.toBeNull();
      expect(state.tools.doctor.error).toMatch(/codex missing/);
      expect(state.tools.doctor.data).toBeNull();
      expect(state.tools.detectPhase.data).not.toBeNull();
      expect(state.tools.update.data).not.toBeNull();
      expect(state.tools.providerAuth.data).not.toBeNull();
      actions.shutdown();
      dispose();
    });
  });

  it('fast poll timer fires the volatile-cell group after each interval tick', async () => {
    vi.useFakeTimers();
    try {
      await createRoot(async (dispose) => {
        const [, actions] = createDashboardStore({ pollIntervalMs: 1000 });
        fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
        fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
        fetchDoctorMock.mockResolvedValue(makeDoctorReport());
        fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
        fetchUpdateMock.mockResolvedValue(makeUpdateReport());
        await actions.bootstrap();
        // First fetch from bootstrap.
        await vi.advanceTimersByTimeAsync(0);
        const baselineCalls = fetchConfigMock.mock.calls.length;
        // Advance past one polling tick.
        await vi.advanceTimersByTimeAsync(1100);
        expect(fetchConfigMock.mock.calls.length).toBeGreaterThan(baselineCalls);
        actions.shutdown();
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fast timer polls only the volatile cells; slow cells stay on the slow interval', async () => {
    vi.useFakeTimers();
    try {
      await createRoot(async (dispose) => {
        // opts.pollIntervalMs overrides the FAST tier (→ 1000ms); the SLOW
        // tier (doctor / update / commands) keeps its fixed 60s default.
        const [, actions] = createDashboardStore({ pollIntervalMs: 1000 });
        fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
        fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
        fetchDoctorMock.mockResolvedValue(makeDoctorReport());
        fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
        fetchUpdateMock.mockResolvedValue(makeUpdateReport());
        await actions.bootstrap();
        // Settle bootstrap's immediate full refreshTools() (all six cells).
        await vi.advanceTimersByTimeAsync(0);
        const fastBaseline = {
          config: fetchConfigMock.mock.calls.length,
          detectPhase: fetchDetectPhaseMock.mock.calls.length,
          providerAuth: fetchProviderAuthMock.mock.calls.length,
        };
        const slowBaseline = {
          doctor: fetchDoctorMock.mock.calls.length,
          update: fetchUpdateMock.mock.calls.length,
          commands: fetchCommandsMock.mock.calls.length,
        };
        // Advance past 3 fast ticks (3000ms) — nowhere near a slow tick (60s).
        await vi.advanceTimersByTimeAsync(3300);
        // Fast group (config / detect-phase / provider-auth) refreshed each tick…
        expect(fetchConfigMock.mock.calls.length).toBeGreaterThan(fastBaseline.config);
        expect(fetchDetectPhaseMock.mock.calls.length).toBeGreaterThan(fastBaseline.detectPhase);
        expect(fetchProviderAuthMock.mock.calls.length).toBeGreaterThan(fastBaseline.providerAuth);
        // …slow group (doctor / update / commands) did NOT — still on the 60s timer.
        expect(fetchDoctorMock.mock.calls.length).toBe(slowBaseline.doctor);
        expect(fetchUpdateMock.mock.calls.length).toBe(slowBaseline.update);
        expect(fetchCommandsMock.mock.calls.length).toBe(slowBaseline.commands);
        actions.shutdown();
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shutdown stops the polling timer (no fetches after)', async () => {
    vi.useFakeTimers();
    try {
      await createRoot(async (dispose) => {
        const [, actions] = createDashboardStore({ pollIntervalMs: 1000 });
        fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
        fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
        fetchDoctorMock.mockResolvedValue(makeDoctorReport());
        fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
        fetchUpdateMock.mockResolvedValue(makeUpdateReport());
        await actions.bootstrap();
        await vi.advanceTimersByTimeAsync(0);
        actions.shutdown();
        const callsAtShutdown = fetchConfigMock.mock.calls.length;
        // Advance well past several polling ticks.
        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetchConfigMock.mock.calls.length).toBe(callsAtShutdown);
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshTools() short-circuits when snapshot.is_initialized is false', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: false }));
      await actions.bootstrap();
      // Try a direct refreshTools call — it must still no-op on greenfield.
      await actions.refreshTools();
      expect(fetchConfigMock).not.toHaveBeenCalled();
      expect(state.tools.config.data).toBeNull();
      actions.shutdown();
      dispose();
    });
  });

  it('loading flag flips true during the fetch and back to false after', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      let resolveCfg: (v: ConfigSnapshot) => void = () => {};
      fetchConfigMock.mockReturnValue(
        new Promise<ConfigSnapshot>((resolve) => {
          resolveCfg = resolve;
        }),
      );
      const refreshPromise = actions.refreshToolsCell('config');
      // Microtask flush — loading flag set immediately, before the promise resolves.
      await Promise.resolve();
      expect(state.tools.config.loading).toBe(true);
      resolveCfg(makeConfigSnapshot());
      await refreshPromise;
      expect(state.tools.config.loading).toBe(false);
      expect(state.tools.config.data).not.toBeNull();
      dispose();
    });
  });

  it('greenfield bootstrap never starts the polling timer (no fetches even after time passes)', async () => {
    vi.useFakeTimers();
    try {
      await createRoot(async (dispose) => {
        const [, actions] = createDashboardStore({ pollIntervalMs: 1000 });
        fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: false }));
        await actions.bootstrap();
        // Advance well past several would-be polling ticks. No fetches
        // should fire because the timer was never installed.
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchConfigMock).not.toHaveBeenCalled();
        expect(fetchDoctorMock).not.toHaveBeenCalled();
        expect(fetchDetectPhaseMock).not.toHaveBeenCalled();
        expect(fetchUpdateMock).not.toHaveBeenCalled();
        actions.shutdown();
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── v2.3 Phase 03: mutation actions ───────────────────────────────── */

describe('applyConfigUpdate', () => {
  it('on success, optimistically updates state.tools.config.data', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postConfigMock.mockResolvedValue({
        ok: true,
        config: { effort: 'fast', autonomy: 'pure-vibe' },
        generated_at: '2026-05-10T12:00:00.000Z',
      });
      const result = await actions.applyConfigUpdate({ config: { effort: 'fast' } });
      expect(result).toEqual({ ok: true });
      expect(postConfigMock).toHaveBeenCalledTimes(1);
      const cfg = state.tools.config.data?.config as Record<string, unknown> | undefined;
      expect(cfg?.['effort']).toBe('fast');
      expect(state.tools.config.error).toBeNull();
      dispose();
    });
  });

  it('on POST failure, surfaces error and returns {error}', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postConfigMock.mockRejectedValue(new Error('invalid_config_schema: nope'));
      const result = await actions.applyConfigUpdate({ config: { effort: 'wat' } });
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toMatch(/invalid_config_schema/);
      }
      expect(state.tools.config.error).toMatch(/invalid_config_schema/);
      dispose();
    });
  });
});

/* ── Phase 3: providerAuth tools-cell + SSE refetch ─────────────────── */

describe('providerAuth tools-cell', () => {
  it("refreshToolsCell('providerAuth') populates the cell from fetchProviderAuth", async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const snap = makeProviderAuthSnapshot();
      fetchProviderAuthMock.mockResolvedValue(snap);
      await actions.refreshToolsCell('providerAuth');
      expect(fetchProviderAuthMock).toHaveBeenCalledTimes(1);
      // Only the providerAuth fetcher fired — the others are untouched.
      expect(fetchConfigMock).not.toHaveBeenCalled();
      expect(fetchDoctorMock).not.toHaveBeenCalled();
      expect(state.tools.providerAuth.data).toEqual(snap);
      expect(state.tools.providerAuth.loading).toBe(false);
      expect(state.tools.providerAuth.error).toBeNull();
      expect(state.tools.providerAuth.lastFetched).toBeTypeOf('string');
      dispose();
    });
  });

  it('refreshTools() includes providerAuth in its parallel batch', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      // refreshTools short-circuits unless the snapshot is initialized —
      // seed it via snapshot.replace the same way other refreshTools paths do.
      actions.applyEvent({
        type: 'snapshot.replace',
        snapshot: makeSnapshot({ is_initialized: true }),
      });
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      fetchDoctorMock.mockResolvedValue(makeDoctorReport());
      fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
      fetchUpdateMock.mockResolvedValue(makeUpdateReport());
      fetchCommandsMock.mockResolvedValue({
        verbs: [],
        generated_at: '2026-05-10T12:00:00.000Z',
      });
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      await actions.refreshTools();
      expect(fetchProviderAuthMock).toHaveBeenCalledTimes(1);
      expect(state.tools.providerAuth.data).not.toBeNull();
      dispose();
    });
  });

  it('applyProviderAuthUpdate on success optimistically updates the cell from response.snapshot', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const snap = makeProviderAuthSnapshot({ selected_provider: 'openai' });
      postProviderAuthMock.mockResolvedValue({
        ok: true,
        snapshot: snap,
        generated_at: '2026-05-14T13:00:00.000Z',
      });
      const result = await actions.applyProviderAuthUpdate({
        provider: 'openai',
        authMode: 'api_key',
        apiKey: 'sk-x',
      });
      expect(result).toEqual({ ok: true });
      expect(postProviderAuthMock).toHaveBeenCalledTimes(1);
      expect(state.tools.providerAuth.data).toEqual(snap);
      expect(state.tools.providerAuth.loading).toBe(false);
      expect(state.tools.providerAuth.error).toBeNull();
      expect(state.tools.providerAuth.lastFetched).toBe('2026-05-14T13:00:00.000Z');
      dispose();
    });
  });

  it('applyProviderAuthUpdate on POST failure sets the cell error, pushes to errors[], returns {error}', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postProviderAuthMock.mockRejectedValue(new Error('keychain_unavailable: no Secret Service'));
      const result = await actions.applyProviderAuthUpdate({
        provider: 'anthropic',
        authMode: 'api_key',
        apiKey: 'sk-y',
      });
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toMatch(/keychain_unavailable/);
      }
      expect(state.tools.providerAuth.error).toMatch(/keychain_unavailable/);
      expect(state.tools.providerAuth.loading).toBe(false);
      expect(state.errors.at(-1)?.message).toMatch(/keychain_unavailable/);
      dispose();
    });
  });

  it("state.changed with changed:['provider-auth'] refetches the providerAuth cell", async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      // The schema enum doesn't include 'provider-auth' yet — cast through
      // unknown to exercise the store's forward-compatible string check.
      actions.applyEvent({
        type: 'state.changed',
        changed: ['provider-auth'],
      } as unknown as Parameters<typeof actions.applyEvent>[0]);
      await Promise.resolve();
      expect(fetchProviderAuthMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it("state.changed with changed:['config'] refetches BOTH config AND providerAuth", async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      actions.applyEvent({
        type: 'state.changed',
        changed: ['config'],
      });
      await Promise.resolve();
      // The existing config refetch is not regressed...
      expect(fetchConfigMock).toHaveBeenCalledTimes(1);
      // ...and the combined condition also refetches providerAuth.
      expect(fetchProviderAuthMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });
});

/* ── User Notes — the userNotes tools-cell + saveUserNotes action ──────
 * Locks the three load-bearing invariants: (a) refreshToolsCell('userNotes')
 * populates the cell, (b) userNotes is NOT on any poll group so a poll tick
 * never fetches it, and (c) saveUserNotes optimistically updates the cell on
 * success and surfaces the error on failure.
 */

function makeUserNotesSnapshot(
  overrides: Partial<{ notes: string; exists: boolean; generated_at: string }> = {},
): { notes: string; exists: boolean; generated_at: string } {
  return {
    notes: 'remember the rate-card',
    exists: true,
    generated_at: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('userNotes tools-cell', () => {
  it('initializes the userNotes cell empty', async () => {
    await createRoot(async (dispose) => {
      const [state] = createDashboardStore();
      expect(state.tools.userNotes.data).toBeNull();
      expect(state.tools.userNotes.loading).toBe(false);
      expect(state.tools.userNotes.error).toBeNull();
      expect(state.tools.userNotes.lastFetched).toBeNull();
      dispose();
    });
  });

  it("refreshToolsCell('userNotes') populates the cell from fetchUserNotes", async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const snap = makeUserNotesSnapshot();
      fetchUserNotesMock.mockResolvedValue(snap);
      await actions.refreshToolsCell('userNotes');
      expect(fetchUserNotesMock).toHaveBeenCalledTimes(1);
      // Only the userNotes fetcher fired — the others are untouched.
      expect(fetchConfigMock).not.toHaveBeenCalled();
      expect(fetchProviderAuthMock).not.toHaveBeenCalled();
      expect(state.tools.userNotes.data).toEqual(snap);
      expect(state.tools.userNotes.loading).toBe(false);
      expect(state.tools.userNotes.error).toBeNull();
      expect(state.tools.userNotes.lastFetched).toBeTypeOf('string');
      dispose();
    });
  });

  it('bootstrap on an initialized snapshot fetches userNotes exactly once', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      fetchDoctorMock.mockResolvedValue(makeDoctorReport());
      fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
      fetchUpdateMock.mockResolvedValue(makeUpdateReport());
      fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
      fetchCommandsMock.mockResolvedValue({
        verbs: [],
        generated_at: '2026-05-10T12:00:00.000Z',
      });
      fetchUserNotesMock.mockResolvedValue(makeUserNotesSnapshot());
      await actions.bootstrap();
      await Promise.resolve();
      await Promise.resolve();
      // The one-shot bootstrap fetch landed.
      expect(fetchUserNotesMock).toHaveBeenCalledTimes(1);
      expect(state.tools.userNotes.data).not.toBeNull();
      actions.shutdown();
      dispose();
    });
  });

  it('userNotes is NOT on any poll group — poll ticks never fetch it', async () => {
    vi.useFakeTimers();
    try {
      await createRoot(async (dispose) => {
        const [, actions] = createDashboardStore({ pollIntervalMs: 1000 });
        fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
        fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
        fetchDoctorMock.mockResolvedValue(makeDoctorReport());
        fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
        fetchUpdateMock.mockResolvedValue(makeUpdateReport());
        fetchProviderAuthMock.mockResolvedValue(makeProviderAuthSnapshot());
        fetchCommandsMock.mockResolvedValue({
          verbs: [],
          generated_at: '2026-05-10T12:00:00.000Z',
        });
        fetchUserNotesMock.mockResolvedValue(makeUserNotesSnapshot());
        await actions.bootstrap();
        // Settle bootstrap's immediate refreshTools() + the one-shot
        // userNotes fetch.
        await vi.advanceTimersByTimeAsync(0);
        const baseline = fetchUserNotesMock.mock.calls.length;
        expect(baseline).toBe(1); // only the bootstrap one-shot
        // Advance past many fast (1s) AND slow (60s) poll ticks.
        await vi.advanceTimersByTimeAsync(70_000);
        // userNotes was NEVER re-fetched — it is on no poll group.
        expect(fetchUserNotesMock.mock.calls.length).toBe(baseline);
        actions.shutdown();
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('saveUserNotes on success optimistically updates the cell', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postUserNotesMock.mockResolvedValue({
        ok: true,
        generated_at: '2026-05-14T13:00:00.000Z',
      });
      const result = await actions.saveUserNotes('my freshly typed notes');
      expect(result).toEqual({ ok: true });
      expect(postUserNotesMock).toHaveBeenCalledTimes(1);
      expect(postUserNotesMock).toHaveBeenCalledWith('my freshly typed notes');
      // Optimistic apply — the saved text becomes the cell's source of
      // truth (no SSE event refetches it).
      expect(state.tools.userNotes.data?.notes).toBe('my freshly typed notes');
      expect(state.tools.userNotes.data?.exists).toBe(true);
      expect(state.tools.userNotes.loading).toBe(false);
      expect(state.tools.userNotes.error).toBeNull();
      expect(state.tools.userNotes.lastFetched).toBe('2026-05-14T13:00:00.000Z');
      dispose();
    });
  });

  it('saveUserNotes on POST failure sets the cell error, pushes to errors[], returns {error}', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postUserNotesMock.mockRejectedValue(new Error('user_notes_write_failed: EACCES'));
      const result = await actions.saveUserNotes('notes that fail to save');
      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toMatch(/user_notes_write_failed/);
      }
      expect(state.tools.userNotes.error).toMatch(/user_notes_write_failed/);
      expect(state.tools.userNotes.loading).toBe(false);
      expect(state.errors.at(-1)?.message).toMatch(/user_notes_write_failed/);
      dispose();
    });
  });
});

describe('applyUpdate', () => {
  it('on success returns the daemon response and refreshes the update cell', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postUpdateApplyMock.mockResolvedValue({
        ok: true,
        exit_code: 0,
        stdout: 'added 1 package',
        stderr: '',
        duration_ms: 3000,
        requires_elevation: false,
        copyable_command: null,
      });
      fetchUpdateMock.mockResolvedValue({
        current_version: '2.3.0',
        latest_version: '2.3.0',
        update_available: false,
        registry: 'npm',
        last_checked: '2026-05-10T12:00:00.000Z',
        error: null,
      });
      const result = await actions.applyUpdate();
      expect('ok' in result).toBe(true);
      if ('ok' in result) expect(result.ok).toBe(true);
      // Wait one microtask for the void refreshToolsCell promise to land.
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchUpdateMock).toHaveBeenCalled();
      expect(state.tools.update.loading).toBe(false);
      dispose();
    });
  });

  it('on EACCES, returns requires_elevation:true + copyable_command', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postUpdateApplyMock.mockResolvedValue({
        ok: false,
        exit_code: 1,
        stdout: '',
        stderr: 'npm error code EACCES',
        duration_ms: 800,
        requires_elevation: true,
        copyable_command: 'sudo npm install -g stop-wasting-tokens@latest',
      });
      const result = await actions.applyUpdate();
      expect('requires_elevation' in result).toBe(true);
      if ('requires_elevation' in result) {
        expect(result.requires_elevation).toBe(true);
        expect(result.copyable_command).toMatch(/^sudo /);
      }
      dispose();
    });
  });

  it('on transport failure (POST throws), returns {error}', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postUpdateApplyMock.mockRejectedValue(new Error('HTTP 500: spawn ENOENT npm'));
      const result = await actions.applyUpdate();
      expect('error' in result).toBe(true);
      expect(state.tools.update.error).toMatch(/spawn ENOENT/);
      dispose();
    });
  });
});
