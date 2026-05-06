import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

export const FailClassificationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['code-fix', 'plan-amendment', 'process-exception']),
  rationale: z.string().min(1),
  source_plan: z.string().optional(),
});

export type FailClassification = z.infer<typeof FailClassificationSchema>;

export const RemediationPlanFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  round: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  tasks_total: z.number().int().nonnegative(),
  fail_classifications: z.array(FailClassificationSchema).default([]),
  known_issues_input: z.array(z.string()).default([]),
  known_issue_resolutions: z.array(z.string()).default([]),
});

export type RemediationPlanFrontmatter = z.infer<typeof RemediationPlanFrontmatterSchema>;

export interface ParsedRemediationPlan {
  readonly frontmatter: RemediationPlanFrontmatter;
  readonly body: string;
}

export function readRemediationPlanFrontmatter(raw: string): ParsedRemediationPlan {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: RemediationPlanFrontmatterSchema.parse(coerce(frontmatter)),
    body,
  };
}

export function writeRemediationPlanFrontmatter(
  fm: RemediationPlanFrontmatter,
  body = '',
): string {
  const ordered: Record<string, unknown> = {
    phase: fm.phase,
    round: fm.round,
    title: fm.title,
    tasks_total: fm.tasks_total,
  };
  if (fm.fail_classifications.length > 0) ordered.fail_classifications = fm.fail_classifications;
  if (fm.known_issues_input.length > 0) ordered.known_issues_input = fm.known_issues_input;
  if (fm.known_issue_resolutions.length > 0) {
    ordered.known_issue_resolutions = fm.known_issue_resolutions;
  }
  return formatFrontmatter(ordered, body);
}

function coerce(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (typeof out.tasks_total === 'string' && /^\d+$/.test(out.tasks_total)) {
    out.tasks_total = Number.parseInt(out.tasks_total, 10);
  }
  return out;
}
