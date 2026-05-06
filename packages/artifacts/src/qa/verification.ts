import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';
import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

const ResultSchema = z.enum(['pass', 'fail', 'partial']);
export type VerificationResult = z.infer<typeof ResultSchema>;

const TierSchema = z.enum(['minimal', 'standard', 'strict']);
export type VerificationTier = z.infer<typeof TierSchema>;

const CheckSchema = z.object({
  id: z.string().min(1),
  must_have: z.string().min(1),
  status: z.enum(['pass', 'fail', 'partial', 'deferred']),
  evidence: z.string().min(1),
});

export const VerificationDocSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  tier: TierSchema,
  result: ResultSchema,
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plans_verified: z.array(z.string().regex(/^\d{2}$/)).min(1),
  verified_at_commit: z.string().min(1),
  checks: z.array(CheckSchema).default([]),
  pre_existing_issues: z.array(z.string().min(1)).default([]),
  body: z.string().default(''),
});

export type VerificationDoc = z.infer<typeof VerificationDocSchema>;

export interface WriteVerificationOptions {
  readonly phaseDir: string;
  readonly doc: VerificationDoc;
}

export async function writeVerification(opts: WriteVerificationOptions): Promise<string> {
  const path = join(opts.phaseDir, `${opts.doc.phase}-VERIFICATION.md`);
  const { body, ...frontmatter } = opts.doc;
  const renderedBody = body.length > 0 ? body : renderDefaultBody(opts.doc);
  const ordered: Record<string, unknown> = {
    phase: frontmatter.phase,
    tier: frontmatter.tier,
    result: frontmatter.result.toUpperCase(),
    passed: frontmatter.passed,
    failed: frontmatter.failed,
    total: frontmatter.total,
    date: frontmatter.date,
    plans_verified: frontmatter.plans_verified,
    verified_at_commit: frontmatter.verified_at_commit,
  };
  if (frontmatter.pre_existing_issues.length > 0) {
    ordered.pre_existing_issues = frontmatter.pre_existing_issues;
  }
  await writeAtomically(path, formatFrontmatter(ordered, renderedBody));
  return path;
}

export async function readVerification(
  phaseDir: string,
  phase: string,
): Promise<VerificationDoc> {
  const path = join(phaseDir, `${phase}-VERIFICATION.md`);
  const raw = await readFile(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw);
  const normalized = {
    phase: String(frontmatter.phase ?? phase),
    tier: String(frontmatter.tier ?? 'standard') as VerificationTier,
    result: String(frontmatter.result ?? 'pass').toLowerCase() as VerificationResult,
    passed: Number(frontmatter.passed ?? 0),
    failed: Number(frontmatter.failed ?? 0),
    total: Number(frontmatter.total ?? 0),
    date: String(frontmatter.date ?? ''),
    plans_verified: toStringArray(frontmatter.plans_verified),
    verified_at_commit: String(frontmatter.verified_at_commit ?? ''),
    checks: parseChecksFromBody(body),
    pre_existing_issues: toStringArray(frontmatter.pre_existing_issues),
    body,
  };
  return VerificationDocSchema.parse(normalized);
}

function renderDefaultBody(doc: VerificationDoc): string {
  const lines: string[] = [];
  lines.push(`# Phase ${doc.phase} Verification`);
  lines.push('');
  if (doc.checks.length > 0) {
    lines.push('## Must-Have Checks');
    lines.push('');
    lines.push('| ID | Must-have | Status | Evidence |');
    lines.push('|----|-----------|--------|----------|');
    for (const c of doc.checks) {
      lines.push(
        `| ${c.id} | ${escapePipes(c.must_have)} | ${c.status.toUpperCase()} | ${escapePipes(c.evidence)} |`,
      );
    }
    lines.push('');
  }
  lines.push('## Result');
  lines.push('');
  lines.push(`${doc.result.toUpperCase()} — ${doc.passed}/${doc.total} checks passed.`);
  return lines.join('\n');
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function parseChecksFromBody(
  body: string,
): { id: string; must_have: string; status: 'pass' | 'fail' | 'partial' | 'deferred'; evidence: string }[] {
  const result: {
    id: string;
    must_have: string;
    status: 'pass' | 'fail' | 'partial' | 'deferred';
    evidence: string;
  }[] = [];
  const lines = body.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith('|---') || line.startsWith('| ---')) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const id = cells[0];
    const mustHave = cells[1];
    const statusRaw = (cells[2] ?? '').toLowerCase();
    const evidence = cells[3];
    if (id === undefined || mustHave === undefined || evidence === undefined) continue;
    const statusBase = statusRaw.split(' ')[0] ?? 'pass';
    const statusKey: 'pass' | 'fail' | 'partial' | 'deferred' = (
      ['pass', 'fail', 'partial', 'deferred'] as const
    ).includes(statusBase as 'pass' | 'fail' | 'partial' | 'deferred')
      ? (statusBase as 'pass' | 'fail' | 'partial' | 'deferred')
      : 'pass';
    result.push({ id, must_have: mustHave, status: statusKey, evidence });
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
}
