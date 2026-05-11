import { describe, expect, it } from 'vitest';

import {
  createDispatcher,
  PiSpawnerEnvironment,
  type SessionFactory,
  type TaskBrief,
  type TaskResult,
} from '../src/index.js';
import type { SwtSession } from '@swt-labs/runtime';

/**
 * Test seam: an in-memory `SessionFactory` that records calls and returns a
 * disposable mock session. Keeps the dispatcher tests independent of
 * runtime/'s real `createSession` (which today is a mock itself, but PR-06
 * makes it call Pi — these tests stay green either way).
 */
function makeRecordingSessionFactory(): {
  factory: SessionFactory;
  calls: Array<{ cwd: string; ephemeral?: boolean }>;
  disposals: number;
} {
  const calls: Array<{ cwd: string; ephemeral?: boolean }> = [];
  let disposals = 0;
  const factory: SessionFactory = async (opts) => {
    calls.push({ cwd: opts.cwd, ephemeral: opts.ephemeral });
    const session: SwtSession = {
      sessionId: `mock-${calls.length}`,
      async prompt() {
        // no-op
      },
      subscribe() {
        return () => {
          // no-op
        };
      },
      dispose() {
        disposals += 1;
      },
    };
    return session;
  };
  return { factory, calls, get disposals() { return disposals; } } as {
    factory: SessionFactory;
    calls: Array<{ cwd: string; ephemeral?: boolean }>;
    disposals: number;
  };
}

describe('@swt-labs/orchestration — PR-03 surface', () => {
  describe('createDispatcher', () => {
    it('dispatch(no-op task) returns a TaskResult with the expected shape', async () => {
      const { factory } = makeRecordingSessionFactory();
      const dispatcher = createDispatcher({ sessionFactory: factory });
      const brief: TaskBrief = {
        taskId: 'T-test-001',
        role: 'scout',
        cwd: '/tmp/orchestration-test',
      };
      const result: TaskResult = await dispatcher.dispatch(brief);

      expect(result.schema_version).toBe(1);
      expect(result.task_id).toBe('T-test-001');
      expect(result.status).toBe('success');
      expect(typeof result.summary).toBe('string');
      expect(Array.isArray(result.files_changed)).toBe(true);
      expect(result.files_changed.length).toBe(0);
      expect(Array.isArray(result.must_haves)).toBe(true);
      expect(result.must_haves.length).toBe(0);
    });

    it('dispatch creates a session with the task cwd + ephemeral=true and disposes it', async () => {
      const recording = makeRecordingSessionFactory();
      const dispatcher = createDispatcher({ sessionFactory: recording.factory });
      await dispatcher.dispatch({
        taskId: 'T-test-002',
        role: 'dev',
        cwd: '/tmp/orchestration-test/dev',
      });
      expect(recording.calls).toEqual([
        { cwd: '/tmp/orchestration-test/dev', ephemeral: true },
      ]);
    });

    it('dispatchBatch runs tasks sequentially in order', async () => {
      const recording = makeRecordingSessionFactory();
      const dispatcher = createDispatcher({ sessionFactory: recording.factory });
      const tasks: TaskBrief[] = [
        { taskId: 'T-1', role: 'scout', cwd: '/tmp/a' },
        { taskId: 'T-2', role: 'lead', cwd: '/tmp/b' },
        { taskId: 'T-3', role: 'dev', cwd: '/tmp/c' },
      ];
      const results = await dispatcher.dispatchBatch(tasks);

      expect(results.length).toBe(3);
      expect(results.map((r) => r.task_id)).toEqual(['T-1', 'T-2', 'T-3']);
      expect(recording.calls.map((c) => c.cwd)).toEqual([
        '/tmp/a',
        '/tmp/b',
        '/tmp/c',
      ]);
    });
  });

  describe('PiSpawnerEnvironment', () => {
    it('probe reports available with name pi when Pi peerDep is resolvable', async () => {
      // Pi is a workspace dep + peerDep here, so the dynamic import inside
      // probe() succeeds. PR-03 considers this the happy path.
      const env = new PiSpawnerEnvironment();
      const probe = await env.probe();
      expect(probe.name).toBe('pi');
      expect(probe.available).toBe(true);
    });

    it('getSpawner returns an AgentSpawner with the expected method shape', async () => {
      const env = new PiSpawnerEnvironment();
      const spawner = await env.getSpawner();
      expect(typeof spawner.installAgent).toBe('function');
      expect(typeof spawner.spawn).toBe('function');
      expect(typeof spawner.removeAgent).toBe('function');
    });
  });
});
