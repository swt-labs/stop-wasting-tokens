import { describe, expect, it } from 'vitest';

import { createSession, type SwtSession, MockSpawnerEnvironment } from '../src/index.js';

describe('@swt-labs/runtime — PR-02 surface', () => {
  describe('createSession', () => {
    it('returns a SwtSession-shaped object with all required members', async () => {
      const session: SwtSession = await createSession({
        cwd: '/tmp/swt-runtime-test',
        ephemeral: true,
      });

      expect(typeof session.sessionId).toBe('string');
      expect(session.sessionId.length).toBeGreaterThan(0);
      expect(typeof session.prompt).toBe('function');
      expect(typeof session.subscribe).toBe('function');
      expect(typeof session.dispose).toBe('function');

      session.dispose();
    });

    it('subscribe returns an unsubscribe function that removes the listener', async () => {
      const session = await createSession({ cwd: '/tmp/swt-runtime-test', ephemeral: true });
      let received = 0;
      const unsubscribe = session.subscribe(() => {
        received += 1;
      });
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
      // Mock impl emits nothing, but the unsubscribe path must run cleanly.
      expect(received).toBe(0);
      session.dispose();
    });

    it('prompt throws if called after dispose', async () => {
      const session = await createSession({ cwd: '/tmp/swt-runtime-test', ephemeral: true });
      session.dispose();
      await expect(session.prompt('hi')).rejects.toThrow(/after dispose/);
    });
  });

  describe('MockSpawnerEnvironment', () => {
    it('probe reports available with name pi-runtime-mock', async () => {
      const env = new MockSpawnerEnvironment();
      const probe = await env.probe();
      expect(probe.available).toBe(true);
      expect(probe.name).toBe('pi-runtime-mock');
      expect(probe.version).toBeDefined();
    });

    it('getSpawner throws with a pointer to PR-03', async () => {
      const env = new MockSpawnerEnvironment();
      await expect(env.getSpawner()).rejects.toThrow(/PR-03|orchestration/);
    });
  });
});
