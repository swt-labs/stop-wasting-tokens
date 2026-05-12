import { describe, expect, it } from 'vitest';

import { buildPrompt } from '../src/prompt-builder.js';

describe('@swt-labs/orchestration — prompt-builder', () => {
  it('emits the canonical 8-block order per TDD2 §8.3', () => {
    const built = buildPrompt({
      systemPrompt: 'You are the Scout.',
      projectMd: 'PROJECT content',
      requirementsMd: 'REQUIREMENTS content',
      stateMd: 'STATE content',
      phaseContextMd: 'phase context',
      task: { taskId: 'T-1', role: 'scout', cwd: '/tmp', claims: ['src/foo.ts'] },
      mustHaves: [{ id: 'MH-1', text: 'check thing' }],
    });
    expect(built.blocks.map((b) => b.kind)).toEqual([
      'system',
      'project',
      'requirements',
      'state',
      'phase-context',
      'task',
      'must-haves',
    ]);
  });

  it('omits empty/undefined stable blocks but keeps task block', () => {
    const built = buildPrompt({
      systemPrompt: 'You are the Scout.',
      task: { taskId: 'T-1', role: 'scout', cwd: '/tmp' },
    });
    expect(built.blocks.map((b) => b.kind)).toEqual(['system', 'task']);
  });

  it('records cacheBreakpointIndex between stable prefix and variable suffix', () => {
    const built = buildPrompt({
      systemPrompt: 'You are the Scout.',
      projectMd: 'p',
      requirementsMd: 'r',
      stateMd: 's',
      phaseContextMd: 'c',
      task: { taskId: 'T-1', role: 'scout', cwd: '/tmp' },
    });
    // 5 stable blocks (system + project + requirements + state + phase-context),
    // so the breakpoint sits at index 5 (right before the task block).
    expect(built.cacheBreakpointIndex).toBe(5);
    expect(built.blocks[built.cacheBreakpointIndex]?.kind).toBe('task');
  });

  it('cacheBreakpointIndex accounts for omitted optional blocks', () => {
    const built = buildPrompt({
      systemPrompt: 'You are the Scout.',
      // projectMd, requirementsMd, stateMd, phaseContextMd all omitted.
      task: { taskId: 'T-1', role: 'scout', cwd: '/tmp' },
    });
    // Only the system block precedes the breakpoint.
    expect(built.cacheBreakpointIndex).toBe(1);
    expect(built.blocks[built.cacheBreakpointIndex]?.kind).toBe('task');
  });

  it('renders task block with taskId + role + cwd + claims', () => {
    const built = buildPrompt({
      systemPrompt: 'sys',
      task: {
        taskId: 'T-test',
        role: 'dev',
        cwd: '/repo/src',
        claims: ['a.ts', 'b.ts'],
        promptContext: { foo: 'bar' },
      },
    });
    const taskBlock = built.blocks.find((b) => b.kind === 'task');
    expect(taskBlock?.content).toContain('T-test');
    expect(taskBlock?.content).toContain('Role: dev');
    expect(taskBlock?.content).toContain('CWD: /repo/src');
    expect(taskBlock?.content).toContain('a.ts, b.ts');
    expect(taskBlock?.content).toContain('"foo"');
  });

  it('renders must-haves block when provided', () => {
    const built = buildPrompt({
      systemPrompt: 'sys',
      task: { taskId: 'T-1', role: 'scout', cwd: '/tmp' },
      mustHaves: [
        { id: 'MH-1', text: 'first thing' },
        { id: 'MH-2', text: 'second thing' },
      ],
    });
    const mhBlock = built.blocks.find((b) => b.kind === 'must-haves');
    expect(mhBlock?.content).toContain('MH-1: first thing');
    expect(mhBlock?.content).toContain('MH-2: second thing');
  });
});
