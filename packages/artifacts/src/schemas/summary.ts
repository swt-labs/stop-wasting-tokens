import { z } from 'zod';

import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

export type AcVerdict = 'pass' | 'fail' | 'partial' | 'deferred';

const RawAcResultSchema = z
  .object({
    id: z.string().min(1),
    criterion: z.string().optional(),
    must_have: z.string().optional(),
    verdict: z.string().optional(),
    status: z.string().optional(),
    evidence: z.string().optional(),
  })
  .passthrough();

export const AcResultSchema = RawAcResultSchema.transform((raw) => ({
  id: raw.id,
  criterion: (raw.criterion ?? raw.must_have ?? '').trim(),
  verdict: normalizeVerdict(raw.verdict ?? raw.status ?? 'pass'),
  evidence: (raw.evidence ?? '').trim(),
}));

export type AcResult = z.infer<typeof AcResultSchema>;

const RawDeviationSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().optional(),
    description: z.string().min(1),
    rationale: z.string().optional(),
    resolution: z.string().optional(),
  })
  .passthrough();

export const DeviationSchema = RawDeviationSchema.transform((raw) => {
  const out: { id: string; type?: string; description: string; resolution?: string } = {
    id: raw.id,
    description: raw.description,
  };
  if (raw.type !== undefined) out.type = raw.type;
  const resolution = raw.resolution ?? raw.rationale;
  if (resolution !== undefined) out.resolution = resolution;
  return out;
});

export type Deviation = z.infer<typeof DeviationSchema>;

export const SummaryFrontmatterSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plan: z.string().regex(/^\d{2}[a-z]?$/),
  title: z.string().min(1),
  status: z.enum(['complete', 'partial', 'failed', 'in-progress']),
  completed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks_completed: z.number().int().nonnegative(),
  tasks_total: z.number().int().nonnegative(),
  ac_results: z.array(AcResultSchema).default([]),
  pre_existing_issues: z.array(z.string()).default([]),
  commit_hashes: z.array(z.string()).default([]),
  files_modified: z.array(z.string()).default([]),
  deviations: z.array(DeviationSchema).default([]),
  deferred_to_followup: z.array(z.string()).default([]),
});

export type SummaryFrontmatter = z.infer<typeof SummaryFrontmatterSchema>;

export interface ParsedSummary {
  readonly frontmatter: SummaryFrontmatter;
  readonly body: string;
}

export function readSummaryFrontmatter(raw: string): ParsedSummary {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  return {
    frontmatter: SummaryFrontmatterSchema.parse(coerceSummary(frontmatter)),
    body,
  };
}

export function writeSummaryFrontmatter(fm: SummaryFrontmatter, body = ''): string {
  const ordered: Record<string, unknown> = {
    phase: fm.phase,
    plan: fm.plan,
    title: fm.title,
    status: fm.status,
    completed: fm.completed,
    tasks_completed: fm.tasks_completed,
    tasks_total: fm.tasks_total,
  };
  if (fm.ac_results.length > 0) ordered.ac_results = fm.ac_results;
  if (fm.pre_existing_issues.length > 0) ordered.pre_existing_issues = fm.pre_existing_issues;
  if (fm.commit_hashes.length > 0) ordered.commit_hashes = fm.commit_hashes;
  if (fm.files_modified.length > 0) ordered.files_modified = fm.files_modified;
  if (fm.deviations.length > 0) ordered.deviations = fm.deviations;
  if (fm.deferred_to_followup.length > 0) ordered.deferred_to_followup = fm.deferred_to_followup;
  return formatFrontmatter(ordered, body);
}

function coerceSummary(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (typeof out.tasks_completed === 'string' && /^\d+$/.test(out.tasks_completed)) {
    out.tasks_completed = Number.parseInt(out.tasks_completed, 10);
  }
  if (typeof out.tasks_total === 'string' && /^\d+$/.test(out.tasks_total)) {
    out.tasks_total = Number.parseInt(out.tasks_total, 10);
  }
  return out;
}

function normalizeVerdict(raw: string): AcVerdict {
  const lower = raw.trim().toLowerCase();
  if (lower === 'pass' || lower === 'fail' || lower === 'partial' || lower === 'deferred') {
    return lower;
  }
  if (lower.startsWith('pass')) return 'pass';
  if (lower.startsWith('fail')) return 'fail';
  if (lower.startsWith('partial')) return 'partial';
  if (lower.startsWith('defer')) return 'deferred';
  return 'pass';
}
