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
] as const;

// Plan 04-01 — CookEvent surface. Inferred from the discriminated-union so
// downstream consumers (cook.ts emitter, dashboard reducer at plan 04-02,
// SPA fold at plan 04-03) get exhaustive narrowing for `cook.*` variants.
export type CookEvent = Extract<SnapshotEvent, { type: `cook.${string}` }>;
export type CookMode = z.infer<typeof CookModeSchema>;
export type CookEventAgentRole = z.infer<typeof CookAgentRoleSchema>;
export type CookUsage = z.infer<typeof CookUsageSchema>;
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
};
