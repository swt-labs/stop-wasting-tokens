import { z } from 'zod';

import { HandoffError } from '../errors/SwtError.js';

import {
  HandoffEnvelopeSchema,
  HandoffMetadataSchema,
  type HandoffEnvelope,
} from './envelope.js';

const TaskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  files: z.array(z.string().min(1)).default([]),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  depends_on: z.array(z.string().min(1)).default([]),
});

export const LeadPlanPayloadSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plan: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  must_haves: z.array(z.string().min(1)).min(1),
  tasks: z.array(TaskSchema).min(1),
  /** Comma-separated REQ-IDs satisfied by this plan, or [] if none. */
  requirements: z.array(z.string().regex(/^REQ-/)).default([]),
});

export type LeadPlanPayload = z.infer<typeof LeadPlanPayloadSchema>;

export const LeadHandoffSchema = HandoffEnvelopeSchema.extend({
  kind: z.literal('lead-plan'),
  payload: LeadPlanPayloadSchema,
  metadata: HandoffMetadataSchema,
});

export type LeadHandoff = HandoffEnvelope<LeadPlanPayload> & { kind: 'lead-plan' };

export function parseLeadHandoff(input: unknown): LeadHandoff {
  const result = LeadHandoffSchema.safeParse(input);
  if (!result.success) {
    throw new HandoffError('Invalid Lead handoff', {
      cause: result.error,
      context: { kind: 'lead-plan' },
    });
  }
  return result.data as LeadHandoff;
}
