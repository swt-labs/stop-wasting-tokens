/**
 * `swt bench` handler tests (M2 PR-21).
 *
 * Today the handler chains through `runMilestone` →
 * `harvestRunResult` → `computeTpac` but `runMilestone` itself throws
 * before the harvest can run. Tests cover the deferred-state
 * contract:
 *
 *   1. With no cassettes recorded (today's repo state), `runMilestone`
 *      throws `CassetteNotRecordedError`; the handler catches it,
 *      reports on stderr, returns `EXIT.NOT_IMPLEMENTED` (2).
 *   2. With `runMilestone` mocked to resolve, the internal
 *      `harvestRunResult` throws `MilestoneInvocationDeferredError`
 *      until M3 PR-22 wires real Pi prompting — also caught,
 *      `EXIT.NOT_IMPLEMENTED`.
 *   3. Unexpected errors land in `EXIT.RUNTIME_ERROR` (3).
 *   4. Flag defaults + overrides propagate through to `runMilestone`'s
 *      arguments. This locks the activation contract so PR-22 can flip
 *      a single line in `bench.ts` (the body of `harvestRunResult`)
 *      without touching the CLI surface.
 *
 * When M3 PR-22 activates real Pi sessions, the first two tests
 * invert (asserting `runMilestone` reaches the real prompt path) and
 * a new test covers the happy path's TpacReport emit. The contract
 * surface stays the same.
 */

import type * as TestUtilsModule from '@swt-labs/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { StringStream } from '../_helpers.js';

describe('benchHandler — M2 PR-21 deferred state', () => {
  it('returns NOT_IMPLEMENTED + reports CassetteNotRecordedError on stderr when no cassettes are recorded', async () => {
    vi.resetModules();
    const { benchHandler } = await import('../../src/commands/bench.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await benchHandler(
      { verb: 'bench', positionals: [], flags: {} },
      { cwd: process.cwd(), stdout, stderr },
    );

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('No cassettes found');
    expect(stderr.text()).toContain('docs/operations/cassette-recording.md');
    expect(exit).toBe(2);
  });

  it('returns NOT_IMPLEMENTED + reports MilestoneInvocationDeferredError when runMilestone resolves but harvest is deferred', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/test-utils', async () => {
      const actual = await vi.importActual<typeof TestUtilsModule>('@swt-labs/test-utils');
      return {
        ...actual,
        runMilestone: () => ({
          artefactsPath: '/tmp/fake-artefacts',
          cassettesActivated: ['scout-noop'],
          replayHandles: [],
        }),
      };
    });
    const { benchHandler } = await import('../../src/commands/bench.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await benchHandler(
      { verb: 'bench', positionals: [], flags: {} },
      { cwd: '/tmp', stdout, stderr },
    );

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('M3 PR-22');
    expect(stderr.text()).toContain('Pi prompting');
    expect(exit).toBe(2);

    vi.doUnmock('@swt-labs/test-utils');
    vi.resetModules();
  });

  it('returns RUNTIME_ERROR (3) for unexpected errors', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/test-utils', async () => {
      const actual = await vi.importActual<typeof TestUtilsModule>('@swt-labs/test-utils');
      return {
        ...actual,
        runMilestone: () => {
          throw new Error('boom — undici dispatcher mid-handshake');
        },
      };
    });
    const { benchHandler } = await import('../../src/commands/bench.js');
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await benchHandler(
      { verb: 'bench', positionals: [], flags: {} },
      { cwd: '/tmp', stdout, stderr },
    );

    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('unexpected error');
    expect(stderr.text()).toContain('boom');
    expect(exit).toBe(3);

    vi.doUnmock('@swt-labs/test-utils');
    vi.resetModules();
  });

  it('propagates flag defaults + overrides through to runMilestone', async () => {
    vi.resetModules();
    const captured: Array<{ fixture: string; cassettesDir?: string }> = [];
    vi.doMock('@swt-labs/test-utils', async () => {
      const actual = await vi.importActual<typeof TestUtilsModule>('@swt-labs/test-utils');
      return {
        ...actual,
        runMilestone: (opts: { fixture: string; cassettesDir?: string }) => {
          captured.push({ fixture: opts.fixture, cassettesDir: opts.cassettesDir });
          throw new actual.CassetteNotRecordedError(opts.cassettesDir ?? opts.fixture);
        },
      };
    });
    const { benchHandler } = await import('../../src/commands/bench.js');

    // Default fixture (`ref-fastapi-empty` → on-disk `ref-fastapi/`).
    await benchHandler(
      { verb: 'bench', positionals: [], flags: {} },
      { cwd: '/repo', stdout: new StringStream(), stderr: new StringStream() },
    );
    expect(captured[0]?.fixture).toBe('/repo/packages/test-utils/golden/ref-fastapi');
    expect(captured[0]?.cassettesDir).toBeUndefined();

    // Override fixture + cassettes path; the cassettes override is
    // passed through verbatim (no implicit /packages/test-utils/golden/
    // path prefix — overrides are absolute by convention).
    await benchHandler(
      {
        verb: 'bench',
        positionals: [],
        flags: { fixture: 'custom-fixture', cassettes: '/abs/cassettes' },
      },
      { cwd: '/repo', stdout: new StringStream(), stderr: new StringStream() },
    );
    expect(captured[1]?.fixture).toBe('/repo/packages/test-utils/golden/custom-fixture');
    expect(captured[1]?.cassettesDir).toBe('/abs/cassettes');

    vi.doUnmock('@swt-labs/test-utils');
    vi.resetModules();
  });
});
