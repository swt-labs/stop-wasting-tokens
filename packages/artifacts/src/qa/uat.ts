import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';
import { formatFrontmatter, parseFrontmatter, safeStringify } from '../frontmatter.js';

const SeveritySchema = z.enum(['critical', 'major', 'minor', 'cosmetic']);
export type IssueSeverity = z.infer<typeof SeveritySchema>;

const TestStatusSchema = z.enum(['pass', 'fail', 'skipped', 'deferred']);
export type UatTestStatus = z.infer<typeof TestStatusSchema>;

const StatusSchema = z.enum(['complete', 'partial', 'failed', 'in-progress']);
export type UatStatus = z.infer<typeof StatusSchema>;

export const UatTestSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  status: TestStatusSchema,
  notes: z.string().default(''),
});

export const UatIssueSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  summary: z.string().min(1),
  details: z.string().default(''),
});

export const SeverityCountsSchema = z
  .object({
    critical: z.number().int().nonnegative().default(0),
    major: z.number().int().nonnegative().default(0),
    minor: z.number().int().nonnegative().default(0),
    cosmetic: z.number().int().nonnegative().default(0),
  })
  .default({ critical: 0, major: 0, minor: 0, cosmetic: 0 });

export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;

export const UatDocSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  plan_count: z.number().int().nonnegative(),
  status: StatusSchema,
  started: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  completed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_tests: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  issues: z.number().int().nonnegative(),
  severity_counts: SeverityCountsSchema,
  tests: z.array(UatTestSchema).default([]),
  issue_records: z.array(UatIssueSchema).default([]),
  body: z.string().default(''),
});

export function deriveSeverityCounts(issues: readonly UatIssue[]): SeverityCounts {
  const out: SeverityCounts = { critical: 0, major: 0, minor: 0, cosmetic: 0 };
  for (const issue of issues) {
    out[issue.severity] += 1;
  }
  return out;
}

export type UatDoc = z.infer<typeof UatDocSchema>;
export type UatDocInput = z.input<typeof UatDocSchema>;
export type UatTest = z.infer<typeof UatTestSchema>;
export type UatIssue = z.infer<typeof UatIssueSchema>;

export interface WriteUatOptions {
  readonly phaseDir: string;
  readonly doc: UatDocInput;
  /** Optional override path (used by re-verify round-dir layouts). */
  readonly path?: string;
}

export async function writeUat(opts: WriteUatOptions): Promise<string> {
  const doc = UatDocSchema.parse(opts.doc);
  const path = opts.path ?? join(opts.phaseDir, `${doc.phase}-UAT.md`);
  const counts = doc.severity_counts ?? deriveSeverityCounts(doc.issue_records);
  const ordered: Record<string, unknown> = {
    phase: doc.phase,
    plan_count: doc.plan_count,
    status: doc.status,
    started: doc.started,
    completed: doc.completed,
    total_tests: doc.total_tests,
    passed: doc.passed,
    skipped: doc.skipped,
    issues: doc.issues,
  };
  if (counts.critical + counts.major + counts.minor + counts.cosmetic > 0) {
    ordered.severity_counts = counts;
  }
  const docWithCounts = { ...doc, severity_counts: counts };
  const body = doc.body.length > 0 ? doc.body : renderDefaultBody(docWithCounts);
  await writeAtomically(path, formatFrontmatter(ordered, body));
  return path;
}

export async function readUat(phaseDir: string, phase: string): Promise<UatDoc> {
  const path = join(phaseDir, `${phase}-UAT.md`);
  const raw = await readFile(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  const normalized = {
    phase: safeStringify(frontmatter.phase) || phase,
    plan_count: Number(frontmatter.plan_count ?? 0),
    status: (frontmatter.status as UatStatus | undefined) ?? 'complete',
    started: safeStringify(frontmatter.started) || safeStringify(frontmatter.completed),
    completed: safeStringify(frontmatter.completed) || safeStringify(frontmatter.started),
    total_tests: Number(frontmatter.total_tests ?? 0),
    passed: Number(frontmatter.passed ?? 0),
    skipped: Number(frontmatter.skipped ?? 0),
    issues: Number(frontmatter.issues ?? 0),
    tests: [],
    issue_records: [],
    body,
  };
  return UatDocSchema.parse(normalized);
}

function renderDefaultBody(doc: UatDoc): string {
  const lines: string[] = [];
  lines.push(`# Phase ${doc.phase} UAT`);
  lines.push('');
  if (doc.tests.length > 0) {
    lines.push('## Tests');
    lines.push('');
    lines.push('| ID | Description | Status | Notes |');
    lines.push('|----|-------------|--------|-------|');
    for (const t of doc.tests) {
      lines.push(
        `| ${t.id} | ${escapePipes(t.description)} | ${t.status.toUpperCase()} | ${escapePipes(t.notes)} |`,
      );
    }
    lines.push('');
  }
  if (doc.issue_records.length > 0) {
    lines.push('## Issues');
    lines.push('');
    const counts = doc.severity_counts ?? deriveSeverityCounts(doc.issue_records);
    if (counts.critical + counts.major + counts.minor + counts.cosmetic > 0) {
      const parts = [
        counts.critical > 0 ? `${counts.critical} critical` : '',
        counts.major > 0 ? `${counts.major} major` : '',
        counts.minor > 0 ? `${counts.minor} minor` : '',
        counts.cosmetic > 0 ? `${counts.cosmetic} cosmetic` : '',
      ].filter((s) => s.length > 0);
      lines.push(`Severity Mix: ${parts.join(', ')}`);
      lines.push('');
    }
    for (const issue of doc.issue_records) {
      lines.push(`### ${issue.id} — ${issue.severity.toUpperCase()}`);
      lines.push('');
      lines.push(issue.summary);
      if (issue.details.length > 0) {
        lines.push('');
        lines.push(issue.details);
      }
      lines.push('');
    }
  }
  lines.push('## Result');
  lines.push('');
  lines.push(
    `${doc.status.toUpperCase()} — ${doc.passed}/${doc.total_tests} tests passed, ${doc.issues} issues.`,
  );
  return lines.join('\n');
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}
