import type { PiSessionEntryLike } from '@swt-labs/orchestration';
import { describe, expect, it } from 'vitest';

import { buildTaskId, runDevTasks } from '../../../src/vibe/orchestration/dev-runner.js';
import type { PlanRecord } from '../../../src/vibe/orchestration/waves.js';

function plan(record: Partial<PlanRecord> & Pick<PlanRecord, 'plan'>): PlanRecord {
  return {
    plan: record.plan,
    title: record.title ?? `Plan ${record.plan}`,
    wave: record.wave ?? 1,
    depends_on: record.depends_on ?? [],
    files_modified: record.files_modified ?? [],
  };
}

function successEntries(phase: string, planId: string): PiSessionEntryLike[] {
  return [
    {
      type: 'custom',
      customType: 'swt-task-result',
      data: {
        schema_version: 1,
        task_id: buildTaskId(phase, planId),
        status: 'success',
        summary: `dev run for plan ${planId}`,
        files_changed: [{ path: `src/plan-${planId}.ts`, action: 'modified' }],
        must_haves: [],
      },
    },
  ];
}

function failedEntries(phase: string, planId: string, reason: string): PiSessionEntryLike[] {
  return [
    {
      type: 'custom',
      customType: 'swt-task-result',
      data: {
        schema_version: 1,
        task_id: buildTaskId(phase, planId),
        status: 'failed',
        summary: reason,
        files_changed: [],
        must_haves: [],
        blockers: [reason],
      },
    },
  ];
}

describe('@swt-labs/methodology — runDevTasks', () => {
  it('dispatches every plan sequentially with role=dev and returns success when all pass', async () => {
    const phase = '01';
    const plans = [plan({ plan: '01' }), plan({ plan: '02' }), plan({ plan: '03' })];
    const dispatched: string[] = [];

    const summary = await runDevTasks({
      phase,
      plans,
      cwd: '/tmp/test',
      opts: {
        harvestStrategy: {
          kind: 'entries',
          getEntries: (task) => {
            dispatched.push(task.taskId);
            expect(task.role).toBe('dev');
            const planId = task.taskId.split('-')[1] ?? '';
            return successEntries(phase, planId);
          },
        },
      },
    });

    expect(summary.status).toBe('success');
    expect(summary.outcomes).toHaveLength(3);
    expect(dispatched).toEqual([
      buildTaskId(phase, '01'),
      buildTaskId(phase, '02'),
      buildTaskId(phase, '03'),
    ]);
    for (const outcome of summary.outcomes) {
      expect(outcome.result.status).toBe('success');
    }
  });

  it('halts the loop after a failed TaskResult — remaining plans are NOT dispatched', async () => {
    const phase = '01';
    const plans = [plan({ plan: '01' }), plan({ plan: '02' }), plan({ plan: '03' })];
    const dispatched: string[] = [];

    const summary = await runDevTasks({
      phase,
      plans,
      cwd: '/tmp/test',
      opts: {
        harvestStrategy: {
          kind: 'entries',
          getEntries: (task) => {
            dispatched.push(task.taskId);
            const planId = task.taskId.split('-')[1] ?? '';
            return planId === '02'
              ? failedEntries(phase, planId, 'simulated dev failure')
              : successEntries(phase, planId);
          },
        },
      },
    });

    expect(summary.status).toBe('halted');
    expect(summary.haltReason).toContain('plan 02 returned status=failed');
    expect(summary.outcomes).toHaveLength(2);
    expect(dispatched).toEqual([buildTaskId(phase, '01'), buildTaskId(phase, '02')]);
  });

  it('halts on blocked status the same way', async () => {
    const phase = '01';
    const plans = [plan({ plan: '01' }), plan({ plan: '02' })];

    const summary = await runDevTasks({
      phase,
      plans,
      cwd: '/tmp/test',
      opts: {
        harvestStrategy: {
          kind: 'entries',
          getEntries: (task) => [
            {
              type: 'custom',
              customType: 'swt-task-result',
              data: {
                schema_version: 1,
                task_id: task.taskId,
                status: 'blocked',
                summary: 'blocked on PR review',
                files_changed: [],
                must_haves: [],
                blockers: ['waiting for review'],
              },
            },
          ],
        },
      },
    });

    expect(summary.status).toBe('halted');
    expect(summary.haltReason).toContain('plan 01 returned status=blocked');
    expect(summary.outcomes).toHaveLength(1);
  });

  it('propagates plan.files_modified as TaskBrief.claims', async () => {
    const phase = '01';
    const plans = [plan({ plan: '01', files_modified: ['src/a.ts', 'src/b.ts'] })];
    let observedClaims: ReadonlyArray<string> | undefined;

    await runDevTasks({
      phase,
      plans,
      cwd: '/tmp/test',
      opts: {
        harvestStrategy: {
          kind: 'entries',
          getEntries: (task) => {
            observedClaims = task.claims;
            return successEntries(phase, '01');
          },
        },
      },
    });

    expect(observedClaims).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('defaults to the stub HarvestStrategy when no opts are provided', async () => {
    const phase = '01';
    const plans = [plan({ plan: '01' })];

    const summary = await runDevTasks({ phase, plans, cwd: '/tmp/test' });

    expect(summary.status).toBe('success');
    expect(summary.outcomes).toHaveLength(1);
    expect(summary.outcomes[0]?.result.task_id).toBe(buildTaskId(phase, '01'));
  });

  it('builds task IDs as {phase}-{plan}-dev so dispatcher mismatch guard rejects stale entries', async () => {
    const phase = '02';
    const plans = [plan({ plan: '03' })];

    let captured = '';
    await runDevTasks({
      phase,
      plans,
      cwd: '/tmp/test',
      opts: {
        harvestStrategy: {
          kind: 'entries',
          getEntries: (task) => {
            captured = task.taskId;
            return successEntries(phase, '03');
          },
        },
      },
    });
    expect(captured).toBe('02-03-dev');
  });
});
