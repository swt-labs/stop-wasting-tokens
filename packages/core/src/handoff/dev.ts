import { z } from 'zod';

import { HandoffError } from '../errors/SwtError.js';

import {
  HandoffEnvelopeSchema,
  HandoffMetadataSchema,
  type HandoffEnvelope,
} from './envelope.js';

const DeviationSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
});

export const DevSummaryPayloadSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plan: z.string().regex(/^\d{2}$/),
  status: z.enum(['complete', 'partial', 'failed']),
  tasks_completed: z.number().int().nonnegative(),
  tasks_total: z.number().int().positive(),
  files_modified: z.array(z.string().min(1)).default([]),
  commit_hashes: z.array(z.string().min(7).max(64)).default([]),
  deviations: z.array(DeviationSchema).default([]),
});

export type DevSummaryPayload = z.infer<typeof DevSummaryPayloadSchema>;

export const DevHandoffSchema = HandoffEnvelopeSchema.extend({
  kind: z.literal('dev-summary'),
  payload: DevSummaryPayloadSchema,
  metadata: HandoffMetadataSchema,
});

export type DevHandoff = HandoffEnvelope<DevSummaryPayload> & { kind: 'dev-summary' };

export function parseDevHandoff(input: unknown): DevHandoff {
  const result = DevHandoffSchema.safeParse(input);
  if (!result.success) {
    throw new HandoffError('Invalid Dev handoff', {
      cause: result.error,
      context: { kind: 'dev-summary' },
    });
  }
  return result.data as DevHandoff;
}
