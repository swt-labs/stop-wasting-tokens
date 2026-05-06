export interface GuardOutcome {
  readonly decision: 'allow' | 'block';
  readonly reason?: string;
  readonly matched_segment?: string;
}

const COMPOUND_SEPARATORS = /\s*(&&|\|\||;|\|)\s*/;

const DENY_PATTERNS: readonly RegExp[] = [
  /\brm\s+-[rRf]+(\s+-[rRf]+)*\s+\/\b/,
  /\brm\s+-[rRf]+(\s+-[rRf]+)*\s+~\/?\b/,
  /\bsudo\b/,
  /\bcurl\s+[^|]*\|\s*sh\b/,
  /\bwget\s+[^|]*\|\s*sh\b/,
  /\bdd\s+if=.+of=\/dev\/(sd|nvme|disk)/,
  /\bmkfs\./,
  /:\s*\(\s*\)\s*\{.*:\s*\|\s*:.*\};:/,
  /\bchown\s+-R\s+root\b/,
  /\b>\s*\/dev\/(sd|nvme|disk)/,
  /\bnpm\s+publish\b/,
];

/**
 * Inspect a Bash command (possibly compound) and return a block decision when
 * any segment matches a denylisted pattern. The denylist is intentionally
 * conservative — it covers obvious foot-guns and supply-chain footprints, not
 * every possible misuse.
 */
export function checkBashCommand(command: string): GuardOutcome {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { decision: 'allow' };
  for (const segment of splitCompound(trimmed)) {
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(segment)) {
        return {
          decision: 'block',
          reason: `denylisted pattern: ${pattern.source}`,
          matched_segment: segment,
        };
      }
    }
  }
  return { decision: 'allow' };
}

function splitCompound(command: string): string[] {
  return command
    .split(COMPOUND_SEPARATORS)
    .filter((s) => !/^(&&|\|\||;|\|)$/.test(s))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
