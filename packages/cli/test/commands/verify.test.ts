/**
 * Plan 03-03 (Phase 3) Task T2 — swt verify INLINE handler coverage.
 *
 * Invariants under test:
 *   - Registered in buildRegistry()
 *   - DOES NOT call spawnAgent / spawnOrchestratorSession (R3)
 *   - Iterates one askUser per scenario; PASS path writes all-PASS UAT.md
 *   - FAIL path captures the failure note via a follow-up askUser
 *   - verify_scope='remediation' + FAIL → execSync(prepare-reverification.sh)
 *   - Returns EXIT.SUCCESS when the loop completes
 */

import type { PathLike, PathOrFileDescriptor } from 'node:fs';

import type { PhaseDetectResult } from '@swt-labs/methodology';
import type * as SwtRuntime from '@swt-labs/runtime';
import type { AskUserResponse } from '@swt-labs/runtime';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Phase 03 G-03 T5: controllable mock for resolveInstallRoot — toggled in the
// missing-precondition / io.cwd-bug regression test. Defaults to passthrough
// so existing tests see the real runtime resolver.
const runtimeMockState = vi.hoisted(() => ({ resolveInstallRootShouldThrow: false }));
vi.mock('@swt-labs/runtime', async () => {
  const actual = await vi.importActual<typeof SwtRuntime>('@swt-labs/runtime');
  return {
    ...actual,
    resolveInstallRoot: () => {
      if (runtimeMockState.resolveInstallRootShouldThrow) {
        throw new Error(
          'swt:installRoot — could not locate the SWT package root. Set SWT_INSTALL_ROOT explicitly.',
        );
      }
      return actual.resolveInstallRoot();
    },
  };
});

import {
  extractFromVerification,
  extractFromPlanSuccessCriteria,
  makeVerifyHandler,
  renderUatArtifact,
  resolvePhaseId,
} from '../../src/commands/verify.js';
import { buildRegistry } from '../../src/main.js';
import type { CommandIO } from '../../src/router.js';

const REPO_ROOT = '/tmp/swt-verify-test-repo';

const STUB_VERIFICATION_MD = `---
phase: 03
---

# Phase 03 Verification

## UAT Scenarios

- Scenario A — orchestrator routes priority 2 correctly
- Scenario B — orchestrator routes priority 7 correctly
- Scenario C — askUser is registered ONLY on orchestrator session
`;

const STUB_PLAN_MD = `---
plan: 03-03
---

<success_criteria>
- swt qa is registered and spawns a QA agent
- swt verify runs INLINE without a Pi spawn
- swt map fan-outs 4 scouts in parallel
</success_criteria>
`;

interface HarnessOpts {
  readonly positionals?: readonly string[];
  /** Sequenced askUser responses (consumed in order). */
  readonly askResponses?: ReadonlyArray<AskUserResponse>;
  /** verify_scope in config.json (none if undefined). */
  readonly verifyScope?: 'milestone' | 'remediation';
  /** When true, the VERIFICATION.md fixture exists; otherwise only PLAN.md. */
  readonly hasVerification?: boolean;
  readonly detected?: Partial<PhaseDetectResult>;
}

