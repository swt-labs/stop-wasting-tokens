/**
 * Pi's `ThinkingLevel` vocabulary, per `pi.dev/docs/latest` and TDD2 §7.1.1.
 *
 * SWT's per-role thinking-level resolver in `runtime/src/providers/role-resolver.ts`
 * (lands in Plan 01-02 PR-08) maps from SWT's vendor-neutral tier (`cheap-fast`
 * / `balanced` / `quality` / `reasoning`) to a Pi `ThinkingLevel`, which the
 * provider quirks then map to the provider-specific value (Anthropic, OpenAI,
 * etc.).
 *
 * Note: `CodexReasoningEffort` in `@swt-labs/core/types/codex-reasoning-effort.ts`
 * is a sibling (Codex's TOML vocabulary) and stays put until M2 renames the
 * `AgentSpec.reasoning_effort` field to `AgentSpec.thinking_level` (deferred
 * from PR-04 because it cascades across methodology's `agent-spec-resolver.ts`).
 */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
}
