import type { AgentRole, SwtConfig } from '@swt-labs/core';

export interface PromptBuildInput {
  readonly role: AgentRole;
  readonly config: SwtConfig;
  readonly project_name: string;
  readonly core_value: string;
  readonly conventions: readonly string[];
  /** Per-call dynamic context (RESEARCH.md content, plan, summaries, etc.). */
  readonly dynamic: string;
  /** Optional task description appended to the dynamic suffix. */
  readonly task?: string;
}

export interface BuiltPrompt {
  readonly prefix: string;
  readonly suffix: string;
  readonly full: string;
}

/**
 * Compose the cache-aware prompt. The prefix is a deterministic function of
 * (role, project_name, core_value, conventions, config) — every input that
 * does NOT change between calls in the same session. The suffix carries the
 * per-call dynamic content. Backends with prompt caching reuse the prefix
 * verbatim across calls.
 */
export function buildPrompt(input: PromptBuildInput): BuiltPrompt {
  const prefix = composePrefix(input);
  const suffix = composeSuffix(input);
  return { prefix, suffix, full: `${prefix}\n\n${suffix}\n` };
}

function composePrefix(input: PromptBuildInput): string {
  const lines: string[] = [];
  lines.push(`# SWT — ${input.project_name}`);
  lines.push('');
  lines.push(`You are operating as the ${input.role.toUpperCase()} agent.`);
  lines.push(`Project core value: ${input.core_value}`);
  lines.push('');
  lines.push('## Effort, autonomy, verification');
  lines.push(`- effort: ${input.config.effort}`);
  lines.push(`- autonomy: ${input.config.autonomy}`);
  lines.push(`- verification_tier: ${input.config.verification_tier}`);
  lines.push(`- model_profile: ${input.config.model_profile}`);
  lines.push('');
  if (input.conventions.length > 0) {
    lines.push('## Project conventions');
    for (const c of input.conventions) lines.push(`- ${c}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function composeSuffix(input: PromptBuildInput): string {
  const lines: string[] = [];
  lines.push('## Dynamic context');
  lines.push(input.dynamic.trim());
  if (input.task !== undefined && input.task.length > 0) {
    lines.push('');
    lines.push('## Task');
    lines.push(input.task.trim());
  }
  return lines.join('\n').trimEnd();
}
