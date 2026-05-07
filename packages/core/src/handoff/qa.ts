import { z } from 'zod';

import { HandoffError } from '../errors/SwtError.js';

import {
  HandoffEnvelopeSchema,
  HandoffMetadataSchema,
  type HandoffEnvelope,
} from './envelope.js';

const CheckSchema = z.object({
  id: z.string().min(1),
  must_have: z.string().min(1),
  status: z.enum(['pass', 'fail', 'partial', 'deferred']),
  evidence: z.string().min(1),
});

export const QaVerificationPayloadSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plans_verified: z.array(z.string().regex(/^\d{2}$/)).min(1),
  result: z.enum(['pass', 'fail', 'partial']),
  checks: z.array(CheckSchema).min(1),
  /** Tracked phase known issues that survived this run. */
  pre_existing_issues: z.array(z.string().min(1)).default([]),
});

export type QaVerificationPayload = z.infer<typeof QaVerificationPayloadSchema>;

export const QaHandoffSchema = HandoffEnvelopeSchema.extend({
  kind: z.literal('qa-verification'),
  payload: QaVerificationPayloadSchema,
  metadata: HandoffMetadataSchema,
});

export type QaHandoff = HandoffEnvelope<QaVerificationPayload> & { kind: 'qa-verification' };

export function parseQaHandoff(input: unknown): QaHandoff {
  const result = QaHandoffSchema.safeParse(input);
  if (!result.success) {
    throw new HandoffError('Invalid QA handoff', {
      cause: result.error,
      context: { kind: 'qa-verification' },
    });
  }
  return result.data;
}
