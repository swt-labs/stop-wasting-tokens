import type {
  AgentPromptContext,
  AgentPromptOption,
  ConfigSnapshot,
  DetectPhaseReport,
  DoctorReport,
  Snapshot,
  SnapshotEvent,
  UpdateReport,
  VibeReplyBody,
} from '@swt-labs/dashboard-core';
import { createStore } from 'solid-js/store';

import {
  fetchArtifactRendered,
  fetchConfig,
  fetchDetectPhase,
  fetchDoctor,
  fetchSnapshot,
  fetchUpdate,
  postCommand,
  postInit,
  postUatCheckpoint,
  postVibeReply,
  postVibeStart,
  type CommandResponse,
  type InitBody,
  type RenderedArtifact,
  type UatCheckpointBody,
} from '../services/api.js';
import { openSseConnection, type SseConnection } from '../services/sse.js';

export type ConnectionState = 'connecting' | 'syncing' | 'connected' | 'error';

export interface DashboardErrorEntry {
  id: string;
  message: string;
  ts: string;
}

export interface LogLine {
  id: string;
  ts: string;
  channel: 'stdout' | 'stderr';
  line: string;
}

export interface UatModalState {
  phase: string;
  scenario: string;
  plan?: string;
}

export type ConversationEntryStatus = 'pending' | 'answered' | 'expired';

export interface ConversationEntry {
  prompt_id: string;
  session_id: string;
  subtype: 'clarification' | 'permission';
  question: string;
  options?: AgentPromptOption[];
  context?: AgentPromptContext;
  emitted_at: string;
  expires_at?: string;
  status: ConversationEntryStatus;
  /** The reply payload once answered (free_form text, choice value, or permission decision). */
  reply?: VibeReplyBody['answer'];
  /** When the prompt expired or the user replied. */
  resolved_at?: string;
}

export interface VibeSessionState {
  session_id: string;
  initial_prompt: string;
  started_at: string;
  conversation: ConversationEntry[];
  /**
   * Reflects whether the daemon has an agent backend wired. When 'none',
   * the session was created but no agent will run — the UI surfaces a
   * setup hint instead of waiting silently. v2.0 ships codex agents
   * gated behind SWT_VIBE_AGENT=codex opt-in. When undefined (older
   * daemons), assume 'none' for back-compat.
   */
  agent_backend: 'none' | 'codex' | 'scripted';
}

/**
 * Per-cell lifecycle state for the v2.3 tools sub-store. Each of the four
 * read-only parity panels (Config / Doctor / Detect-phase / Update) owns
 * one cell of this shape.
 */
export interface ToolsCellState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** ISO-8601 timestamp of the last successful fetch. Null until the first
   * fetch lands; stays at the previous successful value during reload errors. */
  lastFetched: string | null;
}

export interface ToolsState {
  config: ToolsCellState<ConfigSnapshot>;
  doctor: ToolsCellState<DoctorReport>;
  detectPhase: ToolsCellState<DetectPhaseReport>;
  update: ToolsCellState<UpdateReport>;
}

export type ToolsCellKey = keyof ToolsState;

export interface DashboardState {
  connection: ConnectionState;
  reconnectAttempt: number;
  snapshot: Snapshot | null;
  selectedArtifact: { phase: string; name: string } | null;
  artifactCache: Map<string, RenderedArtifact>;
  artifactLoading: boolean;
  artifactError: string | null;
  recentLogLines: LogLine[];
  uatModal: UatModalState | null;
  uatSubmitting: boolean;
  initSubmitting: boolean;
  commandSubmitting: boolean;
  vibeSession: VibeSessionState | null;
  vibeStarting: boolean;
  vibeReplying: boolean;
  errors: DashboardErrorEntry[];
  tools: ToolsState;
}

export interface DashboardActions {
  bootstrap: () => Promise<void>;
  applyEvent: (evt: SnapshotEvent) => void;
  selectArtifact: (phase: string, name: string) => Promise<void>;
  openUatModal: (modal: UatModalState) => void;
  closeUatModal: () => void;
  submitUatCheckpoint: (result: 'pass' | 'fail', note?: string) => Promise<void>;
  initProject: (body: InitBody) => Promise<void>;
  runCommand: (input: string) => Promise<CommandResponse | null>;
  startVibeSession: (prompt: string) => Promise<string | null>;
  replyToActivePrompt: (answer: VibeReplyBody['answer']) => Promise<boolean>;
  /**
   * Fetch all four tools cells in parallel. No-op when the snapshot reports
   * `is_initialized: false` (greenfield daemons have no project to inspect
   * yet, and the App.tsx gate hides the column anyway).
   */
  refreshTools: () => Promise<void>;
  /** Fetch a single tools cell — used by the per-panel manual refresh button. */
  refreshToolsCell: (key: ToolsCellKey) => Promise<void>;
  pushError: (message: string) => void;
  shutdown: () => void;
}