function buildVerifyHarness(opts: HarnessOpts = {}) {
  const hasVerification = opts.hasVerification ?? true;
  const askResponses = opts.askResponses ?? [];
  let askIdx = 0;
  const askUserImpl = vi.fn(async () => {
    const r = askResponses[askIdx];
    askIdx += 1;
    return r ?? { selectedOption: 'Pass', freeform: null };
  });

  const detectPhaseImpl = vi.fn(
    async () =>
      ({
        next_phase: '03',
        next_phase_slug: '03-orchestrator-wiring-swt-cook',
        ...opts.detected,
      }) as PhaseDetectResult,
  );

  const phaseSlug = '03-orchestrator-wiring-swt-cook';
  const phaseDir = `.swt-planning/phases/${phaseSlug}`;

  const existsSyncImpl = vi.fn((p: PathLike) => {
    const s = String(p);
    if (s.endsWith('config.json')) return opts.verifyScope !== undefined;
    if (s.endsWith(phaseDir)) return true;
    if (s.endsWith(`${phaseSlug}`)) return true;
    if (s.endsWith('phases')) return true;
    if (s.endsWith('03-VERIFICATION.md')) return hasVerification;
    return false;
  });

  const readdirSyncImpl = vi.fn((p: PathLike) => {
    const s = String(p);
    if (s.endsWith('phases')) return [phaseSlug] as never;
    if (s.endsWith(phaseSlug)) {
      const out = ['03-03-PLAN.md'];
      if (hasVerification) out.push('03-VERIFICATION.md');
      return out as never;
    }
    return [] as never;
  });

  const readFileSyncImpl = vi.fn((p: PathOrFileDescriptor, _enc?: unknown) => {
    const s = String(p);
    if (s.endsWith('config.json')) {
      return JSON.stringify({ verify_scope: opts.verifyScope, max_uat_remediation_rounds: 2 });
    }
    if (s.endsWith('03-VERIFICATION.md')) return STUB_VERIFICATION_MD;
    if (s.endsWith('-PLAN.md')) return STUB_PLAN_MD;
    return '';
  });

  const writtenFiles = new Map<string, string>();
  const writeFileSyncImpl = vi.fn(
    (p: PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, _enc?: unknown) => {
      writtenFiles.set(
        String(p),
        typeof data === 'string' ? data : Buffer.from(data).toString('utf8'),
      );
    },
  );
  const mkdirSyncImpl = vi.fn(() => undefined as never);
  const execSyncImpl = vi.fn(() => '' as unknown as Buffer);

  const handler = makeVerifyHandler({
    askUserImpl: askUserImpl,
    detectPhaseImpl: detectPhaseImpl,
    existsSyncImpl: existsSyncImpl,
    readdirSyncImpl: readdirSyncImpl,
    readFileSyncImpl: readFileSyncImpl as never,
    writeFileSyncImpl: writeFileSyncImpl,
    mkdirSyncImpl: mkdirSyncImpl,
    execSyncImpl: execSyncImpl as never,
  });

  const stderr: string[] = [];
  const stdout: string[] = [];
  const io: CommandIO = {
    cwd: REPO_ROOT,
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      },
    } as unknown as NodeJS.WritableStream,
  };

  async function run(positionals: readonly string[] = opts.positionals ?? ['03']) {
    return handler({ verb: 'verify', positionals, flags: {} }, io);
  }

  return {
    run,
    askUserImpl,
    detectPhaseImpl,
    writeFileSyncImpl,
    execSyncImpl,
    writtenFiles,
    stderr: () => stderr.join(''),
    stdout: () => stdout.join(''),
  };
}

beforeAll(() => {
  process.env['SWT_INSTALL_ROOT'] = REPO_ROOT;
  process.env['SWT_SESSION_ID'] = 'verify-test-session';
});

describe('@swt-labs/cli — verifyHandler scenario extraction (Plan 03-03 T2)', () => {
  it('extracts UAT scenarios from a VERIFICATION.md ## UAT Scenarios block', () => {
    const scenarios = extractFromVerification(STUB_VERIFICATION_MD, '03');
    expect(scenarios).toHaveLength(3);
    expect(scenarios[0]?.id).toBe('P03-T01');
    expect(scenarios[0]?.description).toContain('Scenario A');
  });

  it('falls back to PLAN.md <success_criteria> bullets when VERIFICATION.md is absent', () => {
    const scenarios = extractFromPlanSuccessCriteria(STUB_PLAN_MD, '03-03');
    expect(scenarios).toHaveLength(3);
    expect(scenarios[0]?.description).toContain('swt qa is registered');
  });

  it('resolvePhaseId normalises bare ints, padded ids, and slugs', () => {
    expect(resolvePhaseId('3', undefined).padded).toBe('03');
    expect(resolvePhaseId('03', undefined).padded).toBe('03');
    expect(resolvePhaseId('03-orchestrator', undefined).slug).toBe('03-orchestrator');
    expect(resolvePhaseId(undefined, '07').padded).toBe('07');
  });

  it('renderUatArtifact emits valid frontmatter + sections with PASS/FAIL/SKIP counts', () => {
    const startedIso = '2026-05-13T12:00:00.000Z';
    const out = renderUatArtifact(
      '03',
      [
        {
          scenario: { id: 'P03-T01', planId: '03', description: 'Scenario A', steps: 'Scenario A' },
          verdict: 'pass',
          note: null,
        },
        {
          scenario: { id: 'P03-T02', planId: '03', description: 'Scenario B', steps: 'Scenario B' },
          verdict: 'fail',
          note: 'Broken on Wave 3',
        },
      ],
      startedIso,
    );
    expect(out).toContain('phase: 3');
    expect(out).toContain('passed: 1');
    expect(out).toContain('issues: 1');
    expect(out).toContain('status: issues_found');
    expect(out).toContain('Broken on Wave 3');
  });
});

