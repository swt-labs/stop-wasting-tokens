import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { writeAtomically } from '../atomic-write.js';

const SeveritySchema = z.enum(['critical', 'major', 'minor', 'cosmetic']);
const StatusSchema = z.enum(['open', 'resolved', 'deferred']);

export const KnownIssueSchema = z.object({
  id: z.string().min(1),
  severity: SeveritySchema,
  summary: z.string().min(1),
  opened_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: StatusSchema,
  resolution_round: z.number().int().nonnegative().optional(),
  details: z.string().optional(),
});

export type KnownIssue = z.infer<typeof KnownIssueSchema>;

export const KnownIssuesFileSchema = z.object({
  version: z.literal(1),
  issues: z.array(KnownIssueSchema),
});

export type KnownIssuesFile = z.infer<typeof KnownIssuesFileSchema>;

const FILE_NAME = 'known-issues.json';

export async function readKnownIssues(phaseDir: string): Promise<KnownIssue[]> {
  const path = join(phaseDir, FILE_NAME);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = KnownIssuesFileSchema.parse(JSON.parse(raw));
    return parsed.issues;
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

export async function writeKnownIssues(phaseDir: string, issues: KnownIssue[]): Promise<string> {
  const path = join(phaseDir, FILE_NAME);
  const sorted = [...issues].sort((a, b) => a.id.localeCompare(b.id));
  const file: KnownIssuesFile = { version: 1, issues: sorted };
  await writeAtomically(path, `${JSON.stringify(file, null, 2)}\n`);
  return path;
}

export function addIssue(existing: KnownIssue[], issue: KnownIssue): KnownIssue[] {
  if (existing.some((e) => e.id === issue.id)) {
    return existing.map((e) => (e.id === issue.id ? issue : e));
  }
  return [...existing, issue];
}

export function resolveIssue(
  existing: KnownIssue[],
  id: string,
  resolution_round: number,
): KnownIssue[] {
  return existing.map((e) =>
    e.id === id ? { ...e, status: 'resolved' as const, resolution_round } : e,
  );
}

export function deferIssue(existing: KnownIssue[], id: string): KnownIssue[] {
  return existing.map((e) => (e.id === id ? { ...e, status: 'deferred' as const } : e));
}
