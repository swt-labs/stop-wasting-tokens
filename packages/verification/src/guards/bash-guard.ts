/**
 * Bash command guard.
 *
 * Inspects a Bash command (possibly compound) and returns `block` when any
 * denylist pattern fires. The denylist is **conservative by design** — it
 * covers obvious foot-guns (rm -rf /, sudo, fork bombs) and supply-chain
 * footprints (curl|sh, npm publish), not every possible misuse. The goal is
 * a high-precision, low-recall filter the LLM can rely on so denied commands
 * are unambiguously dangerous.
 *
 * Matching strategy (M2 PR-14 — the v2.3.5 carry-forward fix):
 *
 *   1. **Full-command pass** — each denylist regex is tested against the
 *      complete trimmed command. This is the ONLY pass that can catch
 *      patterns spanning a `|` or `;` boundary (curl|sh, fork bomb).
 *      The pre-PR-14 guard skipped this pass; `splitCompound` then
 *      fragmented the very patterns the regex was written to detect.
 *
 *   2. **Per-segment pass** — each segment is tested individually. This
 *      catches per-segment denials in compound commands like
 *      `echo ok && sudo something` where the sudo lives on its own segment
 *      and would not be flagged by a full-command match (the leading `echo`
 *      noise would not match `\bsudo\b` even though it appears in the
 *      string — well, it would, but defending against compound chains
 *      where one part hides the other is the whole point of this pass).
 *
 * Each denylist regex is written to match standalone segments first;
 * patterns that intentionally span boundaries (`|`, `;`) document that in
 * a comment above the pattern.
 *
 * **Per-pattern boundary discipline** — trailing `\b` after a non-word
 * char (`/`, `~`) does NOT match end-of-string in JavaScript regex
 * (`\b` requires a word/non-word transition; EOS-against-non-word is
 * non-transition). Patterns that previously used `\/\b` are now `\/(?:\s|$)`
 * (lookahead-style). Every denylist regex is regression-tested by the
 * guards.test.ts denylist round-trip below.
 */

export interface GuardOutcome {
  readonly decision: 'allow' | 'block';
  readonly reason?: string;
  readonly matched_segment?: string;
}

const COMPOUND_SEPARATORS = /\s*(&&|\|\||;|\|)\s*/;

const DENY_PATTERNS: readonly RegExp[] = [
  // `rm -rf /` (root). Trailing `\/(?:\s|$)` correctly anchors against
  // end-of-string AND against `/etc`, `/var`, etc. (the path-component
  // version is the next pattern, `\/\w+\b`).
  /\brm\s+-[rRf]+(\s+-[rRf]+)*\s+\/(?:\s|$)/,
  // `rm -rf /<single-path-component>` — `/etc`, `/var`, `/tmp/...`, etc.
  // Limits to first-component-only by anchoring on `\b` (word boundary
  // works here because `\w` is a word char).
  /\brm\s+-[rRf]+(\s+-[rRf]+)*\s+\/\w+\b/,
  // `rm -rf ~` (home) — same `\b` issue as `/`. Uses `\s|$` boundary.
  /\brm\s+-[rRf]+(\s+-[rRf]+)*\s+~\/?(?:\s|$)/,
  // `sudo` — block as a single token wherever it appears.
  /\bsudo\b/,
  // Pipe-to-shell — `curl ... | sh`. Spans a `|` boundary; relies on the
  // full-command matching pass to catch (per-segment matching can't see it).
  /\bcurl\s+[^|]*\|\s*sh\b/,
  /\bwget\s+[^|]*\|\s*sh\b/,
  // Direct-disk dd — block writes to raw device nodes.
  /\bdd\s+if=.+of=\/dev\/(sd|nvme|disk)/,
  // Filesystem creation tools — never reasonable from an agent.
  /\bmkfs\./,
  // Fork bomb `:(){ :|: & };:` — spans `|` and `;`, relies on the
  // full-command matching pass to catch.
  /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:[^}]*\};\s*:/,
  // Recursive root chown — privilege-escalation footprint.
  /\bchown\s+-R\s+root\b/,
  // Redirecting to raw device nodes. Matches `> /dev/sda`, `>/dev/sda`,
  // `>>/dev/sda` (append). The leading `\b` on `>` is intentionally absent
  // because `>` is a non-word char; surrounding context (whitespace OR
  // start-of-string) anchors the operator on the left.
  />+\s*\/dev\/(sd|nvme|disk)/,
  // npm publish — agent must not publish to a registry.
  /\bnpm\s+publish\b/,
];

/**
 * Inspect a Bash command and return a block decision when any denylisted
 * pattern matches. Performs both a full-command pass (catches patterns
 * spanning `|` / `;`) and a per-segment pass (catches per-segment denials
 * inside `&&` / `||` / `;` / `|` chains).
 */
export function checkBashCommand(command: string): GuardOutcome {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { decision: 'allow' };
  // Pass 1: full command — catches multi-segment patterns (curl|sh, fork bomb)
  // that splitCompound would otherwise fragment.
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        decision: 'block',
        reason: `denylisted pattern: ${pattern.source}`,
        matched_segment: trimmed,
      };
    }
  }
  // Pass 2: per-segment — catches per-segment denials in compound chains
  // (e.g., `echo ok && sudo something` — the sudo segment alone is denied).
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
