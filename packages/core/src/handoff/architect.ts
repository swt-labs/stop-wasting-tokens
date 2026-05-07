import { z } from 'zod';

import { HandoffError } from '../errors/SwtError.js';

import {
  HandoffEnvelopeSchema,
  HandoffMetadataSchema,
  type HandoffEnvelope,
} from './envelope.js';

export const ArchitectDesignPayloadSchema = z.object({
  goal: z.string().min(1),
  decisions: z
    .array(
      z.object({
        id: z.string().min(1),
        decision: z.string().min(1),
        rationale: z.string().min(1),
        alternatives_considered: z.array(z.string().min(1)).default([]),
      }),
    )
    .min(1),
  risks: z.array(z.string().min(1)).default([]),
  follow_up: z.array(z.string().min(1)).default([]),
});

export type ArchitectDesignPayload = z.infer<typeof ArchitectDesignPayloadSchema>;

export const ArchitectHandoffSchema = HandoffEnvelopeSchema.extend({
  kind: z.literal('architect-design'),
  payload: ArchitectDesignPayloadSchema,
  metadata: HandoffMetadataSchema,
});

export type ArchitectHandoff = HandoffEnvelope<ArchitectDesignPayload> & {
  kind: 'architect-design';
};

export function parseArchitectHandoff(input: unknown): ArchitectHandoff {
  const result = ArchitectHandoffSchema.safeParse(input);
  if (!result.success) {
    throw new HandoffError('Invalid Architect handoff', {
      cause: result.error,
      context: { kind: 'architect-design' },
    });
  }
  return result.data;
}
