/**
 * `swt rpc` handler tests (M2 PR-20).
 *
 * Today the handler delegates to `runRpc` which throws
 * `RpcModeUnavailableError` until M3 PR-22 wires the full Pi
 * `AgentSessionRuntime` construction. These tests assert the handler's
 * delegation contract:
 *
 *   1. Calling the handler invokes `runRpc` (verified through the
 *      thrown deferred-mode error — proof that the call site fired).
 *   2. The deferred-mode error is caught and reported on **stderr**,
 *      NOT stdout (per the Pi convention — stdout is reserved for
 *      the RPC log stream).
 *   3. The exit code is `EXIT.NOT_IMPLEMENTED` (78) — distinguishable
 *      from `EXIT.RUNTIME_ERROR` (3) which fires for unexpected
 *      errors.
 *   4. Unexpected errors land in `EXIT.RUNTIME_ERROR` with the message
 *      surfaced on stderr.
 *
 * When M3 PR-22 activates real Pi sessions, the deferred-mode test
 * inverts (asserts the handler reaches `runRpcMode` without throwing)
 * and a new test covers stdin/stdout round-trip. The contract surface
 * stays the same.
 */

import type * as RuntimeModule from '@swt-labs/runtime';
import { describe, expect, it, vi } from 'vitest';

import { StringStream } from '../_helpers.js';

describe('rpcHandler — M2 PR-20 deferred state', () => {
  it('catches RpcModeUnavailableError and reports it on stderr (not stdout)', async () => {
    const { rpcHandler } = await import('../../src/commands/rpc.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await rpcHandler(
      { verb: 'rpc', positionals: [], flags: {} },
      { cwd: '/tmp', stdout, stderr },
    );

    // Stdout MUST be empty — Pi reserves it for the RPC protocol stream.
    expect(stdout.text()).toBe('');
    // Stderr carries the deferred-mode error message.
    expect(stderr.text()).toContain('M3 PR-22');
    expect(stderr.text()).toContain('AgentSessionRuntime');
    // EXIT.NOT_IMPLEMENTED — distinguishable from RUNTIME_ERROR.
    expect(exit).toBe(2);
  });

  it('returns EXIT.RUNTIME_ERROR (3) for unexpected errors', async () => {
    // Stub out the runtime module to throw a non-deferred-mode error,
    // simulating an unforeseen failure mode (e.g., a Pi version mismatch).
    vi.resetModules();
    vi.doMock('@swt-labs/runtime', async () => {
      const actual = await vi.importActual<typeof RuntimeModule>('@swt-labs/runtime');
      return {
        ...actual,
        runRpc: async (): Promise<never> => {
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

  it('reserves stdout for the Pi RPC log stream — never writes to it', async () => {
    vi.resetModules();
    const { rpcHandler } = await import('../../src/commands/rpc.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    await rpcHandler({ verb: 'rpc', positionals: [], flags: {} }, { cwd: '/tmp', stdout, stderr });

    // The whole point of the stdout/stderr convention: Pi reserves
    // stdout for line-delimited JSON. Anything SWT writes to stdout
    // would corrupt the protocol stream the moment activation lands.
    expect(stdout.text()).toBe('');
  });
});