describe('@swt-labs/cli — verifyHandler integration (Plan 03-03 T2)', () => {
  it('is registered in buildRegistry() as a real verb (not a stub)', () => {
    const reg = buildRegistry();
    const spec = reg.get('verify');
    expect(spec).toBeDefined();
    expect(spec?.description.toLowerCase()).toContain('inline');
  });

  it('writes an all-PASS UAT.md when every scenario is acknowledged Pass', async () => {
    const h = buildVerifyHarness({
      askResponses: [
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Pass', freeform: null },
      ],
    });
    const exit = await h.run();
    expect(exit).toBe(0);
    // 3 scenarios → 3 askUser calls (no follow-up notes for PASS)
    expect(h.askUserImpl).toHaveBeenCalledTimes(3);
    expect(h.writeFileSyncImpl).toHaveBeenCalledTimes(1);
    const written = [...h.writtenFiles.values()][0]!;
    expect(written).toContain('passed: 3');
    expect(written).toContain('issues: 0');
    expect(written).toContain('status: complete');
  });

  it('captures the failure note via a follow-up askUser on FAIL', async () => {
    const h = buildVerifyHarness({
      askResponses: [
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Fail', freeform: null },
        { selectedOption: null, freeform: 'orchestrator wiring is broken' },
        { selectedOption: 'Pass', freeform: null },
      ],
    });
    const exit = await h.run();
    expect(exit).toBe(0);
    // 3 verdicts + 1 follow-up note (only for the FAIL) = 4 askUser calls
    expect(h.askUserImpl).toHaveBeenCalledTimes(4);
    const written = [...h.writtenFiles.values()][0]!;
    expect(written).toContain('orchestrator wiring is broken');
    expect(written).toContain('issues: 1');
  });

  it('R3 invariant — verify never IMPORTS or CALLS spawnAgent / spawnOrchestratorSession', async () => {
    // Code-level guard: the verify.ts module must not import or invoke
    // either spawn primitive. The function names are mentioned in the
    // R3 header comment block for context, so we check only lines that
    // are NOT comments. Removing block comments + line comments before
    // grep is the standard way to do this in TS source-level tests.
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/commands/verify.ts', import.meta.url), 'utf8');
    // Strip /* ... */ block comments and // line comments before testing.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(codeOnly).not.toContain('spawnAgent');
    expect(codeOnly).not.toContain('spawnOrchestratorSession');
  });

  it('seeds re-verification via execSync when verify_scope=remediation AND a FAIL is recorded', async () => {
    const h = buildVerifyHarness({
      verifyScope: 'remediation',
      askResponses: [
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Fail', freeform: null },
        { selectedOption: null, freeform: 'reproduce in CI' },
        { selectedOption: 'Pass', freeform: null },
      ],
    });
    const exit = await h.run();
    expect(exit).toBe(0);
    expect(h.execSyncImpl).toHaveBeenCalledTimes(1);
    const cmd = String(h.execSyncImpl.mock.calls[0]?.[0]);
    expect(cmd).toContain('prepare-reverification.sh');
  });

  it('does NOT seed re-verification when verify_scope=remediation but every scenario PASSed', async () => {
    const h = buildVerifyHarness({
      verifyScope: 'remediation',
      askResponses: [
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Pass', freeform: null },
      ],
    });
    await h.run();
    expect(h.execSyncImpl).not.toHaveBeenCalled();
  });

  it('does NOT seed re-verification when verify_scope=milestone even with failures', async () => {
    const h = buildVerifyHarness({
      verifyScope: 'milestone',
      askResponses: [
        { selectedOption: 'Fail', freeform: null },
        { selectedOption: null, freeform: 'broken' },
        { selectedOption: 'Pass', freeform: null },
        { selectedOption: 'Pass', freeform: null },
      ],
    });
    await h.run();
    expect(h.execSyncImpl).not.toHaveBeenCalled();
  });

  // Phase 03 G-03 T5 — DEVN-PHASE-03-CRITICAL-VERIFY-IO-CWD-BUG regression guard.
  // The previous verify.ts:453 fell back to `io.cwd` (the user's project dir)
  // when SWT_INSTALL_ROOT was unset, silently loading scripts from the wrong
  // filesystem location. After the fix, verify.ts calls resolveInstallRoot()
  // which throws on missing env. This test asserts EXIT.RUNTIME_ERROR + the
  // SWT_INSTALL_ROOT diagnostic message.
  it('exits EXIT.RUNTIME_ERROR when resolveInstallRoot throws in remediation path', async () => {
    runtimeMockState.resolveInstallRootShouldThrow = true;
    try {
      const h = buildVerifyHarness({
        verifyScope: 'remediation',
        askResponses: [
          { selectedOption: 'Pass', freeform: null },
          { selectedOption: 'Fail', freeform: null },
          { selectedOption: null, freeform: 'reproduce in CI' },
          { selectedOption: 'Pass', freeform: null },
        ],
      });
      const exit = await h.run();
      expect(exit).toBe(3);
      expect(h.stderr()).toContain('SWT_INSTALL_ROOT');
      // execSync must NOT have been invoked — the throw fires before the
      // script-path resolution would reach `prepare-reverification.sh`.
      expect(h.execSyncImpl).not.toHaveBeenCalled();
    } finally {
      runtimeMockState.resolveInstallRootShouldThrow = false;
    }
  });
});
