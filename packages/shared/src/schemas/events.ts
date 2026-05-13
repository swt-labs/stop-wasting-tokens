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
] as const;
