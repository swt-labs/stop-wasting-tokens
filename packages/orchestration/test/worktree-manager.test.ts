/**
 * WorktreeManager lifecycle FSM tests (M3 PR-22).
 *
 * Covers:
 *   - All 8 legal transitions fire + record journal entries.
 *   - Illegal transitions throw `IllegalTransitionError`.
 *   - `fail` is reachable from any non-terminal state; never reachable
 *     from `removed` or `failed`.
 *   - `remove({keepForForensics: true})` skips the git command but
 *     still transitions state.
 *   - Per-task journals are append-only + don't interfere across tasks.
 *   - Git failures during `create` / `remove` transition to `failed`
 *     and throw `GitOperationError`.
 *
 * Tests inject `gitRunner` + `journalWriter` mocks so no real git
 * tree or filesystem writes happen — the FSM behaviour is what's
 * under test, not the git binary integration.
 */

import type { WorktreeJournalEntry } from '@swt-labs/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  GitOperationError,
  IllegalTransitionError,
  WorktreeManager,
  type GitRunResult,
  type WorktreeManagerOptions,
} from '../src/worktree-manager.js';

interface RecordedGitCall {
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
}

interface RecordingHarness {
  readonly gitCalls: RecordedGitCall[];
  readonly journalEntries: Array<{ filePath: string; entry: WorktreeJournalEntry }>;
  readonly clockTicks: number[];
}

function makeHarness(gitImpl?: (call: RecordedGitCall) => GitRunResult): {
  harness: RecordingHarness;
  opts: WorktreeManagerOptions;
} {
  const gitCalls: RecordedGitCall[] = [];
  const journalEntries: Array<{ filePath: string; entry: WorktreeJournalEntry }> = [];
  let tick = 0;
  const clockTicks: number[] = [];
  const harness: RecordingHarness = { gitCalls, journalEntries, clockTicks };
  const opts: WorktreeManagerOptions = {
    parallelRoot: '.swt-planning/parallel',
    journalRoot: '.swt-planning/journal',
    gitRunner: async (args, cwd) => {
      const call: RecordedGitCall = { args, cwd };
      gitCalls.push(call);
      return gitImpl ? gitImpl(call) : { exitCode: 0, stdout: '', stderr: '' };
    },
    clock: () => {
      tick += 1;
      clockTicks.push(tick);
      return `2026-05-12T00:00:0${tick}.000Z`;
    },
    journalWriter: async (filePath, entry) => {
      journalEntries.push({ filePath, entry });
    },
  };
  return { harness, opts };
}

