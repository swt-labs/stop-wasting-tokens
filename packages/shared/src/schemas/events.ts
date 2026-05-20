import { z } from 'zod';

import { SnapshotSchema } from './snapshot.js';

const TimestampSchema = z.string().datetime({ offset: true });

const SnapshotReplaceEvent = z.object({
  type: z.literal('snapshot.replace'),
  ts: TimestampSchema,
  snapshot: SnapshotSchema,
});

const StateChangedEvent = z.object({
  type: z.literal('state.changed'),
  ts: TimestampSchema,
  // v2.3 added 'config' to signal that .swt-planning/config.json mutated
  // (via POST /api/config). The Config tools panel branches on this and
  // re-fetches; other panels ignore it.
  changed: z.array(z.enum(['phase', 'agents', 'artifacts', 'cost', 'config'])).min(1),
  snapshot: SnapshotSchema.partial(),
});

const AgentSpawnEvent = z.object({
  type: z.literal('agent.spawn'),
  ts: TimestampSchema,
  agent: z.string().min(1),
  phase: z.string().regex(/^\d{2}$/),
  plan: z.string().nullable(),
});

const AgentCompleteEvent = z.object({
  type: z.literal('agent.complete'),
  ts: TimestampSchema,
  agent: z.string().min(1),
  phase: z.string().regex(/^\d{2}$/),
  plan: z.string().nullable(),
  tokens_in: z.number().int().nonnegative(),
  tokens_out: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  artifact: z.string().nullable(),
});

const LogAppendEvent = z.object({
  type: z.literal('log.append'),
  ts: TimestampSchema,
  channel: z.enum(['stdout', 'stderr']),
  line: z.string(),
});

const ErrorEvent = z.object({
  type: z.literal('error'),
  ts: TimestampSchema,
  code: z.string().min(1),
  message: z.string().min(1),
});

const AgentPromptOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

const AgentPromptContextSchema = z.object({
  operation: z.enum(['write_file', 'read_file', 'shell', 'network', 'mcp_action']).optional(),
  target: z.string().optional(),
  risk_summary: z.string().optional(),
  agent_role: z.enum(['scout', 'architect', 'lead', 'dev', 'qa', 'debugger']).optional(),
  related_files: z.array(z.string()).optional(),
});

