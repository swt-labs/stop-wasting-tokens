/**
 * Milestone 13 / Phase 01 — Unified-log discriminated union.
 *
 * Single chronological feed model that replaces the dual LogPanel + ChatPanel
 * split in `@swt-labs/dashboard`. Every reducer branch in `dashboard-store.ts`
 * that previously wrote to `state.recentLogLines` or `state.chatSession.messages`
 * is migrated to push a `LogEntry` into `state.unifiedLog`.
 *
 * Variant shapes are grounded in the reducers that already receive these events.
 * Source-line citations live in `01-RESEARCH.md` §1 (the authoritative contract);
 * each member schema below carries the same anchor as JSDoc for traceability.
 *
 * L0 invariant — this module imports ONLY `zod`. No workspace-internal deps.
 *
 * Schema-only: no IO, no `fs`/`path`, no side effects. The reducer + UI
 * consumers live in `@swt-labs/dashboard` (L7) and import `LogEntry` via
 * `import type` (`@typescript-eslint/consistent-type-imports: error`).
 */

import { z } from 'zod';

// ── init ─────────────────────────────────────────────────────────────────────
// Sourced from: handleInitEvent (dashboard-store.ts:891-927).
// The three init.* SSE events map to one kind; `status` discriminates sub-state.
export const InitLogEntrySchema = z.object({
  kind: z.literal('init'),
  id: z.string(),
  ts: z.string(),
  session_id: z.string(),
  status: z.enum(['start', 'complete', 'error']),
  message: z.string(),
  /** Set only when status === 'error' (from evt.code at init.error). */
  errorCode: z.string().optional(),
});

// ── cook-status ──────────────────────────────────────────────────────────────
// Sourced from: handleCookEvent cases that today write via appendLogLine() or
// fire lifecycle transitions (cook.priority_decision, cook.resume,
// cook.completion, cook.error). Phase 01 ADDS `budget_exceeded` /
// `budget_resume` subtypes — these were previously invisible in the UI per
// Scout Cross-Cutting Finding #1.
export const CookStatusEntrySchema = z.object({
  kind: z.literal('cook-status'),
  id: z.string(),
  ts: z.string(),
  session_id: z.string(),
  subtype: z.enum([
    'started',
    'resumed',
    'completed',
    'failed',
    'cancelled',
    'budget_exceeded',
    'budget_resume',
  ]),
  message: z.string(),
  /** CookMode from cook.priority_decision (events.ts:173-176). */
  mode: z.string().optional(),
  /** 'success' | 'failed' | 'cancelled' from cook.completion (events.ts:241-246). */
  status: z.string().optional(),
});

// ── cook-agent ───────────────────────────────────────────────────────────────
// Sourced from: handleCookEvent cook.agent_spawn + cook.agent_result. Today
// these only mutate state.activeAgents Map — Phase 01 ALSO pushes them to
// unifiedLog (two-consumer pattern per Scout §1 K-2).
export const CookAgentEntrySchema = z.object({
  kind: z.literal('cook-agent'),
  id: z.string(),
  ts: z.string(),
  session_id: z.string(),
  sub_session_id: z.string(),
  role: z.string(),
  event: z.enum(['spawn', 'result']),
  /** Present only when event === 'result'. */
  result_status: z.enum(['completed', 'failed', 'blocked']).optional(),
  cost_usd: z.number().optional(),
  elapsed_ms: z.number().optional(),
});

// ── cook-tool ────────────────────────────────────────────────────────────────
// Sourced from: handleCookEvent cook.tool_call + cook.tool_result. Today
// these only mutate activeAgents.current_tool — Phase 01 surfaces them as
// inline chips in the unified log.
export const CookToolEntrySchema = z.object({
  kind: z.literal('cook-tool'),
  id: z.string(),
  ts: z.string(),
  session_id: z.string(),
  sub_session_id: z.string(),
  tool: z.string(),
  event: z.enum(['call', 'result']),
  input_excerpt: z.string().optional(),
  result_excerpt: z.string().optional(),
  /** Present only when event === 'result'. */
  duration_ms: z.number().optional(),
});

