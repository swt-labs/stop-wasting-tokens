import { z } from 'zod';

export const PhaseEntrySchema = z.object({
  position: z.string().regex(/^\d{2}$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  goal: z.string().min(1),
  requirements: z.array(z.string()).default([]),
  success_criteria: z.array(z.string()).default([]),
  status: z.enum(['pending', 'planned', 'in-progress', 'complete']).default('pending'),
});

export type PhaseEntry = z.infer<typeof PhaseEntrySchema>;

export const RoadmapSchema = z.object({
  project_name: z.string().min(1),
  // 0 phases is the valid initial state right after `swt vibe` bootstraps a
  // project — the user has named the project + described it, but hasn't
  // scoped any phases yet. Scope mode adds phases.
  phases: z.array(PhaseEntrySchema).min(0),
});

export type Roadmap = z.infer<typeof RoadmapSchema>;