const AgentPromptEvent = z.object({
  type: z.literal('agent.prompt'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  prompt_id: z.string().min(1),
  subtype: z.enum(['clarification', 'permission']),
  question: z.string().min(1),
  options: z.array(AgentPromptOptionSchema).optional(),
  context: AgentPromptContextSchema.optional(),
  expires_at: TimestampSchema.optional(),
});

const AgentPromptTimeoutEvent = z.object({
  type: z.literal('agent.prompt.timeout'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  prompt_id: z.string().min(1),
  expired_at: TimestampSchema,
});

// Plan 01-05: askUser dashboard-mediated primitive. The orchestrator publishes
// `prompt.request` onto the dashboard SSE bus; the dashboard renders a card
// (PromptCard) per references/ask-user-question.md; user clicks; dashboard POSTs
// to /api/prompts/:id/respond which publishes the `prompt.response` mirror.
// Distinct from `agent.prompt` (Phase 2 vibe-session conversational prompt) —
// askUser is the Pi-substrate primitive that's orchestrator-only at the tool
// registration layer. See research §5 for the IPC contract; Phase D swaps the
// transport to Unix-socket without changing this shape.
const PromptRequestOptionSchema = z.object({
  label: z.string().min(1),
  isRecommended: z.boolean().optional(),
});

const PromptRequestEvent = z.object({
  type: z.literal('prompt.request'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  prompt_id: z.string().min(1),
  header: z.string().optional(),
  question: z.string().min(1),
  options: z.array(PromptRequestOptionSchema).min(1),
  multiSelect: z.boolean().optional(),
  preview: z.string().nullable().optional(),
});

const PromptResponseEvent = z.object({
  type: z.literal('prompt.response'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  prompt_id: z.string().min(1),
  selectedOption: z.string().nullable(),
  freeform: z.string().nullable(),
});

// Plan 04-01 (Phase 4) — Cook orchestrator IPC event channel (R1 file-tail
// decision: writers append JSONL to .swt-planning/.events/*.jsonl which the
// dashboard's events-tailer.ts already consumes; no UDS socket). These
// `cook.*` variants are the wire format for plans 04-02 (reducer) and
// 04-03 (SPA fold). `cook.askUser_*` deliberately NOT added — those reuse
// the existing prompt.request / prompt.response schemas (research §2.3).
const CookModeSchema = z.enum([
  'bootstrap',
  'scope',
  'discuss',
  'assumptions',
  'plan',
  'execute',
  'plan-and-execute',
  'verify',
  'uat-remediation',
  'qa-remediation',
  'milestone-uat-recovery',
  'add-phase',
  'insert-phase',
  'remove-phase',
  'archive',
]);

const CookAgentRoleSchema = z.enum([
  'orchestrator',
  'scout',
  'architect',
  'lead',
  'dev',
  'qa',
  'debugger',
  'docs',
]);

const CookUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
});

const CookPriorityDecisionEvent = z.object({
  type: z.literal('cook.priority_decision'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  priority: z.number().min(0).max(11),
  mode: CookModeSchema,
  phase_target: z.string().optional(),
});

const CookAgentSpawnEvent = z.object({
  type: z.literal('cook.agent_spawn'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  role: CookAgentRoleSchema,
  sub_session_id: z.string().min(1),
  prompt_hash: z.string().optional(),
  /**
   * Statusline-extension milestone — the resolved model id for the spawned
   * agent (or the orchestrator). Optional because the cook callsite often
   * doesn't know the id (Pi's ModelRegistry resolves provider defaults
   * internally); sub-agent spawns from
   * `.swt-planning/.sessions/*.json` polling fold a model field in
   * via the snapshot pipeline rather than this event. Pure addition;
   * older consumers ignore it.
   */
  model: z.string().optional(),
});

const CookAgentResultEvent = z.object({
  type: z.literal('cook.agent_result'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  status: z.enum(['completed', 'failed', 'blocked']),
  usage: CookUsageSchema,
});

const CookToolCallEvent = z.object({
  type: z.literal('cook.tool_call'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  tool: z.string().min(1),
  input_excerpt: z.string().max(500),
});

const CookToolResultEvent = z.object({
  type: z.literal('cook.tool_result'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  tool: z.string().min(1),
  result_excerpt: z.string().max(500),
  duration_ms: z.number().int().nonnegative(),
});

const CookFileWriteEvent = z.object({
  type: z.literal('cook.file_write'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});

const CookCommitEvent = z.object({
  type: z.literal('cook.commit'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  commit_sha: z.string().min(1),
  message: z.string().min(1),
});

const CookErrorEvent = z.object({
  type: z.literal('cook.error'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  mode: CookModeSchema.optional(),
});

const CookCompletionEvent = z.object({
  type: z.literal('cook.completion'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  status: z.enum(['success', 'failed', 'cancelled']),
  total_cost_usd: z.number().nonnegative().optional(),
});

// Plan 06-01 (Phase 6) T2 — REQ-11 crash-recovery task lifecycle events.
// Appended to the same .swt-planning/.events/cook-*.jsonl channel that
// Phase 4 ships; the resume probe (cookHandler entry) consults the journal
// for the last task.commit at recovery time. PIPE_BUF-safe (each line
// stays ≤500 bytes; the `reason` field on task.fail is capped at 200).
const CookTaskStartEvent = z.object({
  type: z.literal('cook.task_start'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  plan: z.string().min(1),
  task_id: z.string().min(1),
});

const CookTaskCommitEvent = z.object({
  type: z.literal('cook.task_commit'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  plan: z.string().min(1),
  task_id: z.string().min(1),
  commit_hash: z.string().min(1),
});

const CookTaskCompleteEvent = z.object({
  type: z.literal('cook.task_complete'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  plan: z.string().min(1),
  task_id: z.string().min(1),
});

const CookTaskFailEvent = z.object({
  type: z.literal('cook.task_fail'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  plan: z.string().min(1),
  task_id: z.string().min(1),
  reason: z.string().max(200),
});

const CookResumeEvent = z.object({
  type: z.literal('cook.resume'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  from_task: z.string().min(1),
  last_commit_hash: z.string().optional(),
  reason: z.string().max(200).optional(),
});

// Plan 06-02 T4 (REQ-16) — budget gate transition. Emitted on the cook
// events JSONL when the BudgetGate crosses the pause threshold; the
// `reason` discriminator carries which transition fired so the dashboard
// can surface the right copy. `spent_usd` / `ceiling_usd` mirror the
// BudgetEvent payload at the moment of transition.
const CookBudgetExceededEvent = z.object({
  type: z.literal('cook.budget_exceeded'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  reason: z.enum(['paused_on_entry', 'paused_during_spawn']),
  spent_usd: z.number().nonnegative(),
  ceiling_usd: z.number().nonnegative(),
  threshold: z.number().min(0).max(1),
});

const CookBudgetResumeEvent = z.object({
  type: z.literal('cook.budget_resume'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  spent_usd: z.number().nonnegative(),
  ceiling_usd: z.number().nonnegative(),
});

// Phase 17 plan 04-01 (Codex parity, update_plan tool) — emitted by the
// `update_plan` Pi customTool (packages/runtime/src/extensions/update-plan-tool.ts)
// via `pi.appendEntry('cook.plan_update', parsedArgs)` on each successful
// invocation. The customType on the Pi entry maps to this event's `type`
// when the cook events JSONL bridge surfaces it to SSE consumers. The
// dashboard reducer (handleCookEvent 'cook.plan_update' branch) consumes
// this and applies REPLACE semantics — the most-recent CookPlanUpdateEntry
// for the same `session_id` is replaced in place rather than appended,
// matching Codex's plan-replace contract (`plan_tool.rs`). `plan` mirrors
// the runtime `UpdatePlanArgs` schema (status enum verbatim); `explanation`
// is optional.
const CookPlanUpdateEvent = z.object({
  type: z.literal('cook.plan_update'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  plan: z.array(
    z
      .object({
        step: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
      })
      .strict(),
  ),
  explanation: z.string().optional(),
});

// Plan 02-01 (milestone 13, Phase 02) — Cook askUser UI timeout.
// UI-cosmetic only: dashboard tracks its own setTimeout per cook-correlated
// prompt.request and emits this on expiry to mark the CookAskUserEntry
// `status: 'expired'`. The cook-side askUser promise (10-min default in
// ask-user.ts:74) times out independently and surfaces via cook.error —
// Phase 02 does NOT try to resolve cook's promise from this event.
// `cook.ask_user` / `cook.user_responded` are deliberately NOT added: the
// emit + answer halves reuse the existing prompt.request / prompt.response
// schemas (see Scout §5 Option A and the convention comment at events.ts:129).
const CookAskUserTimeoutEvent = z.object({
  type: z.literal('cook.ask_user_timeout'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  prompt_id: z.string().min(1),
});

// Plan 06-03 T1 (R6) — one-time warning at cook start when the active phase
// carries 2+ same-wave plans AND `worktree_isolation` is `'off'`. The
// dashboard surfaces this on the Worktrees panel so operators see the
// staging-area race risk before any spawn happens.
const CookWorktreeIsolationWarningEvent = z.object({
  type: z.literal('cook.worktree_isolation_warning'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  parallel_plans: z.number().int().nonnegative(),
});

// Plan 02-04 (Phase 2 / G-R3) — provider-router telemetry on the cook events
// JSONL channel. `cook.provider_selected` fires once per spawn after the
// router resolves the primary provider; `selected_via` records which strategy
// variant picked it (the 'tier-routed-compound:fallback-strategy' composition
// hint distinguishes a map-hit from a fallbackStrategy delegation per R3).
// The optional rate-card / dimension / tier fields are populated only for the
// strategy variants that carry them. Per R5 — pure addition to the union;
// the dashboard reducer's unknown-type-no-op behaviour makes it safe.
const CookProviderSelectedEvent = z.object({
  type: z.literal('cook.provider_selected'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  selected_provider: z.string().min(1),
  selected_via: z.enum([
    'pinned',
    'round-robin',
    'tier-routed',
    'cost-optimized',
    'tier-routed-compound',
    'cost-optimized-rate-card',
    'tier-routed-compound:fallback-strategy',
  ]),
  tier: z.string().optional(),
  rate_card_age_ms: z.number().int().nonnegative().optional(),
  rate_card_source: z.enum(['embedded', 'project-override', 'fetched']).optional(),
  dimension: z.enum(['input', 'output', 'blended']).optional(),
  /**
   * Statusline-extension milestone — the resolved model id for the orchestrator
   * Pi session (e.g. `claude-sonnet-4-6`, `gpt-5-mini`). Optional because Pi's
   * `ModelRegistry` resolves the provider default internally for simple
   * strategies and the cook callsite doesn't always know the id; the
   * dashboard statusline renders `—` when omitted. Pure addition to the
   * union — older consumers ignore it.
   */
  model: z.string().optional(),
});

// Plan 02-04 (Phase 2 / G-R3) — promotes the existing stderr-only
// `provider.fallback_fired` to a JSONL event (dual-emit; stderr stays for
// human visibility). Fires on every fallback-chain hop.
const CookProviderFallbackEvent = z.object({
  type: z.literal('cook.provider_fallback'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  reason: z.enum(['503', '429', '500', 'other']),
  attempt: z.number().int().positive(),
});

// Plan 03-02 (Phase 3 / G-R4) — `cook.budget_projected` — pre-spawn cost
// forecast emitted once per spawn from the cook callsite (plan 03-04), whether
// the projection halts (would_exceed: true) or passes. Carries the projection's
// gating number (projected_cost_usd), the gate's current state (spent_usd,
// ceiling_usd), the forward-looking projected_pressure (deliberately NO `.max()`
// — a projection CAN blow past the ceiling, so pressure can exceed 1.0), the
// binary halt decision (would_exceed), and the honesty surface (confidence +
// assumptions[]). assumptions is double-capped — `.max(8)` entries AND
// `.string().max(80)` per entry — to keep the JSONL line within the PIPE_BUF
// ~500-byte convention the sibling cook events follow. Fields map 1:1 onto the
// CostProjection interface (packages/runtime/src/budget/cost-projector.ts) plus
// the gate.project() state. Per R5 — pure addition to the union; the dashboard
// reducer's unknown-type-no-op behaviour makes it safe (no schema_version bump).
export const CookBudgetProjectedEventSchema = z.object({
  type: z.literal('cook.budget_projected'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  sub_session_id: z.string().min(1),
  projected_cost_usd: z.number().nonnegative(),
  spent_usd: z.number().nonnegative(),
  ceiling_usd: z.number().nonnegative(),
  projected_pressure: z.number().min(0),
  would_exceed: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  assumptions: z.array(z.string().max(80)).max(8),
  rate_card_source: z.enum(['embedded', 'project-override', 'fetched']),
});

// Plan 04-01 (Phase 4) — OAuth login flow SSE bridge channel. The dashboard's
// POST /api/provider-auth/oauth/start route (plan 04-02) drives pi-ai's
// OAuthProviderInterface.login() and bridges OAuthLoginCallbacks onto this
// EventBus as `oauth.*` events; the SPA (plan 04-03) renders them. Every
// variant carries `flow_id` (correlates the events of one OAuth flow) +
// `provider`. NONE carries a token — the OAuthCredentials blob pi-ai produces
// goes straight to the OS keychain (research §6), never onto the SSE wire.

/** pi-ai's OAuthLoginCallbacks.onAuth({url, instructions}) fired — the SPA
 *  renders "open this URL in your browser". `url` is the genuine provider
 *  URL (it comes from pi-ai, trusted). */
const OAuthAuthUrlEvent = z.object({
  type: z.literal('oauth.auth_url'),
  ts: TimestampSchema,
  flow_id: z.string().min(1),
  provider: z.string().min(1),
  url: z.string().min(1),
  instructions: z.string().optional(),
});

/** pi-ai's OAuthLoginCallbacks.onProgress(message) fired — a human-readable
 *  progress line for the SPA. */
const OAuthProgressEvent = z.object({
  type: z.literal('oauth.progress'),
  ts: TimestampSchema,
  flow_id: z.string().min(1),
  provider: z.string().min(1),
  message: z.string().min(1),
});

/** pi-ai's OAuthLoginCallbacks.onManualCodeInput invoked — the headless
 *  paste-flow signal (Risk 4). The SPA shows the auth-code paste box; the
 *  user POSTs the code to /api/provider-auth/oauth/code. */
const OAuthAwaitingCodeEvent = z.object({
  type: z.literal('oauth.awaiting_code'),
  ts: TimestampSchema,
  flow_id: z.string().min(1),
  provider: z.string().min(1),
  message: z.string().optional(),
});

/** pi-ai's login() resolved and the OAuthCredentials blob was stored in the
 *  OS keychain. Success is signalled by the event TYPE — this event carries
 *  NO token (the credential lives only in the keychain). */
const OAuthCompleteEvent = z.object({
  type: z.literal('oauth.complete'),
  ts: TimestampSchema,
  flow_id: z.string().min(1),
  provider: z.string().min(1),
});

/** pi-ai's login() rejected, or the flow was aborted / timed out. */
const OAuthErrorEvent = z.object({
  type: z.literal('oauth.error'),
  ts: TimestampSchema,
  flow_id: z.string().min(1),
  provider: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
});

// Plan 02-01 (milestone 08, Phase 02) — Dashboard `/api/init` init Lead
// subprocess lifecycle. Mirrors the `cook.*` watchdog contract from
// cook-start.ts: the init route appends an `init.start` JSONL row +
// bus.publish before spawning `swt init`, and the `child.once('exit', ...)`
// watchdog fires `init.complete` (code 0) or `init.error` (non-zero).
// `init.error.code` is `INIT_SPAWN_FAILED` for fast non-zero exits (<5s)
// and `INIT_FAILED` for late non-zero exits — see plan 02-01 T3 Decisions.
const InitStartEvent = z.object({
  type: z.literal('init.start'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
});

const InitCompleteEvent = z.object({
  type: z.literal('init.complete'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  status: z.enum(['success', 'failed']).optional(),
  // Milestone 23 Phase 01 T03 — synchronous scaffold result fields. All
  // optional for back-compat with v1.6.x daemons that emitted the bare
  // session_id-only envelope; v3.0.0-alpha.44+ always emits the enriched
  // shape so the dashboard wizard can render Step 3 without a follow-up
  // GET /api/snapshot round-trip.
  brownfield: z.boolean().optional(),
  git_initialized: z.boolean().optional(),
  stack: z.array(z.string()).optional(),
});

const InitErrorEvent = z.object({
  type: z.literal('init.error'),
  ts: TimestampSchema,
  session_id: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
});

// Plan 01-02 (milestone 12, Phase 01) — Free-talk Mode chat event schemas.
// Lead decisions recorded inline (Scout's RESEARCH §Q6 + Open Questions):
//
//   1. Correlation field is `chat_session_id` (NOT `session_id`). Chat
//      sessions are a separate namespace from cook/init; using a distinct
//      field name keeps the reducer switch clear and avoids accidental
//      cross-contamination with `events.ts:32` cook/init session-id
//      filtering. Resolves Scout Open Question #1.
//   2. `ChatErrorEvent.code` is a CLOSED Zod enum (4 values) so the
//      dashboard reducer can exhaustively switch on it without an
//      unknown-code fallback path. Resolves Scout Open Question #3 (closed
//      enum vs. free-form string).
//   3. `ChatTokenUsageEvent` matches the SwtEvent `TASK_TOKEN_USAGE`
//      `usage` shape (input/output/cacheRead/cacheWrite/provider/model)
//      so the existing meter pipeline (REQ-05) can consume chat usage
//      with NO shape translation.
//   4. Schema additions are purely additive (per the R5 comment at
//      events.ts:383): no downstream `handleInitEvent` / `handleCookEvent`
//      reducers need to change to accommodate chat events.
const ChatStartEvent = z.object({
  type: z.literal('chat.start'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
  prompt: z.string(),
});

const ChatMessageDelta = z.object({
  type: z.literal('chat.message_delta'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
  text: z.string(),
});

const ChatToolCall = z.object({
  type: z.literal('chat.tool_call'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
  tool: z.string(),
});

const ChatMessageEnd = z.object({
  type: z.literal('chat.message_end'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
});

const ChatTokenUsage = z.object({
  type: z.literal('chat.token_usage'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  provider: z.string(),
  model: z.string(),
});

const ChatError = z.object({
  type: z.literal('chat.error'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
  code: z.enum([
    'CHAT_AUTH_FAILED',
    'CHAT_SESSION_ERROR',
    'CHAT_PROMPT_ERROR',
    'CHAT_INVALID_REQUEST',
  ]),
  message: z.string(),
});

const ChatComplete = z.object({
  type: z.literal('chat.complete'),
  ts: TimestampSchema,
  chat_session_id: z.string().min(1),
});

export const SnapshotEventSchema = z.discriminatedUnion('type', [
  SnapshotReplaceEvent,
  StateChangedEvent,
  AgentSpawnEvent,
  AgentCompleteEvent,
  LogAppendEvent,
  ErrorEvent,
  AgentPromptEvent,
  AgentPromptTimeoutEvent,
  PromptRequestEvent,
  PromptResponseEvent,
  CookPriorityDecisionEvent,
  CookAgentSpawnEvent,
  CookAgentResultEvent,
  CookToolCallEvent,
  CookToolResultEvent,
  CookFileWriteEvent,
  CookCommitEvent,
  CookErrorEvent,
  CookCompletionEvent,
  CookTaskStartEvent,
  CookTaskCommitEvent,
  CookTaskCompleteEvent,
  CookTaskFailEvent,
  CookResumeEvent,
  CookBudgetExceededEvent,
  CookBudgetResumeEvent,
  CookPlanUpdateEvent,
  CookAskUserTimeoutEvent,
  CookWorktreeIsolationWarningEvent,
  CookProviderSelectedEvent,
  CookProviderFallbackEvent,
  CookBudgetProjectedEventSchema,
  // Plan 04-01 (Phase 4) — OAuth login flow SSE bridge events.
  OAuthAuthUrlEvent,
  OAuthProgressEvent,
  OAuthAwaitingCodeEvent,
  OAuthCompleteEvent,
  OAuthErrorEvent,
  // Plan 02-01 (milestone 08, Phase 02) — Dashboard /api/init init Lead
  // subprocess lifecycle (init.start before spawn; init.complete / init.error
  // from the child.once('exit') watchdog).
  InitStartEvent,
  InitCompleteEvent,
  InitErrorEvent,
  // Plan 01-02 (milestone 12, Phase 01) — Free-talk Mode chat lifecycle.
  // The dashboard /api/chat SSE route emits these in real time via direct
  // session.subscribe() fan-out (no orchestrator). chat_session_id is the
  // correlation field (see header comment above the schema block).
  ChatStartEvent,
  ChatMessageDelta,
  ChatToolCall,
  ChatMessageEnd,
  ChatTokenUsage,
  ChatError,
  ChatComplete,
]);
export type SnapshotEvent = z.infer<typeof SnapshotEventSchema>;
export type AgentPromptEvent = z.infer<typeof AgentPromptEvent>;
export type AgentPromptTimeoutEvent = z.infer<typeof AgentPromptTimeoutEvent>;
export type AgentPromptOption = z.infer<typeof AgentPromptOptionSchema>;
export type AgentPromptContext = z.infer<typeof AgentPromptContextSchema>;
export type PromptRequestEvent = z.infer<typeof PromptRequestEvent>;
export type PromptResponseEvent = z.infer<typeof PromptResponseEvent>;
export type PromptRequestOption = z.infer<typeof PromptRequestOptionSchema>;
// Re-exported Zod schemas so route handlers can validate POST bodies that
// project the same shape as the SSE event payload.
export {
  PromptRequestEvent as PromptRequestEventSchema,
  PromptResponseEvent as PromptResponseEventSchema,
  PromptRequestOptionSchema,
};

export const SNAPSHOT_EVENT_TYPES = [
  'snapshot.replace',
  'state.changed',
  'agent.spawn',
  'agent.complete',
  'log.append',
  'error',
  'agent.prompt',
  'agent.prompt.timeout',
  'prompt.request',
  'prompt.response',
  'cook.priority_decision',
  'cook.agent_spawn',
  'cook.agent_result',
  'cook.tool_call',
  'cook.tool_result',
  'cook.file_write',
  'cook.commit',
  'cook.error',
  'cook.completion',
  'cook.task_start',
  'cook.task_commit',
  'cook.task_complete',
  'cook.task_fail',
  'cook.resume',
  'cook.budget_exceeded',
  'cook.budget_resume',
  // Phase 17 plan 04-01 — Codex parity update_plan customTool entry. The
  // tool's pi.appendEntry call surfaces through the cook events JSONL
  // bridge as this type; the dashboard reducer applies REPLACE semantics
  // on a same-session_id match.
  'cook.plan_update',
  // Plan 02-01 (milestone 13, Phase 02) — UI-cosmetic timeout marker emitted
  // by the dashboard when its per-prompt setTimeout expires; the reducer
  // sets the matching CookAskUserEntry to `status: 'expired'`.
  'cook.ask_user_timeout',
  'cook.worktree_isolation_warning',
  'cook.provider_selected',
  'cook.provider_fallback',
  // Plan 03-02 (Phase 3 / G-R4) — pre-spawn cost forecast emitted once per
  // spawn (whether the projection halts or passes); the schema plan 03-04
  // emits against from a CostProjection + gate.project() result.
  'cook.budget_projected',
  // Plan 04-01 (Phase 4) — OAuth login flow SSE bridge events.
  'oauth.auth_url',
  'oauth.progress',
  'oauth.awaiting_code',
  'oauth.complete',
  'oauth.error',
  // Plan 02-01 (milestone 08, Phase 02) — Dashboard /api/init init Lead
  // subprocess lifecycle.
  'init.start',
  'init.complete',
  'init.error',
  // Plan 01-02 (milestone 12, Phase 01) — Free-talk Mode chat lifecycle.
  'chat.start',
  'chat.message_delta',
  'chat.tool_call',
  'chat.message_end',
  'chat.token_usage',
  'chat.error',
  'chat.complete',
] as const;

// Plan 04-01 — CookEvent surface. Inferred from the discriminated-union so
// downstream consumers (cook.ts emitter, dashboard reducer at plan 04-02,
// SPA fold at plan 04-03) get exhaustive narrowing for `cook.*` variants.
export type CookEvent = Extract<SnapshotEvent, { type: `cook.${string}` }>;
export type CookMode = z.infer<typeof CookModeSchema>;
export type CookEventAgentRole = z.infer<typeof CookAgentRoleSchema>;
export type CookUsage = z.infer<typeof CookUsageSchema>;
// Plan 02-04 (Phase 2 / G-R3) — inferred TS types for the provider-router
// telemetry events; the cook.ts emitter + (future) dashboard reducer narrow
// on these.
export type CookProviderSelectedEvent = z.infer<typeof CookProviderSelectedEvent>;
export type CookProviderFallbackEvent = z.infer<typeof CookProviderFallbackEvent>;
// Plan 02-01 (milestone 13, Phase 02) — inferred TS type for the cook
// askUser UI-timeout event. Plan's P02 dashboard-store reducer narrows on
// this when clearing cookAwaitingUser + marking the matching
// CookAskUserEntry `status: 'expired'`.
export type CookAskUserTimeoutEvent = z.infer<typeof CookAskUserTimeoutEvent>;
// Phase 17 plan 04-01 — inferred TS type for the update_plan customTool
// event. handleCookEvent's 'cook.plan_update' branch narrows on this and
// constructs a CookPlanUpdateEntry under REPLACE semantics.
export type CookPlanUpdateEvent = z.infer<typeof CookPlanUpdateEvent>;
// Plan 03-02 (Phase 3 / G-R4) — inferred TS type for the pre-spawn cost
// forecast event; plan 03-04's cook.ts emitter narrows on this. The
// CookBudgetProjectedEventSchema const is already exported at its declaration.
export type CookBudgetProjectedEvent = z.infer<typeof CookBudgetProjectedEventSchema>;
// Plan 04-01 (Phase 4) — inferred TS types for the OAuth login SSE bridge
// events; plan 04-02's route bridge + plan 04-03's SPA fold narrow on these.
export type OAuthAuthUrlEvent = z.infer<typeof OAuthAuthUrlEvent>;
export type OAuthProgressEvent = z.infer<typeof OAuthProgressEvent>;
export type OAuthAwaitingCodeEvent = z.infer<typeof OAuthAwaitingCodeEvent>;
export type OAuthCompleteEvent = z.infer<typeof OAuthCompleteEvent>;
export type OAuthErrorEvent = z.infer<typeof OAuthErrorEvent>;
// Plan 02-01 (milestone 08, Phase 02) — inferred TS types for the init
// Lead subprocess lifecycle events. Phase 03 will add a client-side handler
// (handleInitEvent) that narrows on these; Phase 02 only consumes them at the
// server emit site (packages/dashboard/src/server/routes/init.ts). No
// InitEvent helper alias yet — Phase 03 may add one if the client switch
// wants it.
export type InitStartEvent = z.infer<typeof InitStartEvent>;
export type InitCompleteEvent = z.infer<typeof InitCompleteEvent>;
export type InitErrorEvent = z.infer<typeof InitErrorEvent>;
// Plan 01-02 (milestone 12, Phase 01) — inferred TS types for the Free-talk
// Mode chat lifecycle events. Plan 01-03's dashboard /api/chat route narrows
// on these when fanning Pi session events out to the SSE stream; Phase 03's
// ChatPanel store fold narrows on the same types client-side.
export type ChatStartEvent = z.infer<typeof ChatStartEvent>;
export type ChatMessageDeltaEvent = z.infer<typeof ChatMessageDelta>;
export type ChatToolCallEvent = z.infer<typeof ChatToolCall>;
export type ChatMessageEndEvent = z.infer<typeof ChatMessageEnd>;
export type ChatTokenUsageEvent = z.infer<typeof ChatTokenUsage>;
export type ChatErrorEvent = z.infer<typeof ChatError>;
export type ChatCompleteEvent = z.infer<typeof ChatComplete>;
// Plan 01-02 — ChatEvent surface mirrors the CookEvent precedent at line 602:
// Extract the chat.* variants from SnapshotEvent so dashboard reducers /
// route handlers get exhaustive narrowing on the chat lifecycle.
export type ChatEvent = Extract<SnapshotEvent, { type: `chat.${string}` }>;
export {
  CookModeSchema,
  CookAgentRoleSchema,
  CookUsageSchema,
  CookPriorityDecisionEvent as CookPriorityDecisionEventSchema,
  CookAgentSpawnEvent as CookAgentSpawnEventSchema,
  CookAgentResultEvent as CookAgentResultEventSchema,
  CookToolCallEvent as CookToolCallEventSchema,
  CookToolResultEvent as CookToolResultEventSchema,
  CookFileWriteEvent as CookFileWriteEventSchema,
  CookCommitEvent as CookCommitEventSchema,
  CookErrorEvent as CookErrorEventSchema,
  CookCompletionEvent as CookCompletionEventSchema,
  CookTaskStartEvent as CookTaskStartEventSchema,
  CookTaskCommitEvent as CookTaskCommitEventSchema,
  CookTaskCompleteEvent as CookTaskCompleteEventSchema,
  CookTaskFailEvent as CookTaskFailEventSchema,
  CookResumeEvent as CookResumeEventSchema,
  CookProviderSelectedEvent as CookProviderSelectedEventSchema,
  CookProviderFallbackEvent as CookProviderFallbackEventSchema,
  // Plan 02-01 (milestone 13, Phase 02) — Zod schema alias for the
  // `cook.ask_user_timeout` UI-cosmetic timeout event so route emitters and
  // tests can validate payloads before publishing onto the EventBus.
  CookAskUserTimeoutEvent as CookAskUserTimeoutEventSchema,
  // Phase 17 plan 04-01 — Zod schema alias for the cook.plan_update event
  // (Codex parity update_plan customTool). Route emitters / tests can
  // validate payloads before publishing onto the EventBus.
  CookPlanUpdateEvent as CookPlanUpdateEventSchema,
  // Plan 04-01 (Phase 4) — Zod schema aliases so plan 04-02's route can
  // validate the `oauth.*` payloads it publishes onto the EventBus.
  OAuthAuthUrlEvent as OAuthAuthUrlEventSchema,
  OAuthProgressEvent as OAuthProgressEventSchema,
  OAuthAwaitingCodeEvent as OAuthAwaitingCodeEventSchema,
  OAuthCompleteEvent as OAuthCompleteEventSchema,
  OAuthErrorEvent as OAuthErrorEventSchema,
  // Plan 02-01 (milestone 08, Phase 02) — Zod schema aliases for the init
  // Lead subprocess lifecycle events. Phase 02's init route uses these to
  // emit (typed) events into the JSONL channel + bus.publish; Phase 03's
  // client fold can re-use them as runtime validators if it wants.
  InitStartEvent as InitStartEventSchema,
  InitCompleteEvent as InitCompleteEventSchema,
  InitErrorEvent as InitErrorEventSchema,
  // Plan 01-02 (milestone 12, Phase 01) — Zod schema aliases for the
  // Free-talk Mode chat lifecycle events. Plan 01-03's /api/chat route uses
  // these to validate event payloads before bus.publish + writeSSE; Phase 03's
  // ChatPanel store fold may re-use them as runtime validators.
  ChatStartEvent as ChatStartEventSchema,
  ChatMessageDelta as ChatMessageDeltaSchema,
  ChatToolCall as ChatToolCallSchema,
  ChatMessageEnd as ChatMessageEndSchema,
  ChatTokenUsage as ChatTokenUsageSchema,
  ChatError as ChatErrorSchema,
  ChatComplete as ChatCompleteSchema,
};