// ── cook-ask-user ────────────────────────────────────────────────────────────
// Phase 01 declares the shape; Phase 02 wires the SSE event that populates it.
// Modeled after AgentPromptOption + AgentPromptEvent in events.ts (the wire
// format the orchestrator already uses for askUser today).
export const CookAskUserEntrySchema = z.object({
  kind: z.literal('cook-ask-user'),
  id: z.string(),
  ts: z.string(),
  session_id: z.string(),
  prompt_id: z.string(),
  question: z.string(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  status: z.enum(['pending', 'answered', 'expired']),
  /** Set once the user has answered. */
  reply: z.string().optional(),
});

// ── chat-user ────────────────────────────────────────────────────────────────
// Sourced from: startChat() optimistic user message (dashboard-store.ts:1697-1701).
// chat_session_id may be the empty string in the optimistic window before
// chat.start adoption lands the server-issued id.
export const ChatUserEntrySchema = z.object({
  kind: z.literal('chat-user'),
  id: z.string(),
  ts: z.string(),
  chat_session_id: z.string(),
  text: z.string(),
});

// ── chat-assistant ───────────────────────────────────────────────────────────
// Sourced from: chat.message_delta / chat.tool_call / chat.message_end /
// chat.token_usage (dashboard-store.ts:981-1085). The streaming pattern
// updates the LAST chat-assistant entry in place via setState path-based
// reactivity (Scout §5 streaming optimization).
export const ChatAssistantEntrySchema = z.object({
  kind: z.literal('chat-assistant'),
  id: z.string(),
  ts: z.string(),
  chat_session_id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  tools_called: z.array(z.string()).optional(),
  usage: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      provider: z.string(),
      model: z.string(),
    })
    .optional(),
});

// ── chat-error ───────────────────────────────────────────────────────────────
// Sourced from: chat.error reducer (dashboard-store.ts:1055-1075). The closed
// enum mirrors the ChatError schema at events.ts:550-561.
export const ChatErrorEntrySchema = z.object({
  kind: z.literal('chat-error'),
  id: z.string(),
  ts: z.string(),
  chat_session_id: z.string(),
  code: z.enum([
    'CHAT_AUTH_FAILED',
    'CHAT_SESSION_ERROR',
    'CHAT_PROMPT_ERROR',
    'CHAT_INVALID_REQUEST',
  ]),
  message: z.string(),
});

// ── system ───────────────────────────────────────────────────────────────────
// Covers log.append SSE events, error events, and internal appendLogLine()
// synthesized lines. Channel 'internal' is NEW per Scout §1 K-3 — distinguishes
// synthesized bookkeeping lines from real process stdout/stderr.
export const SystemEntrySchema = z.object({
  kind: z.literal('system'),
  id: z.string(),
  ts: z.string(),
  channel: z.enum(['stdout', 'stderr', 'internal']),
  line: z.string(),
  /** Set when produced from an `error` SSE event (carries evt.code). */
  errorCode: z.string().optional(),
});

/**
 * The discriminated union — exactly 9 variants. Order matches Scout §1.
 * Discriminant: `kind`.
 */
export const LogEntrySchema = z.discriminatedUnion('kind', [
  InitLogEntrySchema,
  CookStatusEntrySchema,
  CookAgentEntrySchema,
  CookToolEntrySchema,
  CookAskUserEntrySchema,
  ChatUserEntrySchema,
  ChatAssistantEntrySchema,
  ChatErrorEntrySchema,
  SystemEntrySchema,
]);

export type LogEntry = z.infer<typeof LogEntrySchema>;

// Convenience per-kind type aliases for ergonomic consumer code. Each is
// derived from the union via `Extract<>` so it stays in lockstep with the
// schemas above.
export type InitLogEntry = Extract<LogEntry, { kind: 'init' }>;
export type CookStatusEntry = Extract<LogEntry, { kind: 'cook-status' }>;
export type CookAgentEntry = Extract<LogEntry, { kind: 'cook-agent' }>;
export type CookToolEntry = Extract<LogEntry, { kind: 'cook-tool' }>;
export type CookAskUserEntry = Extract<LogEntry, { kind: 'cook-ask-user' }>;
export type ChatUserEntry = Extract<LogEntry, { kind: 'chat-user' }>;
export type ChatAssistantEntry = Extract<LogEntry, { kind: 'chat-assistant' }>;
export type ChatErrorEntry = Extract<LogEntry, { kind: 'chat-error' }>;
export type SystemEntry = Extract<LogEntry, { kind: 'system' }>;
