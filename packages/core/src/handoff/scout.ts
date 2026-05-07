import { z } from 'zod';

import { HandoffError } from '../errors/SwtError.js';

import {
  HandoffEnvelopeSchema,
  HandoffMetadataSchema,
  type HandoffEnvelope,
} from './envelope.js';

const FindingSchema = z.object({
  topic: z.string().min(1),
  summary: z.string().min(1),
  /** Files / URLs / docs the Scout consulted. */
  sources: z.array(z.string().min(1)).min(0),
  /**
   * Topics requiring a follow-up live validation by Dev/Debugger that Scout
   * could not perform safely (e.g. authenticated APIs).
   */
  requires_live_validation: z.boolean().default(false),
});

export const ScoutFindingsPayloadSchema = z.object({
  goal: z.string().min(1),
  findings: z.array(FindingSchema).min(1),
  open_questions: z.array(z.string().min(1)).default([]),
});

export type ScoutFindingsPayload = z.infer<typeof ScoutFindingsPayloadSchema>;

export const ScoutHandoffSchema = HandoffEnvelopeSchema.extend({
  kind: z.literal('scout-findings'),
  payload: ScoutFindingsPayloadSchema,
  metadata: HandoffMetadataSchema,
});

export type ScoutHandoff = HandoffEnvelope<ScoutFindingsPayload> & {
  kind: 'scout-findings';
};

export function parseScoutHandoff(input: unknown): ScoutHandoff {
  const result = ScoutHandoffSchema.safeParse(input);
  if (!result.success) {
    throw new HandoffError('Invalid Scout handoff', {
      cause: result.error,
      context: { kind: 'scout-findings' },
    });
  }
  return result.data;
}