describe('WorktreeManager — M3 PR-22 lifecycle FSM', () => {
  describe('happy path', () => {
    let manager: WorktreeManager;
    let harness: RecordingHarness;

    beforeEach(() => {
      const built = makeHarness();
      harness = built.harness;
      manager = new WorktreeManager(built.opts);
    });

    it('walks the full lifecycle and journals each transition', async () => {
      const taskId = 'T-001';

      const { worktreePath } = await manager.create(taskId, 'HEAD');
      expect(worktreePath).toBe('.swt-planning/parallel/wt-T-001');
      expect(manager.getState(taskId)).toBe('created');

      await manager.claim(taskId, ['src/foo.ts', 'src/bar.ts']);
      expect(manager.getState(taskId)).toBe('claimed');

      await manager.dispatch(taskId, { role: 'dev', tier: 'balanced' });
      expect(manager.getState(taskId)).toBe('dispatched');

      await manager.markAgentRunning(taskId);
      expect(manager.getState(taskId)).toBe('agent_running');

      await manager.markAgentComplete(taskId, 'success');
      expect(manager.getState(taskId)).toBe('agent_complete');

      await manager.harvest(taskId);
      expect(manager.getState(taskId)).toBe('harvested');

      await manager.remove(taskId);
      expect(manager.getState(taskId)).toBe('removed');

      // 7 transitions recorded.
      expect(harness.journalEntries).toHaveLength(7);
      const transitions = harness.journalEntries.map((j) => `${j.entry.from}→${j.entry.to}`);
      expect(transitions).toEqual([
        'none→created',
        'created→claimed',
        'claimed→dispatched',
        'dispatched→agent_running',
        'agent_running→agent_complete',
        'agent_complete→harvested',
        'harvested→removed',
      ]);

      // Every entry carries the same taskId + the journal path is per-task.
      for (const j of harness.journalEntries) {
        expect(j.entry.taskId).toBe(taskId);
        expect(j.filePath).toBe('.swt-planning/journal/wt-T-001.jsonl');
      }

      // create + remove invoke git; the other transitions don't.
      expect(harness.gitCalls).toHaveLength(2);
      expect(harness.gitCalls[0]?.args).toEqual([
        'worktree',
        'add',
        '.swt-planning/parallel/wt-T-001',
        'HEAD',
      ]);
      expect(harness.gitCalls[1]?.args).toEqual([
        'worktree',
        'remove',
        '.swt-planning/parallel/wt-T-001',
      ]);
    });

    it('records claim details in the journal entry', async () => {
      await manager.create('T-002', 'HEAD');
      await manager.claim('T-002', ['src/a.ts', 'src/b.ts']);
      const claimEntry = harness.journalEntries[1];
      expect(claimEntry?.entry.details).toEqual({ claims: ['src/a.ts', 'src/b.ts'] });
    });

    it('records dispatch details when provided', async () => {
      await manager.create('T-003', 'HEAD');
      await manager.claim('T-003', []);
      await manager.dispatch('T-003', { role: 'dev', tier: 'balanced' });
      const dispatchEntry = harness.journalEntries[2];
      expect(dispatchEntry?.entry.details).toEqual({ role: 'dev', tier: 'balanced' });
    });

    it('records markAgentComplete outcome', async () => {
      await manager.create('T-004', 'HEAD');
      await manager.claim('T-004', []);
      await manager.dispatch('T-004');
      await manager.markAgentRunning('T-004');
      await manager.markAgentComplete('T-004', 'blocked');
      const completeEntry = harness.journalEntries[4];
      expect(completeEntry?.entry.details).toEqual({ outcome: 'blocked' });
    });
  });

  describe('illegal transitions', () => {
    let manager: WorktreeManager;

    beforeEach(() => {
      const { opts } = makeHarness();
      manager = new WorktreeManager(opts);
    });

    it('rejects claim before create', async () => {
      await expect(manager.claim('T-100', [])).rejects.toBeInstanceOf(IllegalTransitionError);
    });

    it('rejects skipping states (created → dispatched)', async () => {
      await manager.create('T-101', 'HEAD');
      await expect(manager.dispatch('T-101')).rejects.toBeInstanceOf(IllegalTransitionError);
    });

    it('rejects markAgentComplete before markAgentRunning', async () => {
      await manager.create('T-102', 'HEAD');
      await manager.claim('T-102', []);
      await manager.dispatch('T-102');
      await expect(manager.markAgentComplete('T-102', 'success')).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );
    });

    it('rejects double removal', async () => {
      await manager.create('T-103', 'HEAD');
      await manager.claim('T-103', []);
      await manager.dispatch('T-103');
      await manager.markAgentRunning('T-103');
      await manager.markAgentComplete('T-103', 'success');
      await manager.harvest('T-103');
      await manager.remove('T-103');
      await expect(manager.remove('T-103')).rejects.toBeInstanceOf(IllegalTransitionError);
    });

    it('rejects fail from `removed`', async () => {
      await manager.create('T-104', 'HEAD');
      await manager.claim('T-104', []);
      await manager.dispatch('T-104');
      await manager.markAgentRunning('T-104');
      await manager.markAgentComplete('T-104', 'success');
      await manager.harvest('T-104');
      await manager.remove('T-104');
      await expect(manager.fail('T-104', 'too late')).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );
    });

    it('rejects fail from `failed` (no double-fail)', async () => {
      await manager.create('T-105', 'HEAD');
      await manager.fail('T-105', 'first failure');
      await expect(manager.fail('T-105', 'second failure')).rejects.toBeInstanceOf(
        IllegalTransitionError,
      );
    });
  });

  describe('fail transitions', () => {
    it('can transition to failed from any non-terminal state', async () => {
      const states = [
        {
          trigger: async (m: WorktreeManager, id: string) => m.create(id, 'HEAD'),
          expected: 'created',
        },
        {
          trigger: async (m: WorktreeManager, id: string) => {
            await m.create(id, 'HEAD');
            await m.claim(id, []);
          },
          expected: 'claimed',
        },
        {
          trigger: async (m: WorktreeManager, id: string) => {
            await m.create(id, 'HEAD');
            await m.claim(id, []);
            await m.dispatch(id);
          },
          expected: 'dispatched',
        },
        {
          trigger: async (m: WorktreeManager, id: string) => {
            await m.create(id, 'HEAD');
            await m.claim(id, []);
            await m.dispatch(id);
            await m.markAgentRunning(id);
          },
          expected: 'agent_running',
        },
        {
          trigger: async (m: WorktreeManager, id: string) => {
            await m.create(id, 'HEAD');
            await m.claim(id, []);
            await m.dispatch(id);
            await m.markAgentRunning(id);
            await m.markAgentComplete(id, 'success');
          },
          expected: 'agent_complete',
        },
        {
          trigger: async (m: WorktreeManager, id: string) => {
            await m.create(id, 'HEAD');
            await m.claim(id, []);
            await m.dispatch(id);
            await m.markAgentRunning(id);
            await m.markAgentComplete(id, 'success');
            await m.harvest(id);
          },
          expected: 'harvested',
        },
      ];
      for (let i = 0; i < states.length; i += 1) {
        const { opts } = makeHarness();
        const manager = new WorktreeManager(opts);
        const taskId = `T-fail-${i}`;
        await states[i]!.trigger(manager, taskId);
        expect(manager.getState(taskId)).toBe(states[i]!.expected);
        await manager.fail(taskId, `forced from ${states[i]!.expected}`);
        expect(manager.getState(taskId)).toBe('failed');
      }
    });

    it('fail records reason in the journal entry', async () => {
      const { harness, opts } = makeHarness();
      const manager = new WorktreeManager(opts);
      await manager.create('T-200', 'HEAD');
      await manager.fail('T-200', 'integration_test_simulated_failure');
      const failEntry = harness.journalEntries[1];
      expect(failEntry?.entry.from).toBe('created');
      expect(failEntry?.entry.to).toBe('failed');
      expect(failEntry?.entry.details).toEqual({ reason: 'integration_test_simulated_failure' });
    });
  });

  describe('keepForForensics', () => {
    it('skips git worktree remove but still transitions to removed', async () => {
      const { harness, opts } = makeHarness();
      const manager = new WorktreeManager(opts);
      await manager.create('T-300', 'HEAD');
      await manager.claim('T-300', []);
      await manager.dispatch('T-300');
      await manager.markAgentRunning('T-300');
      await manager.markAgentComplete('T-300', 'success');
      await manager.harvest('T-300');
      await manager.remove('T-300', { keepForForensics: true });

      expect(manager.getState('T-300')).toBe('removed');
      // Only `create` issued a git call — remove was skipped.
      expect(harness.gitCalls).toHaveLength(1);
      expect(harness.gitCalls[0]?.args[0]).toBe('worktree');
      expect(harness.gitCalls[0]?.args[1]).toBe('add');
      const removeEntry = harness.journalEntries.at(-1);
      expect(removeEntry?.entry.details).toEqual({ keepForForensics: true });
    });
  });

  describe('git failures', () => {
    it('create → failed when `git worktree add` exits non-zero', async () => {
      const { harness, opts } = makeHarness((call) =>
        call.args[1] === 'add'
          ? { exitCode: 128, stdout: '', stderr: "fatal: 'wt-x' already exists" }
          : { exitCode: 0, stdout: '', stderr: '' },
      );
      const manager = new WorktreeManager(opts);
      await expect(manager.create('T-400', 'HEAD')).rejects.toBeInstanceOf(GitOperationError);
      expect(manager.getState('T-400')).toBe('failed');
      expect(harness.journalEntries).toHaveLength(1);
      expect(harness.journalEntries[0]?.entry.from).toBe('none');
      expect(harness.journalEntries[0]?.entry.to).toBe('failed');
    });

    it('remove → failed when `git worktree remove` exits non-zero', async () => {
      const { harness, opts } = makeHarness((call) =>
        call.args[1] === 'remove'
          ? { exitCode: 128, stdout: '', stderr: 'fatal: worktree locked' }
          : { exitCode: 0, stdout: '', stderr: '' },
      );
      const manager = new WorktreeManager(opts);
      await manager.create('T-401', 'HEAD');
      await manager.claim('T-401', []);
      await manager.dispatch('T-401');
      await manager.markAgentRunning('T-401');
      await manager.markAgentComplete('T-401', 'success');
      await manager.harvest('T-401');
      await expect(manager.remove('T-401')).rejects.toBeInstanceOf(GitOperationError);
      expect(manager.getState('T-401')).toBe('failed');
      const finalEntry = harness.journalEntries.at(-1);
      expect(finalEntry?.entry.from).toBe('harvested');
      expect(finalEntry?.entry.to).toBe('failed');
    });
  });

  describe('concurrent tasks', () => {
    it('keeps per-task journals isolated', async () => {
      const { harness, opts } = makeHarness();
      const manager = new WorktreeManager(opts);
      await manager.create('T-500', 'HEAD');
      await manager.create('T-501', 'HEAD');
      await manager.claim('T-500', ['a.ts']);
      await manager.claim('T-501', ['b.ts']);

      const taskAEntries = harness.journalEntries.filter((j) => j.entry.taskId === 'T-500');
      const taskBEntries = harness.journalEntries.filter((j) => j.entry.taskId === 'T-501');
      expect(taskAEntries).toHaveLength(2);
      expect(taskBEntries).toHaveLength(2);
      expect(taskAEntries[0]?.filePath).toBe('.swt-planning/journal/wt-T-500.jsonl');
      expect(taskBEntries[0]?.filePath).toBe('.swt-planning/journal/wt-T-501.jsonl');
    });
  });
});
