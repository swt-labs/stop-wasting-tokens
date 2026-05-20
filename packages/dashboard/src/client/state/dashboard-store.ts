// Milestone 13 / Phase 01 — LogEntry imported on a dedicated single line
// for the plan's grep verify gate (`^import type \{ LogEntry`). Keeping it
// separate from the broader shared-type bundle below also documents the
// L7 → L0 downward import direction at a glance.
import type { CookPlanUpdateEntry, LogEntry } from '@swt-labs/shared';
import type {
  AgentLiveState,
  AgentPromptContext,
  AgentPromptOption,
  ChatEvent,
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
  ApiError,
  fetchArtifactRendered,
  fetchChatHistory,
  fetchCommands,
  fetchConfig,
  fetchDetectPhase,
  fetchDoctor,
  fetchProviderAuth,
  fetchSnapshot,
  fetchUpdate,
  fetchUserNotes,
  postChatStart,
  postCommand,
  postConfig,
  postCookRespond,
  postCookStart,
  postInit,
  postMap,
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
  type InitResponse,
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

/**
 * Plan 03-01 (milestone 08, Phase 03) — In-flight init Lead lifecycle. Set by
 * `initProject` after a successful `POST /api/init` (status='detecting'),
 * driven by the `init.*` SSE events from Phase 02's `/api/init` route, and
 * cleared either by `init.complete` (success path → snapshot.is_initialized
 * flips true; InitScreen unmounts via App.tsx's `<Show when={isInitialized()}>`)
 * or by the catch path in `initProject` (scaffold 4xx). `init.error` keeps
 * the slot SET with `status='error'` + `errorMessage` so InitScreen can
 * surface the failure inline — only a fresh `initProject` call resets it.
 *
 * Dedicated slot (NOT a reuse of `activeSessionId`) — cook's pause/resume/
 * cancel controls POST `/api/cook/:sessionId/control`; there is no
 * `/api/init/:id/control` route, so leaking an init session into
 * `activeSessionId` would expose unusable controls.
 */
export interface InitSessionState {
  session_id: string;
  status: 'detecting' | 'complete' | 'error';
  name: string;
  description?: string;
  errorMessage?: string;
  /** Latest log.append line attributed to this init session.
   *  Populated by the log.append reducer when status === 'detecting'.
   *  Rendered by InitScreen above the submit button after being passed
   *  through `classifyInitLine` (InitScreen.tsx). `undefined` until the
   *  first line arrives. Plan 19-03-01 T01. */
  lastMessage?: string;
  /** ISO-8601 datetime captured when `initProject` set the slot. */
  started_at: string;
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

/**
 * Milestone 13 / Phase 01 — `state.chatStatus` discriminator.
 *
 * Replaces the prior `ChatSession.status` slot. Top-level field on
 * `DashboardState` so the TopBar's chat-streaming gate + the panel's
 * "Clear conversation" button + future chat affordances can subscribe
 * without dereferencing a nullable `chat-session`. `'idle'` is the
 * greenfield state; `'streaming'` is in-flight; `'error'` is set when a
 * `chat.error` SSE event landed; `'done'` is set when `chat.complete`
 * lands (terminal, until the next `startChat`).
 */
export type ChatStatus = 'idle' | 'streaming' | 'error' | 'done';

export interface DashboardState {
  connection: ConnectionState;
  reconnectAttempt: number;
  snapshot: Snapshot | null;
  selectedArtifact: { phase: string; name: string } | null;
  artifactCache: Map<string, RenderedArtifact>;
  artifactLoading: boolean;
  artifactError: string | null;
  /**
   * Milestone 13 / Phase 01 — the unified chronological feed consumed by
   * `UnifiedLogPanel`. Replaces the prior `recent-log-lines` + `chat-session.messages`
   * dual slots. Init / cook / chat / system events all push `LogEntry`s here
   * via the reducer-by-reducer migration in `handleInitEvent` /
   * `handleCookEvent` / `handleChatEvent` / `applyEvent.log.append` /
   * `appendLogLine`. Capped at `UNIFIED_LOG_LIMIT` on every push.
   */
  unifiedLog: LogEntry[];
  /**
   * Milestone 13 / Phase 01 — the in-flight chat-thread id, or `null` when
   * no chat is active. Hoisted from `chat-session.chat_session_id` so it
   * survives verb-chip mode switches (a `startVibeSession` does NOT reset
   * this — the chat thread is continuous across cook turns). Adopted
   * optimistically as `''` on first `startChat()` and replaced with the
   * server-issued id when `chat.start` arrives. `clearChat()` resets to
   * `null`.
   */
  chat_session_id: string | null;
  /**
   * Milestone 13 / Phase 01 — true while a chat turn is streaming. Hoisted
   * from `chat-session.streaming` so the TopBar's Send-button gate + the
   * unified panel's Clear-button gate read it without a nullable deref.
   */
  chatStreaming: boolean;
  /**
   * Milestone 13 / Phase 01 — replaces `chat-session.status`. See
   * `ChatStatus` for the four-state vocabulary.
   */
  chatStatus: ChatStatus;
  uatModal: UatModalState | null;
  uatSubmitting: boolean;
  initSubmitting: boolean;
  /**
   * Milestone 23 Phase 03 (PA-1) — single source of truth for "is `swt map`
   * currently running?" Hoisted from `InitScreen.tsx`'s former component-
   * local `mapClicked` signal so both the wizard's Step 4 `[Map codebase]`
   * button AND the persistent `<CodebaseMapPrompt>` banner observe the
   * SAME in-flight flag (no parallel signals; no UI drift). Set to `true`
   * inside `actions.startCodebaseMap()` and cleared when the snapshotter's
   * SSE-driven `state.changed` event flips `snapshot.codebase_mapped` to
   * `true` (or on POST failure so the user can retry).
   */
  isMappingCodebase: boolean;
  commandSubmitting: boolean;
  vibeSession: VibeSessionState | null;
  vibeStarting: boolean;
  vibeReplying: boolean;
  /**
   * Plan 03-01 (milestone 12, Phase 03) — mirrors `vibeStarting`. Set to
   * `true` while `startChat()` awaits the `postChatStart` POST; cleared in
   * `finally`. Gates the TopBar Send button against double-submit. Kept
   * separate from `chatStreaming` per Scout Cross-Cutting Finding #8 —
   * `chatStarting` is the POST-in-flight race-protection flag; `chatStreaming`
   * is the SSE-in-progress signal.
   */
  chatStarting: boolean;
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
   * Statusline-extension milestone — the resolved orchestrator model id
   * captured from the latest `cook.provider_selected` event payload (when
   * the cook callsite knew it; see cook.ts emit site for the resolution
   * rules). `null` before the orchestrator has emitted, or when the
   * callsite couldn't resolve the model (Pi's ModelRegistry resolved it
   * internally). The dashboard statusline renders `—` when null.
   *
   * Statusline v2 Wave 2 — the post-`cook.completion` cookClearTimer
   * (line ~920) now also clears this slot 10s after the session ends
   * so stale orchestrator model labels don't bleed into the next
   * session's UI.
   */
  orchestratorModel: string | null;
  /**
   * Statusline v2 Wave 2 — cumulative input tokens for the current
   * orchestrator session. Resets to 0 on every `cook.priority_decision`
   * (new session) AND alongside `orchestratorModel` in the
   * `cook.completion` cookClearTimer. Incremented on every
   * `cook.agent_result` by `evt.usage.input_tokens` (the only cook
   * event that carries per-turn input-token counts).
   *
   * Replaces the v1 statusline's read of `cost_summary.tokens.in` which
   * was dashboard-lifetime cumulative and never decremented across
   * sessions — so after three sessions the statusline read `~150k/200k`
   * even when the active session had ~0 input tokens.
   */
  orchestratorSessionInputTokens: number;
  /**
   * Statusline v2 Wave 5 commit 10 — ISO-8601 start timestamp of the
   * current orchestrator session. Set from `cook.priority_decision.ts`
   * on session start; cleared (to `null`) by the same 10s cookClearTimer
   * that wipes `activeAgents` / `activeSessionId` / `orchestratorModel`.
   *
   * Drives the live `rate:` cell in the Money group: the statusline
   * derives `rate: $X.XX/min` from `state.snapshot.cost_summary
   * .this_session_usd` divided by elapsed minutes since this timestamp.
   * `null` between sessions; the cell then renders `rate: —`.
   */
  orchestratorSessionStartTs: string | null;
  /**
   * Plan 02-01 (milestone 13, Phase 02) — the single in-flight cook askUser
   * prompt, or `null` when no cook prompt is awaiting a user response.
   * SET by the `prompt.request` reducer branch when the event's `session_id`
   * matches `state.activeSessionId` (cook-session correlation key, Scout
   * Cross-cutting #8). CLEARED by the matching `prompt.response` (user
   * answered) OR `cook.ask_user_timeout` (UI-cosmetic expiry).
   *
   * Single-card invariant (Scout §7): there is only one active cook prompt
   * at a time — a second `prompt.request` while this slot is non-null
   * OVERWRITES the slot. The older `CookAskUserEntry` items remain in
   * `unifiedLog` with `status: 'pending'`; Phase 03 may render them as
   * 'missed' visually but Phase 02 does not auto-mutate their status.
   *
   * `allowFreeform` defaults to `true` for cook prompts — the
   * AskUserQuestion contract treats freeform as the universal escape hatch;
   * Phase 03 may refine if a per-prompt opt-out signal is added.
   */
  cookAwaitingUser: {
    askUserId: string;
    question: string;
    options: Array<{ value: string; label: string; description?: string }>;
    allowFreeform: boolean;
  } | null;
  /**
   * Plan 04-03 (Phase 4) — the in-progress OAuth login flow, or `null` when
   * no OAuth login is running. The `ProviderAuthPanel`'s source of truth for
   * what to render during an OAuth login. Token-free by construction (see
   * `OAuthFlowState`). `flow_id`-correlated: the `applyEvent` `oauth.*`
   * branch ignores any event whose `flow_id` does not match this flow.
   */
  oauthFlow: OAuthFlowState | null;
  /**
   * Plan 03-01 (milestone 08, Phase 03) — the in-flight init Lead lifecycle,
   * or `null` when no init is running. Set by `initProject` after a
   * successful scaffold POST, transitioned by the Phase 02 `init.*` SSE
   * events. InitScreen renders a "Detecting stack…" overlay when
   * `status === 'detecting'` and surfaces `errorMessage` when
   * `status === 'error'`. See `InitSessionState` for the field semantics
   * and lifecycle.
   */
  initSession: InitSessionState | null;
}

export interface DashboardActions {
  bootstrap: () => Promise<void>;
  applyEvent: (evt: SnapshotEvent) => void;
  selectArtifact: (phase: string, name: string) => Promise<void>;
  openUatModal: (modal: UatModalState) => void;
  closeUatModal: () => void;
  submitUatCheckpoint: (result: 'pass' | 'fail', note?: string) => Promise<void>;
  initProject: (body: InitBody) => Promise<InitResponse>;
  /**
   * Milestone 23 Phase 03 (PA-1) — single entry point for triggering
   * `swt map` on a brownfield project. Called by both `<CodebaseMapPrompt>`
   * (the persistent banner) and `<InitScreen>` Step 4's `[Map codebase]`
   * button. Guards on `state.isMappingCodebase === true` (no-op while
   * already in flight), flips the flag, and calls `postMap()`. On success
   * the flag stays `true` until the snapshotter's `state.changed` event
   * flips `snapshot.codebase_mapped` to `true` (a `createEffect` resets
   * the flag). On error the flag is cleared so the user can retry.
   */
  startCodebaseMap: () => Promise<{ ok: true } | { error: string }>;
  runCommand: (input: string) => Promise<CommandResponse | null>;
  startVibeSession: (prompt: string) => Promise<string | null>;
  /**
   * Plan 03-01 (milestone 12, Phase 03) — Free-talk Mode turn submission.
   * Trims `prompt`; returns `null` immediately on empty input. Sets
   * `chatStarting=true` then fires `postChatStart(trimmed,
   * state.chat-session?.chat_session_id)` — passing the existing id on
   * multi-turn so the server reuses the registered SwtSession.
   *
   * **Optimistic state pattern.** First turn: `chat-session === null`, so
   * the action full-object-replaces it with `{chat_session_id: '',
   * started_at, messages: [userMsg], streaming: true, status: 'streaming'}`.
   * Multi-turn: appends `userMsg` to the existing `messages[]` and flips
   * `streaming/status` back to in-progress. The real `chat_session_id`
   * arrives via the first `chat.start` SSE event and is adopted by the
   * `handleChatEvent` reducer (P04).
   *
   * **Error handling.** First-turn failure rolls back `chat-session` to
   * `null` so the empty optimistic state doesn't linger. Multi-turn
   * failure keeps `messages[]` intact and flips `status: 'error'` +
   * `streaming: false` so the panel surfaces the failure inline. Both
   * branches `pushError(...)` and return `null`.
   *
   * Returns the resolved `chat_session_id` on success (may be `''` on the
   * first turn — adopted shortly after by the `chat.start` event), or
   * `null` on empty/whitespace input or fetch failure.
   */
  startChat: (prompt: string) => Promise<string | null>;
  /**
   * Plan 03-01 (milestone 12, Phase 03) — wipe the local chat conversation.
   * Synchronous: `setState('chat-session', null)`. NO HTTP call — the
   * server's `ChatSessionRegistry` has a 10-minute TTL sweep that handles
   * cleanup (Lead's v1 decision; Phase 04 may add `DELETE /api/chat/:id`).
   */
  clearChat: () => void;
  replyToActivePrompt: (answer: VibeReplyBody['answer']) => Promise<boolean>;
  /**
   * Milestone 13 / Phase 03 — dispatch a user response to the currently
   * pending cook askUser prompt. Called by both surfaces:
   *
   *   - `<AskUserCard>` option-button click (`{selectedOption, freeform: null}`)
   *   - `<AskUserCard>` freeform Send (`{selectedOption: null, freeform}`)
   *   - TopBar answer-mode submit (always freeform — option choice happens
   *     on the card, not the TopBar)
   *
   * Optimistic state pattern (Scout §7):
   *   1. Snapshot the current `cookAwaitingUser` for revert.
   *   2. Find the matching `CookAskUserEntry` by `prompt_id === askUserId`
   *      AND `status === 'pending'`.
   *   3. Optimistically mark the entry `status: 'answered'` with the reply
   *      text (selectedOption ?? freeform ?? '').
   *   4. Optimistically clear `cookAwaitingUser` to null BEFORE awaiting
   *      the POST — TopBar's answer-mode disengages immediately so the
   *      user can move on without waiting for the SSE round-trip.
   *   5. POST to `/api/cook/respond`. On success, the Phase 02
   *      `prompt.response` reducer (when it arrives) becomes a no-op for
   *      the already-optimistic entry.
   *   6. On POST failure: revert the entry to `pending`, restore the
   *      snapshotted `cookAwaitingUser`, and append both a `pushError`
   *      pill AND a system `LogEntry` so the user sees the failure inline.
   *
   * No-active-session and no-pending-entry are early-return errors — both
   * `pushError` with documented messages and return without POSTing.
   *
   * `askUserId` (NOT `promptId`) is the parameter name to match the
   * `cookAwaitingUser.askUserId` slot, the `/api/cook/respond` body, and
   * the `postCookRespond` helper. Cross-cutting #8 consistency.
   */
  respondToCookAskUser: (
    askUserId: string,
    response: { selectedOption: string | null; freeform: string | null },
  ) => Promise<void>;
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

// Slow-tier tools poll — was 60_000 (60 s) for cells that are cheap to leave
// stale (`commands` static verb registry, `update` 24 h-cached npm version
// check, `doctor` toolchain checks). Reduced to 5 s by user request so every
// tools cell refreshes on the same fast cadence. The two-tier split is now
// effectively a single tier; kept as two constants for surgical reversibility
// if the all-fast cost ever bites on idle laptops.
const DEFAULT_TOOLS_SLOW_POLL_INTERVAL_MS = 5_000;
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
/**
 * Milestone 13 / Phase 01 — cap on `state.unifiedLog.length`. Replaces the
 * prior `RECENT_LOG_LIMIT = 200`. Bumped to 500 to absorb the cook-agent /
 * cook-tool / cook-status entries now folded into the same array (Scout §5
 * "Pagination/virtualization" — tunable; defer real virtualization).
 */
export const UNIFIED_LOG_LIMIT = 500;

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
    unifiedLog: [],
    chat_session_id: null,
    chatStreaming: false,
    chatStatus: 'idle',
    uatModal: null,
    uatSubmitting: false,
    initSubmitting: false,
    // Milestone 23 Phase 03 (PA-1) — hoisted from InitScreen.tsx's former
    // component-local `mapClicked` signal. Single source of truth for "is
    // `swt map` running?" observed by both the wizard's Step 4 button and
    // the persistent CodebaseMapPrompt banner.
    isMappingCodebase: false,
    commandSubmitting: false,
    vibeSession: null,
    vibeStarting: false,
    vibeReplying: false,
    chatStarting: false,
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
    orchestratorModel: null,
    // Statusline v2 Wave 2 — per-orchestrator-session cumulative input-token
    // counter. Resets on `cook.priority_decision` (new session) AND in the
    // post-`cook.completion` cookClearTimer alongside the other Runtime
    // slots. Used by App.tsx's statuslineCumulativeTokens memo so the
    // context-estimate cell reflects the active session, not
    // dashboard-lifetime cumulative (the v1 bug — read cost_summary.tokens
    // which never decremented across sessions).
    orchestratorSessionInputTokens: 0,
    // Statusline v2 Wave 5 commit 10 — orchestrator session start
    // timestamp for the live cost-rate cell. Set from
    // `cook.priority_decision.ts`; cleared in the 10s cookClearTimer.
    orchestratorSessionStartTs: null,
    cookAwaitingUser: null,
    oauthFlow: null,
    initSession: null,
  });

  // Plan 04-03 T1 — pending clear timer scheduled by `cook.completion`. Held
  // at module scope so a follow-up `cook.priority_decision` (new session) can
  // cancel it and prevent the previous session's rows from being wiped after
  // the new one starts.
  let cookClearTimer: ReturnType<typeof setTimeout> | null = null;

  let sse: SseConnection | null = null;
  let logSeq = 0;
  // Plan 03-01 (milestone 12, Phase 03) — monotonic counter for chat message
  // ids. Used by `startChat` (user messages) and `handleChatEvent` (assistant
  // messages synthesized on delta/tool_call). Solid's <For> keys on
  // `message.id` so stable, unique ids are required to avoid full-list
  // re-renders on every delta.
  let chatMsgSeq = 0;
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

  /**
   * Milestone 13 / Phase 01 — push a `LogEntry` onto `state.unifiedLog`,
   * applying the `UNIFIED_LOG_LIMIT` cap on every push. Centralized so the
   * reducers and the `appendLogLine` helper share one mutation site.
   */
  const pushLogEntry = (entry: LogEntry): void => {
    setState('unifiedLog', (prev) => {
      const next = [...prev, entry];
      return next.slice(-UNIFIED_LOG_LIMIT);
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
        // Statusline v2 Wave 2 — reset the per-session input-token counter
        // for the new session. Defensive guard per Locked Decision #16:
        // we also re-zero if the prior session's cookClearTimer was
        // cancelled above (which would otherwise leave the counter
        // carrying the prior session's tail).
        setState('orchestratorSessionInputTokens', 0);
        // Statusline v2 Wave 5 commit 10 — capture the session start
        // timestamp from the event payload so the live cost-rate cell
        // can compute $/min as the session runs. Falls back to "now"
        // if the event omitted `ts` (defensive).
        setState('orchestratorSessionStartTs', evt.ts ?? new Date().toISOString());
        setState('activeSessionId', evt.session_id);
        // Milestone 13 / Phase 01 — surface the priority-decision as a
        // started-subtype cook-status entry in the unified log. The
        // initial-prompt context arrives separately via the vibeSession
        // slot (startVibeSession already wrote it); the inline message
        // here mirrors the historical appendLogLine format.
        const sid8 = evt.session_id.slice(0, 8);
        pushLogEntry({
          kind: 'cook-status',
          id: `log-cook-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          subtype: 'started',
          message: `started session ${sid8}`,
          mode: evt.mode,
        });
        return;
      }
      case 'cook.provider_selected': {
        // Statusline-extension milestone — capture the resolved orchestrator
        // model id when the cook callsite carried it on the event. Omitted
        // when Pi's ModelRegistry resolved internally; in that case the
        // dashboard statusline keeps its prior value or renders `—`.
        if (evt.model !== undefined && evt.model !== null && evt.model.length > 0) {
          setState('orchestratorModel', evt.model);
        }
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
          // Statusline-extension milestone — populate AgentLiveState.model
          // when the spawn event carries it. AgentLiveStateSchema.model
          // has been an optional field since plan 04-02 T1 (pre-dating
          // this milestone); the reducer just stopped dropping it.
          ...(evt.model !== undefined ? { model: evt.model } : {}),
        });
        setState('activeAgents', next);
        // Milestone 13 / Phase 01 — also surface the spawn as a cook-agent
        // LogEntry. activeAgents stays the authoritative grid source; the
        // unified-log entry is the chronological breadcrumb.
        pushLogEntry({
          kind: 'cook-agent',
          id: `log-agent-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          sub_session_id: evt.sub_session_id,
          role: evt.role,
          event: 'spawn',
        });
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
        // Statusline v2 Wave 2 — accumulate the per-session input-token
        // counter from the only cook event that carries token counts
        // (`cook.agent_result.usage.input_tokens`). Powers App.tsx's
        // statuslineCumulativeTokens memo and the context-estimate cell.
        setState('orchestratorSessionInputTokens', (prev) => prev + evt.usage.input_tokens);
        // Milestone 13 / Phase 01 — cook-agent result entry. Carries
        // result_status + cost/elapsed for richer monospace rendering.
        pushLogEntry({
          kind: 'cook-agent',
          id: `log-agent-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          sub_session_id: evt.sub_session_id,
          role: existing.role,
          event: 'result',
          result_status: evt.status,
          cost_usd: evt.usage.cost_usd ?? 0,
          elapsed_ms: updated.elapsed_ms,
        });
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
        // Milestone 13 / Phase 01 — cook-tool call entry. Renders as an
        // inline chip in the unified log.
        pushLogEntry({
          kind: 'cook-tool',
          id: `log-tool-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          sub_session_id: evt.sub_session_id,
          tool: evt.tool,
          event: 'call',
          ...(evt.input_excerpt !== undefined ? { input_excerpt: evt.input_excerpt } : {}),
        });
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
        // Milestone 13 / Phase 01 — cook-tool result entry.
        pushLogEntry({
          kind: 'cook-tool',
          id: `log-tool-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          sub_session_id: evt.sub_session_id,
          tool: evt.tool,
          event: 'result',
          ...(evt.result_excerpt !== undefined ? { result_excerpt: evt.result_excerpt } : {}),
          ...(evt.duration_ms !== undefined ? { duration_ms: evt.duration_ms } : {}),
        });
        return;
      }
      case 'cook.resume': {
        // Phase 03 GAP-03 — surface cook crash-recovery to the user. A
        // resumed cook always fires cook.priority_decision next (which
        // sets activeSessionId), but emitting the LOG line + cancelling
        // any pending clear here makes the recovery legible even if the
        // priority_decision is briefly delayed.
        if (cookClearTimer !== null) {
          clearTimeout(cookClearTimer);
          cookClearTimer = null;
        }
        setState('activeSessionId', evt.session_id);
        // Milestone 13 / Phase 01 — cook-status resumed entry replaces
        // the prior appendLogLine call. Message format mirrors the
        // historical "[cook] resuming session {sid8} from {from_task}" line.
        const sid8 = evt.session_id.slice(0, 8);
        const fromTask = evt.from_task ?? 'unknown';
        pushLogEntry({
          kind: 'cook-status',
          id: `log-cook-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          subtype: 'resumed',
          message: `resuming session ${sid8} from ${fromTask}`,
        });
        return;
      }
      case 'cook.completion': {
        // Phase 03 GAP-01 — flip the lifecycle pill so the conversation
        // thread shows 'completed' immediately while the 10s timer keeps
        // the agent grid visible.
        if (state.vibeSession?.session_id === evt.session_id) {
          setState('vibeSession', 'status', 'completed');
        }
        if (cookClearTimer !== null) clearTimeout(cookClearTimer);
        cookClearTimer = setTimeout(() => {
          setState('activeAgents', new Map<string, AgentLiveState>());
          setState('activeSessionId', null);
          // Statusline v2 Wave 2 — clear the orchestrator model + the
          // per-session token counter alongside agents/sessionId so
          // stale Runtime-section signals don't bleed into the next
          // cook session. 10s after completion mirrors the
          // existing agents clear so the user has the same window
          // to glance at all four signals before they zero out.
          setState('orchestratorModel', null);
          setState('orchestratorSessionInputTokens', 0);
          // Statusline v2 Wave 5 commit 10 — clear the session start
          // timestamp alongside everything else so the cost-rate cell
          // returns to `rate: —` between sessions.
          setState('orchestratorSessionStartTs', null);
          cookClearTimer = null;
        }, 10_000);
        // Milestone 13 / Phase 01 — surface completion as a cook-status entry
        // whose `subtype` mirrors the wire `status` (success → completed).
        // `status: 'success'` maps to subtype `'completed'`; explicit
        // 'failed' / 'cancelled' pass through.
        const subtype =
          evt.status === 'success' ? 'completed' : evt.status === 'failed' ? 'failed' : 'cancelled';
        pushLogEntry({
          kind: 'cook-status',
          id: `log-cook-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          subtype,
          message: `session ${evt.session_id.slice(0, 8)} ${subtype}`,
          status: evt.status,
        });
        return;
      }
      case 'cook.error': {
        // Phase 03 GAP-01 — flip the lifecycle pill to 'crashed' when
        // cook emits an error event.
        if (state.vibeSession?.session_id === evt.session_id) {
          setState('vibeSession', 'status', 'crashed');
        }
        // Milestone 13 / Phase 01 — surface the error as a cook-status
        // failed entry. activeAgents/activeSessionId are intentionally
        // not touched — they keep flowing through the existing path.
        pushLogEntry({
          kind: 'cook-status',
          id: `log-cook-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          subtype: 'failed',
          message: evt.message,
        });
        return;
      }
      case 'cook.budget_exceeded': {
        // Milestone 13 / Phase 01 — Scout Cross-Cutting Finding #1: surface
        // the previously-invisible budget_exceeded lifecycle event. No
        // session-state mutation (the orchestrator owns the pause); the
        // unified-log entry is purely observational.
        pushLogEntry({
          kind: 'cook-status',
          id: `log-cook-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          subtype: 'budget_exceeded',
          message: `budget exceeded — session ${evt.session_id.slice(0, 8)} paused`,
        });
        return;
      }
      case 'cook.budget_resume': {
        // Milestone 13 / Phase 01 — Scout Cross-Cutting Finding #1: surface
        // the previously-invisible budget_resume lifecycle event.
        pushLogEntry({
          kind: 'cook-status',
          id: `log-cook-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          subtype: 'budget_resume',
          message: `budget refilled — session ${evt.session_id.slice(0, 8)} resuming`,
        });
        return;
      }
      case 'cook.plan_update': {
        // Phase 17 plan 04-01 Task 2 — Codex parity update_plan reducer.
        // REPLACE semantics: every `cook.plan_update` event REPLACES the
        // most-recent CookPlanUpdateEntry for the same `session_id` rather
        // than appending, matching Codex's plan-replace contract
        // (`plan_tool.rs`). The Solid <For> keys on entry.id, so we
        // reuse the prior entry's id when replacing — prevents a row
        // remount and mirrors the chat-assistant streaming pattern.
        // First call for a session falls through to pushLogEntry.
        //
        // `findLastIndex` is ES2023; workspace tsconfig pins `lib:
        // ['ES2022']` so TS doesn't know the method exists. The runtime
        // (Node ≥18, all evergreen browsers) does ship it, so we narrow
        // through a local `Array.prototype.findLastIndex`-shaped helper
        // typed at the call site rather than widening the tsconfig
        // workspace-wide.
        const findLastIndex = <T>(arr: readonly T[], predicate: (value: T) => boolean): number =>
          (
            arr as unknown as {
              findLastIndex(p: (value: T) => boolean): number;
            }
          ).findLastIndex(predicate);
        const lastPlanIdx = findLastIndex(
          state.unifiedLog,
          (e) => e.kind === 'cook-plan-update' && e.session_id === evt.session_id,
        );
        const prior = lastPlanIdx >= 0 ? state.unifiedLog[lastPlanIdx] : undefined;
        const entry: CookPlanUpdateEntry = {
          kind: 'cook-plan-update',
          id: prior?.id ?? `log-plan-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          sub_session_id: evt.sub_session_id,
          plan: evt.plan,
          ...(evt.explanation !== undefined ? { explanation: evt.explanation } : {}),
        };
        if (lastPlanIdx >= 0) {
          setState('unifiedLog', lastPlanIdx, entry);
        } else {
          pushLogEntry(entry);
        }
        return;
      }
      case 'cook.ask_user_timeout': {
        // Plan 02-01 (milestone 13, Phase 02) — UI-cosmetic timeout marker
        // (Scout §6): mark the matching CookAskUserEntry `status: 'expired'`
        // and clear `cookAwaitingUser` if it still points at this prompt.
        // The cook-side askUser promise times out independently and
        // surfaces via cook.error — Phase 02 does NOT resolve the cook
        // promise from this path.
        setState('unifiedLog', (prev) =>
          prev.map((entry) =>
            entry.kind === 'cook-ask-user' &&
            entry.prompt_id === evt.prompt_id &&
            entry.status === 'pending'
              ? { ...entry, status: 'expired' as const }
              : entry,
          ),
        );
        if (state.cookAwaitingUser?.askUserId === evt.prompt_id) {
          setState('cookAwaitingUser', null);
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
    // Provisional-flow correlator — accept an event when the flow's real
    // flowId hasn't yet been assigned (the POST /oauth/start response is
    // still in flight). Without this, an early-failure event (e.g.
    // EADDRINUSE on the loopback callback port) fires BEFORE the response
    // sets `flow.flowId`, and a strict `flow.flowId === evt.flow_id` check
    // rejects it — the UI then stays stuck at "Starting OAuth login…"
    // because no event ever correlates. Originally only `oauth.auth_url`
    // had this match; we now apply it uniformly so `oauth.error`,
    // `oauth.progress`, and `oauth.awaiting_code` all surface during the
    // race window too.
    const matchesProvisional = (eventFlowId: string, eventProvider: string): boolean =>
      flow?.flowId === eventFlowId ||
      (flow?.status === 'starting' && flow.provider === eventProvider && flow.flowId.length === 0);
    switch (evt.type) {
      case 'oauth.auth_url': {
        if (!matchesProvisional(evt.flow_id, evt.provider)) return;
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
        if (!matchesProvisional(evt.flow_id, evt.provider)) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                // Adopt the real flow_id if this is a still-provisional entry.
                flowId: prev.flowId.length === 0 ? evt.flow_id : prev.flowId,
                progressMessage: evt.message,
                status: prev.status === 'starting' ? 'awaiting_browser' : prev.status,
              }
            : prev,
        );
        return;
      }
      case 'oauth.awaiting_code': {
        if (!matchesProvisional(evt.flow_id, evt.provider)) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                flowId: prev.flowId.length === 0 ? evt.flow_id : prev.flowId,
                status: 'awaiting_code',
                progressMessage: evt.message ?? prev.progressMessage,
              }
            : prev,
        );
        return;
      }
      case 'oauth.complete': {
        if (!matchesProvisional(evt.flow_id, evt.provider)) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                flowId: prev.flowId.length === 0 ? evt.flow_id : prev.flowId,
                status: 'complete',
              }
            : prev,
        );
        // Immediate refetch so the auth-status display reflects the
        // now-configured provider. The 04-02 route also publishes
        // `state.changed`, which 03-04's handler refetches `providerAuth`
        // on too — belt-and-suspenders; either path is correct.
        void refreshToolsCell('providerAuth');
        return;
      }
      case 'oauth.error': {
        if (!matchesProvisional(evt.flow_id, evt.provider)) return;
        setState('oauthFlow', (prev) =>
          prev
            ? {
                ...prev,
                flowId: prev.flowId.length === 0 ? evt.flow_id : prev.flowId,
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

  /**
   * Plan 03-01 (milestone 08, Phase 03) — fold the three `init.*` SSE bridge
   * events (Phase 02) into `state.initSession` + `recent-log-lines` + (on
   * error) `state.errors`.
   *
   *   - `init.start` appends a defensive `[init]` log line and adopts the
   *     server-issued `session_id` onto `initSession` (the post-init HTTP
   *     response strips unknowns via Zod, so this event is the canonical
   *     source of the real id). Status stays at 'detecting'.
   *   - `init.complete` flips `snapshot.is_initialized = true` (the actual
   *     SSE signal that the Lead has finished — replaces the old optimistic
   *     flip the initProject action used to do), clears `initSession`
   *     back to null so InitScreen unmounts, and appends a bootstrap-
   *     complete log line.
   *   - `init.error` sets `initSession.status='error'` + `errorMessage`
   *     and pushes to `state.errors` so the existing InitScreen error
   *     paragraph surfaces the failure. Does NOT flip is_initialized
   *     and does NOT clear `initSession` — the user can read the error
   *     inline and resubmit (the resubmit `initProject` call replaces
   *     the slot).
   */
  const handleInitEvent = (evt: Extract<SnapshotEvent, { type: `init.${string}` }>): void => {
    switch (evt.type) {
      case 'init.start': {
        // Milestone 13 / Phase 01 — surface the init-start event as an init
        // LogEntry (replaces the prior appendLogLine call). InitSession
        // continues to drive the InitScreen overlay gate.
        pushLogEntry({
          kind: 'init',
          id: `log-init-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          status: 'start',
          message: 'Lead detecting stack…',
        });
        if (state.initSession) {
          setState('initSession', 'session_id', evt.session_id);
        }
        return;
      }
      case 'init.complete': {
        setState('snapshot', (prev) => (prev ? { ...prev, is_initialized: true } : prev));
        setState('initSession', null);
        // Milestone 13 / Phase 01 — init-complete LogEntry.
        pushLogEntry({
          kind: 'init',
          id: `log-init-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          status: 'complete',
          message: 'Lead bootstrap complete',
        });
        return;
      }
      case 'init.error': {
        // Keep initSession set so InitScreen can surface the error and the
        // user can resubmit without losing their typed name/description.
        if (state.initSession) {
          setState('initSession', 'status', 'error');
          setState('initSession', 'errorMessage', evt.message);
        }
        pushError(`${evt.code}: ${evt.message}`);
        // Milestone 13 / Phase 01 — init-error LogEntry. pushError still
        // fires for the errors[] pill.
        pushLogEntry({
          kind: 'init',
          id: `log-init-${++logSeq}`,
          ts: evt.ts,
          session_id: evt.session_id,
          status: 'error',
          message: evt.message,
          errorCode: evt.code,
        });
        return;
      }
    }
  };

  /**
   * Plan 03-01 (milestone 12, Phase 03) — fold the 7 `chat.*` SSE events
   * from Phase 01's `/api/chat` route (published via `bus.publish` onto the
   * shared `/api/events` bus channel) into `state.chat-session`.
   *
   * **Correlation guard.** Every branch checks
   * `evt.chat_session_id === state.chat-session?.chat_session_id` and
   * silently drops mismatches. The single exception is `chat.start` during
   * OPTIMISTIC ADOPTION — when the current `chat_session_id` is the empty
   * placeholder `''` set by `startChat`, the branch adopts the
   * server-issued id. Stale events (e.g. tab reload mid-stream, late
   * arrival after `clearChat`) are dropped.
   *
   * **Synthesis fallback.** `chat.message_delta` / `chat.tool_call` /
   * `chat.token_usage` / `chat.error` synthesize a new assistant message
   * when no in-progress one exists. This is defensive: the server SHOULD
   * always emit `chat.start` first, but the synthesis path keeps the
   * reducer total — out-of-order events never throw or drop data
   * silently.
   *
   * All array mutations use the functional-update pattern
   * (`setState('chat-session', 'messages', (msgs) => [...])`) so Solid's
   * fine-grained reactivity re-renders only the affected message.
   */
  /**
   * Milestone 13 / Phase 01 — find the index of the last in-progress chat-
   * assistant entry in `state.unifiedLog`. Returns -1 if none. Helper used
   * by `handleChatEvent` to update the streaming bubble in place (Scout §5
   * streaming optimization).
   */
  const findLastAssistantIndex = (log: LogEntry[], threadId: string): number => {
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      if (entry === undefined) continue;
      if (entry.kind === 'chat-assistant' && entry.chat_session_id === threadId) {
        return i;
      }
    }
    return -1;
  };

  /**
   * Milestone 13 / Phase 01 — synthesize a new chat-assistant LogEntry at
   * the tail of `state.unifiedLog`. Used by the four chat reducers when no
   * in-progress assistant entry exists yet (defensive: chat.message_delta /
   * tool_call / token_usage / error may arrive before chat.start in
   * out-of-order delivery — keeps the reducer total).
   */
  const synthAssistantEntry = (
    threadId: string,
    ts: string,
    init: {
      text?: string;
      tools_called?: string[];
      usage?: Extract<LogEntry, { kind: 'chat-assistant' }>['usage'];
    } = {},
  ): Extract<LogEntry, { kind: 'chat-assistant' }> => ({
    kind: 'chat-assistant',
    id: `chat-msg-${++chatMsgSeq}`,
    ts,
    chat_session_id: threadId,
    text: init.text ?? '',
    completed: false,
    ...(init.tools_called !== undefined ? { tools_called: init.tools_called } : {}),
    ...(init.usage !== undefined ? { usage: init.usage } : {}),
  });

  const handleChatEvent = (evt: ChatEvent): void => {
    // chat.start has its own adoption path — handle it first.
    if (evt.type === 'chat.start') {
      if (state.chat_session_id === null) {
        // No active chat thread — likely a tab reload mid-stream. Silently drop.
        return;
      }
      const currentId = state.chat_session_id;
      if (currentId.length === 0) {
        // Optimistic adoption: startChat set chat_session_id='' before the
        // POST; this is the canonical SSE frame that delivers the real id.
        setState('chat_session_id', evt.chat_session_id);
        // Backfill the optimistic chat-user entry (and any synthesized
        // chat-assistant entry) with the real id so future correlation
        // guards match.
        setState('unifiedLog', (prev) =>
          prev.map((e) =>
            (e.kind === 'chat-user' || e.kind === 'chat-assistant' || e.kind === 'chat-error') &&
            e.chat_session_id === ''
              ? { ...e, chat_session_id: evt.chat_session_id }
              : e,
          ),
        );
        return;
      }
      if (currentId === evt.chat_session_id) {
        // Re-broadcast — no-op.
        return;
      }
      // Stale — drop.
      return;
    }
    // Correlation guard for the remaining 6 events. A `chat.*` event
    // arriving with no active session OR a mismatched id is silently
    // dropped (no pushError — this is a known race).
    if (state.chat_session_id === null) return;
    if (evt.chat_session_id !== state.chat_session_id) return;
    const threadId = state.chat_session_id;
    // Helper closure: update the streaming chat-assistant entry by index.
    // Solid's path-based setter cannot narrow across the LogEntry union,
    // so we use the array-level updater + spread the entry. This still
    // produces a fine-grained array diff at the <For> level — only the
    // single mutated entry's identity changes.
    const updateAssistantAt = (
      idx: number,
      patch: Partial<Extract<LogEntry, { kind: 'chat-assistant' }>>,
    ): void => {
      setState('unifiedLog', (prev) =>
        prev.map((e, i) => {
          if (i !== idx || e.kind !== 'chat-assistant') return e;
          return { ...e, ...patch };
        }),
      );
    };
    switch (evt.type) {
      case 'chat.message_delta': {
        const idx = findLastAssistantIndex(state.unifiedLog, threadId);
        const target = idx >= 0 ? state.unifiedLog[idx] : undefined;
        if (idx >= 0 && target?.kind === 'chat-assistant' && target.completed === false) {
          updateAssistantAt(idx, { text: target.text + evt.text });
        } else {
          // Defensive: synthesize an in-progress assistant entry.
          pushLogEntry(synthAssistantEntry(threadId, evt.ts, { text: evt.text, tools_called: [] }));
        }
        return;
      }
      case 'chat.tool_call': {
        const idx = findLastAssistantIndex(state.unifiedLog, threadId);
        const target = idx >= 0 ? state.unifiedLog[idx] : undefined;
        if (idx >= 0 && target?.kind === 'chat-assistant' && target.completed === false) {
          updateAssistantAt(idx, { tools_called: [...(target.tools_called ?? []), evt.tool] });
        } else {
          pushLogEntry(synthAssistantEntry(threadId, evt.ts, { tools_called: [evt.tool] }));
        }
        return;
      }
      case 'chat.message_end': {
        // Seal the in-progress assistant entry. Does NOT clear streaming —
        // chat.complete owns that transition.
        const idx = findLastAssistantIndex(state.unifiedLog, threadId);
        if (idx >= 0) {
          updateAssistantAt(idx, { completed: true });
        }
        return;
      }
      case 'chat.token_usage': {
        const usage = {
          input: evt.input,
          output: evt.output,
          cacheRead: evt.cacheRead,
          cacheWrite: evt.cacheWrite,
          provider: evt.provider,
          model: evt.model,
        };
        const idx = findLastAssistantIndex(state.unifiedLog, threadId);
        if (idx >= 0) {
          updateAssistantAt(idx, { usage });
        } else {
          pushLogEntry(synthAssistantEntry(threadId, evt.ts, { usage }));
        }
        return;
      }
      case 'chat.error': {
        // Push a chat-error entry. Both the wire `evt.code` (ChatErrorEvent
        // at events.ts:550-561) and the LogEntry's `code` slot are the
        // same closed enum — no runtime narrowing needed.
        pushLogEntry({
          kind: 'chat-error',
          id: `chat-err-${++chatMsgSeq}`,
          ts: evt.ts,
          chat_session_id: threadId,
          code: evt.code,
          message: evt.message,
        });
        setState('chatStatus', 'error');
        pushError(`chat error: ${evt.code}: ${evt.message}`);
        return;
      }
      case 'chat.complete': {
        setState('chatStreaming', false);
        setState('chatStatus', (prev) => (prev === 'error' ? 'error' : 'done'));
        return;
      }
    }
  };

  const applyEvent = (evt: SnapshotEvent): void => {
    // Chat branch goes FIRST so the chat.* prefix routing wins before any
    // overlapping init./cook./oauth. handling could fire on a future
    // schema collision. The reducer is self-correlating (drops events
    // whose chat_session_id does not match state.chat-session), so a stray
    // chat.* event during a cook session is a safe no-op.
    if (evt.type.startsWith('chat.')) {
      handleChatEvent(evt as ChatEvent);
      return;
    }
    if (evt.type.startsWith('init.')) {
      handleInitEvent(evt as Extract<SnapshotEvent, { type: `init.${string}` }>);
      return;
    }
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
      // Milestone 23 Phase 03 (PA-1) — keep the in-flight flag aligned with
      // a freshly replaced snapshot. On reconnect the daemon may emit the
      // post-map snapshot directly; the flag must clear or the banner /
      // wizard would stay stuck in "Mapping…" forever.
      if ((evt.snapshot as Snapshot & { codebase_mapped?: boolean }).codebase_mapped === true) {
        setState('isMappingCodebase', false);
      }
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
        // Milestone 23 Phase 03 (PA-1) — when the snapshotter reports the
        // 4-Scout fan-out has completed (.swt-planning/codebase/ now
        // exists → buildSnapshot flips `codebase_mapped` to true → SSE
        // carries the partial), clear the in-flight flag so the wizard's
        // Step 4 button (if still mounted) and the CodebaseMapPrompt banner
        // both observe the resolved state.
        if ((partial as { codebase_mapped?: boolean }).codebase_mapped === true) {
          setState('isMappingCodebase', false);
        }
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
      // Milestone 13 / Phase 01 — push the SSE log line as a system entry
      // with its native channel (stdout/stderr). Replaces the prior
      // recent-log-lines write.
      pushLogEntry({
        kind: 'system',
        id: `log-${++logSeq}`,
        ts: evt.ts,
        channel: evt.channel,
        line: evt.line,
      });
      // Temporal-correlation invariant: log.append carries no session_id (events.ts:44-49);
      // init and cook do not overlap (init runs once at setup, cook requires .swt-planning/
      // to exist), so attributing every detecting-state log.append to initSession.lastMessage
      // is sound. If a future cook-during-init flow emerges, extend LogAppendEventSchema with
      // an optional session_id discriminator and key this attribution off it. Plan 19-03-01 T01.
      if (state.initSession !== null && state.initSession.status === 'detecting') {
        setState('initSession', 'lastMessage', evt.line);
      }
      return;
    }
    if (evt.type === 'error') {
      // Milestone 13 / Phase 01 — surface SSE errors in the unified log
      // (channel=stderr) AND keep the existing pushError pill behavior.
      pushLogEntry({
        kind: 'system',
        id: `log-${++logSeq}`,
        ts: evt.ts,
        channel: 'stderr',
        line: evt.message,
        errorCode: evt.code,
      });
      pushError(`${evt.code}: ${evt.message}`);
      return;
    }
    if (evt.type === 'prompt.request') {
      // Plan 02-01 (milestone 13, Phase 02) — cook askUser emit half. Only
      // prompt.request events whose `session_id` matches the active cook
      // session produce CookAskUserEntry items in unifiedLog. Other
      // prompt.request events (init Lead, init-test seams, /vbw subagent
      // prompts) MUST NOT pollute the cook log (Scout Cross-cutting #8).
      if (evt.session_id !== state.activeSessionId) return;
      // Translate AskUserOption `{label, isRecommended?}` → CookAskUserEntry
      // `{value, label, description?}`. Per plan must_have: `label` is used
      // as both `value` AND `label` (orchestrator round-trips selectedOption
      // against the original label string); `isRecommended` is stashed in
      // `description` as a sentinel ('Recommended — ' prefix) so Phase 03
      // can render the visual cue without a schema change. Phase 03 may
      // revisit if a dedicated `recommended` flag becomes needed.
      const translatedOptions = evt.options.map((o) => ({
        value: o.label,
        label: o.label,
        ...(o.isRecommended === true ? { description: 'Recommended' } : {}),
      }));
      pushLogEntry({
        kind: 'cook-ask-user',
        id: `log-cook-ask-${++logSeq}`,
        ts: evt.ts,
        session_id: evt.session_id,
        prompt_id: evt.prompt_id,
        question: evt.question,
        options: translatedOptions,
        // Phase 02 default per VBW `references/ask-user-question.md` — the
        // Other (freeform) path is always present unless an explicit
        // per-prompt opt-out is introduced. AskUserCard's `showOtherButton`
        // gate reads this; without the field, `=== true` checks always fail
        // and the Other button never renders (regression caught in M13 P04).
        allowFreeform: true,
        status: 'pending',
      });
      // Single-card invariant (Scout §7): a second prompt.request while the
      // slot is still set OVERWRITES; older un-answered entries remain in
      // unifiedLog with `status: 'pending'`. Freeform escape hatch is on
      // by default — Phase 03 may refine if a per-prompt opt-out signal is
      // ever introduced.
      setState('cookAwaitingUser', {
        askUserId: evt.prompt_id,
        question: evt.question,
        options: translatedOptions,
        allowFreeform: true,
      });
      return;
    }
    if (evt.type === 'prompt.response') {
      // Plan 02-01 (milestone 13, Phase 02) — cook askUser answer half.
      // Match by prompt_id (NOT session_id — the prompt's session_id is the
      // authoritative source for the matching entry, which we already
      // stamped on append). If no matching CookAskUserEntry exists, ignore
      // defensively — could be a response for a non-cook prompt.
      const reply = evt.selectedOption ?? evt.freeform ?? '';
      setState('unifiedLog', (prev) =>
        prev.map((entry) =>
          entry.kind === 'cook-ask-user' &&
          entry.prompt_id === evt.prompt_id &&
          entry.status === 'pending'
            ? { ...entry, status: 'answered' as const, reply }
            : entry,
        ),
      );
      if (state.cookAwaitingUser?.askUserId === evt.prompt_id) {
        setState('cookAwaitingUser', null);
      }
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
      const accept = state.vibeSession?.session_id === sid || state.activeSessionId === sid;
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
      const accept = state.vibeSession?.session_id === sid || state.activeSessionId === sid;
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

  // alpha.43 fix — `providerAuth` is the ONE cell that must fetch even in
  // greenfield mode. The InitScreen mounts the ProviderAuthPanel BEFORE
  // `.swt-planning/` exists so the user can configure / pin a provider
  // before clicking "Initialize SWT project" (the button is gated on a
  // resolved selected_provider). Without the snapshot, the panel stays
  // `data: null` → renders "No provider auth loaded yet" + no ✓ markers
  // on configured providers, even though the keychain HAS them. User
  // perception: "SWT doesn't remember my auth — I have to re-enter creds
  // to enable the Initialize button". The other cells (config,
  // detect-phase, doctor, update, commands) ARE meaningless pre-init
  // and the short-circuit still applies to them.
  const PROVIDERAUTH_KEY: ToolsCellKey = 'providerAuth';
  const filterKeysForGreenfield = (keys: readonly ToolsCellKey[]): readonly ToolsCellKey[] => {
    if (state.snapshot?.is_initialized === true) return keys;
    return keys.filter((k) => k === PROVIDERAUTH_KEY);
  };

  const refreshTools = async (): Promise<void> => {
    const allowed = filterKeysForGreenfield(TOOLS_KEYS);
    if (allowed.length === 0) return;
    await Promise.all(allowed.map((k) => refreshToolsCell(k)));
  };

  // Refresh one poll tier (a subset of TOOLS_KEYS). Shares refreshTools's
  // greenfield filter so a tier timer fetches ONLY providerAuth before
  // init (and skips everything pre-init when providerAuth isn't in the
  // tier — but FAST_TOOLS_KEYS does include providerAuth).
  const refreshToolsGroup = async (keys: readonly ToolsCellKey[]): Promise<void> => {
    const allowed = filterKeysForGreenfield(keys);
    if (allowed.length === 0) return;
    await Promise.all(allowed.map((k) => refreshToolsCell(k)));
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

    // alpha.47 — rehydrate the Log card's chat transcript from the on-disk
    // `<projectRoot>/.swt-planning/.events/chat-*.jsonl` channel BEFORE SSE
    // opens. This guarantees prior chat entries land in `unifiedLog` before
    // any live `chat.*` SSE event from a fresh turn arrives — so the user
    // sees their full history immediately on dashboard restart. Failure is
    // swallowed (the route returns `entries: []` rather than 5xx in the
    // common "no events dir yet" case; only schema-violation responses
    // throw, and that should not block the rest of bootstrap). The next
    // turn always starts a fresh Pi `AgentSession` — restored history is
    // display-only, the previous Pi `SessionManager.inMemory` cannot be
    // recovered across a daemon restart by design (Pi 0.74 constraint).
    try {
      const history = await fetchChatHistory();
      if (history.length > 0) {
        setState('unifiedLog', (prev) => [...history, ...prev].slice(-UNIFIED_LOG_LIMIT));
        // Adopt the MOST RECENT chat_session_id so a follow-up turn
        // continues the same thread visually. The server-side
        // `ChatSessionRegistry` no longer holds that id (process restart
        // cleared it), so the chat route will create a fresh Pi session
        // on the next POST — but the LogEntry stream stays continuous.
        const lastChatEntry = [...history]
          .reverse()
          .find(
            (e) => e.kind === 'chat-user' || e.kind === 'chat-assistant' || e.kind === 'chat-error',
          );
        if (lastChatEntry !== undefined) {
          setState('chat_session_id', lastChatEntry.chat_session_id);
        }
      }
    } catch {
      // Rehydration is best-effort — never block the rest of bootstrap.
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

    // v2.3 tools polling — most cells are only meaningful once the daemon
    // reports `is_initialized`. The `providerAuth` cell is the one
    // exception (alpha.43): the InitScreen mounts the ProviderAuthPanel
    // BEFORE init so the user can configure credentials, and the
    // "Initialize SWT project" button is gated on `selected_provider`
    // being resolved. So the bootstrap fires the providerAuth fetch even
    // in greenfield, and starts the polling tier (filterKeysForGreenfield
    // will keep it fetching only providerAuth pre-init). Once init lands,
    // the full TOOLS_KEYS set unblocks naturally on the next tick.
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
    } else {
      // Greenfield bootstrap: fetch the providerAuth snapshot once + start
      // the polling tier (filtered to just providerAuth via
      // filterKeysForGreenfield). This is what makes the InitScreen's
      // ProviderAuthPanel correctly show "✓ <provider> is configured (via
      // Keychain)" when the keychain already has credentials, instead of
      // forcing the user to re-enter creds to enable the Initialize
      // button. SSE `state.changed` after init triggers the regular
      // refreshTools flow which picks up everything else.
      void refreshToolsCell('providerAuth');
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
      // Defensive: on 404, the file may have been deleted since the last snapshot.
      // Trigger a snapshot reconcile so the tree reflects reality. After Phase 01
      // Fix 1, genuine 404s from /api/artifact now mean the file truly is missing
      // (not that the route is missing).
      if (err instanceof ApiError && err.status === 404) {
        setState('artifactCache', (prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        void fetchSnapshot()
          .then((snap) => {
            setState('snapshot', snap);
          })
          .catch(() => {
            /* reconnect path will reconcile */
          });
      }
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

  /**
   * Milestone 13 / Phase 01 — synthesize a system-internal LogEntry.
   * Replaces the legacy `recent-log-lines` writer. The `channel` argument
   * is retained for legacy callers (initProject / runCommand surface
   * stdout/stderr lines this way) but defaults to `'internal'` — the new
   * discriminator per Scout §1 K-3 for non-SSE bookkeeping lines.
   */
  const appendLogLine = (
    line: string,
    channel: 'stdout' | 'stderr' | 'internal' = 'internal',
  ): void => {
    pushLogEntry({
      kind: 'system',
      id: `log-init-${++logSeq}`,
      ts: nowFn().toISOString(),
      channel,
      line,
    });
  };

  const initProject = async (body: InitBody): Promise<InitResponse> => {
    setState('initSubmitting', true);
    // Plan 03-01 T2 — the old optimistic snapshot flip (setting
    // is_initialized) is REMOVED. Phase 02 made `POST /api/init` spawn a detached Lead
    // subprocess that runs for many seconds; flipping is_initialized at
    // submit time unmounted InitScreen instantly, hiding the "Detecting
    // stack…" overlay and breaking the audit Instance #1 contract. The
    // canonical flip now happens in `handleInitEvent` on `init.complete`
    // (the actual SSE signal that the Lead finished).
    const trimmedName = body.name.trim();
    const trimmedDesc = body.description?.trim() ?? '';
    try {
      const response = await postInit(body);
      // Capture the server-issued init session id when present. The
      // server-side init.ts mints a session_id and embeds it in the
      // init.start SSE event; the HTTP response shape (InitResponseSchema)
      // does NOT formally carry it (Zod's default object mode strips
      // unknown fields), but tests can mock postInit to return one, and
      // future schema additions are forward-compatible. The real id is
      // adopted onto initSession.session_id in `handleInitEvent`'s
      // init.start branch once that event arrives — keeping this slot
      // populated with a provisional empty id closes the race window
      // between scaffold-success and the first SSE frame.
      const sessionIdFromResponse = (response as { session_id?: string }).session_id ?? '';
      // Solid's setState with an object argument merges into the existing
      // store entry — explicitly write the optional fields (description /
      // errorMessage) so a re-submit after a prior init.error doesn't leak
      // the previous error message or description onto the new attempt.
      setState('initSession', {
        session_id: sessionIdFromResponse,
        status: 'detecting',
        name: trimmedName,
        description: trimmedDesc.length > 0 ? trimmedDesc : undefined,
        errorMessage: undefined,
        // Plan 19-03-01 T01 — lastMessage is part of the shape from
        // inception so the reducer's path-based setter at the log.append
        // case writes to a pre-existing key (not a missing one). The
        // first log.append during 'detecting' replaces this undefined.
        lastMessage: undefined,
        started_at: new Date().toISOString(),
      });
      appendLogLine(`[ok] Initialized .swt-planning/ — type 'help' for available subcommands.`);
      appendLogLine(`[ok] Project ${body.name} ready at ${response.root}`);
      // Milestone 23 Phase 02 T03 (Drift 5) — return the parsed
      // InitResponse so InitScreen's submit handler can capture
      // `{ brownfield, git_initialized, stack, files }` into a local
      // `lastInitResponse` signal that drives Step 4. Step 4 must read
      // from the HTTP response (not state.initSession), because the
      // synchronous scaffold's `init.complete` SSE event arrives ~100ms
      // later and immediately clears state.initSession via the
      // handleInitEvent reducer.
      return response;
    } catch (err: unknown) {
      // Scaffold-time failure (409 AlreadyInitialized, write error, etc.)
      // — clear any provisional initSession that a prior call left behind
      // and surface the error. No optimistic snapshot rollback needed
      // because the optimistic flip is gone. InitScreen stays mounted
      // (is_initialized was never flipped) with the user's typed
      // name/description intact, and the error paragraph surfaces via
      // state.errors / the InitScreen errorMessage prop wiring.
      setState('initSession', null);
      const message = err instanceof Error ? err.message : String(err);
      pushError(`init failed: ${message}`);
      throw err;
    } finally {
      setState('initSubmitting', false);
    }
  };

  /**
   * Milestone 23 Phase 03 (PA-1) — single entry point for triggering
   * `swt map` on a brownfield project. Hoisted from InitScreen.tsx's
   * former component-local `mapClicked` signal so both surfaces (the
   * wizard's Step 4 button + the persistent CodebaseMapPrompt banner)
   * share ONE in-flight signal. No parallel signals; no UI drift.
   *
   * Guards on `state.isMappingCodebase === true` (no-op if already in
   * flight). On success the flag stays `true` until the snapshotter's
   * `state.changed` event with `codebase_mapped: true` lands (handled in
   * the applyEvent state.changed branch above). On error the flag is
   * cleared so the user can retry.
   *
   * Vendor-agnostic at the HTTP layer (Locked Decision #10) — the auth
   * gate lives inside `swt map` CLI itself; a non-zero exit within 5s
   * surfaces via the route's watchdog → ErrorEvent on the bus →
   * pushError toast.
   */
  const startCodebaseMap = async (): Promise<{ ok: true } | { error: string }> => {
    if (state.isMappingCodebase) {
      return { ok: true };
    }
    setState('isMappingCodebase', true);
    try {
      await postMap();
      return { ok: true };
    } catch (err: unknown) {
      // Failure path — clear the flag so the banner re-shows the CTA and
      // the user can retry.
      setState('isMappingCodebase', false);
      const message = err instanceof Error ? err.message : String(err);
      pushError(`codebase mapping failed: ${message}`);
      return { error: message };
    }
  };

  /**
   * Milestone 13 / Phase 01 — surface a runCommand response in the unified
   * log. The user's typed input becomes one stdout entry; each stdout/
   * stderr line is a separate entry; a non-zero exit code adds a final
   * stderr breadcrumb. Replaces the prior recent-log-lines write.
   */
  const appendCommandLines = (response: CommandResponse, input: string): void => {
    const ts = nowFn().toISOString();
    pushLogEntry({
      kind: 'system',
      id: `log-cmd-${++logSeq}`,
      ts,
      channel: 'stdout',
      line: `$ swt ${input}`,
    });
    for (const raw of response.stdout.split('\n')) {
      if (raw.length === 0) continue;
      pushLogEntry({
        kind: 'system',
        id: `log-cmd-${++logSeq}`,
        ts,
        channel: 'stdout',
        line: raw,
      });
    }
    for (const raw of response.stderr.split('\n')) {
      if (raw.length === 0) continue;
      pushLogEntry({
        kind: 'system',
        id: `log-cmd-${++logSeq}`,
        ts,
        channel: 'stderr',
        line: raw,
      });
    }
    if (response.exit_code !== 0) {
      pushLogEntry({
        kind: 'system',
        id: `log-cmd-${++logSeq}`,
        ts,
        channel: 'stderr',
        line: `[exit ${response.exit_code} · ${response.duration_ms}ms]`,
      });
    }
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

  /**
   * Plan 03-01 (milestone 12, Phase 03) — Free-talk Mode turn submission.
   * Mirrors `startVibeSession`'s shape (trim+guard, loading flag, error
   * path) but lives on a SEPARATE state slot (`chat-session`) and uses the
   * OPTIMISTIC chat_session_id pattern: the first turn sets the id to ''
   * before the POST resolves, and the `chat.start` SSE event (via
   * `/api/events` bus) adopts the real id in `handleChatEvent` (P04).
   *
   * Multi-turn: when `state.chat-session?.chat_session_id` is non-empty, it
   * is passed to `postChatStart` so the server reuses the registered
   * SwtSession — Pi's `SessionManager.inMemory` accumulates conversation
   * history natively, so the same session handle keeps prior turns in
   * context.
   *
   * Error handling per Lead's plan: first-turn failure ROLLS BACK
   * `chat-session` to `null` (the empty optimistic state would otherwise
   * linger). Multi-turn failure KEEPS `messages[]` intact and flips
   * `status: 'error'` + `streaming: false` so the panel surfaces the
   * failure inline without losing the prior conversation.
   */
  /**
   * Milestone 13 / Phase 01 — Free-talk Mode turn submission, rewritten for
   * the unified-log + continuous-chat-thread model. The exported name
   * `startChat` is preserved (TopBar prop compat per Scout §3 #3).
   *
   * Two design changes from the milestone-12 implementation:
   *
   *   1. First-turn detection uses `state.chat_session_id === null` rather
   *      than the deleted `state.chat-session === null` slot. The chat
   *      thread is now top-level state — a `startVibeSession()` between
   *      chat turns does NOT clear the id, so verb-chip mode switching
   *      preserves one continuous chat thread (Scout §4, must_have #13).
   *
   *   2. The user message is pushed into `state.unifiedLog` as a
   *      `chat-user` LogEntry (interleaved with any cook/init/system
   *      entries the user has produced in between).
   *
   * Optimistic state pattern is unchanged: first turn sets
   * `chat_session_id = ''`, the `chat.start` SSE event adopts the real id
   * via `handleChatEvent` (which also backfills the optimistic chat-user
   * entry's `chat_session_id` field). On first-turn failure the optimistic
   * id is rolled back to `null` and the optimistic chat-user entry is
   * filtered out of `unifiedLog`. On multi-turn failure the user message
   * stays visible (so the user sees what was sent) and `chatStatus`
   * flips to `'error'`.
   */
  const startChat = async (prompt: string): Promise<string | null> => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return null;
    setState('chatStarting', true);
    const wasFirstTurn = state.chat_session_id === null;
    const priorSessionId = state.chat_session_id ?? '';
    const userEntryId = `chat-msg-${++chatMsgSeq}`;
    const userEntry: LogEntry = {
      kind: 'chat-user',
      id: userEntryId,
      ts: nowFn().toISOString(),
      // Optimistic: empty on first turn; carried over on multi-turn.
      // chat.start adoption backfills any '' entries with the real id.
      chat_session_id: wasFirstTurn ? '' : priorSessionId,
      text: trimmed,
    };
    if (wasFirstTurn) {
      // First-turn: optimistically adopt the empty id so the correlation
      // guard in handleChatEvent (which compares against state.chat_session_id)
      // matches the chat.start frame.
      setState('chat_session_id', '');
    }
    setState('chatStreaming', true);
    setState('chatStatus', 'streaming');
    pushLogEntry(userEntry);
    try {
      await postChatStart(trimmed, priorSessionId.length > 0 ? priorSessionId : undefined);
      return state.chat_session_id ?? '';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pushError(`chat start failed: ${message}`);
      if (wasFirstTurn) {
        // Roll back the first-turn optimistic state. Remove the orphan
        // chat-user entry and reset the thread id to null so the next
        // startChat is also a first turn.
        setState('chat_session_id', null);
        setState('chatStreaming', false);
        setState('chatStatus', 'idle');
        setState('unifiedLog', (prev) => prev.filter((e) => e.id !== userEntryId));
      } else {
        // Multi-turn: keep the user message visible; flip the status flag
        // so the panel can render an inline error banner.
        setState('chatStreaming', false);
        setState('chatStatus', 'error');
      }
      return null;
    } finally {
      setState('chatStarting', false);
    }
  };

  /**
   * Plan 03-01 (milestone 12, Phase 03) — wipe the local chat conversation.
   * Synchronous; no HTTP call. The server's `ChatSessionRegistry` has a
   * 10-minute TTL sweep that handles cleanup (Lead's deliberate v1
   * decision — Phase 04 may add `DELETE /api/chat/:id`).
   */
  /**
   * Milestone 13 / Phase 01 — wipe the chat thread, preserving the rest of
   * the unified log. Filters `unifiedLog` to drop only chat-* entries
   * (`chat-user` / `chat-assistant` / `chat-error`); cook / init / system
   * entries are preserved. Resets `chat_session_id` / `chatStreaming` /
   * `chatStatus` to their greenfield values, then leaves a system-internal
   * breadcrumb. Synchronous; no HTTP call (the server's
   * `ChatSessionRegistry` has a 10-minute TTL sweep that handles cleanup).
   */
  const clearChat = (): void => {
    setState('unifiedLog', (prev) =>
      prev.filter(
        (e) => e.kind !== 'chat-user' && e.kind !== 'chat-assistant' && e.kind !== 'chat-error',
      ),
    );
    setState('chat_session_id', null);
    setState('chatStreaming', false);
    setState('chatStatus', 'idle');
    appendLogLine('[chat] conversation cleared');
  };

  /**
   * Milestone 13 / Phase 03 — see the `DashboardActions.respondToCookAskUser`
   * doc-comment for the full optimistic-mark + optimistic-clear +
   * revert-on-error sequence (Scout §7). Implementation notes:
   *
   *   - The match predicate is `prompt_id === askUserId AND status === 'pending'`.
   *     A prior pending entry that was already optimistically answered (e.g.
   *     a fast double-click) will not re-match, and the action becomes a
   *     no-op for that case — `pushError` documents the "already answered?"
   *     hypothesis.
   *   - The reply text uses `??` ordering: `selectedOption` first (option
   *     buttons), `freeform` second (TopBar / textarea), empty string last
   *     (defensive — schema requires `reply?: string` so undefined is
   *     valid, but a visible empty string is more honest than a "no reply"
   *     placeholder).
   *   - The revert path re-applies the snapshotted `cookAwaitingUser`
   *     verbatim — this is the same shape the Phase 02 `prompt.request`
   *     reducer wrote, so visual state is bit-identical to the moment
   *     before submit.
   *   - `appendLogLine` writes a system-internal entry (`channel:
   *     'internal'`) so the failure surfaces in the unified log alongside
   *     the now-reverted `cook-ask-user` entry. `pushError` adds the
   *     toast/pill pair (capped at the 10-entry `errors[]` ring).
   */
  const respondToCookAskUser = async (
    askUserId: string,
    response: { selectedOption: string | null; freeform: string | null },
  ): Promise<void> => {
    const cookSessionId = state.activeSessionId;
    if (cookSessionId === null) {
      pushError('[cook-ask-user] no active cook session — cannot respond');
      return;
    }
    const matchIdx = state.unifiedLog.findIndex(
      (e) => e.kind === 'cook-ask-user' && e.prompt_id === askUserId && e.status === 'pending',
    );
    if (matchIdx === -1) {
      pushError('[cook-ask-user] no pending entry for askUserId — already answered?');
      return;
    }
    // Snapshot cookAwaitingUser BEFORE the optimistic clear so the revert
    // path can restore the exact pre-action shape.
    const prevAwaiting = state.cookAwaitingUser;
    const replyText = response.selectedOption ?? response.freeform ?? '';
    // Optimistic mark — mutate the entry by index. The kind-guard is
    // defensive (the `findIndex` predicate already filtered to
    // 'cook-ask-user'); without it the discriminated-union narrows back
    // to LogEntry and the spread fails type-checking.
    setState('unifiedLog', matchIdx, (entry) =>
      entry.kind === 'cook-ask-user'
        ? { ...entry, status: 'answered' as const, reply: replyText }
        : entry,
    );
    // Optimistic clear — TopBar disengages answer-mode immediately. The
    // SSE prompt.response reducer (Phase 02) becomes a no-op for both
    // the entry status AND the slot when the round-trip lands.
    setState('cookAwaitingUser', null);
    try {
      await postCookRespond({
        cook_session_id: cookSessionId,
        askUserId,
        response,
      });
      // Success — nothing to do. The Phase 02 reducer at prompt.response
      // confirms the optimistic state when the SSE arrives.
    } catch (err: unknown) {
      // Revert: entry status → pending, slot → snapshotted shape, and
      // surface both a toast and an inline system LogEntry.
      setState('unifiedLog', matchIdx, (entry) =>
        entry.kind === 'cook-ask-user'
          ? { ...entry, status: 'pending' as const, reply: undefined }
          : entry,
      );
      setState('cookAwaitingUser', prevAwaiting);
      const message = err instanceof Error ? err.message : String(err);
      pushError(`cook askUser respond failed: ${message}`);
      appendLogLine(`[cook-ask-user] respond failed: ${message}`);
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
      startCodebaseMap,
      runCommand,
      startVibeSession,
      startChat,
      clearChat,
      replyToActivePrompt,
      respondToCookAskUser,
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
