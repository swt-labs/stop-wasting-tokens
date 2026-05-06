import type { CheckResult } from './summary-frontmatter.js';

export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const;

const HEADER_RE = new RegExp(
  `^(${CONVENTIONAL_TYPES.join('|')})(\\([\\w./-]+\\))?(!)?: .+`,
);

export function checkCommitMessage(message: string): CheckResult {
  const reasons: string[] = [];
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    reasons.push('commit message is empty');
    return { ok: false, reasons };
  }
  const header = trimmed.split('\n')[0] ?? '';
  if (!HEADER_RE.test(header)) {
    reasons.push(
      `header does not match Conventional Commits (${CONVENTIONAL_TYPES.join('|')})(scope)?: <description>`,
    );
  }
  if (header.length > 100) {
    reasons.push('header exceeds 100 characters');
  }
  return { ok: reasons.length === 0, reasons };
}
