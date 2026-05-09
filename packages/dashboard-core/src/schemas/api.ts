import { z } from 'zod';

import { SnapshotEventSchema } from './events.js';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime_ms: z.number().int().nonnegative(),
  schema_version: z.literal('1'),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const DebugEmitBodySchema = SnapshotEventSchema;
export type DebugEmitBody = z.infer<typeof DebugEmitBodySchema>;

export const DebugEmitResponseSchema = z.object({
  queued: z.literal(true),
});
export type DebugEmitResponse = z.infer<typeof DebugEmitResponseSchema>;

export const UatCheckpointBodySchema = z.object({
  scenario: z.string().min(1),
  result: z.enum(['pass', 'fail']),
  note: z.string().optional(),
});
export type UatCheckpointBody = z.infer<typeof UatCheckpointBodySchema>;

export const UatCheckpointResponseSchema = z.object({
  saved: z.literal(true),
  path: z.string().min(1),
});
export type UatCheckpointResponse = z.infer<typeof UatCheckpointResponseSchema>;

export const InitBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type InitBody = z.infer<typeof InitBodySchema>;

export const InitResponseSchema = z.object({
  initialized: z.literal(true),
  root: z.string().min(1),
  files: z.array(z.string().min(1)),
});
export type InitResponse = z.infer<typeof InitResponseSchema>;

export const CommandBodySchema = z.object({
  input: z.string().min(1).max(500),
});
export type CommandBody = z.infer<typeof CommandBodySchema>;

export const CommandResponseSchema = z.object({
  ok: z.boolean(),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number().int().nonnegative(),
});
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

export const ApiSchemas = {
  '/api/health': {
    method: 'GET',
    response: HealthResponseSchema,
  },
  '/api/_debug/emit': {
    method: 'POST',
    body: DebugEmitBodySchema,
    response: DebugEmitResponseSchema,
  },
  '/api/events': {
    method: 'GET',
    sse: SnapshotEventSchema,
  },
  '/api/uat/:phase/checkpoint': {
    method: 'POST',
    body: UatCheckpointBodySchema,
    response: UatCheckpointResponseSchema,
  },
  '/api/init': {
    method: 'POST',
    body: InitBodySchema,
    response: InitResponseSchema,
  },
  '/api/command': {
    method: 'POST',
    body: CommandBodySchema,
    response: CommandResponseSchema,
  },
} as const;
export type ApiSchemaMap = typeof ApiSchemas;
