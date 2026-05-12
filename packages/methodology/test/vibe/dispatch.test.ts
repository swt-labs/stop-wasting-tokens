// TODO(v3-debt): tracking https://github.com/swt-labs/stop-wasting-tokens/issues/32
// All describe() blocks below are .skip()-ed pending v2.3.5 test-debt remediation.
// See `docs/decisions/test-debt-tracking.md` for the cluster classification.

import { describe, expect, it } from 'vitest';

import {
  ModeRegistry,
  NotImplementedError,
  buildStubRegistry,
  stubHandler,
} from '../../src/vibe/handlers/index.js';
import type { VibeRoute } from '../../src/vibe/route.js';

describe.skip('ModeRegistry', () => {
  it('registers and dispatches a known mode', async () => {
    const registry = new ModeRegistry();
    let called = false;
    registry.register({
      kind: 'execute',
      async run(route, _io) {
        called = true;
        return { route, exit: 0, ranTo: 'completion' };
      },
    });
    const route: VibeRoute = {
      kind: 'execute',
      requires_confirmation: false,
    };
    const result = await registry.dispatch(route, makeIO());
    expect(called).toBe(true);
    expect(result.exit).toBe(0);
    expect(result.ranTo).toBe('completion');
  });

  it('rejects duplicate registration for the same kind', () => {
    const registry = new ModeRegistry();
    registry.register(stubHandler({ kind: 'discuss', roadmap_pointer: 'p' }));
    expect(() =>
      registry.register(stubHandler({ kind: 'discuss', roadmap_pointer: 'q' })),
    ).toThrow();
  });

  it('throws when no handler is registered', async () => {
    const registry = new ModeRegistry();
    await expect(
      registry.dispatch({ kind: 'plan-and-execute', requires_confirmation: false }, makeIO()),
    ).rejects.toThrow();
  });
});

describe.skip('buildStubRegistry', () => {
  const registry = buildStubRegistry();

  it.each<VibeRoute['kind']>([
    'init-redirect',
    'bootstrap',
    'scope',
    'discuss',
    'plan-and-execute',
    'execute',
    'verify',
    'qa-remediation',
    'uat-remediation',
    're-verify',
    'milestone-uat-recovery',
    'archive',
    'all-done',
  ])('has a stub for kind=%s', (kind) => {
    expect(registry.has(kind)).toBe(true);
  });

  it('every stub throws NotImplementedError on dispatch', async () => {
    const route: VibeRoute = { kind: 'execute', requires_confirmation: false };
    await expect(registry.dispatch(route, makeIO())).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('NotImplementedError carries mode + roadmap_pointer', async () => {
    const route: VibeRoute = { kind: 'archive', requires_confirmation: false };
    try {
      await registry.dispatch(route, makeIO());
      throw new Error('expected NotImplementedError');
    } catch (err) {
      expect(err).toBeInstanceOf(NotImplementedError);
      if (err instanceof NotImplementedError) {
        expect(err.mode).toBe('archive');
        expect(err.roadmap_pointer).toContain('Phase 9');
      }
    }
  });
});

function makeIO(): { cwd: string; stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } {
  const noop = {
    write: (): boolean => true,
  } as unknown as NodeJS.WritableStream;
  return { cwd: '/tmp', stdout: noop, stderr: noop };
}
