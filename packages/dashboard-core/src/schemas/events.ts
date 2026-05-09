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
  changed: z.array(z.enum(['phase', 'agents', 'artifacts', 'cost'])).min(1),
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

export const SnapshotEventSchema = z.discriminatedUnion('type', [
  SnapshotReplaceEvent,
  StateChangedEvent,
  AgentSpawnEvent,
  AgentCompleteEvent,
  LogAppendEvent,
  ErrorEvent,
]);
export type SnapshotEvent = z.infer<typeof SnapshotEventSchema>;

export const SNAPSHOT_EVENT_TYPES = [
  'snapshot.replace',
  'state.changed',
  'agent.spawn',
  'agent.complete',
  'log.append',
  'error',
] as const;
