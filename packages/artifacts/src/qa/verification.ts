import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';
import { formatFrontmatter, parseFrontmatter } from '../frontmatter.js';

const ResultSchema = z.enum(['pass', 'fail', 'partial']);
export type VerificationResult = z.infer<typeof ResultSchema>;

const TierSchema = z.enum(['minimal', 'standard', 'strict']);
export type VerificationTier = z.infer<typeof TierSchema>;

const StatusSchema = z.enum(['pass', 'fail', 'partial', 'deferred']);

const CheckSchema = z.object({
  id: z.string().min(1),
  must_have: z.string().min(1),
  status: StatusSchema,
  evidence: z.string().min(1),
});

const ArtifactCheckSchema = z.object({
  id: z.string().min(1),
  artifact: z.string().min(1),
  status: StatusSchema,
  evidence: z.string().min(1),
});

const KeyLinkCheckSchema = z.object({
  id: z.string().min(1),
  link: z.string().min(1),
  status: StatusSchema,
  evidence: z.string().min(1),
});

const AntiPatternCheckSchema = z.object({
  id: z.string().min(1),
  anti_pattern: z.string().min(1),
  status: StatusSchema,
  evidence: z.string().min(1),
});

const ConventionCheckSchema = z.object({
  id: z.string().min(1),
  convention: z.string().min(1),
  status: StatusSchema,
  evidence: z.string().min(1),
});

const RequirementMappingSchema = z.object({
  req: z.string().min(1),
  phase: z.string().min(1),
  status: StatusSchema,
  evidence: z.string().default(''),
});

const LayoutSchema = z.enum(['swt', 'vbw']);
export type VerificationLayout = z.infer<typeof LayoutSchema>;

export const VerificationDocSchema = z.object({
  phase: z.string().regex(/^\d{2}$/),
  tier: TierSchema,
  result: ResultSchema,
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plans_verified: z.array(z.string().regex(/^\d{2}[a-z]?$/)).min(1),
  verified_at_commit: z.string().min(1),
  checks: z.array(CheckSchema).default([]),
  artifact_checks: z.array(ArtifactCheckSchema).default([]),
  key_link_checks: z.array(KeyLinkCheckSchema).default([]),
  anti_pattern_checks: z.array(AntiPatternCheckSchema).default([]),
  convention_checks: z.array(ConventionCheckSchema).default([]),
  requirement_mapping: z.array(RequirementMappingSchema).default([]),
  pre_existing_issues: z.array(z.string().min(1)).default([]),
  layout: LayoutSchema.default('swt'),
  body: z.string().default(''),
});

export type VerificationDoc = z.infer<typeof VerificationDocSchema>;
export type VerificationDocInput = z.input<typeof VerificationDocSchema>;

export interface WriteVerificationOptions {
  readonly phaseDir: string;
  readonly doc: VerificationDocInput;
}

export async function writeVerification(opts: WriteVerificationOptions): Promise<string> {
  const doc = VerificationDocSchema.parse(opts.doc);
  const path = join(opts.phaseDir, `${doc.phase}-VERIFICATION.md`);
  const { body, ...frontmatter } = doc;
  const renderedBody = body.length > 0 ? body : renderVerificationBody(doc);
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
  const sections = parseVerificationBody(body);
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
    checks: sections.checks,
    artifact_checks: sections.artifact_checks,
    key_link_checks: sections.key_link_checks,
    anti_pattern_checks: sections.anti_pattern_checks,
    convention_checks: sections.convention_checks,
    requirement_mapping: sections.requirement_mapping,
    pre_existing_issues: toStringArray(frontmatter.pre_existing_issues),
    layout: sections.layout,
    body,
  };
  return VerificationDocSchema.parse(normalized);
}

