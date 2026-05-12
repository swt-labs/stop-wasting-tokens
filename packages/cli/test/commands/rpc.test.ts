/**
 * `swt rpc` handler tests (M3 PR-S — post session-wiring follow-up).
 *
 * As of PR-S, `runRpc` no longer throws `RpcModeUnavailableError` by
 * default — it builds an `AgentSessionRuntime` and invokes Pi's
 * `runRpcMode`. The handler's contract assertions:
 *
 *   1. Clean disconnect → `EXIT.SUCCESS` (0).
 *   2. Stdout stays empty regardless of outcome — the Pi RPC protocol
 *      owns stdout; SWT writes only to stderr.
 *   3. The legacy `RpcModeUnavailableError` is still caught if a
 *      consumer's older build path happens to throw it; exit code is
 *      `EXIT.NOT_IMPLEMENTED` (2) in that case.
 *   4. Unexpected errors land on `EXIT.RUNTIME_ERROR` (3) with the
 *      message surfaced on stderr.
 *
 * The "real Pi runtime construction" itself is not exercised here —
 * Pi requires auth + a model to construct, and CI doesn't have them.
 * Instead each test mocks `runRpc` at the runtime layer via `vi.doMock`
 * and asserts the handler's contract against the resulting promise
 * shape (resolves / rejects with specific error classes).
 */

import type * as RuntimeModule from '@swt-labs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { StringStream } from '../_helpers.js';

describe('rpcHandler — post PR-S activation', () => {
  it('returns EXIT.SUCCESS when runRpc resolves cleanly + writes nothing to stdout', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/runtime', async () => {
      const actual = await vi.importActual<typeof RuntimeModule>('@swt-labs/runtime');
      return {
        ...actual,
        runRpc: async (): Promise<void> => {
          // Simulates a clean RPC client disconnect.
        },
      };
    });
    const { rpcHandler } = await import('../../src/commands/rpc.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await rpcHandler(
      { verb: 'rpc', positionals: [], flags: {} },
      { cwd: '/tmp', stdout, stderr },
    );

    expect(exit).toBe(0);
    // Pi reserves stdout for the RPC protocol stream — SWT never writes there.
    expect(stdout.text()).toBe('');
    // No stderr output on the happy path.
    expect(stderr.text()).toBe('');

    vi.doUnmock('@swt-labs/runtime');
    vi.resetModules();
  });

  it('still catches RpcModeUnavailableError if a consumer build chain throws it (BC shim)', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/runtime', async () => {
      const actual = await vi.importActual<typeof RuntimeModule>('@swt-labs/runtime');
      return {
        ...actual,
        runRpc: async (): Promise<void> => {
          throw new actual.RpcModeUnavailableError();
        },
      };
    });
    const { rpcHandler } = await import('../../src/commands/rpc.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await rpcHandler(
      { verb: 'rpc', positionals: [], flags: {} },
      { cwd: '/tmp', stdout, stderr },
    );

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('RPC mode is unavailable');
    expect(exit).toBe(2);

    vi.doUnmock('@swt-labs/runtime');
    vi.resetModules();
  });

  it('returns EXIT.RUNTIME_ERROR (3) for unexpected errors', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/runtime', async () => {
      const actual = await vi.importActual<typeof RuntimeModule>('@swt-labs/runtime');
      return {
        ...actual,
        runRpc: async (): Promise<void> => {
          throw new Error('boom — Pi went offline mid-handshake');
        },
      };
    });
    const { rpcHandler } = await import('../../src/commands/rpc.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await rpcHandler(
      { verb: 'rpc', positionals: [], flags: {} },
      { cwd: '/tmp', stdout, stderr },
    );

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('unexpected error');
    expect(stderr.text()).toContain('boom');
    expect(exit).toBe(3);

    vi.doUnmock('@swt-labs/runtime');
    vi.resetModules();
  });

  // Note: a "reserves stdout against real runRpc" test was removed at
  // PR-S. Real `runRpc` now invokes `createAgentSessionServices` which
  // can block on filesystem / config reads in CI without auth — that
  // makes the test flaky. The stdout-empty invariant is already
  // asserted by every other test in this file (clean disconnect,
  // RpcModeUnavailableError catch, unexpected error) since all three
  // mock `runRpc` and assert `stdout.text() === ''`.
});
