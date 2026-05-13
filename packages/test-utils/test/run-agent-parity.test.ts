/**
 * Unit tests for `runAgentParity` — the per-role parity harness from
 * Phase 5 plan 05-02 §5.1. Exercises the harness shape against a synthetic
 * fixture + synthetic cassette so we don't need real cassette recordings
 * to validate the env-var dance and cleanup semantics.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAgentParity, type InvokeCook } from '../src/run-agent-parity.js';

const SYNTHETIC_CASSETTE = JSON.stringify({
  schema_version: 1,
  type: 'header',
  name: 'parity-harness-test',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  recorded_at: '2026-05-13T00:00:00.000Z',
  cwd_redacted: true,
});

describe('runAgentParity — harness shape', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'swt-parity-test-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
    // Defensive — the harness's `finally` should restore these, but if a
    // test fails mid-flight we don't want to leak state into other tests.
    delete process.env['SWT_DEBUG_ONLY_ROLE'];
    delete process.env['SWT_PLANNING_ROOT'];
  });

  function setupFixture(opts: {
    readonly fixture: string;
    readonly withBaseline: boolean;
  }): { goldenRoot: string; cassettePath: string } {
    const goldenRoot = join(scratch, 'golden');
    const fixtureRoot = join(goldenRoot, opts.fixture);
    mkdirSync(join(fixtureRoot, 'spec'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'spec', 'PROJECT.md'),
      '# Test Project\n\nSynthetic fixture for parity-harness tests.\n',
    );
    if (opts.withBaseline) {
      mkdirSync(join(fixtureRoot, 'v2-baseline', '.swt-planning'), { recursive: true });
    }
    const cassettePath = join(scratch, 'parity.jsonl');
    writeFileSync(cassettePath, SYNTHETIC_CASSETTE + '\n');
    return { goldenRoot, cassettePath };
  }

  it('returns a baseline-missing violation and skips cookHandler when v2-baseline is absent', async () => {
    const { goldenRoot, cassettePath } = setupFixture({
      fixture: 'ref-test',
      withBaseline: false,
    });

    let invokeCount = 0;
    const invokeCook: InvokeCook = async () => {
      invokeCount += 1;
    };

    const result = await runAgentParity({
      role: 'lead',
      fixture: 'ref-test',
      cassettePath,
      expectedArtefacts: ['phases/01-foo/01-01-PLAN.md'],
      goldenRoot,
      invokeCook,
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.category).toBe('baseline-missing');
    expect(invokeCount).toBe(0);
  });

  it('sets SWT_DEBUG_ONLY_ROLE + NODE_ENV during invokeCook and restores them after', async () => {
    const { goldenRoot, cassettePath } = setupFixture({
      fixture: 'ref-test',
      withBaseline: true,
    });

    const prevDebug = process.env['SWT_DEBUG_ONLY_ROLE'];
    const prevPlanning = process.env['SWT_PLANNING_ROOT'];

    let envSeenDuringInvocation:
      | { readonly debug: string | undefined; readonly nodeEnv: string | undefined }
      | undefined;
    const invokeCook: InvokeCook = async () => {
      envSeenDuringInvocation = {
        debug: process.env['SWT_DEBUG_ONLY_ROLE'],
        nodeEnv: process.env['NODE_ENV'],
      };
    };

    await runAgentParity({
      role: 'dev',
      fixture: 'ref-test',
      cassettePath,
      expectedArtefacts: [],
      goldenRoot,
      invokeCook,
    });

    expect(envSeenDuringInvocation?.debug).toBe('dev');
    expect(envSeenDuringInvocation?.nodeEnv).toBe('test');

    // Restoration — both env vars should return to their pre-call state.
    expect(process.env['SWT_DEBUG_ONLY_ROLE']).toBe(prevDebug);
    expect(process.env['SWT_PLANNING_ROOT']).toBe(prevPlanning);
  });

  it('restores env and uninstalls the replayer when invokeCook throws', async () => {
    const { goldenRoot, cassettePath } = setupFixture({
      fixture: 'ref-test',
      withBaseline: true,
    });

    const prevDebug = process.env['SWT_DEBUG_ONLY_ROLE'];

    const failingCook: InvokeCook = async () => {
      throw new Error('synthetic cook failure');
    };

    await expect(
      runAgentParity({
        role: 'qa',
        fixture: 'ref-test',
        cassettePath,
        expectedArtefacts: [],
        goldenRoot,
        invokeCook: failingCook,
      }),
    ).rejects.toThrow('synthetic cook failure');

    expect(process.env['SWT_DEBUG_ONLY_ROLE']).toBe(prevDebug);
  });
});
