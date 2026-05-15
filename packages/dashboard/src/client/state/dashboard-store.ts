import type {
  AgentLiveState,
  AgentPromptContext,
  AgentPromptOption,
  CommandRegistry,
  ConfigSnapshot,
  CookEvent,
  DetectPhaseReport,
  DoctorReport,
  Snapshot,
  SnapshotEvent,
  UpdateReport,
  UserNotesSnapshot,
  VibeReplyBody,
} from '@swt-labs/shared';
import { createStore } from 'solid-js/store';

import {
  fetchArtifactRendered,
  fetchCommands,
  fetchConfig,
  fetchDetectPhase,
  fetchDoctor,
  fetchProviderAuth,
  fetchSnapshot,
  fetchUpdate,
  fetchUserNotes,
  postCommand,
  postConfig,
  postCookStart,
  postInit,
  postOAuthCode,
  postOAuthStart,
  postPromptRespond,
  postProviderAuth,
  postUatCheckpoint,
  postUpdateApply,
  postUserNotes,
  type CommandResponse,
  type ConfigUpdateBody,
  type InitBody,
  type ProviderAuthSnapshot,
  type ProviderAuthUpdateBody,
  type RenderedArtifact,
  type UatCheckpointBody,
  type UpdateApplyResponse,
} from '../services/api.js';
// `UserNotesSnapshot` is imported from `@swt-labs/shared` above alongside the
// other wire types — the store types its `userNotes` tools-cell against it.
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
  agent_backend: 'none' | 'pi';
  /**
   * Phase 03 — lifecycle pill for the active vibe session. 'running' on
   * spawn; transitions to 'completed' when cook emits cook.completion;
   * 'crashed' when cook emits cook.error or the watchdog fires
   * COOK_SPAWN_FAILED. The 10s activeAgents/activeSessionId clear timer
   * keeps the conversation thread visible after status flips so the user
   * can read the final agent.prompt; the NEXT startVibeSession replaces
   * the whole vibeSession (new session_id, empty conversation,
   * status='running'). Phase 04 may consume this field for the
   * phase-aware placeholder/hint.
   */
  status?: 'running' | 'completed' | 'crashed';
}

/**
 * Plan 04-03 (Phase 4) — the in-progress OAuth login flow. `null` when no
 * OAuth login is running. TOKEN-FREE by construction: it holds only the
 * non-secret auth URL + progress/error strings the `oauth.*` SSE events
 * carry (04-01's events are token-free; the `OAuthCredentials` blob never
 * reaches the SPA — it goes straight to the OS keychain server-side, 04-02).
 *
 * `status` discriminates the flow's phase: `starting` (the `postOAuthStart`
 * POST is in flight, awaiting the first event), `awaiting_browser` (an
 * `oauth.auth_url` arrived — the panel shows "open this URL"),
 * `awaiting_code` (an `oauth.awaiting_code` arrived — the panel shows the
 * manual-code paste box), `complete`, `error`.
 */