interface ParsedSections {
  checks: VerificationDoc['checks'];
  artifact_checks: VerificationDoc['artifact_checks'];
  key_link_checks: VerificationDoc['key_link_checks'];
  anti_pattern_checks: VerificationDoc['anti_pattern_checks'];
  convention_checks: VerificationDoc['convention_checks'];
  requirement_mapping: VerificationDoc['requirement_mapping'];
  layout: VerificationLayout;
}

export function parseVerificationBody(body: string): ParsedSections {
  const out: ParsedSections = {
    checks: [],
    artifact_checks: [],
    key_link_checks: [],
    anti_pattern_checks: [],
    convention_checks: [],
    requirement_mapping: [],
    layout: 'swt',
  };

  const lines = body.split(/\r?\n/);
  let currentSection = '';
  let pendingTable: string[][] = [];
  const flush = (): void => {
    if (pendingTable.length === 0) return;
    const rows = pendingTable;
    pendingTable = [];
    const headerSlug = currentSection.toLowerCase();
    if (headerSlug.includes('must-have') || headerSlug.includes('must have')) {
      for (const cells of rows) {
        const [id, mustHave, statusRaw, evidence] = cells;
        if (id === undefined || mustHave === undefined || evidence === undefined) continue;
        out.checks.push({
          id,
          must_have: mustHave,
          status: normalizeStatus(statusRaw ?? ''),
          evidence,
        });
      }
    } else if (headerSlug.includes('artifact')) {
      for (const cells of rows) {
        const [id, artifact, statusRaw, evidence] = cells;
        if (id === undefined || artifact === undefined || evidence === undefined) continue;
        out.artifact_checks.push({
          id,
          artifact,
          status: normalizeStatus(statusRaw ?? ''),
          evidence,
        });
      }
      out.layout = 'vbw';
    } else if (headerSlug.includes('key-link') || headerSlug.includes('key link')) {
      for (const cells of rows) {
        const [id, link, statusRaw, evidence] = cells;
        if (id === undefined || link === undefined || evidence === undefined) continue;
        out.key_link_checks.push({
          id,
          link,
          status: normalizeStatus(statusRaw ?? ''),
          evidence,
        });
      }
      out.layout = 'vbw';
    } else if (headerSlug.includes('anti-pattern') || headerSlug.includes('anti pattern')) {
      for (const cells of rows) {
        const [id, antiPattern, statusRaw, evidence] = cells;
        if (id === undefined || antiPattern === undefined || evidence === undefined) continue;
        out.anti_pattern_checks.push({
          id,
          anti_pattern: antiPattern,
          status: normalizeStatus(statusRaw ?? ''),
          evidence,
        });
      }
      out.layout = 'vbw';
    } else if (headerSlug.includes('convention')) {
      for (const cells of rows) {
        const [id, convention, statusRaw, evidence] = cells;
        if (id === undefined || convention === undefined || evidence === undefined) continue;
        out.convention_checks.push({
          id,
          convention,
          status: normalizeStatus(statusRaw ?? ''),
          evidence,
        });
      }
      out.layout = 'vbw';
    } else if (headerSlug.includes('requirement mapping') || headerSlug.includes('requirements mapping')) {
      for (const cells of rows) {
        const [req, phase, statusRaw, evidence] = cells;
        if (req === undefined || phase === undefined) continue;
        out.requirement_mapping.push({
          req,
          phase,
          status: normalizeStatus(statusRaw ?? ''),
          evidence: evidence ?? '',
        });
      }
      out.layout = 'vbw';
    } else if (currentSection.length === 0) {
      // Pre-section table — fall back to Must-Have semantics for SWT-1.0 compat.
      for (const cells of rows) {
        const [id, mustHave, statusRaw, evidence] = cells;
        if (id === undefined || mustHave === undefined || evidence === undefined) continue;
        out.checks.push({
          id,
          must_have: mustHave,
          status: normalizeStatus(statusRaw ?? ''),
          evidence,
        });
      }
    }
  };

  let inTable = false;
  for (const line of lines) {
    const sectionMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (sectionMatch !== null) {
      flush();
      currentSection = sectionMatch[1] ?? '';
      inTable = false;
      continue;
    }
    if (line.startsWith('|---') || line.startsWith('| ---')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (!line.startsWith('|')) {
        flush();
        inTable = false;
        continue;
      }
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      pendingTable.push(cells);
    }
  }
  flush();
  return out;
}

