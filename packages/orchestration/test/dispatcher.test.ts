import type { SwtSession } from '@swt-labs/runtime';
import { describe, expect, it } from 'vitest';

import {
  ClaimRegistry,
  createDispatcher,
  PiSpawnerEnvironment,
  type SessionFactory,
  type TaskBrief,
  type TaskResult,
} from '../src/index.js';

/**
 * Test seam: an in-memory `SessionFactory` that records calls and returns a
 * disposable mock session. Keeps the dispatcher tests independent of
 * runtime/'s real `createSession` (which today is a mock itself, but PR-06
 * makes it call Pi — these tests stay green either way).
 */
interface RecordedSessionCall {
  readonly cwd: string;
  readonly ephemeral?: boolean;
  readonly enableResultProtocol?: boolean;
  readonly taskId?: string;
}

function makeRecordingSessionFactory(): {
  factory: SessionFactory;
  calls: RecordedSessionCall[];
  disposals: number;
} {
  const calls: RecordedSessionCall[] = [];
  let disposals = 0;
  const factory: SessionFactory = async (opts) => {
    calls.push({
      cwd: opts.cwd,
      ephemeral: opts.ephemeral,
      enableResultProtocol: opts.enableResultProtocol,
      taskId: opts.taskId,
    });
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
  return {
    factory,
    calls,
    get disposals() {
      return disposals;
    },
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
        {
          cwd: '/tmp/orchestration-test/dev',
          ephemeral: true,
          enableResultProtocol: true,
          taskId: 'T-test-002',
        },
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
      expect(recording.calls.map((c) => c.cwd)).toEqual(['/tmp/a', '/tmp/b', '/tmp/c']);
    });
  });

  describe('createDispatcher — result-protocol wire-up (M3 PR-26)', () => {
    it('threads enableResultProtocol: true + taskId into every session factory call', async () => {
      const recording = makeRecordingSessionFactory();
      const dispatcher = createDispatcher({ sessionFactory: recording.factory });
      await dispatcher.dispatch({
        taskId: 'T-PR26-001',
        role: 'dev',
        cwd: '/tmp/a',
      });
      expect(recording.calls).toHaveLength(1);
      expect(recording.calls[0]?.enableResultProtocol).toBe(true);
      expect(recording.calls[0]?.taskId).toBe('T-PR26-001');
    });

    it('threads enableResultProtocol consistently across a batch (every task gets the flag)', async () => {
      const recording = makeRecordingSessionFactory();
      const dispatcher = createDispatcher({ sessionFactory: recording.factory });
      await dispatcher.dispatchBatch([
        { taskId: 'T-PR26-batch-1', role: 'scout', cwd: '/a' },
        { taskId: 'T-PR26-batch-2', role: 'lead', cwd: '/b' },
        { taskId: 'T-PR26-batch-3', role: 'dev', cwd: '/c' },
      ]);
      expect(recording.calls).toHaveLength(3);
      for (const call of recording.calls) {
        expect(call.enableResultProtocol).toBe(true);
      }
      expect(recording.calls.map((c) => c.taskId)).toEqual([
        'T-PR26-batch-1',
        'T-PR26-batch-2',
        'T-PR26-batch-3',
      ]);
    });
  });

  describe('createDispatcher — claim-registry (M3 PR-23)', () => {
    it('passes through when no claimRegistry is wired', async () => {
      const { factory } = makeRecordingSessionFactory();
      const dispatcher = createDispatcher({ sessionFactory: factory });
      const result = await dispatcher.dispatch({
        taskId: 'T-401',
        role: 'dev',
        cwd: '/tmp/a',
        claims: ['src/foo.ts'],
      });
      // No registry → claims are decorative; dispatcher returns the stub success.
      expect(result.status).toBe('success');
    });

    it('passes through when claims array is missing or empty', async () => {
      const { factory } = makeRecordingSessionFactory();
      const claimRegistry = new ClaimRegistry();
      const dispatcher = createDispatcher({ sessionFactory: factory, claimRegistry });

      const noClaims = await dispatcher.dispatch({
        taskId: 'T-402',
        role: 'dev',
        cwd: '/tmp/a',
      });
      expect(noClaims.status).toBe('success');

      const emptyClaims = await dispatcher.dispatch({
        taskId: 'T-403',
        role: 'dev',
        cwd: '/tmp/a',
        claims: [],
      });
      expect(emptyClaims.status).toBe('success');

      expect(claimRegistry.size()).toBe(0);
    });

    it('blocks dispatch when a claim conflicts and never creates a session', async () => {
      const recording = makeRecordingSessionFactory();
      const claimRegistry = new ClaimRegistry();
      // Pre-register a conflicting claim from another task.
      claimRegistry.register('T-other', ['src/foo.ts']);

      const dispatcher = createDispatcher({
        sessionFactory: recording.factory,
        claimRegistry,
      });
      const result = await dispatcher.dispatch({
        taskId: 'T-404',
        role: 'dev',
        cwd: '/tmp/a',
        claims: ['src/foo.ts'],
      });

      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual(['claim-conflict-with-T-other:src/foo.ts']);
      // No session was created — blocking happens BEFORE the session factory is called.
      expect(recording.calls).toHaveLength(0);
      expect(recording.disposals).toBe(0);
    });

    it('releases claims after successful dispatch so the slot frees up', async () => {
      const { factory } = makeRecordingSessionFactory();
      const claimRegistry = new ClaimRegistry();
      const dispatcher = createDispatcher({ sessionFactory: factory, claimRegistry });

      await dispatcher.dispatch({
        taskId: 'T-405',
        role: 'dev',
        cwd: '/tmp/a',
        claims: ['src/foo.ts'],
      });
      // Claim was registered then released in the finally block.
      expect(claimRegistry.size()).toBe(0);

      // A second task claiming the same path now succeeds.
      const second = await dispatcher.dispatch({
        taskId: 'T-406',
        role: 'dev',
        cwd: '/tmp/a',
        claims: ['src/foo.ts'],
      });
      expect(second.status).toBe('success');
      expect(claimRegistry.size()).toBe(0);
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
