/**
 * resolveDag tests (M3 PR-24).
 *
 * Covers:
 *   - Empty input → empty batches, ok.
 *   - Single task with no deps → one batch with one task.
 *   - Linear chain (A → B → C) → three single-task batches.
 *   - Diamond (A → [B, C] → D) → [[A], [B, C], [D]].
 *   - Multiple roots in one batch → grouped by Kahn's algorithm.
 *   - Within-batch ordering preserves input-array order (determinism).
 *   - Missing dependency → MissingDependencyError with task + dep IDs.
 *   - Cycle (A → B → A) → CycleDetectedError with residual node IDs.
 *   - Larger cycle (A → B → C → A) → all three residuals.
 *   - Cycle plus an unrelated valid subgraph → only the cycle's nodes
 *     become residuals; the valid subgraph is scheduled normally.
 *   - Self-loop (A depends on A) → cycle detected.
 *   - Duplicate task ID → DuplicateTaskError.
 *   - depends_on field missing entirely is treated as no deps.
 */

import type { TaskNode } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import {
  CycleDetectedError,
  DuplicateTaskError,
  MissingDependencyError,
  resolveDag,
} from '../src/dag-resolver.js';

describe('resolveDag — M3 PR-24', () => {
  describe('happy paths', () => {
    it('returns empty batches for empty input', () => {
      const result = resolveDag([]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([]);
    });

    it('single task with no deps lands in one batch', () => {
      const tasks: TaskNode[] = [{ id: 'A' }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['A']]);
    });

    it('linear chain A → B → C produces three single-task batches', () => {
      const tasks: TaskNode[] = [
        { id: 'A' },
        { id: 'B', depends_on: ['A'] },
        { id: 'C', depends_on: ['B'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['A'], ['B'], ['C']]);
    });

    it('diamond A → [B, C] → D produces three batches with parallel middle', () => {
      const tasks: TaskNode[] = [
        { id: 'A' },
        { id: 'B', depends_on: ['A'] },
        { id: 'C', depends_on: ['A'] },
        { id: 'D', depends_on: ['B', 'C'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['A'], ['B', 'C'], ['D']]);
    });

    it('groups multiple independent roots into the first batch', () => {
      const tasks: TaskNode[] = [{ id: 'A' }, { id: 'B' }, { id: 'C', depends_on: ['A', 'B'] }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['A', 'B'], ['C']]);
    });

    it('preserves input-array order within batches (deterministic)', () => {
      // Three independent tasks in reverse alphabetic order; within-batch
      // order should match input order, not alphabetic.
      const tasks: TaskNode[] = [{ id: 'Z' }, { id: 'M' }, { id: 'A' }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['Z', 'M', 'A']]);
    });

    it('treats missing depends_on field as no dependencies', () => {
      const tasks: TaskNode[] = [{ id: 'A' }, { id: 'B', depends_on: [] }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['A', 'B']]);
    });

    it('handles deeper fan-out: A → [B, C, D, E] → F', () => {
      const tasks: TaskNode[] = [
        { id: 'A' },
        { id: 'B', depends_on: ['A'] },
        { id: 'C', depends_on: ['A'] },
        { id: 'D', depends_on: ['A'] },
        { id: 'E', depends_on: ['A'] },
        { id: 'F', depends_on: ['B', 'C', 'D', 'E'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.batches).toEqual([['A'], ['B', 'C', 'D', 'E'], ['F']]);
    });
  });

  describe('missing dependency', () => {
    it('returns MissingDependencyError with task + dep IDs', () => {
      const tasks: TaskNode[] = [{ id: 'A' }, { id: 'B', depends_on: ['NONEXISTENT'] }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toBeInstanceOf(MissingDependencyError);
      const err = result.error as MissingDependencyError;
      expect(err.kind).toBe('missing-dep');
      expect(err.taskId).toBe('B');
      expect(err.missingDependency).toBe('NONEXISTENT');
    });

    it('surfaces the first missing dep encountered (caller iterates if needed)', () => {
      const tasks: TaskNode[] = [
        { id: 'A', depends_on: ['MISSING1'] },
        { id: 'B', depends_on: ['MISSING2'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      // Surface order matches task input order — A's missing dep is reported first.
      const err = result.error as MissingDependencyError;
      expect(err.taskId).toBe('A');
      expect(err.missingDependency).toBe('MISSING1');
    });
  });

  describe('cycle detection', () => {
    it('detects two-node cycle A → B → A', () => {
      const tasks: TaskNode[] = [
        { id: 'A', depends_on: ['B'] },
        { id: 'B', depends_on: ['A'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toBeInstanceOf(CycleDetectedError);
      const err = result.error as CycleDetectedError;
      expect(err.kind).toBe('cycle');
      expect(err.residualNodes).toEqual(['A', 'B']);
    });

    it('detects three-node cycle A → B → C → A', () => {
      const tasks: TaskNode[] = [
        { id: 'A', depends_on: ['C'] },
        { id: 'B', depends_on: ['A'] },
        { id: 'C', depends_on: ['B'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      const err = result.error as CycleDetectedError;
      expect(err.residualNodes).toEqual(['A', 'B', 'C']);
    });

    it('detects a cycle alongside a valid subgraph; residuals are the cycle nodes', () => {
      const tasks: TaskNode[] = [
        { id: 'X' }, // valid root
        { id: 'Y', depends_on: ['X'] }, // valid follow-up
        { id: 'A', depends_on: ['B'] }, // cycle
        { id: 'B', depends_on: ['A'] }, // cycle
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      const err = result.error as CycleDetectedError;
      // The cycle nodes (A, B) are the residuals; X + Y could have
      // scheduled but the resolver gave up the moment in-degree-0
      // queue went empty (after X, Y both completed).
      expect(err.residualNodes).toEqual(['A', 'B']);
    });

    it('detects a self-loop (A → A) as a cycle', () => {
      const tasks: TaskNode[] = [{ id: 'A', depends_on: ['A'] }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      const err = result.error as CycleDetectedError;
      expect(err.residualNodes).toEqual(['A']);
    });
  });

  describe('duplicate task IDs', () => {
    it('returns DuplicateTaskError when the same ID appears twice', () => {
      const tasks: TaskNode[] = [{ id: 'A' }, { id: 'A' }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error).toBeInstanceOf(DuplicateTaskError);
      const err = result.error as DuplicateTaskError;
      expect(err.kind).toBe('duplicate');
      expect(err.taskId).toBe('A');
    });
  });

  describe('error class shape', () => {
    it('CycleDetectedError carries a descriptive message and `name`', () => {
      const tasks: TaskNode[] = [
        { id: 'A', depends_on: ['B'] },
        { id: 'B', depends_on: ['A'] },
      ];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.name).toBe('CycleDetectedError');
      expect(result.error.message).toContain('cycle detected');
      expect(result.error.message).toContain('A');
      expect(result.error.message).toContain('B');
    });

    it('MissingDependencyError carries a descriptive message and `name`', () => {
      const tasks: TaskNode[] = [{ id: 'A', depends_on: ['GHOST'] }];
      const result = resolveDag(tasks);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.error.name).toBe('MissingDependencyError');
      expect(result.error.message).toContain('GHOST');
      expect(result.error.message).toContain('depends_on');
    });
  });
});
