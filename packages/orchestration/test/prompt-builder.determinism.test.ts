/**
 * `buildPrompt` determinism contract tests per TDD2 §8.3 + Plan 04-01 PR-31.
 *
 * The cache breakpoint (PR-32's `cache_control` wiring) is only useful
 * when the cacheable prefix is byte-identical across calls — same opts
 * must produce same blocks must produce same wire-format prompt must
 * produce the same Anthropic / OpenAI cache key. This suite pins that
 * property.
 *
 * Categories:
 *   1. Pure-determinism: same opts called twice → byte-identical result.
 *   2. Property-order independence: passing the same opts with keys in
 *      different orders (using object spreading) doesn't change output.
 *   3. Canonical golden snapshot: a representative full prompt's block
 *      structure is asserted explicitly — any future refactor that
 *      changes block ordering or cache-breakpoint placement fails here.
 *   4. Optional-block shifting: omitting stable-prefix blocks moves the
 *      cache-breakpoint index correctly.
 *   5. `serializeBlocks` deterministic format pinned.
 */

import type { TaskBrief } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  buildPrompt,
  cacheableBlockCount,
  serializeBlocks,
  type BuildPromptOptions,
} from '../src/prompt-builder.js';

const canonicalTask: TaskBrief = {
  taskId: 'T-PR31-CANON',
  role: 'dev',
  cwd: '/tmp/swt-canon',
  claims: ['src/foo.ts', 'src/bar.ts'],
};

const canonicalOpts: BuildPromptOptions = {
  systemPrompt: '# Dev role system prompt\nYou are the dev agent.',
  projectMd: '# PROJECT\nname: swt-canon',
  requirementsMd: '# REQUIREMENTS\nREQ-01: pass tests',
  stateMd: '# STATE\nphase: 01',
  phaseContextMd: '# PHASE-01\nfoo bar',
  task: canonicalTask,
  mustHaves: [
    { id: 'mh-1', text: 'Tests pass' },
    { id: 'mh-2', text: 'No regressions' },
  ],
};

