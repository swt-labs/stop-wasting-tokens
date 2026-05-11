import type {
  CommandResponse,
  ConfigSnapshot,
  DetectPhaseReport,
  DoctorReport,
  InitResponse,
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
const postVibeStartMock = vi.fn();
const postVibeReplyMock = vi.fn();
const openSseConnectionMock = vi.fn();
const fetchConfigMock = vi.fn();
const fetchDoctorMock = vi.fn();
const fetchDetectPhaseMock = vi.fn();
const fetchUpdateMock = vi.fn();
const fetchCommandsMock = vi.fn();
const postConfigMock = vi.fn();
const postUpdateApplyMock = vi.fn();

vi.mock('../src/client/services/api.js', () => ({
  fetchSnapshot: (...args: unknown[]) => fetchSnapshotMock(...args),
  postInit: (...args: unknown[]) => postInitMock(...args),
  postCommand: (...args: unknown[]) => postCommandMock(...args),
  postUatCheckpoint: (...args: unknown[]) => postUatCheckpointMock(...args),
  fetchArtifactRendered: (...args: unknown[]) => fetchArtifactRenderedMock(...args),
  postVibeStart: (...args: unknown[]) => postVibeStartMock(...args),
  postVibeReply: (...args: unknown[]) => postVibeReplyMock(...args),
  fetchConfig: (...args: unknown[]) => fetchConfigMock(...args),
  fetchDoctor: (...args: unknown[]) => fetchDoctorMock(...args),
  fetchDetectPhase: (...args: unknown[]) => fetchDetectPhaseMock(...args),
  fetchUpdate: (...args: unknown[]) => fetchUpdateMock(...args),
  fetchCommands: (...args: unknown[]) => fetchCommandsMock(...args),
  postConfig: (...args: unknown[]) => postConfigMock(...args),
  postUpdateApply: (...args: unknown[]) => postUpdateApplyMock(...args),
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
    active_agent: null,
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
  postVibeStartMock.mockReset();
  postVibeReplyMock.mockReset();
  openSseConnectionMock.mockReset();
  fetchConfigMock.mockReset();
  fetchDoctorMock.mockReset();
  fetchDetectPhaseMock.mockReset();
  fetchUpdateMock.mockReset();
  fetchCommandsMock.mockReset();
  postConfigMock.mockReset();
  postUpdateApplyMock.mockReset();
  openSseConnectionMock.mockReturnValue({ close: () => {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initProject', () => {
  it('optimistically flips is_initialized:true before the POST resolves', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const initResponse: InitResponse = {
        initialized: true,
        root: '/tmp/proj',
        files: ['.swt-planning/PROJECT.md'],
      };
      // Resolve postInit only after we observe the optimistic flip.
      let resolveInit: (v: InitResponse) => void = () => {};
      postInitMock.mockReturnValue(
        new Promise<InitResponse>((resolve) => {
          resolveInit = resolve;
        }),
      );
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));

      const initPromise = actions.initProject({ name: 'proj' });
      // After awaiting a microtask, the optimistic flip should be visible.
      await Promise.resolve();
      expect(state.snapshot?.is_initialized).toBe(true);
      expect(state.initSubmitting).toBe(true);

      resolveInit(initResponse);
      await initPromise;
      expect(state.initSubmitting).toBe(false);
      expect(fetchSnapshotMock).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  it('rolls back the optimistic flip when postInit rejects', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      const previous = makeSnapshot({ is_initialized: false });
      // Seed the previous snapshot via applyEvent (snapshot.replace).
      actions.applyEvent({ type: 'snapshot.replace', snapshot: previous });
      expect(state.snapshot?.is_initialized).toBe(false);

      postInitMock.mockRejectedValue(new Error('init_failed: EACCES'));

      await expect(actions.initProject({ name: 'proj' })).rejects.toThrow('init_failed');

      expect(state.snapshot?.is_initialized).toBe(false);
      expect(state.errors.at(-1)?.message).toContain('init_failed');
      dispose();
    });
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
  it('startVibeSession sets the active session and clears stale state', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-123',
        state: 'idle',
        agent_backend: 'codex',
      });

      const id = await actions.startVibeSession('build me a snake game');
      expect(id).toBe('sess-123');
      expect(state.vibeSession?.session_id).toBe('sess-123');
      expect(state.vibeSession?.initial_prompt).toBe('build me a snake game');
      expect(state.vibeSession?.conversation).toEqual([]);
      expect(state.vibeStarting).toBe(false);
      dispose();
    });
  });

  it('startVibeSession captures agent_backend=none and emits a setup-hint log line', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-no-agent',
        state: 'idle',
        agent_backend: 'none',
      });
      await actions.startVibeSession('test prompt');
      expect(state.vibeSession?.agent_backend).toBe('none');
      // The hint log line should appear on stderr channel.
      const stderrLines = state.recentLogLines.filter((l) => l.channel === 'stderr');
      expect(stderrLines.some((l) => l.line.includes('SWT_VIBE_AGENT=codex'))).toBe(true);
      dispose();
    });
  });

  it('startVibeSession returns null on rejection and pushes an error', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockRejectedValue(new Error('vibe_start_failed'));
      const id = await actions.startVibeSession('test');
      expect(id).toBeNull();
      expect(state.vibeSession).toBeNull();
      expect(state.errors.at(-1)?.message).toContain('vibe_start_failed');
      dispose();
    });
  });

  it('agent.prompt event appends to conversation as pending when session_id matches', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-A',
        state: 'idle',
        agent_backend: 'codex',
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
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-A',
        state: 'idle',
        agent_backend: 'codex',
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
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-A',
        state: 'idle',
        agent_backend: 'codex',
      });
      postVibeReplyMock.mockResolvedValue({ ok: true, accepted: true });
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
      expect(postVibeReplyMock).toHaveBeenCalledWith('sess-A', {
        prompt_id: 'p-1',
        answer: { kind: 'free_form', text: 'a snake game' },
      });
      const entry = state.vibeSession?.conversation[0];
      expect(entry?.status).toBe('answered');
      expect(entry?.reply).toEqual({ kind: 'free_form', text: 'a snake game' });
      dispose();
    });
  });

  it('replyToActivePrompt returns false when no pending prompt exists', async () => {
    await createRoot(async (dispose) => {
      const [, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-A',
        state: 'idle',
        agent_backend: 'codex',
      });
      await actions.startVibeSession('test');
      const ok = await actions.replyToActivePrompt({ kind: 'free_form', text: 'a' });
      expect(ok).toBe(false);
      expect(postVibeReplyMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('agent.prompt.timeout flips matching pending entry to expired', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-A',
        state: 'idle',
        agent_backend: 'codex',
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
      postVibeStartMock.mockResolvedValue({
        session_id: 'sess-A',
        state: 'idle',
        agent_backend: 'codex',
      });
      postVibeReplyMock.mockResolvedValue({ ok: true, accepted: true });
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

describe('tools sub-state', () => {
  it('initializes all five cells empty (config, doctor, detectPhase, update, commands)', async () => {
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
      dispose();
    });
  });

  it('bootstrap on initialized snapshot triggers refreshTools (all 5 cells fetch)', async () => {
    await createRoot(async (dispose) => {
      const [state, actions] = createDashboardStore();
      fetchSnapshotMock.mockResolvedValue(makeSnapshot({ is_initialized: true }));
      fetchConfigMock.mockResolvedValue(makeConfigSnapshot());
      fetchDoctorMock.mockResolvedValue(makeDoctorReport());
      fetchDetectPhaseMock.mockResolvedValue(makeDetectPhaseReport());
      fetchUpdateMock.mockResolvedValue(makeUpdateReport());
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
      expect(state.tools.config.data).not.toBeNull();
      expect(state.tools.commands.data?.verbs).toHaveLength(1);
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
      await actions.bootstrap();
      await Promise.resolve();
      await Promise.resolve();
      expect(state.tools.config.error).toBeNull();
      expect(state.tools.config.data).not.toBeNull();
      expect(state.tools.doctor.error).toMatch(/codex missing/);
      expect(state.tools.doctor.data).toBeNull();
      expect(state.tools.detectPhase.data).not.toBeNull();
      expect(state.tools.update.data).not.toBeNull();
      actions.shutdown();
      dispose();
    });
  });

  it('60s polling timer fires refreshTools after each interval tick', async () => {
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
