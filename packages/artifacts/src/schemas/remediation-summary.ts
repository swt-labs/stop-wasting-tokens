import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

import { DeviationSchema } from './summary.js';

export const RemediationSummaryFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  round: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  status: z.enum(['complete', 'partial', 'failed', 'in-progress']),
  completed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks_completed: z.number().int().nonnegative(),
  tasks_total: z.number().int().nonnegative(),
  commit_hashes: z.array(z.string()).default([]),
  files_modified: z.array(z.string()).default([]),
  deviations: z.array(DeviationSchema).default([]),
  known_issue_outcomes: z.array(z.string()).default([]),
});

export type RemediationSummaryFrontmatter = z.infer<typeof RemediationSummaryFrontmatterSchema>;

export interface ParsedRemediationSummary {
  readonly frontmatter: RemediationSummaryFrontmatter;
  readonly body: string;
}

export function readRemediationSummaryFrontmatter(raw: string): ParsedRemediationSummary {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: RemediationSummaryFrontmatterSchema.parse(coerce(frontmatter)),
    body,
  };
}

export function writeRemediationSummaryFrontmatter(
  fm: RemediationSummaryFrontmatter,
  body = '',
): string {
  const ordered: Record<string, unknown> = {
    phase: fm.phase,
    round: fm.round,
    title: fm.title,
    status: fm.status,
    completed: fm.completed,
    tasks_completed: fm.tasks_completed,
    tasks_total: fm.tasks_total,
  };
  if (fm.commit_hashes.length > 0) ordered.commit_hashes = fm.commit_hashes;
  if (fm.files_modified.length > 0) ordered.files_modified = fm.files_modified;
  if (fm.deviations.length > 0) ordered.deviations = fm.deviations;
  if (fm.known_issue_outcomes.length > 0) ordered.known_issue_outcomes = fm.known_issue_outcomes;
  return formatFrontmatter(ordered, body);
}

function coerce(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (typeof out.tasks_completed === 'string' && /^\d+$/.test(out.tasks_completed)) {
    out.tasks_completed = Number.parseInt(out.tasks_completed, 10);
  }
  if (typeof out.tasks_total === 'string' && /^\d+$/.test(out.tasks_total)) {
    out.tasks_total = Number.parseInt(out.tasks_total, 10);
  }
  return out;
}
