import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

export const MustHaveBlockSchema = z.object({
  truths: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  key_links: z.array(z.string()).default([]),
});

export type MustHaveBlock = z.infer<typeof MustHaveBlockSchema>;

export const MustHaveSchema = z.union([z.string().min(1), MustHaveBlockSchema]);

export type MustHave = z.infer<typeof MustHaveSchema>;

const PlanIdSchema = z.string().regex(/^\d{2}[a-z]?$/);

export const PlanFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plan: PlanIdSchema,
  title: z.string().min(1),
  wave: z.number().int().positive(),
  depends_on: z.array(z.string()).default([]),
  must_haves: z.array(MustHaveSchema).min(1),
  cross_phase_deps: z.array(z.string()).default([]),
  effort_override: z.enum(['thorough', 'balanced', 'fast', 'turbo']).optional(),
  forbidden_commands: z.array(z.string()).default([]),
  skills_used: z.array(z.string()).default([]),
  files_modified: z.array(z.string()).default([]),
  acceptance_criteria: z.string().optional(),
  deferred_to_followup: z.array(z.string()).default([]),
});

export type PlanFrontmatter = z.infer<typeof PlanFrontmatterSchema>;

export interface ParsedPlan {
  readonly frontmatter: PlanFrontmatter;
  readonly body: string;
}

export function readPlanFrontmatter(raw: string): ParsedPlan {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: PlanFrontmatterSchema.parse(coercePlan(frontmatter)),
    body,
  };
}

export function writePlanFrontmatter(fm: PlanFrontmatter, body = ''): string {
  const ordered: Record<string, unknown> = {
    phase: fm.phase,
    plan: fm.plan,
    title: fm.title,
    wave: fm.wave,
    depends_on: fm.depends_on,
    must_haves: fm.must_haves,
  };
  if (fm.cross_phase_deps.length > 0) ordered.cross_phase_deps = fm.cross_phase_deps;
  if (fm.effort_override !== undefined) ordered.effort_override = fm.effort_override;
  if (fm.forbidden_commands.length > 0) ordered.forbidden_commands = fm.forbidden_commands;
  if (fm.skills_used.length > 0) ordered.skills_used = fm.skills_used;
  if (fm.files_modified.length > 0) ordered.files_modified = fm.files_modified;
  if (fm.acceptance_criteria !== undefined) ordered.acceptance_criteria = fm.acceptance_criteria;
  if (fm.deferred_to_followup.length > 0) ordered.deferred_to_followup = fm.deferred_to_followup;
  return formatFrontmatter(ordered, body);
}

function coercePlan(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (typeof out.wave === 'string' && /^\d+$/.test(out.wave)) {
    out.wave = Number.parseInt(out.wave, 10);
  }
  if (Array.isArray(out.must_haves)) {
    out.must_haves = (out.must_haves as readonly unknown[]).map((m: unknown) => {
      if (typeof m === 'object' && m !== null && 'truths' in m) {
        return MustHaveBlockSchema.parse(m);
      }
      return m;
    });
  }
  return out;
}
