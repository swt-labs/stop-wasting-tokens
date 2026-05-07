import { describe, expect, it } from 'vitest';

import {
  checkCommitMessage,
  checkPlanFrontmatter,
  checkSummaryFrontmatter,
} from '../src/checks/index.js';

describe('checkSummaryFrontmatter', () => {
  it('passes a complete frontmatter', () => {
    const result = checkSummaryFrontmatter({
      phase: '01',
      plan: '01',
      title: 'A',
      status: 'complete',
      tasks_completed: 3,
      tasks_total: 3,
      files_modified: [],
      commit_hashes: ['abc1234'],
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('reports missing required keys', () => {
    const result = checkSummaryFrontmatter({ phase: '01' });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('rejects bad phase / plan formats', () => {
    const result = checkSummaryFrontmatter({
      phase: '1',
      plan: '01',
      title: 'A',
      status: 'complete',
      tasks_completed: 1,
      tasks_total: 1,
      files_modified: [],
      commit_hashes: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('phase must be a 2-digit string');
  });
});

describe('checkCommitMessage', () => {
  it.each([
    'feat: add foo',
    'feat(cli): add foo',
    'fix(core)!: drop deprecated x',
    'chore(deps): bump tsup',
  ])('accepts a Conventional Commits header: %s', (msg) => {
    expect(checkCommitMessage(msg).ok).toBe(true);
  });

  it.each(['add foo', 'random update', 'WIP: ignore'])(
    'rejects a non-conventional header: %s',
    (msg) => {
      expect(checkCommitMessage(msg).ok).toBe(false);
    },
  );

  it('rejects empty messages', () => {
    expect(checkCommitMessage('   ').ok).toBe(false);
  });
});

describe('checkPlanFrontmatter', () => {
  it('passes a complete plan frontmatter', () => {
    const result = checkPlanFrontmatter({
      phase: '01',
      plan: '01',
      title: 'X',
      wave: 1,
      must_haves: ['a'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects empty must_haves', () => {
    const result = checkPlanFrontmatter({
      phase: '01',
      plan: '01',
      title: 'X',
      wave: 1,
      must_haves: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('must_haves cannot be empty');
  });
});