describe('buildPrompt — determinism contract (M4 PR-31)', () => {
  it('two calls with identical opts produce byte-identical results', () => {
    const a = buildPrompt(canonicalOpts);
    const b = buildPrompt(canonicalOpts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.cacheBreakpointIndex).toBe(b.cacheBreakpointIndex);
    expect(a.blocks.length).toBe(b.blocks.length);
    for (let i = 0; i < a.blocks.length; i++) {
      expect(a.blocks[i]?.kind).toBe(b.blocks[i]?.kind);
      expect(a.blocks[i]?.content).toBe(b.blocks[i]?.content);
    }
  });

  it('property iteration order does not affect output', () => {
    // Re-shape opts with keys in a different order via object spread.
    // Object property iteration order is insertion order in JS; this
    // asserts buildPrompt reads each field by name, not by enumeration.
    const reordered: BuildPromptOptions = {
      mustHaves: canonicalOpts.mustHaves ?? [],
      phaseContextMd: canonicalOpts.phaseContextMd ?? '',
      task: canonicalOpts.task,
      stateMd: canonicalOpts.stateMd ?? '',
      requirementsMd: canonicalOpts.requirementsMd ?? '',
      projectMd: canonicalOpts.projectMd ?? '',
      systemPrompt: canonicalOpts.systemPrompt,
    };
    const a = buildPrompt(canonicalOpts);
    const b = buildPrompt(reordered);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('canonical golden snapshot pins block ordering + cache-breakpoint index', () => {
    const prompt = buildPrompt(canonicalOpts);
    // 7 blocks: system + project + requirements + state + phase-context + task + must-haves.
    expect(prompt.blocks.map((b) => b.kind)).toEqual([
      'system',
      'project',
      'requirements',
      'state',
      'phase-context',
      'task',
      'must-haves',
    ]);
    // Cache breakpoint = 5 (after phase-context, before task).
    expect(prompt.cacheBreakpointIndex).toBe(5);
    expect(cacheableBlockCount(prompt)).toBe(5);
    // Block contents are exact pass-throughs (with derived task brief).
    expect(prompt.blocks[0]?.content).toBe(canonicalOpts.systemPrompt);
    expect(prompt.blocks[1]?.content).toBe(canonicalOpts.projectMd);
    expect(prompt.blocks[5]?.content).toContain('# Task T-PR31-CANON');
    expect(prompt.blocks[5]?.content).toContain('Role: dev');
    expect(prompt.blocks[6]?.content).toContain('mh-1: Tests pass');
  });

  it('omitting optional stable-prefix blocks shifts cacheBreakpointIndex correctly', () => {
    // System + task only — minimal prompt. Breakpoint = 1 (after system).
    const minimal = buildPrompt({
      systemPrompt: 'sys',
      task: canonicalTask,
    });
    expect(minimal.blocks.map((b) => b.kind)).toEqual(['system', 'task']);
    expect(minimal.cacheBreakpointIndex).toBe(1);

    // System + projectMd + task — breakpoint = 2.
    const withProject = buildPrompt({
      systemPrompt: 'sys',
      projectMd: 'proj',
      task: canonicalTask,
    });
    expect(withProject.blocks.map((b) => b.kind)).toEqual(['system', 'project', 'task']);
    expect(withProject.cacheBreakpointIndex).toBe(2);

    // Empty-string stable blocks are treated as omitted (no block emitted).
    const emptyState = buildPrompt({
      systemPrompt: 'sys',
      stateMd: '',
      task: canonicalTask,
    });
    expect(emptyState.blocks.map((b) => b.kind)).toEqual(['system', 'task']);
    expect(emptyState.cacheBreakpointIndex).toBe(1);
  });

  it('omitting mustHaves drops the must-haves block but does not change cacheBreakpointIndex', () => {
    const noMustHaves = buildPrompt({
      ...canonicalOpts,
      mustHaves: [],
    });
    expect(noMustHaves.blocks.map((b) => b.kind)).toEqual([
      'system',
      'project',
      'requirements',
      'state',
      'phase-context',
      'task',
      // no must-haves
    ]);
    // The breakpoint is unaffected — must-haves are after the breakpoint
    // (variable suffix), so dropping them only shrinks the suffix.
    expect(noMustHaves.cacheBreakpointIndex).toBe(5);
  });
});

describe('serializeBlocks — deterministic format (M4 PR-31)', () => {
  it('produces byte-identical output for identical prompts', () => {
    const a = serializeBlocks(buildPrompt(canonicalOpts));
    const b = serializeBlocks(buildPrompt(canonicalOpts));
    expect(a).toBe(b);
  });

  it('follows the documented `<kind>:\\n<content>\\n\\n<kind>:\\n<content>` format', () => {
    const minimal = buildPrompt({
      systemPrompt: 'sys-content',
      task: canonicalTask,
    });
    const serialized = serializeBlocks(minimal);
    // 2 blocks → exactly one `\n\n` separator.
    const separatorCount = serialized.split('\n\n').length - 1;
    expect(separatorCount).toBeGreaterThanOrEqual(1);
    expect(serialized.startsWith('system:\nsys-content')).toBe(true);
    expect(serialized).toContain('task:\n# Task T-PR31-CANON');
  });

  it('handles single-block prompts without trailing separator', () => {
    const single = buildPrompt({
      systemPrompt: 'only',
      task: { taskId: 'T-X', role: 'scout', cwd: '/' },
    });
    const serialized = serializeBlocks(single);
    expect(serialized.endsWith('\n\n')).toBe(false);
  });
});

describe('cacheableBlockCount — convenience for PR-32 + PR-33 (M4)', () => {
  it('returns the cacheBreakpointIndex for any built prompt', () => {
    const prompts = [
      buildPrompt({ systemPrompt: 's', task: canonicalTask }),
      buildPrompt(canonicalOpts),
    ];
    for (const p of prompts) {
      expect(cacheableBlockCount(p)).toBe(p.cacheBreakpointIndex);
    }
  });
});
