import type { CheckResult } from './summary-frontmatter.js';

const REQUIRED_KEYS = ['phase', 'plan', 'title', 'wave', 'must_haves'] as const;

export function checkPlanFrontmatter(
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
  const mustHaves = frontmatter.must_haves;
  if (Array.isArray(mustHaves) && mustHaves.length === 0) {
    reasons.push('must_haves cannot be empty');
  }
  return { ok: reasons.length === 0, reasons };
}
