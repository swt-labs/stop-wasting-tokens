/**
 * Dispatcher × Dev role integration test — M2 PR-13.
 *
 * Exercises the dispatcher's `'entries'` HarvestStrategy in the
 * dev-runner-shaped call pattern (role: 'dev' + claims + promptContext) and
 * confirms the defensive task_id-mismatch guard added in PR-13 catches stale
 * entries that could otherwise leak across dispatches.
 *
 * The methodology-layer dev-runner unit tests live in `@swt-labs/methodology`
 * and exercise the loop semantics (halt-on-failed, claims propagation, etc.).
 * This file is the orchestration-side of the same surface: the dispatcher
 * contract that dev-runner consumes.
 */

import { TaskResultSchema } from '@swt-labs/shared';
import { describe, expect, it } from 'vitest';

import { createDispatcher } from '../src/dispatcher.js';
import type { PiSessionEntryLike } from '../src/result-harvest.js';

function devEntries(taskId: string): PiSessionEntryLike[] {
  return [
    {
      type: 'custom',
      customType: 'swt-task-result',
      data: {
        schema_version: 1,
        task_id: taskId,
        status: 'success',
        summary: 'dev work complete',
        files_changed: [{ path: 'src/foo.ts', action: 'modified' }],
        must_haves: [{ id: 'M-1', status: 'passed' }],
      },
    },
  ];
}

describe('@swt-labs/orchestration — dispatcher Dev role integration (M2 PR-13)', () => {
  it('dispatches role=dev sequentially through the entries strategy + harvests TaskResult', async () => {
    const dispatcher = createDispatcher({
      harvestStrategy: {
        kind: 'entries',
        getEntries: (task) => devEntries(task.taskId),
      },
    });

    const results = await dispatcher.dispatchBatch([
      { taskId: '01-01-dev', role: 'dev', cwd: '/tmp/cwd', claims: ['src/a.ts'] },
      { taskId: '01-02-dev', role: 'dev', cwd: '/tmp/cwd', claims: ['src/b.ts'] },
      { taskId: '01-03-dev', role: 'dev', cwd: '/tmp/cwd', claims: ['src/c.ts'] },
    ]);

    expect(results.map((r) => r.task_id)).toEqual(['01-01-dev', '01-02-dev', '01-03-dev']);
    for (const r of results) {
      expect(r.status).toBe('success');
      expect(() => TaskResultSchema.parse(r)).not.toThrow();
    }
  });

  it('task_id-mismatch guard rejects a harvested entry whose task_id does not match the dispatched one', async () => {
    const dispatcher = createDispatcher({
      harvestStrategy: {
        kind: 'entries',
        // Deliberately return a stale entry whose task_id does NOT match the
        // dispatched task. This simulates the future M3 worktree-reuse case
        // where session entries persist across dispatches.
        getEntries: () => devEntries('STALE-task-id'),
      },
    });

    await expect(
      dispatcher.dispatch({ taskId: '01-01-dev', role: 'dev', cwd: '/tmp/cwd' }),
    ).rejects.toThrow(
      /dispatcher harvest mismatch.*dispatched task_id=01-01-dev.*harvested.*STALE-task-id/,
    );
  });

  it('propagates promptContext and claims through the TaskBrief unchanged', async () => {
    let capturedClaims: ReadonlyArray<string> | undefined;
    let capturedContext: Readonly<Record<string, unknown>> | undefined;
    let capturedRole: string | undefined;

    const dispatcher = createDispatcher({
      harvestStrategy: {
        kind: 'entries',
        getEntries: (task) => {
          capturedClaims = task.claims;
          capturedContext = task.promptContext;
          capturedRole = task.role;
          return devEntries(task.taskId);
        },
      },
    });

    await dispatcher.dispatch({
      taskId: '01-01-dev',
      role: 'dev',
      cwd: '/tmp/cwd',
      claims: ['src/a.ts', 'src/b.ts'],
      promptContext: {
        phase: '01',
        plan: '01',
        title: 'plan 01',
      },
    });

    expect(capturedRole).toBe('dev');
    expect(capturedClaims).toEqual(['src/a.ts', 'src/b.ts']);
    expect(capturedContext).toMatchObject({
      phase: '01',
      plan: '01',
      title: 'plan 01',
    });
  });
});
