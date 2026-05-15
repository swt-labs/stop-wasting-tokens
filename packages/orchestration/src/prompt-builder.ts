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
 * **Determinism contract (M4 PR-31).** `buildPrompt` is a pure function
 * of `BuildPromptOptions`. It reads no clock, no random, no environment.
 * Two calls with the same opts produce byte-identical results (block
 * ordering, block content, `cacheBreakpointIndex`). Property iteration
 * order doesn't matter — the function reads each field by name. This
 * guarantee is what makes the cache breakpoint useful: same stable
 * prefix → identical cache key on the wire → Anthropic / OpenAI cache
 * hits with no behavioural difference between sessions.
 *
 * Validated by `packages/orchestration/test/prompt-builder.determinism.test.ts`.
 *
 * Per Principle 4 (telemetry is aggregate-only): the prompt may contain
 * user data, but the meter / telemetry only ever sees the **counts**, not
 * the content.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { THINKING_LEVELS, type TaskBrief, type ThinkingLevel } from '@swt-labs/shared';

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
 * Number of blocks in the cacheable prefix (everything before the
 * `cacheBreakpointIndex`). Used by `cache-control.ts` (M4 PR-32) to
 * decide whether the prefix meets Anthropic's 1024-token minimum + by
 * `cache-hit.ts` (M4 PR-33) to attribute cache reads to the prefix.
 */
export function cacheableBlockCount(prompt: BuiltPrompt): number {
  return prompt.cacheBreakpointIndex;
}

/**
 * Serialize a `BuiltPrompt` to a deterministic string for cassette
 * hashing + cache-key derivation. Format:
 *
 *   ```
 *   <kind>:
 *   <content>
 *
 *   <kind>:
 *   <content>
 *   ```
 *
 * (Each block: `<kind>:\n<content>`, separated by `\n\n`.) The output
 * is byte-identical across hosts when the input is identical — same
 * determinism contract as `buildPrompt` itself.
 *
 * Doesn't include the cache-breakpoint marker — that's a runtime-layer
 * concern (M4 PR-32 wires `cache_control` into the Pi-bound payload;
 * the breakpoint index travels alongside via `BuiltPrompt`).
 */
export function serializeBlocks(prompt: BuiltPrompt): string {
  return prompt.blocks.map((b) => `${b.kind}:\n${b.content}`).join('\n\n');
}

/**
 * Helper: read a role's system prompt from a `.prompt.md` file relative to
 * the methodology profiles directory. The methodology layer hands the
 * resolved path; this is a thin readFileSync wrapper that errors clearly
 * when the file is missing.
 *
 * NOTE: `readRolePrompt` returns the raw file content *including* YAML
 * frontmatter — preserved as a back-compat reader (other potential callers
 * may want the raw bytes). Production `resolveSpawnAgentConfig` uses
 * `readRolePromptWithMeta` (below), which strips the frontmatter from the
 * LLM-visible body and parses `effort`/`maxTurns` into structured meta.
 */
export function readRolePrompt(profilesDir: string, promptFilename: string): string {
  const fullPath = join(profilesDir, promptFilename);
  try {
    return readFileSync(fullPath, 'utf8');
  } catch (cause) {
    throw new Error(`prompt-builder: failed to read role prompt at ${fullPath}`, { cause });
  }
}

/**
 * Phase 02 (plan 02-01 T2) — agent-frontmatter parsing for the Anthropic-SDK
 * shape.
 *
 * Reads a role prompt file and returns:
 *   - `body`: the LLM-visible content with YAML frontmatter stripped
 *   - `meta`: parsed `{effort?, maxTurns?}` from the frontmatter
 *
 * Mirrors the `stripFrontmatter` precedent in
 * `packages/orchestration/src/provider-overlay.ts:76-86` — no npm dependency
 * is added. Only the two TDD §4 Phase 02 keys (`effort`, `maxTurns`) are
 * extracted; every other frontmatter field passes through silently (Pi-tool
 * frontmatter like `name:`, `tools:`, `permissionMode:` is consumed at
 * agent-loading layers we don't own here).
 *
 * Throws when:
 *   - `effort` is present but not one of `ThinkingLevel` enum values
 *     (`off|minimal|low|medium|high|xhigh`).
 *   - `maxTurns` is present but does not parse to a positive integer.
 *
 * Graceful degrade when:
 *   - The file has no `---\n` delimiter → returns `{body: raw, meta: {}}`.
 *   - Frontmatter exists but lacks `effort` / `maxTurns` → meta omits the
 *     missing fields (caller falls back through the precedence chain).
 */
export interface RolePromptMeta {
  readonly effort?: ThinkingLevel;
  readonly maxTurns?: number;
}

export interface ReadRolePromptResult {
  readonly body: string;
  readonly meta: RolePromptMeta;
}

export function readRolePromptWithMeta(
  profilesDir: string,
  promptFilename: string,
): ReadRolePromptResult {
  const fullPath = join(profilesDir, promptFilename);
  let raw: string;
  try {
    raw = readFileSync(fullPath, 'utf8');
  } catch (cause) {
    throw new Error(`prompt-builder: failed to read role prompt at ${fullPath}`, { cause });
  }

  if (!raw.startsWith('---\n')) {
    return { body: raw, meta: {} };
  }
  // Find the closing `---\n` AFTER the opener (mirrors provider-overlay's
  // `stripFrontmatter` lines 80-84).
  const closeIdx = raw.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    return { body: raw, meta: {} };
  }
  const frontmatter = raw.slice(4, closeIdx);
  const body = raw.slice(closeIdx + 5);

  let effort: ThinkingLevel | undefined;
  let maxTurns: number | undefined;
  for (const line of frontmatter.split('\n')) {
    const match = /^(effort|maxTurns)\s*:\s*(.+?)\s*$/.exec(line);
    if (match === null) continue;
    const key = match[1] as 'effort' | 'maxTurns';
    const rawValue = match[2] ?? '';
    if (key === 'effort') {
      // Strip optional surrounding quotes (`effort: "high"`) before validating.
      const value = rawValue.replace(/^["']|["']$/g, '');
      if (!(THINKING_LEVELS as readonly string[]).includes(value)) {
        throw new Error(
          `prompt-builder: invalid \`effort\` value "${value}" in ${fullPath} — must be one of ${THINKING_LEVELS.join(', ')}`,
        );
      }
      effort = value as ThinkingLevel;
    } else {
      // maxTurns: positive integer.
      if (!/^-?\d+$/.test(rawValue)) {
        throw new Error(
          `prompt-builder: invalid \`maxTurns\` value "${rawValue}" in ${fullPath} — must be a positive integer`,
        );
      }
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
          `prompt-builder: invalid \`maxTurns\` value "${rawValue}" in ${fullPath} — must be a positive integer`,
        );
      }
      maxTurns = parsed;
    }
  }

  const meta: RolePromptMeta = {
    ...(effort !== undefined ? { effort } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
  };
  return { body, meta };
}
