import { z } from 'zod';

/**
 * Plan envelope — describes one PR's worth of work within a phase. The
 * `must_haves` shape mirrors the `truths/artifacts/key_links` triad VBW
 * carries today (TDD2 §9.4); v3 extends with `claims[]` (M3 worktree
 * isolation) and `depends_on[]` (M3 DAG resolver).
 *
 * PR-04 ships the structural schema; the methodology layer's plan-builder
 * (M2 PR-12) wires it as the validator for `*-PLAN.md` frontmatter.
 */
export const PlanSchema = z.object({
  schema_version: z.literal(1),
  phase: z.number().int().positive(),
  plan: z.union([z.string(), z.number()]),
  title: z.string().min(1),
  wave: z.number().int().positive(),
  depends_on: z.array(z.string()).default([]),
  claims: z.array(z.string()).default([]),
  must_haves: z
    .object({
      truths: z.array(z.string()).default([]),
      artifacts: z
        .array(
          z.object({
            path: z.string().min(1),
            provides: z.string().min(1),
            contains: z.string().optional(),
          }),
        )
        .default([]),
      key_links: z
        .array(
          z.object({
            from: z.string().min(1),
            to: z.string().min(1),
            via: z.string().min(1),
          }),
        )
        .default([]),
    })
    .default({ truths: [], artifacts: [], key_links: [] }),
  cross_phase_deps: z.array(z.string()).default([]),
});

export type PlanSchemaT = z.infer<typeof PlanSchema>;
