import { z } from 'zod';

import { AGENT_ROLES, type AgentRole } from '../types/agent-role.js';

export const HANDOFF_KINDS = [
  'scout-findings',
  'architect-design',
  'lead-plan',
  'dev-summary',
  'qa-verification',
] as const;

export type HandoffKind = (typeof HANDOFF_KINDS)[number];

const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'must be an ISO 8601 timestamp' });

export const HandoffMetadataSchema = z.object({
  /** ISO 8601 timestamp of when the handoff was authored. */
  created_at: isoDateString,
  /** Optional opaque session id propagated by the orchestrator. */
  session_id: z.string().min(1).optional(),
  /** Optional phase number this handoff is scoped to. */
  phase: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  /** Optional plan number this handoff is scoped to. */
  plan: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
});

export type HandoffMetadata = z.infer<typeof HandoffMetadataSchema>;

export const AgentRoleSchema = z.custom<AgentRole>(
  (v) => typeof v === 'string' && (AGENT_ROLES as readonly string[]).includes(v),
  { message: 'invalid agent role' },
);

export const HandoffKindSchema = z.enum(HANDOFF_KINDS);

/**
 * Generic handoff envelope. Concrete handoff schemas wrap a typed `payload`
 * with the same outer shape so consumers can route on `kind`.
 */
export const HandoffEnvelopeSchema = z.object({
  from: AgentRoleSchema,
  to: AgentRoleSchema,
  kind: HandoffKindSchema,
  payload: z.unknown(),
  metadata: HandoffMetadataSchema,
});

export type HandoffEnvelope<TPayload = unknown> = {
  from: AgentRole;
  to: AgentRole;
  kind: HandoffKind;
  payload: TPayload;
  metadata: HandoffMetadata;
};
