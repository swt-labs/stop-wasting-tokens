export interface CheckResult {
  readonly ok: boolean;
  readonly reasons: readonly string[];
}

const REQUIRED_KEYS = [
  'phase',
  'plan',
  'title',
  'status',
  'tasks_completed',
  'tasks_total',
  'files_modified',
  'commit_hashes',
] as const;

export function checkSummaryFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
): CheckResult {
  const reasons: string[] = [];
  for (const key of REQUIRED_KEYS) {
    if (!(key in frontmatter)) reasons.push(`missing ${key}`);
  }
  if (
    frontmatter.phase !== undefined &&
    (typeof frontmatter.phase !== 'string' || !/^\d{2}$/.test(frontmatter.phase))
  ) {
    reasons.push('phase must be a 2-digit string');
  }
  if (
    frontmatter.plan !== undefined &&
    (typeof frontmatter.plan !== 'string' || !/^\d{2}$/.test(frontmatter.plan))
  ) {
    reasons.push('plan must be a 2-digit string');
  }
  if (
    frontmatter.status !== undefined &&
    (typeof frontmatter.status !== 'string' ||
      !['complete', 'partial', 'failed', 'in-progress'].includes(frontmatter.status))
  ) {
    reasons.push('status must be one of complete | partial | failed | in-progress');
  }
  return { ok: reasons.length === 0, reasons };
}
