/**
 * Deterministic prompt construction per TDD2 §8.3.
 *
 * The prompt for a Pi session is assembled from fixed-order blocks:
 *
 *   1. role system prompt   (from the role's profile.prompt.md)
 *   2. PROJECT.md           (project-stable; cacheable)
 *   3. REQUIREMENTS.md      (project-stable; cacheable)
 *   4. STATE.md             (milestone-stable; cacheable)
 *   5. phase context        (`{NN}-CONTEXT.md`; phase-stable; cacheable)
 *   6. ── cache breakpoint  (M4 PR-32 inserts the Anthropic `cache_control`
 *                           marker here; OpenAI auto-caches the prefix)
 *   7. task brief           (the dispatched TaskBrief; variable)
 *   8. must-haves           (the plan's must_haves array; variable)
 *
 * Blocks 1-5 are the **stable prefix** — same content across many turns,
 * eligible for caching. Blocks 7-8 are the **variable suffix** — task-
 * specific, never cached. Per ADR-006, the breakpoint goes between them.
 *
 * Per Principle 4 (telemetry is aggregate-only): the prompt may contain
 * user data, but the meter / telemetry only ever sees the **counts**, not
 * the content.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TaskBrief } from '@swt-labs/shared';

export interface PromptBlock {
  readonly kind:
    | 'system'
    | 'project'
    | 'requirements'
    | 'state'
    | 'phase-context'
    | 'task'
    | 'must-haves';
  readonly content: string;
}

export interface BuildPromptOptions {
  readonly systemPrompt: string;
  readonly projectMd?: string;
  readonly requirementsMd?: string;
  readonly stateMd?: string;
  readonly phaseContextMd?: string;
  readonly task: TaskBrief;
  readonly mustHaves?: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}

export interface BuiltPrompt {
  /** Ordered blocks ready to be joined by the caller (or fed to Pi's `addMessage` chain). */
  readonly blocks: ReadonlyArray<PromptBlock>;
  /** Index into `blocks` where the cache_control marker should be inserted at M4. */
  readonly cacheBreakpointIndex: number;
}

export function buildPrompt(opts: BuildPromptOptions): BuiltPrompt {
  const blocks: PromptBlock[] = [];
  // 1. System prompt (role-specific; cacheable as part of the stable prefix).
  blocks.push({ kind: 'system', content: opts.systemPrompt });
  // 2-5. Stable artefacts (project / requirements / state / phase context).
  if (opts.projectMd !== undefined && opts.projectMd.length > 0) {
    blocks.push({ kind: 'project', content: opts.projectMd });
  }
  if (opts.requirementsMd !== undefined && opts.requirementsMd.length > 0) {
    blocks.push({ kind: 'requirements', content: opts.requirementsMd });
  }
  if (opts.stateMd !== undefined && opts.stateMd.length > 0) {
    blocks.push({ kind: 'state', content: opts.stateMd });
  }
  if (opts.phaseContextMd !== undefined && opts.phaseContextMd.length > 0) {
    blocks.push({ kind: 'phase-context', content: opts.phaseContextMd });
  }

  // 6. Cache breakpoint marker — the index after the last stable block.
  // M4 PR-32 inserts `cache_control: {type: 'ephemeral'}` on the previous
  // block's content; M2 just records the index for later wiring.
  const cacheBreakpointIndex = blocks.length;

  // 7. Task brief (variable per-task content).
  blocks.push({
    kind: 'task',
    content: renderTaskBrief(opts.task),
  });

  // 8. Must-haves (variable per-task verification scope).
  if (opts.mustHaves !== undefined && opts.mustHaves.length > 0) {
    blocks.push({ kind: 'must-haves', content: renderMustHaves(opts.mustHaves) });
  }

  return { blocks, cacheBreakpointIndex };
}

function renderTaskBrief(task: TaskBrief): string {
  const lines: string[] = [];
  lines.push(`# Task ${task.taskId}`);
  lines.push(`Role: ${task.role}`);
  lines.push(`CWD: ${task.cwd}`);
  if (task.claims !== undefined && task.claims.length > 0) {
    lines.push(`Claims: ${task.claims.join(', ')}`);
  }
  if (task.promptContext !== undefined) {
    lines.push('');
    lines.push('## Context');
    lines.push(JSON.stringify(task.promptContext, null, 2));
  }
  return lines.join('\n');
}

function renderMustHaves(
  mhs: ReadonlyArray<{ readonly id: string; readonly text: string }>,
): string {
  const lines: string[] = ['## Must-haves to verify'];
  for (const mh of mhs) {
    lines.push(`- ${mh.id}: ${mh.text}`);
  }
  return lines.join('\n');
}

/**
 * Helper: read a role's system prompt from a `.prompt.md` file relative to
 * the methodology profiles directory. The methodology layer hands the
 * resolved path; this is a thin readFileSync wrapper that errors clearly
 * when the file is missing.
 */
export function readRolePrompt(profilesDir: string, promptFilename: string): string {
  const fullPath = join(profilesDir, promptFilename);
  try {
    return readFileSync(fullPath, 'utf8');
  } catch (cause) {
    throw new Error(`prompt-builder: failed to read role prompt at ${fullPath}`, { cause });
  }
}
