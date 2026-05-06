import type { GuardOutcome } from './bash-guard.js';

export interface SecretMatch {
  readonly label: string;
  readonly index: number;
  readonly preview: string;
}

const SECRET_PATTERNS: readonly { readonly label: string; readonly re: RegExp }[] = [
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'AWS secret access key', re: /\baws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/ },
  { label: 'GitHub PAT (classic)', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { label: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/ },
  { label: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { label: 'Generic high-entropy token', re: /\b[A-Fa-f0-9]{40,}\b/ },
];

export function scanForSecrets(content: string): readonly SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { label, re } of SECRET_PATTERNS) {
    const m = re.exec(content);
    if (m === null) continue;
    matches.push({
      label,
      index: m.index,
      preview: redact(m[0]),
    });
  }
  return matches;
}

export function checkContentForSecrets(content: string): GuardOutcome {
  const matches = scanForSecrets(content);
  if (matches.length === 0) return { decision: 'allow' };
  const first = matches[0];
  if (first === undefined) return { decision: 'allow' };
  return {
    decision: 'block',
    reason: `${matches.length} secret pattern${matches.length === 1 ? '' : 's'} detected`,
    matched_segment: `${first.label}: ${first.preview}`,
  };
}

function redact(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
