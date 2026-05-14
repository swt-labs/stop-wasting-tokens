/**
 * `swt bench` handler tests (M3 PR-T — post runMilestone activation).
 *
 * Post-PR-T the handler:
 *
 *   1. With no cassettes recorded (today's repo state), `runMilestone`
 *      throws `CassetteNotRecordedError`; the handler catches it,
 *      reports on stderr, returns `EXIT.NOT_IMPLEMENTED` (2).
 *   2. With cassettes + a planned fixture, runMilestone returns real
 *      MeterSnapshot + criteriaSatisfied; bench emits a validated
 *      TpacReport. Tested here by mocking runMilestone.
 *   3. NoSatisfiedCriteriaError (zero must_haves) lands on
 *      EXIT.NOT_IMPLEMENTED (caller should record cassettes + fixture
 *      with at least one passing must_have).
 *   4. Unexpected errors land in `EXIT.RUNTIME_ERROR` (3).
 *   5. Flag defaults + overrides propagate through to `runMilestone`.
 */

import type * as TestUtilsModule from '@swt-labs/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { StringStream } from '../_helpers.js';

describe('benchHandler — M3 PR-T live state', () => {
  it('returns NOT_IMPLEMENTED + reports CassetteNotRecordedError on stderr when no cassettes are recorded', async () => {
    vi.resetModules();
    // Hermetic: mock `runMilestone` to throw `CassetteNotRecordedError` rather
    // than depending on the ambient repo cassette dir. Once a (placeholder or
    // real) cassette is committed under `packages/test-utils/cassettes/`, the
    // real `runMilestone` no longer throws and this case's "no cassettes"
    // premise goes stale — so mock it, mirroring cases 2/3/5 below.
    vi.doMock('@swt-labs/test-utils', async () => {
      const actual = await vi.importActual<typeof TestUtilsModule>('@swt-labs/test-utils');
      return {
        ...actual,
        runMilestone: async () => {
          throw new actual.CassetteNotRecordedError('packages/test-utils/cassettes');
        },
      };
    });
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

    vi.doUnmock('@swt-labs/test-utils');
    vi.resetModules();
  });

  it('emits a validated TpacReport to stdout when runMilestone returns enriched fields', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/test-utils', async () => {
      const actual = await vi.importActual<typeof TestUtilsModule>('@swt-labs/test-utils');
      return {
        ...actual,
        runMilestone: async () => ({
          artefactsPath: '/tmp/fake-artefacts',
          cassettesActivated: ['scout-noop'],
          replayHandles: [],
          meterSnapshot: {
            records: [
              {
                timestamp: '2026-05-12T19:00:00.000Z',
                milestone: 'M2',
                phase: '01',
                task_id: 'T-001',
                role: 'dev',
                tier: 'balanced',
                provider: 'anthropic',
                model: 'claude-sonnet-4-5-20250929',
                turn: 1,
                input: 1200,
                output: 340,
                cacheRead: 0,
                cacheWrite: 0,
              },
            ],
            totals: { input: 1200, output: 340, cacheRead: 0, cacheWrite: 0 },
          },
          criteriaSatisfied: 4,
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

    expect(exit).toBe(0);
    expect(stderr.text()).toBe('');
    const json = JSON.parse(stdout.text()) as Record<string, unknown>;
    expect(json['schema_version']).toBe(1);
    expect(json['milestone']).toBe('M2');
    expect(json['fixture']).toBe('ref-fastapi-empty');
    expect(json['tpac_input']).toBe(1200);
    expect(json['tpac_output']).toBe(340);
    expect(json['tpac_total']).toBe(1540);
    expect(json['criteria_satisfied']).toBe(4);
    expect(json['tokens_per_criterion']).toBe(385);

    vi.doUnmock('@swt-labs/test-utils');
    vi.resetModules();
  });

  it('returns NOT_IMPLEMENTED when criteriaSatisfied is 0 (NoSatisfiedCriteriaError)', async () => {
    vi.resetModules();
    vi.doMock('@swt-labs/test-utils', async () => {
      const actual = await vi.importActual<typeof TestUtilsModule>('@swt-labs/test-utils');
      return {
        ...actual,
        runMilestone: async () => ({
          artefactsPath: '/tmp/fake-artefacts',
          cassettesActivated: [],
          replayHandles: [],
          meterSnapshot: {
            records: [],
            totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
          criteriaSatisfied: 0,
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
    expect(stderr.text()).toContain('criteria_satisfied');
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
        runMilestone: async () => {
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
        runMilestone: async (opts: { fixture: string; cassettesDir?: string }) => {
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
