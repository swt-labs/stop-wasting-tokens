/**
 * Command-bar verb allowlist for `POST /api/command`.
 *
 * The dashboard command bar surface is intentionally narrower than the full
 * `swt` CLI surface. Two limits drive the split:
 *
 *  1. **Interactive verbs cannot run via the command bar.** The route's
 *     spawn uses `stdio: ['ignore', 'pipe', 'pipe']` — stdin is closed —
 *     so any verb that prompts the user (vibe routes through methodology
 *     CHECKPOINTs; watch is an Ink TUI; dashboard would be a recursive
 *     daemon spawn) blocks on its first prompt and is killed at the
 *     timeout. We reject these up front rather than make the user wait.
 *
 *  2. **Stub verbs return EXIT.NOT_IMPLEMENTED.** `packages/cli/src/commands/
 *     stubs.ts` registers ~22 verbs (init, plan, execute, qa, archive, …)
 *     that are roadmap placeholders. The dashboard command bar shouldn't
 *     advertise them as runnable.
 *
 * The non-interactive allowlist is **derived from `packages/cli/src/main.ts:
 * buildRegistry()`** — the verbs registered with real handlers there minus
 * the interactive ones. When a new real verb lands in `main.ts`, evaluate
 * whether it belongs here too.
 *
 * This file is deliberately a hand-maintained mirror rather than a runtime
 * import from `packages/cli`: the dashboard package can be consumed as a
 * standalone bundle (the published tarball ships the dashboard server bundle
 * separately from `cli.mjs` per `tsup.config.ts`), and the build graph
 * doesn't want a hard dep from dashboard → cli.
 */

/**
 * Verbs that have real CLI handlers and run non-interactively (no stdin
 * prompts). Safe to spawn from the command bar with stdin closed.
 */
export const ALLOWED_NON_INTERACTIVE_VERBS: ReadonlySet<string> = new Set([
  'help',
  'version',
  'status',
  'doctor',
  'detect-phase',
  'update',
]);

/**
 * Verbs that have real CLI handlers but require an interactive terminal
 * (stdin, TTY, or both). Rejected from the command bar with
 * `routing_decision: 'rejected_interactive'`.
 */
export const INTERACTIVE_VERBS: ReadonlySet<string> = new Set(['vibe', 'watch', 'dashboard']);

/**
 * Union of all known verbs (allowlist + interactive). Everything else is
 * `rejected_unknown` — including stub verbs from `packages/cli/src/commands/
 * stubs.ts` like `init`, `plan`, `execute`, `qa`, `archive`, etc.
 */
export const KNOWN_VERBS: ReadonlySet<string> = new Set([
  ...ALLOWED_NON_INTERACTIVE_VERBS,
  ...INTERACTIVE_VERBS,
]);

export type RoutingDecision = 'literal' | 'rejected_interactive' | 'rejected_unknown';

export interface VerbRouting {
  readonly decision: RoutingDecision;
  readonly verb: string;
}

/**
 * Classify the first whitespace-token of a command bar input.
 * Lowercased to match the allowlist (which is canonical lowercase).
 */
export function classifyVerb(firstToken: string): VerbRouting {
  const verb = firstToken.toLowerCase();
  if (ALLOWED_NON_INTERACTIVE_VERBS.has(verb)) return { decision: 'literal', verb };
  if (INTERACTIVE_VERBS.has(verb)) return { decision: 'rejected_interactive', verb };
  return { decision: 'rejected_unknown', verb };
}