export function renderVerificationBody(doc: VerificationDoc): string {
  const lines: string[] = [];
  lines.push(`# Phase ${doc.phase} Verification`);
  lines.push('');

  if (doc.layout === 'vbw') {
    if (doc.checks.length > 0) {
      lines.push('## Must-Have Checks');
      lines.push('');
      pushTable(lines, ['ID', 'Must-have', 'Status', 'Evidence'], doc.checks, (c) => [
        c.id,
        c.must_have,
        c.status.toUpperCase(),
        c.evidence,
      ]);
    }
    if (doc.artifact_checks.length > 0) {
      lines.push('## Artifact Checks');
      lines.push('');
      pushTable(lines, ['ID', 'Artifact', 'Status', 'Evidence'], doc.artifact_checks, (c) => [
        c.id,
        c.artifact,
        c.status.toUpperCase(),
        c.evidence,
      ]);
    }
    if (doc.key_link_checks.length > 0) {
      lines.push('## Key-Link Checks');
      lines.push('');
      pushTable(lines, ['ID', 'Link', 'Status', 'Evidence'], doc.key_link_checks, (c) => [
        c.id,
        c.link,
        c.status.toUpperCase(),
        c.evidence,
      ]);
    }
    if (doc.anti_pattern_checks.length > 0) {
      lines.push('## Anti-pattern Checks');
      lines.push('');
      pushTable(lines, ['ID', 'Anti-pattern', 'Status', 'Evidence'], doc.anti_pattern_checks, (c) => [
        c.id,
        c.anti_pattern,
        c.status.toUpperCase(),
        c.evidence,
      ]);
    }
    if (doc.convention_checks.length > 0) {
      lines.push('## Convention Checks');
      lines.push('');
      pushTable(lines, ['ID', 'Convention', 'Status', 'Evidence'], doc.convention_checks, (c) => [
        c.id,
        c.convention,
        c.status.toUpperCase(),
        c.evidence,
      ]);
    }
    if (doc.requirement_mapping.length > 0) {
      lines.push('## Requirement Mapping');
      lines.push('');
      pushTable(lines, ['REQ', 'Phase', 'Status', 'Evidence'], doc.requirement_mapping, (m) => [
        m.req,
        m.phase,
        m.status.toUpperCase(),
        m.evidence,
      ]);
    }
  } else {
    if (doc.checks.length > 0) {
      lines.push('## Must-Have Checks');
      lines.push('');
      pushTable(lines, ['ID', 'Must-have', 'Status', 'Evidence'], doc.checks, (c) => [
        c.id,
        c.must_have,
        c.status.toUpperCase(),
        c.evidence,
      ]);
    }
  }

  lines.push('## Result');
  lines.push('');
  lines.push(`${doc.result.toUpperCase()} — ${doc.passed}/${doc.total} checks passed.`);
  return lines.join('\n');
}

function pushTable<T>(
  lines: string[],
  header: readonly string[],
  rows: readonly T[],
  toCells: (row: T) => readonly string[],
): void {
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`|${header.map(() => '----').join('|')}|`);
  for (const row of rows) {
    lines.push(`| ${toCells(row).map(escapePipes).join(' | ')} |`);
  }
  lines.push('');
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function normalizeStatus(raw: string): 'pass' | 'fail' | 'partial' | 'deferred' {
  const lower = raw.toLowerCase().trim().split(' ')[0] ?? 'pass';
  if (lower === 'pass' || lower === 'fail' || lower === 'partial' || lower === 'deferred') {
    return lower;
  }
  return 'pass';
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