export interface OAuthFlowState {
  flowId: string;
  provider: string;
  status: 'starting' | 'awaiting_browser' | 'awaiting_code' | 'complete' | 'error';
  authUrl: string | null;
  instructions: string | null;
  progressMessage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
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
  /**
   * v2.3 Phase 03: the cmd-K command palette consumes this cell to
   * populate its fuzzy-search list. Polled like the other cells but
   * the palette also reads it on every open in case the panel hasn't
   * been visible for a while.
   */
  commands: ToolsCellState<CommandRegistry>;
  /**
   * Phase 3 (vendor-select): the `ProviderAuthPanel`'s read state — the
   * current provider selection + per-provider auth *status* + keychain
   * availability. Secret-free by 03-01's `ProviderAuthSnapshotSchema`.
   * Fetched alongside the other cells and refetched on the `state.changed`
   * SSE event the `POST /api/provider-auth` route publishes.
   */
  providerAuth: ToolsCellState<ProviderAuthSnapshot>;
  /**
   * User Notes — a freeform per-project scratchpad backed by
   * `<cwd>/.swt-planning/USER_NOTES.md`. DELIBERATELY NOT on the poll loop
   * (`TOOLS_KEYS` / `FAST_TOOLS_KEYS` / `SLOW_TOOLS_KEYS` all exclude it):
   * polling would clobber the user's in-progress typing, and it is a
   * single-editor personal file. Fetched ONCE on bootstrap; mutated via the
   * `saveUserNotes` action (the panel debounces, the action does not).
   */
  userNotes: ToolsCellState<UserNotesSnapshot>;
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
  /**
   * Phase 1 (Dashboard Options Menu) — whether the TopBar "Options ▾" dropdown
   * is open. Pure client UI state: no SSE event, no tools-cell, no polling.
   * The canonical home so later phases / other components can observe it.
   */
  optionsMenuOpen: boolean;
  /**
   * Whether the TopBar "Provider ▾" dropdown is open. Pure client UI state,
   * exactly like `optionsMenuOpen` — no SSE event, no tools-cell, no polling.
   * Hosts the (re-surfaced) `<ProviderAuthPanel>`; the two top-bar dropdowns
   * are independent (opening one does not close the other — each owns its
   * own click-outside dismissal via its `<Popover>`).
   */
  providerMenuOpen: boolean;
  errors: DashboardErrorEntry[];
  tools: ToolsState;
  /**
   * Plan 04-03 T1 — live agent rows folded from `cook.*` SSE events. Keyed by
   * `sub_session_id` for O(1) updates. Pane 3 (`<ActiveAgentsPane>`) renders
   * this map. Cleared 10 s after a `cook.completion` so the user has a beat
   * to inspect the final state.
   */
  activeAgents: Map<string, AgentLiveState>;
  /**
   * Plan 04-03 T1 — the most recent `cook.priority_decision.session_id`.
   * Pane 3's pause/resume/cancel buttons POST `/api/cook/:sessionId/control`
   * with this. Null while no cook is running.
   */
  activeSessionId: string | null;
  /**
   * Plan 04-03 (Phase 4) — the in-progress OAuth login flow, or `null` when
   * no OAuth login is running. The `ProviderAuthPanel`'s source of truth for
   * what to render during an OAuth login. Token-free by construction (see
   * `OAuthFlowState`). `flow_id`-correlated: the `applyEvent` `oauth.*`
   * branch ignores any event whose `flow_id` does not match this flow.
   */
  oauthFlow: OAuthFlowState | null;
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
  /**
   * v2.3 Phase 03: POST a new config to the daemon. The server's
   * `state.changed` SSE event with `changed: ['config']` re-fetches the
   * Config cell automatically on success. Returns `{ok: true}` on success,
   * `{error: string}` on validation/write failure (also pushed to errors[]).
   */
  applyConfigUpdate: (body: ConfigUpdateBody) => Promise<{ ok: true } | { error: string }>;
  /**
   * Phase 3 (vendor-select): POST a provider selection + API key to the
   * daemon. The key goes straight to the OS keychain; only the non-secret
   * selection lands in `config.json`. On success the `providerAuth` cell
   * is optimistically updated from the response snapshot, and the server's
   * `state.changed` SSE event refetches it shortly after. Returns
   * `{ok: true}` on success, `{error: string}` on validation/write
   * failure (also pushed to errors[]).
   */
  applyProviderAuthUpdate: (
    body: ProviderAuthUpdateBody,
  ) => Promise<{ ok: true } | { error: string }>;
  /**
   * Plan 04-03 (Phase 4): kick off an OAuth login flow for `provider`. Sets
   * the `oauthFlow` signal to a `starting` entry, calls `postOAuthStart`,
   * and on success updates `oauthFlow.flowId` so the subsequent `oauth.*`
   * SSE events correlate. Returns `{ok: true}` on success, `{error}` on
   * failure (also pushed to errors[]).
   */
  startOAuthFlow: (provider: string) => Promise<{ ok: true } | { error: string }>;
  /**
   * Plan 04-03 (Phase 4): submit a manually-pasted authorization code into
   * the active OAuth flow (Risk 4 headless paste path). Returns
   * `{error: 'no_active_oauth_flow'}` when there is no active flow. The
   * flow's actual completion still arrives via the `oauth.complete` SSE
   * event — this does NOT optimistically complete the flow.
   */
  submitOAuthCode: (code: string) => Promise<{ ok: true } | { error: string }>;
  /** Plan 04-03 (Phase 4): clear the `oauthFlow` signal back to `null`. */
  dismissOAuthFlow: () => void;
  /**
   * User Notes — POST the scratchpad text to the daemon. On success,
   * optimistically updates the `userNotes` cell (sets `data.notes` to the
   * saved text, `exists: true`, refreshes `lastFetched`). Returns `{ok:true}`
   * on success or `{error}` on failure (also pushed to errors[]). The
   * DEBOUNCE lives in the panel — this is a plain async action with no
   * timer. No SSE event is involved (the route publishes none).
   */
  saveUserNotes: (notes: string) => Promise<{ ok: true } | { error: string }>;
  /** Phase 1 — open the TopBar Options dropdown. */
  openOptionsMenu: () => void;
  /** Phase 1 — close the TopBar Options dropdown. */
  closeOptionsMenu: () => void;
  /** Phase 1 — toggle the TopBar Options dropdown. */
  toggleOptionsMenu: () => void;
  /** Open the TopBar Provider dropdown. */
  openProviderMenu: () => void;
  /** Close the TopBar Provider dropdown. */
  closeProviderMenu: () => void;
  /** Toggle the TopBar Provider dropdown. */
  toggleProviderMenu: () => void;
  /**
   * v2.3 Phase 03: trigger `npm i -g stop-wasting-tokens@latest` server-side.
   * On success, refreshes the Update cell. Elevation case (EACCES) returns
   * `requires_elevation: true` + `copyable_command` for the panel to surface.
   */
  applyUpdate: () => Promise<UpdateApplyResponse | { error: string }>;
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

// Slow-tier tools poll — the fallback cadence for cells that are cheap to
// leave stale: `commands` is a static verb registry, `update` is a 24 h-cached
// npm version check, `doctor` spawns toolchain checks. None benefit from a
// fast poll.
const DEFAULT_TOOLS_SLOW_POLL_INTERVAL_MS = 60_000;
// Fast-tier tools poll — the volatile cells (`config`, `detectPhase`,
// `providerAuth`) where an out-of-band change (a hand-edited config.json, a
// `swt` command in a terminal) can land at any time. These also get an
// instant SSE `state.changed` refetch, so this fast timer is only the
// fallback for changes made entirely outside the dashboard.
const DEFAULT_TOOLS_FAST_POLL_INTERVAL_MS = 5_000;

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
  // `opts.pollIntervalMs` (a test seam) overrides the fast tier; the slow
  // tier keeps its fixed 60 s default.
  const fastPollIntervalMs = opts.pollIntervalMs ?? DEFAULT_TOOLS_FAST_POLL_INTERVAL_MS;
  const slowPollIntervalMs = DEFAULT_TOOLS_SLOW_POLL_INTERVAL_MS;
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
    optionsMenuOpen: false,
    providerMenuOpen: false,
    errors: [],
    tools: {
      config: emptyToolsCell<ConfigSnapshot>(),
      doctor: emptyToolsCell<DoctorReport>(),
      detectPhase: emptyToolsCell<DetectPhaseReport>(),
      update: emptyToolsCell<UpdateReport>(),
      commands: emptyToolsCell<CommandRegistry>(),
      providerAuth: emptyToolsCell<ProviderAuthSnapshot>(),
      userNotes: emptyToolsCell<UserNotesSnapshot>(),
    },
    activeAgents: new Map<string, AgentLiveState>(),
    activeSessionId: null,
    oauthFlow: null,
  });

  // Plan 04-03 T1 — pending clear timer scheduled by `cook.completion`. Held
  // at module scope so a follow-up `cook.priority_decision` (new session) can
  // cancel it and prevent the previous session's rows from being wiped after
  // the new one starts.
  let cookClearTimer: ReturnType<typeof setTimeout> | null = null;

  let sse: SseConnection | null = null;
  let logSeq = 0;
  let sseHasOpened = false;

  // Tools polling runs two tiers: a fast 5 s timer for the volatile cells
  // (config / detect-phase / provider-auth — where an out-of-band change can
  // land at any time) and a slow 60 s timer for the cheap/static/cached ones
  // (doctor / update / commands). Both pause when the tab is hidden to keep
  // idle laptops cool. The volatile cells also get an instant SSE
  // `state.changed` refetch — the fast timer is only the fallback for changes
  // made entirely outside the dashboard.
  let toolsFastTimer: ReturnType<typeof setInterval> | null = null;
  let toolsSlowTimer: ReturnType<typeof setInterval> | null = null;
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

  /**
   * Plan 04-03 T1 — fold cook orchestrator events into `activeAgents` +
   * `activeSessionId`. Pure: no DOM access; only writes to the Solid store.
   *
   * `cook.completion` schedules a 10 s delayed clear so the user can inspect
   * the final agent grid before it empties. A subsequent
   * `cook.priority_decision` cancels that timer (a new cook is starting).
   *
   * `cook.file_write` / `cook.commit` / `cook.error` are intentionally
   * no-ops here — they surface through the log/event panels via the
   * existing `recent_events` slice.
   */
  const handleCookEvent = (evt: CookEvent): void => {
    switch (evt.type) {
      case 'cook.priority_decision': {
        // A new (or resumed) cook session is active; cancel any pending
        // post-completion clear so this session's rows aren't wiped.
        if (cookClearTimer !== null) {
          clearTimeout(cookClearTimer);
          cookClearTimer = null;
        }
        setState('activeSessionId', evt.session_id);
        return;
      }
      case 'cook.agent_spawn': {
        const next = new Map(state.activeAgents);
        next.set(evt.sub_session_id, {
          sub_session_id: evt.sub_session_id,
          role: evt.role,
          status: 'running',
          tokens_in: 0,
          tokens_out: 0,
          cache_read: 0,
          cache_creation: 0,
          cost_usd: 0,
          elapsed_ms: 0,
          started_at: evt.ts,
        });
        setState('activeAgents', next);
        return;
      }
      case 'cook.agent_result': {
        const existing = state.activeAgents.get(evt.sub_session_id);
        if (!existing) return;
        const next = new Map(state.activeAgents);
        const updated: AgentLiveState = {
          ...existing,
          // 'blocked' isn't a row-level status — agents that block surface
          // through askUser; treat as 'failed' for the table colouring.
          status: evt.status === 'completed' ? 'completed' : 'failed',
          tokens_in: existing.tokens_in + evt.usage.input_tokens,
          tokens_out: existing.tokens_out + evt.usage.output_tokens,
          cache_read: existing.cache_read + (evt.usage.cache_read_input_tokens ?? 0),
          cache_creation: existing.cache_creation + (evt.usage.cache_creation_input_tokens ?? 0),
          cost_usd: existing.cost_usd + (evt.usage.cost_usd ?? 0),
          elapsed_ms: Math.max(
            0,
            new Date(evt.ts).getTime() - new Date(existing.started_at).getTime(),
          ),
          // Clear the in-flight tool fields — the agent has finished.
          current_tool: undefined,
          current_tool_input_excerpt: undefined,
        };
        next.set(evt.sub_session_id, updated);
        setState('activeAgents', next);
        return;
      }
      case 'cook.tool_call': {
        const existing = state.activeAgents.get(evt.sub_session_id);
        if (!existing) return;
        const next = new Map(state.activeAgents);
        next.set(evt.sub_session_id, {
          ...existing,
          current_tool: evt.tool,
          current_tool_input_excerpt: evt.input_excerpt,
        });
        setState('activeAgents', next);
        return;
      }
      case 'cook.tool_result': {
        const existing = state.activeAgents.get(evt.sub_session_id);
        if (!existing) return;
        // Only clear when the result matches the currently-displayed tool;
        // a stale (race-condition) result for a different tool shouldn't
        // wipe the live one.
        if (existing.current_tool !== evt.tool) return;
        const next = new Map(state.activeAgents);
        next.set(evt.sub_session_id, {
          ...existing,
          current_tool: undefined,
          current_tool_input_excerpt: undefined,
        });
        setState('activeAgents', next);
        return;
      }
      case 'cook.resume': {
        // Phase 03 GAP-03 — surface cook crash-recovery to the user. A
        // resumed cook always fires cook.priority_decision next (which
        // sets activeSessionId), but emitting the LOG line + cancelling
        // any pending clear here makes the recovery legible even if the
        // priority_decision is briefly delayed. Mirrors the timer-cancel
        // half of the cook.priority_decision branch above.
        if (cookClearTimer !== null) {
          clearTimeout(cookClearTimer);
          cookClearTimer = null;
        }
        setState('activeSessionId', evt.session_id);
        // appendLogLine appears below in the store body; it is captured
        // by closure (same channel startVibeSession + initProject use to
        // surface inline UI log lines). Format mirrors the
        // "[cook] started session {sid8} — \"{prompt}\"" line so the
        // user sees a parallel "[cook] resuming session {sid8} from
        // {from_task}" entry. from_task is required per the
        // CookResumeEvent schema but the `?? 'unknown'` fallback survives
        // any future schema drift at zero cost.
        const sid8 = evt.session_id.slice(0, 8);
        const fromTask = evt.from_task ?? 'unknown';
        appendLogLine(`[cook] resuming session ${sid8} from ${fromTask}`);
        return;
      }
      case 'cook.completion': {
        // Phase 03 GAP-01 — flip the lifecycle pill so the conversation
        // thread shows 'completed' immediately while the 10s timer keeps
        // the agent grid visible. Guarded: only flip if vibeSession
        // refers to this session (defensive — should always be true at
        // this point). Do NOT null vibeSession here — the conversation
        // must stay readable. The replace happens on the next
        // startVibeSession.
        if (state.vibeSession?.session_id === evt.session_id) {
          setState('vibeSession', 'status', 'completed');
        }
        if (cookClearTimer !== null) clearTimeout(cookClearTimer);
        cookClearTimer = setTimeout(() => {
          setState('activeAgents', new Map<string, AgentLiveState>());
          setState('activeSessionId', null);
          cookClearTimer = null;
        }, 10_000);
        return;
      }
      case 'cook.error': {
        // Phase 03 GAP-01 — flip the lifecycle pill to 'crashed' when
        // cook emits an error event (typically COOK_SPAWN_FAILED from
        // the cook-start watchdog or the orchestrator's uncaught-error
        // path). activeAgents/activeSessionId are intentionally not
        // touched here — they surface through the existing recent-events
        // + log panels, and the conversation thread stays readable until
        // the next startVibeSession replaces vibeSession.
        if (state.vibeSession?.session_id === evt.session_id) {
          setState('vibeSession', 'status', 'crashed');
        }
        return;
      }
      case 'cook.file_write':
      case 'cook.commit':
        // No store mutation — surfaced via the recent-events + log panels.
        return;
    }
  };

  /**
   * Plan 04-03 (Phase 4) — fold the five `oauth.*` SSE bridge events (04-01)
   * into the `oauthFlow` signal. The 04-02 server route publishes these as
   * it drives pi-ai's `OAuthProviderInterface.login()`.
   *
   * `flow_id`-correlated (Risk 4): every branch first checks the event's
   * `flow_id` against the active `oauthFlow.flowId`. An event whose
   * `flow_id` does NOT match — a stale flow, or a concurrent flow from
   * another browser tab — is IGNORED, so concurrent flows never cross-wire.
   * The `oauth.auth_url` branch also accepts a still-`starting` flow for the
   * same provider whose `flowId` is empty (the provisional entry
   * `startOAuthFlow` set before the `postOAuthStart` response landed).
   *
   * NONE of the branches reads or stores a token — 04-01's `oauth.*` events
   * are token-free by construction; the `oauthFlow` signal mirrors that.
   */
  const handleOAuthEvent = (evt: Extract<SnapshotEvent, { type: `oauth.${string}` }>): void => {
    const flow = state.oauthFlow;
    switch (evt.type) {
      case 'oauth.auth_url': {
        // Accept either an exact flow_id match, or a still-`starting`
        // provisional entry for this provider (flowId not yet assigned).
        const matches =
          flow?.flowId === evt.flow_id ||
          (flow?.status === 'starting' &&
            flow.provider === evt.provider &&
            flow.flowId.length === 0);
        if (!matches) return;
        setState('oauthFlow', (prev) => ({
          flowId: evt.flow_id,
          provider: evt.provider,
          status: 'awaiting_browser',
          authUrl: evt.url,
          instructions: evt.instructions ?? null,
          progressMessage: prev?.progressMessage ?? null,
          errorCode: null,
          errorMessage: null,
        }));
        return;
      }
      case 'oauth.progress': {
        if (flow?.flowId !== evt.flow_id) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                progressMessage: evt.message,
                status: prev.status === 'starting' ? 'awaiting_browser' : prev.status,
              }
            : prev,
        );
        return;
      }
      case 'oauth.awaiting_code': {
        if (flow?.flowId !== evt.flow_id) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                status: 'awaiting_code',
                progressMessage: evt.message ?? prev.progressMessage,
              }
            : prev,
        );
        return;
      }
      case 'oauth.complete': {
        if (flow?.flowId !== evt.flow_id) return;
        setState('oauthFlow', 'status', 'complete');
        // Immediate refetch so the auth-status display reflects the
        // now-configured provider. The 04-02 route also publishes
        // `state.changed`, which 03-04's handler refetches `providerAuth`
        // on too — belt-and-suspenders; either path is correct.
        void refreshToolsCell('providerAuth');
        return;
      }
      case 'oauth.error': {
        if (flow?.flowId !== evt.flow_id) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                status: 'error',
                errorCode: evt.code,
                errorMessage: evt.message,
              }
            : prev,
        );
        return;
      }
    }
  };

  const applyEvent = (evt: SnapshotEvent): void => {
    if (evt.type.startsWith('cook.')) {
      handleCookEvent(evt as CookEvent);
      return;
    }
    if (evt.type.startsWith('oauth.')) {
      handleOAuthEvent(evt as Extract<SnapshotEvent, { type: `oauth.${string}` }>);
      return;
    }
    if (evt.type === 'snapshot.replace') {
      setState('snapshot', evt.snapshot);
      // Plan 04-03 T1 — hydrate live agents from the snapshot so a
      // reconnected client immediately shows the right table without
      // waiting on live events. The field is optional in the Snapshot
      // schema until plan 04-02 lands its extension, hence the cast.
      const seeded = (evt.snapshot as Snapshot & { active_agents?: AgentLiveState[] })
        .active_agents;
      if (Array.isArray(seeded)) {
        const hydrated = new Map<string, AgentLiveState>();
        for (const row of seeded) hydrated.set(row.sub_session_id, row);
        setState('activeAgents', hydrated);
      }
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
      // v2.3 Phase 03: when the server reports config mutated (via POST
      // /api/config), refetch the Config cell so the panel reflects the
      // new state. Other tools cells (doctor, detect-phase, update,
      // commands) don't currently emit state.changed events; if they
      // ever do, branch them here too.
      if (evt.changed.includes('config')) {
        void refreshToolsCell('config');
      }
      // Phase 3 (vendor-select): the `POST /api/provider-auth` route
      // publishes `state.changed` with `changed:['config']` (the
      // `StateChangedEvent.changed` Zod enum has no 'provider-auth'
      // member — see 03-02's DEVN-01), so a credential save from this
      // panel OR from another browser tab lands on the `config` change.
      // Refetch the `providerAuth` cell on either `config` OR a future
      // `provider-auth` change — a plain config edit refetching the
      // provider-auth status too is harmless and keeps the keychain
      // status fresh. The `provider-auth` arm is checked through a
      // widened `string[]` view because the schema enum doesn't include
      // it yet; if a later phase adds it to the enum this keeps working.
      // Reuses the existing state.changed → refreshToolsCell mechanism;
      // no new SSE event type, no new channel.
      const changedKeys: readonly string[] = evt.changed;
      if (changedKeys.includes('config') || changedKeys.includes('provider-auth')) {
        void refreshToolsCell('providerAuth');
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
      // Phase 03 GAP-01 — accept prompts whose session_id matches EITHER
      // the current vibeSession (the conversation thread the user is
      // reading) OR the activeSessionId set by the latest
      // cook.priority_decision (the cook process currently running on
      // disk). After a cook.completion + new startVibeSession the two
      // session_ids diverge for the 10s clear window; both must be
      // accepted so Plan/Execute confirmation gates surface to the user.
      // Cross-session prompts whose session_id matches NEITHER are still
      // ignored — the server-side ?session_id= filter normally prevents
      // them from arriving, but this guard keeps the store coherent if
      // the SSE is unfiltered.
      const sid = evt.session_id;
      const accept =
        state.vibeSession?.session_id === sid || state.activeSessionId === sid;
      if (!accept) return;
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
      // Phase 03 GAP-01 — mirror the relaxed dual-source guard from the
      // agent.prompt branch above so a timeout event for the currently-
      // running cook process still marks the matching entry expired even
      // when state.vibeSession.session_id has diverged from
      // state.activeSessionId (the 10s clear-window race).
      const sid = evt.session_id;
      const accept =
        state.vibeSession?.session_id === sid || state.activeSessionId === sid;
      if (!accept) return;
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
    commands: typeof fetchCommands;
    providerAuth: typeof fetchProviderAuth;
    userNotes: typeof fetchUserNotes;
  };
  const toolsFetchers: ToolsFetcher = {
    config: fetchConfig,
    doctor: fetchDoctor,
    detectPhase: fetchDetectPhase,
    update: fetchUpdate,
    commands: fetchCommands,
    providerAuth: fetchProviderAuth,
    userNotes: fetchUserNotes,
  };
  // The poll-loop key sets DELIBERATELY EXCLUDE `userNotes`. It is a
  // single-editor personal scratchpad — polling would clobber in-progress
  // typing. It is fetched once on bootstrap (see below) and otherwise only
  // re-fetched on the panel's manual ↻ refresh via `refreshToolsCell`.
  const TOOLS_KEYS: ToolsCellKey[] = [
    'config',
    'doctor',
    'detectPhase',
    'update',
    'commands',
    'providerAuth',
  ];
  // Fast tier — volatile cells an out-of-band edit can change at any time.
  const FAST_TOOLS_KEYS: ToolsCellKey[] = ['config', 'detectPhase', 'providerAuth'];
  // Slow tier — cheap/static/cached cells: `commands` is a static registry,
  // `update` is a 24 h-cached npm check, `doctor` spawns toolchain checks.
  const SLOW_TOOLS_KEYS: ToolsCellKey[] = ['doctor', 'update', 'commands'];

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

  // Refresh one poll tier (a subset of TOOLS_KEYS). Shares refreshTools's
  // greenfield short-circuit so a tier timer never fetches before init.
  const refreshToolsGroup = async (keys: readonly ToolsCellKey[]): Promise<void> => {
    if (state.snapshot?.is_initialized !== true) return;
    await Promise.all(keys.map((k) => refreshToolsCell(k)));
  };

  const startToolsPolling = (): void => {
    if (toolsFastTimer === null) {
      toolsFastTimer = setInterval(() => {
        void refreshToolsGroup(FAST_TOOLS_KEYS);
      }, fastPollIntervalMs);
    }
    if (toolsSlowTimer === null) {
      toolsSlowTimer = setInterval(() => {
        void refreshToolsGroup(SLOW_TOOLS_KEYS);
      }, slowPollIntervalMs);
    }
  };

  const stopToolsPolling = (): void => {
    if (toolsFastTimer !== null) {
      clearInterval(toolsFastTimer);
      toolsFastTimer = null;
    }
    if (toolsSlowTimer !== null) {
      clearInterval(toolsSlowTimer);
      toolsSlowTimer = null;
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
      // User Notes is fetched ONCE here on bootstrap — it is deliberately
      // NOT on the poll loop (polling would clobber in-progress typing) and
      // emits no SSE event, so this one-shot fetch is the only automatic
      // load. The panel's ↻ button triggers `refreshToolsCell('userNotes')`
      // for an explicit manual re-fetch thereafter.
      void refreshToolsCell('userNotes');
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

  /* ── Phase 1 (Dashboard Options Menu) — TopBar dropdown open/close ──
   * Pure client UI state. No SSE event, no tools-cell, no polling, and
   * `shutdown()` does not touch it — the document listeners live in
   * `OptionsMenu`'s own `onCleanup`, not at the store level.
   */

  const openOptionsMenu = (): void => {
    setState('optionsMenuOpen', true);
  };
  const closeOptionsMenu = (): void => {
    setState('optionsMenuOpen', false);
  };
  const toggleOptionsMenu = (): void => {
    setState('optionsMenuOpen', !state.optionsMenuOpen);
  };

  /* ── TopBar "Provider ▾" dropdown open/close ──────────────────────────
   * Mirrors the Options-menu trio exactly. Pure client UI state — no SSE
   * event, no tools-cell, no polling; `shutdown()` does not touch it (the
   * document listeners live in the `<Popover>`'s own `onCleanup`).
   */
  const openProviderMenu = (): void => {
    setState('providerMenuOpen', true);
  };
  const closeProviderMenu = (): void => {
    setState('providerMenuOpen', false);
  };
  const toggleProviderMenu = (): void => {
    setState('providerMenuOpen', !state.providerMenuOpen);
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
          active_agents: [],
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
      // Phase 01 (Cook IPC plumbing) — forward the typed prompt to the
      // server so it can write `.swt-planning/.pending-scope-idea.txt`
      // BEFORE spawning `swt cook`. Cook's Scope mode (Phase 02 wiring)
      // pre-fills the "what to build?" askUser answer from that seed
      // file. The daemon still mints the session_id and spawns
      // detached. v3 ships Pi as the sole agent backend, so a successful
      // spawn implies `agent_backend: 'pi'`.
      const response = await postCookStart(undefined, trimmed);
      // Phase 03 GAP-01 — full-object setState REPLACES vibeSession
      // atomically (Solid's createStore semantics). On a second
      // startVibeSession after a cook.completion + 10s clear, this drops
      // the prior conversation and starts the lifecycle pill back at
      // 'running'. Do NOT switch to a merge-style setState here.
      setState('vibeSession', {
        session_id: response.session_id,
        initial_prompt: trimmed,
        started_at: response.started_at,
        conversation: [],
        agent_backend: 'pi',
        status: 'running',
      });
      appendLogLine(`[cook] started session ${response.session_id.slice(0, 8)} — "${trimmed}"`);
      return response.session_id;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`cook start failed: ${message}`);
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
      // G-D3 — ported from the removed v2 vibe-reply helper
      // (`/api/vibe/:id/reply` shim) to the live `POST /api/prompts/:id/respond`
      // route (the dashboard
      // half of the Phase 1 `swt:askUser` IPC contract). The route's wire
      // body is `{prompt_id, selectedOption, freeform}` — both nullable
      // strings, one set per answer. The UI's discriminated answer union
      // maps on as: choice → selectedOption, free_form → freeform,
      // permission → selectedOption (the decision) + freeform (the note).
      const respondBody =
        answer.kind === 'choice'
          ? { selectedOption: answer.value, freeform: null }
          : answer.kind === 'free_form'
            ? { selectedOption: null, freeform: answer.text }
            : { selectedOption: answer.decision, freeform: answer.user_note ?? null };
      await postPromptRespond({ prompt_id: active.prompt_id, ...respondBody });
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

  /* ── v2.3 Phase 03 mutation actions ──────────────────────────────── */

  const applyConfigUpdate = async (
    body: ConfigUpdateBody,
  ): Promise<{ ok: true } | { error: string }> => {
    setState('tools', 'config', 'loading', true);
    setState('tools', 'config', 'error', null);
    try {
      const response = await postConfig(body);
      // Optimistic apply — the server's state.changed event will arrive
      // shortly after and trigger a fresh refreshToolsCell, but updating
      // here keeps the UI snappy and survives momentary SSE disconnects.
      setState('tools', 'config', {
        data: {
          is_initialized: true,
          config: response.config,
          source: 'file',
          generated_at: response.generated_at,
        } as never,
        loading: false,
        error: null,
        lastFetched: response.generated_at,
      });
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('tools', 'config', 'loading', false);
      setState('tools', 'config', 'error', message);
      pushError(`config update failed: ${message}`);
      return { error: message };
    }
  };

  const applyProviderAuthUpdate = async (
    body: ProviderAuthUpdateBody,
  ): Promise<{ ok: true } | { error: string }> => {
    setState('tools', 'providerAuth', 'loading', true);
    setState('tools', 'providerAuth', 'error', null);
    try {
      const response = await postProviderAuth(body);
      // Optimistic apply — the server's state.changed event will arrive
      // shortly after and trigger a fresh refreshToolsCell('providerAuth'),
      // but updating here keeps the UI snappy and survives momentary SSE
      // disconnects. The response snapshot is secret-free by 03-01's schema.
      setState('tools', 'providerAuth', {
        data: response.snapshot,
        loading: false,
        error: null,
        lastFetched: response.generated_at,
      });
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('tools', 'providerAuth', 'loading', false);
      setState('tools', 'providerAuth', 'error', message);
      pushError(`provider auth update failed: ${message}`);
      return { error: message };
    }
  };

  /* ── Plan 04-03 (Phase 4) OAuth flow actions ─────────────────────────
   * Mirror `applyProviderAuthUpdate`'s shape. `startOAuthFlow` /
   * `submitOAuthCode` wrap the `api.ts` OAuth wrappers; `dismissOAuthFlow`
   * is the panel's 'Done' / 'Dismiss' affordance. None retains a token —
   * the `oauthFlow` signal is token-free, and the manual-code `code` is
   * passed straight to `postOAuthCode` and never stored on the store.
   */

  const startOAuthFlow = async (provider: string): Promise<{ ok: true } | { error: string }> => {
    // Provisional entry — the real `flowId` arrives in the
    // `postOAuthStart` response; until then `oauth.*` events for this
    // provider are correlated through the still-`starting` status.
    setState('oauthFlow', {
      flowId: '',
      provider,
      status: 'starting',
      authUrl: null,
      instructions: null,
      progressMessage: null,
      errorCode: null,
      errorMessage: null,
    });
    try {
      const response = await postOAuthStart(provider);
      setState('oauthFlow', (prev) => (prev ? { ...prev, flowId: response.flow_id } : prev));
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('oauthFlow', (prev) =>
        prev
          ? { ...prev, status: 'error', errorCode: 'oauth_start_failed', errorMessage: message }
          : prev,
      );
      pushError(`oauth_start_failed: ${message}`);
      return { error: message };
    }
  };

  const submitOAuthCode = async (code: string): Promise<{ ok: true } | { error: string }> => {
    const flow = state.oauthFlow;
    if (!flow || flow.flowId.length === 0) return { error: 'no_active_oauth_flow' };
    try {
      // `code` is passed straight through — never stored on `oauthFlow`
      // or anywhere in the store. The flow's actual completion arrives
      // via the `oauth.complete` SSE event; this action does NOT
      // optimistically set `status: 'complete'`.
      await postOAuthCode(flow.flowId, code);
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('oauthFlow', (prev) => (prev ? { ...prev, errorMessage: message } : prev));
      pushError(`oauth_code_failed: ${message}`);
      return { error: message };
    }
  };

  const dismissOAuthFlow = (): void => {
    setState('oauthFlow', null);
  };

  /* ── User Notes action ────────────────────────────────────────────────
   * `saveUserNotes` POSTs the scratchpad text and, on success,
   * optimistically updates the `userNotes` cell. The DEBOUNCE lives in
   * `UserNotesPanel` — this is a plain async action with no timer. There is
   * no SSE event to wait on (the route publishes none by design), so the
   * optimistic update IS the cell's source of truth until the next manual
   * ↻ refresh.
   */
  const saveUserNotes = async (notes: string): Promise<{ ok: true } | { error: string }> => {
    setState('tools', 'userNotes', 'loading', true);
    setState('tools', 'userNotes', 'error', null);
    try {
      const response = await postUserNotes(notes);
      setState('tools', 'userNotes', {
        data: {
          notes,
          exists: true,
          generated_at: response.generated_at,
        },
        loading: false,
        error: null,
        lastFetched: response.generated_at,
      });
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('tools', 'userNotes', 'loading', false);
      setState('tools', 'userNotes', 'error', message);
      pushError(`user notes save failed: ${message}`);
      return { error: message };
    }
  };

  const applyUpdate = async (): Promise<UpdateApplyResponse | { error: string }> => {
    setState('tools', 'update', 'loading', true);
    setState('tools', 'update', 'error', null);
    try {
      const response = await postUpdateApply();
      // Refresh the Update cell so it picks up the new "current_version"
      // (which now matches "latest_version" on a successful upgrade).
      // On elevation, the version hasn't changed yet — refresh anyway so
      // last_checked timestamps stay current.
      void refreshToolsCell('update');
      setState('tools', 'update', 'loading', false);
      return response;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setState('tools', 'update', 'loading', false);
      setState('tools', 'update', 'error', message);
      pushError(`update apply failed: ${message}`);
      return { error: message };
    }
  };

  const shutdown = (): void => {
    sse?.close();
    sse = null;
    stopToolsPolling();
    removeToolsVisibilityHandler();
    if (cookClearTimer !== null) {
      clearTimeout(cookClearTimer);
      cookClearTimer = null;
    }
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
      applyConfigUpdate,
      applyProviderAuthUpdate,
      startOAuthFlow,
      submitOAuthCode,
      dismissOAuthFlow,
      saveUserNotes,
      openOptionsMenu,
      closeOptionsMenu,
      toggleOptionsMenu,
      openProviderMenu,
      closeProviderMenu,
      toggleProviderMenu,
      applyUpdate,
      pushError,
      shutdown,
    },
  ];
}
