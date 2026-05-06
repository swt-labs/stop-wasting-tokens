import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';
import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

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
  tests: z.array(UatTestSchema).default([]),
  issue_records: z.array(UatIssueSchema).default([]),
  body: z.string().default(''),
});

export type UatDoc = z.infer<typeof UatDocSchema>;
export type UatTest = z.infer<typeof UatTestSchema>;
export type UatIssue = z.infer<typeof UatIssueSchema>;

export interface WriteUatOptions {
  readonly phaseDir: string;
  readonly doc: UatDoc;
  /** Optional override path (used by re-verify round-dir layouts). */
  readonly path?: string;
}

export async function writeUat(opts: WriteUatOptions): Promise<string> {
  const path = opts.path ?? join(opts.phaseDir, `${opts.doc.phase}-UAT.md`);
  const ordered: Record<string, unknown> = {
    phase: opts.doc.phase,
    plan_count: opts.doc.plan_count,
    status: opts.doc.status,
    started: opts.doc.started,
    completed: opts.doc.completed,
    total_tests: opts.doc.total_tests,
    passed: opts.doc.passed,
    skipped: opts.doc.skipped,
    issues: opts.doc.issues,
  };
  const body = opts.doc.body.length > 0 ? opts.doc.body : renderDefaultBody(opts.doc);
  await writeAtomically(path, formatFrontmatter(ordered, body));
  return path;
}

export async function readUat(phaseDir: string, phase: string): Promise<UatDoc> {
  const path = join(phaseDir, `${phase}-UAT.md`);
  const raw = await readFile(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  const normalized = {
    phase: String(frontmatter.phase ?? phase),
    plan_count: Number(frontmatter.plan_count ?? 0),
    status: (frontmatter.status as UatStatus | undefined) ?? 'complete',
    started: String(frontmatter.started ?? frontmatter.completed ?? ''),
    completed: String(frontmatter.completed ?? frontmatter.started ?? ''),
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
