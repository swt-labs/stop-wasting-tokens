import { z } from 'zod';

export const StateCurrentPhaseSchema = z.object({
  position: z.string().regex(/^\d{2}$/),
  total: z.string().regex(/^\d{2}$/),
  name: z.string().min(1),
  plans_done: z.number().int().nonnegative().default(0),
  plans_total: z.number().int().nonnegative().default(0),
  progress_pct: z.number().min(0).max(100).default(0),
  status: z.enum(['ready', 'active', 'needs_remediation', 'complete']).default('ready'),
});

export type StateCurrentPhase = z.infer<typeof StateCurrentPhaseSchema>;

export const StateSchema = z
  .object({
    project: z.string().min(1),
    milestone: z.string().min(1).optional(),
    current_phase: StateCurrentPhaseSchema.optional(),
    todos: z.array(z.string()).default([]),
    blockers: z.array(z.string()).default([]),
    activity_log: z.array(z.string()).default([]),
  })
  .passthrough();

export type State = z.infer<typeof StateSchema>;