/**
 * Optional hooks for tests: deterministic timestamps + shorter polling
 * intervals. Production callers omit and get the real defaults.
 */
export interface CreateDashboardStoreOptions {
  pollIntervalMs?: number;
  now?: () => Date;
}

const DEFAULT_TOOLS_POLL_INTERVAL_MS = 60_000;

function emptyToolsCell<T>(): ToolsCellState<T> {
  return { data: null, loading: false, error: null, lastFetched: null };
}

const ARTIFACT_CACHE_LIMIT = 32;
const RECENT_EVENTS_LIMIT = 100;
const RECENT_LOG_LIMIT = 200;

// Verbs whose execution mutates `.swt-planning/` and warrants a deterministic
// snapshot re-fetch. Read-only verbs rely on SSE state.changed events instead.
const MUTATING_VERBS = new Set(['init', 'vibe', 'archive', 'fix']);

function cacheKey(phase: string, name: string): string {
  return `${phase}/${name}`;
}

export function createDashboardStore(
  opts: CreateDashboardStoreOptions = {},
): [DashboardState, DashboardActions] {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_TOOLS_POLL_INTERVAL_MS;
  const nowFn = opts.now ?? ((): Date => new Date());

  const [state, setState] = createStore<DashboardState>({
    connection: 'connecting',
    reconnectAttempt: 0,
    snapshot: null,
    selectedArtifact: null,
    artifactCache: new Map<string, RenderedArtifact>(),
    artifactLoading: false,
    artifactError: null,
    recentLogLines: [],
    uatModal: null,
    uatSubmitting: false,
    initSubmitting: false,
    commandSubmitting: false,
    vibeSession: null,
    vibeStarting: false,
    vibeReplying: false,
    errors: [],
    tools: {
      config: emptyToolsCell<ConfigSnapshot>(),
      doctor: emptyToolsCell<DoctorReport>(),
      detectPhase: emptyToolsCell<DetectPhaseReport>(),
      update: emptyToolsCell<UpdateReport>(),
    },
  });

  let sse: SseConnection | null = null;
  let logSeq = 0;
  let sseHasOpened = false;

  // v2.3 tools polling: one timer drives all four cells, so a 60 s poll
  // means a single batched refresh, not four staggered ones. Pause when
  // the tab is hidden to keep idle laptops cool.
  let toolsTimer: ReturnType<typeof setInterval> | null = null;
  let toolsVisibilityHandler: (() => void) | null = null;

  const pushError = (message: string): void => {
    setState('errors', (prev) => {
      const entry: DashboardErrorEntry = {
        id: `err-${Date.now()}-${prev.length}`,
        message,
        ts: new Date().toISOString(),
      };
      const next = [...prev, entry];
      return next.slice(-10);
    });
  };

  const pushRecentEvent = (event: SnapshotEvent): void => {
    setState('snapshot', (prev) => {
      if (!prev) return prev;
      const next = [...prev.recent_events, event];
      return {
        ...prev,
        recent_events: next.slice(-RECENT_EVENTS_LIMIT),
      };
    });
  };

  const applyEvent = (evt: SnapshotEvent): void => {
    if (evt.type === 'snapshot.replace') {
      setState('snapshot', evt.snapshot);
      return;
    }
    if (evt.type === 'state.changed') {
      const partial = evt.snapshot;
      if (partial && Object.keys(partial).length > 0) {
        setState('snapshot', (prev) => {
          if (!prev) return prev;
          return { ...prev, ...partial };
        });
      }
      return;
    }
    if (evt.type === 'agent.spawn' || evt.type === 'agent.complete') {
      pushRecentEvent(evt);
      return;
    }
    if (evt.type === 'log.append') {
      logSeq += 1;
      const line: LogLine = {
        id: `log-${logSeq}`,
        ts: evt.ts,
        channel: evt.channel,
        line: evt.line,
      };
      setState('recentLogLines', (prev) => {
        const next = [...prev, line];
        return next.slice(-RECENT_LOG_LIMIT);
      });
      return;
    }
    if (evt.type === 'error') {
      pushError(`${evt.code}: ${evt.message}`);
      return;
    }
    if (evt.type === 'agent.prompt') {
      // Only append to the active session's conversation. Cross-session
      // prompts (multi-tab daemon) are ignored at the client level — the
      // server-side ?session_id= filter normally prevents them from
      // arriving, but this guard keeps the store coherent if the SSE is
      // unfiltered.
      if (state.vibeSession?.session_id !== evt.session_id) return;
      const entry: ConversationEntry = {
        prompt_id: evt.prompt_id,
        session_id: evt.session_id,
        subtype: evt.subtype,
        question: evt.question,
        ...(evt.options !== undefined ? { options: [...evt.options] } : {}),
        ...(evt.context !== undefined ? { context: { ...evt.context } } : {}),
        emitted_at: evt.ts,
        ...(evt.expires_at !== undefined ? { expires_at: evt.expires_at } : {}),
        status: 'pending',
      };
      setState('vibeSession', 'conversation', (prev) => [...prev, entry]);
      return;
    }
    if (evt.type === 'agent.prompt.timeout') {
      if (state.vibeSession?.session_id !== evt.session_id) return;
      setState('vibeSession', 'conversation', (entries) =>
        entries.map((entry) =>
          entry.prompt_id === evt.prompt_id && entry.status === 'pending'
            ? { ...entry, status: 'expired', resolved_at: evt.expired_at }
            : entry,
        ),
      );
      return;
    }
  };

  /* ── v2.3 tools sub-store ─────────────────────────────────────────── */

  type ToolsFetcher = {
    config: typeof fetchConfig;
    doctor: typeof fetchDoctor;
    detectPhase: typeof fetchDetectPhase;
    update: typeof fetchUpdate;
  };
  const toolsFetchers: ToolsFetcher = {
    config: fetchConfig,
    doctor: fetchDoctor,
    detectPhase: fetchDetectPhase,
    update: fetchUpdate,
  };
  const TOOLS_KEYS: ToolsCellKey[] = ['config', 'doctor', 'detectPhase', 'update'];

  const refreshToolsCell = async (key: ToolsCellKey): Promise<void> => {
    setState('tools', key, 'loading', true);
    setState('tools', key, 'error', null);
    try {
      const data = await toolsFetchers[key]();
      // Solid's setStore can't infer the union when setting `data` across
      // four different cell types in a single call site; cast through the
      // store's per-key typed setter to keep the assignment narrowly typed.
      setState('tools', key, {
        data: data as never,
        loading: false,
        error: null,
        lastFetched: nowFn().toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('tools', key, 'loading', false);
      setState('tools', key, 'error', message);
    }
  };

  const refreshTools = async (): Promise<void> => {
    if (state.snapshot?.is_initialized !== true) return;
    await Promise.all(TOOLS_KEYS.map((k) => refreshToolsCell(k)));
  };

  const startToolsPolling = (): void => {
    if (toolsTimer !== null) return;
    toolsTimer = setInterval(() => {
      void refreshTools();
    }, pollIntervalMs);
  };

  const stopToolsPolling = (): void => {
    if (toolsTimer !== null) {
      clearInterval(toolsTimer);
      toolsTimer = null;
    }
  };

  /**
   * `document.visibilitychange` keeps the polling loop quiet while the user
   * isn't looking at the dashboard. Hidden tab → clear the timer; visible
   * again → restart it AND fire one immediate refresh so the panels show
   * fresh data the moment the user comes back.
   */
  const installToolsVisibilityHandler = (): void => {
    if (toolsVisibilityHandler !== null) return;
    if (typeof document === 'undefined') return; // SSR / non-browser test runs
    toolsVisibilityHandler = (): void => {
      if (document.hidden) {
        stopToolsPolling();
      } else {
        startToolsPolling();
        void refreshTools();
      }
    };
    document.addEventListener('visibilitychange', toolsVisibilityHandler);
  };

  const removeToolsVisibilityHandler = (): void => {
    if (toolsVisibilityHandler === null) return;
    if (typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', toolsVisibilityHandler);
    toolsVisibilityHandler = null;
  };

  const bootstrap = async (): Promise<void> => {
    setState('connection', 'connecting');
    try {
      const snap = await fetchSnapshot();
      setState('snapshot', snap);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`initial snapshot fetch failed: ${message}`);
      setState('connection', 'error');
      return;
    }

    // Snapshot is in hand; SSE is opening. 'syncing' covers this gap so the
    // pill doesn't flash DISCONNECTED on slow networks before the first
    // onOpen fires.
    setState('connection', 'syncing');

    sse = openSseConnection(
      '/api/events',
      {
        onOpen: () => {
          sseHasOpened = true;
          setState('connection', 'connected');
          setState('reconnectAttempt', 0);
        },
        onError: () => {
          // Only flip to 'error' once we've successfully connected at least
          // once. Transient errors during the initial sync window stay in
          // 'syncing' — the SSE wrapper auto-reconnects.
          if (sseHasOpened) setState('connection', 'error');
        },
        onEvent: applyEvent,
      },
      {
        onReconnectAttempt: (attempt) => setState('reconnectAttempt', attempt),
        onReconnected: async () => {
          // Re-fetch snapshot to recover from any state drift during disconnect.
          try {
            const snap = await fetchSnapshot();
            setState('snapshot', snap);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            pushError(`snapshot re-fetch after reconnect failed: ${message}`);
          }
        },
      },
    );

    // v2.3 tools polling — only meaningful once the daemon reports
    // is_initialized. refreshTools() itself short-circuits on greenfield,
    // but skipping the timer setup entirely keeps the dashboard quiet
    // until init lands.
    if (state.snapshot?.is_initialized === true) {
      void refreshTools();
      startToolsPolling();
      installToolsVisibilityHandler();
    }
  };

  const selectArtifact = async (phase: string, name: string): Promise<void> => {
    setState({ selectedArtifact: { phase, name }, artifactError: null });
    const key = cacheKey(phase, name);
    if (state.artifactCache.has(key)) {
      setState('artifactLoading', false);
      return;
    }
    setState('artifactLoading', true);
    try {
      const art = await fetchArtifactRendered(phase, name);
      setState('artifactCache', (prev) => {
        const next = new Map(prev);
        if (next.size >= ARTIFACT_CACHE_LIMIT) {
          const oldest = next.keys().next().value;
          if (oldest) next.delete(oldest);
        }
        next.set(key, art);
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('artifactError', message);
      pushError(`artifact fetch failed: ${message}`);
    } finally {
      setState('artifactLoading', false);
    }
  };

  const openUatModal = (modal: UatModalState): void => {
    setState('uatModal', modal);
  };

  const closeUatModal = (): void => {
    setState('uatModal', null);
  };

  const submitUatCheckpoint = async (result: 'pass' | 'fail', note?: string): Promise<void> => {
    const modal = state.uatModal;
    if (!modal) return;
    setState('uatSubmitting', true);
    try {
      const body: UatCheckpointBody = {
        scenario: modal.scenario,
        result,
        ...(note !== undefined ? { note } : {}),
      };
      await postUatCheckpoint(modal.phase, body);
      closeUatModal();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`UAT checkpoint submit failed: ${message}`);
    } finally {
      setState('uatSubmitting', false);
    }
  };

  const appendLogLine = (line: string, channel: 'stdout' | 'stderr' = 'stdout'): void => {
    logSeq += 1;
    const entry: LogLine = {
      id: `log-init-${logSeq}`,
      ts: new Date().toISOString(),
      channel,
      line,
    };
    setState('recentLogLines', (prev) => {
      const next = [...prev, entry];
      return next.slice(-RECENT_LOG_LIMIT);
    });
  };

  const initProject = async (body: InitBody): Promise<void> => {
    setState('initSubmitting', true);
    // Capture the current snapshot so we can roll back if init fails.
    // Shallow-spread to detach from the SolidJS store proxy — without this,
    // the optimistic setState below would mutate the captured reference and
    // the rollback would no-op. Phases/recent_events arrays are aliased,
    // which is safe because rollback only restores top-level primitives.
    const previousSnapshot: Snapshot | null = state.snapshot ? { ...state.snapshot } : null;
    // Optimistically flip is_initialized: true so App.tsx unmounts InitScreen
    // and mounts the 4-panel grid immediately — no waiting on POST + GET
    // round-trips. Project/milestone stay null; TopBar's <Show> fallback
    // already handles that case ("…" placeholder). The real values arrive
    // when fetchSnapshot resolves below.
    const optimisticSnap: Snapshot = previousSnapshot
      ? { ...previousSnapshot, is_initialized: true, generated_at: new Date().toISOString() }
      : {
          schema_version: '1',
          generated_at: new Date().toISOString(),
          project: null,
          milestone: null,
          phases: [],
          active_agent: null,
          recent_events: [],
          cost_summary: null,
          is_initialized: true,
        };
    setState('snapshot', optimisticSnap);
    appendLogLine(`[ok] Initialized .swt-planning/ — type 'help' for available subcommands.`);
    try {
      const response = await postInit(body);
      appendLogLine(`[ok] Project ${body.name} ready at ${response.root}`);
      // Replace the optimistic snapshot with the server's real one. After
      // /api/init, the daemon's snapshotter is live and /api/snapshot returns
      // populated project/milestone/phases.
      const snap = await fetchSnapshot();
      setState('snapshot', snap);
    } catch (err: unknown) {
      // Roll back the optimistic flip — InitScreen reappears so the user can
      // see the error and retry.
      setState('snapshot', previousSnapshot);
      const message = err instanceof Error ? err.message : String(err);
      pushError(`init failed: ${message}`);
      throw err;
    } finally {
      setState('initSubmitting', false);
    }
  };

  const appendCommandLines = (response: CommandResponse, input: string): void => {
    const ts = new Date().toISOString();
    const inputLine: LogLine = {
      id: `log-cmd-${++logSeq}`,
      ts,
      channel: 'stdout',
      line: `$ swt ${input}`,
    };
    const lines: LogLine[] = [inputLine];
    for (const raw of response.stdout.split('\n')) {
      if (raw.length === 0) continue;
      lines.push({ id: `log-cmd-${++logSeq}`, ts, channel: 'stdout', line: raw });
    }
    for (const raw of response.stderr.split('\n')) {
      if (raw.length === 0) continue;
      lines.push({ id: `log-cmd-${++logSeq}`, ts, channel: 'stderr', line: raw });
    }
    if (response.exit_code !== 0) {
      lines.push({
        id: `log-cmd-${++logSeq}`,
        ts,
        channel: 'stderr',
        line: `[exit ${response.exit_code} · ${response.duration_ms}ms]`,
      });
    }
    setState('recentLogLines', (prev) => {
      const next = [...prev, ...lines];
      return next.slice(-RECENT_LOG_LIMIT);
    });
  };

  const runCommand = async (input: string): Promise<CommandResponse | null> => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    setState('commandSubmitting', true);
    try {
      const result = await postCommand({ input: trimmed });
      appendCommandLines(result, trimmed);
      const verb = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (MUTATING_VERBS.has(verb)) {
        // Mutating verbs warrant a deterministic re-fetch even though SSE
        // state.changed events also fire — covers the case where the user
        // runs a command before SSE has reconnected.
        try {
          const snap = await fetchSnapshot();
          setState('snapshot', snap);
        } catch {
          /* ignore — log lines already captured */
        }
      }
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`command failed: ${message}`);
      return null;
    } finally {
      setState('commandSubmitting', false);
    }
  };

  const startVibeSession = async (prompt: string): Promise<string | null> => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return null;
    setState('vibeStarting', true);
    try {
      const response = await postVibeStart({ prompt: trimmed });
      setState('vibeSession', {
        session_id: response.session_id,
        initial_prompt: trimmed,
        started_at: new Date().toISOString(),
        conversation: [],
        agent_backend: response.agent_backend ?? 'none',
      });
      appendLogLine(`[vibe] started session ${response.session_id.slice(0, 8)} — "${trimmed}"`);
      if ((response.agent_backend ?? 'none') === 'none') {
        appendLogLine(
          `[vibe] no agent backend configured — set SWT_VIBE_AGENT=codex (and have codex CLI installed) to run real agents.`,
          'stderr',
        );
      }
      return response.session_id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`vibe start failed: ${message}`);
      return null;
    } finally {
      setState('vibeStarting', false);
    }
  };

  const replyToActivePrompt = async (answer: VibeReplyBody['answer']): Promise<boolean> => {
    const session = state.vibeSession;
    if (!session) return false;
    const active = session.conversation.find((e) => e.status === 'pending');
    if (!active) return false;
    setState('vibeReplying', true);
    try {
      await postVibeReply(session.session_id, {
        prompt_id: active.prompt_id,
        answer,
      });
      const resolved_at = new Date().toISOString();
      setState('vibeSession', 'conversation', (entries) =>
        entries.map((entry) =>
          entry.prompt_id === active.prompt_id
            ? { ...entry, status: 'answered', reply: answer, resolved_at }
            : entry,
        ),
      );
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`vibe reply failed: ${message}`);
      return false;
    } finally {
      setState('vibeReplying', false);
    }
  };

  const shutdown = (): void => {
    sse?.close();
    sse = null;
    stopToolsPolling();
    removeToolsVisibilityHandler();
  };

  return [
    state,
    {
      bootstrap,
      applyEvent,
      selectArtifact,
      openUatModal,
      closeUatModal,
      submitUatCheckpoint,
      initProject,
      runCommand,
      startVibeSession,
      replyToActivePrompt,
      refreshTools,
      refreshToolsCell,
      pushError,
      shutdown,
    },
  ];
}
