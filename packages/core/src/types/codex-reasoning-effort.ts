/**
 * Codex `model_reasoning_effort` — the model's thinking-budget setting per the
 * Codex CLI runtime config schema documented at
 * `developers.openai.com/codex/config-reference`.
 *
 * Distinct from {@link Effort} (SWT's planning-depth + turn-budget tier). The
 * two share a TOML field name (`model_reasoning_effort`) by historical accident
 * pre-v1.5.1 — Plan 01-01 decoupled them. SWT's Effort tier stays in
 * config.json's `effort` field; CodexReasoningEffort is what the agent template
 * TOMLs declare and what the codex-driver writes verbatim to
 * `~/.codex/agents/{role}.toml` for Codex to consume.
 */
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** Runtime-iterable list of valid Codex reasoning_effort values. */
export const CODEX_REASONING_EFFORTS: readonly CodexReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return (
    typeof value === 'string' && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}
