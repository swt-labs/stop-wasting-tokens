/**
 * `swt bench` — TPAC reference benchmark per TDD2 §3.2 + §14.9.
 *
 * The user-facing wrapper on the same machinery the regression test
 * (`test/regression/ref-fastapi.regression.test.ts`) consumes:
 *
 *   1. `runMilestone` from `@swt-labs/test-utils` (PR-18) replays the
 *      Anthropic cassettes against the frozen `ref-fastapi-empty`
 *      fixture and returns the resulting `MeterSnapshot`.
 *   2. `computeTpac` from `@swt-labs/orchestration` (PR-19) reduces
 *      that snapshot into a milestone-scoped `TpacReport`.
 *   3. The report is validated against `TpacReportSchema`
 *      (`@swt-labs/shared`) at the emit boundary and printed as JSON to
 *      stdout (or `--output <file>` when set).
 *
 * Per Principle 1 (TDD2 §4.3): the handler does NOT import
 * `@earendil-works/*` directly — the Pi session lives behind the
 * `@swt-labs/test-utils`/`@swt-labs/runtime` boundary.
 *
 * **Today's behaviour:** the structural chain (CLI → test-utils →
 * orchestration → shared) is locked in place but the live milestone
 * invocation is deferred until M3 PR-22 wires real Pi prompting.
 * `runMilestone` throws `CassetteNotRecordedError` (no cassettes
 * recorded yet) or `MilestoneInvocationDeferredError` (cassettes
 * present, prompt() still a no-op). Both errors land on stderr with
 * exit code `EXIT.NOT_IMPLEMENTED` (2). Unexpected errors land on
 * `EXIT.RUNTIME_ERROR` (3). Once PR-22 activates `runMilestone`'s real
 * return path, this handler emits a validated TpacReport without any
 * other change to the CLI surface.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeTpac, NoSatisfiedCriteriaError } from '@swt-labs/orchestration';
import { TpacReportSchema, type MeterSnapshot, type TpacReport } from '@swt-labs/shared';
import {
  CassetteNotRecordedError,
  MilestoneInvocationDeferredError,
  disposeRun,
  runMilestone,
  type RunMilestoneResult,
} from '@swt-labs/test-utils';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export const DEFAULT_FIXTURE = 'ref-fastapi-empty';
export const DEFAULT_PROVIDER = 'anthropic';
export const DEFAULT_MILESTONE = 'M2';

/**
 * Conceptual fixture name → on-disk directory name under
 * `packages/test-utils/golden/`. The conceptual name is what appears
 * in `TpacReport.fixture` + `.vbw-planning/v3-tracking.md` Metrics
 * table; the directory name is the path the harness reads. They
 * diverge for the M2 baseline because the fixture covers an empty
 * `phases/` (the conceptual "empty" variant) while the project
 * directory is the broader `ref-fastapi` family.
 */
const FIXTURE_DIRS: Readonly<Record<string, string>> = {
  'ref-fastapi-empty': 'ref-fastapi',
};

interface BenchOptions {
  readonly fixture: string;
  readonly provider: string;
  readonly milestone: string;
  readonly cassettesDir: string | undefined;
  readonly outputPath: string | undefined;
}

export const benchHandler: CommandHandler = async (parsed, io: CommandIO): Promise<ExitCode> => {
  const opts = resolveOptions(parsed.flags);
  let run: RunMilestoneResult | undefined;
  try {
    const fixtureRoot = resolveFixtureDir(io.cwd, opts.fixture);
    run = runMilestone({
      fixture: fixtureRoot,
      ...(opts.cassettesDir !== undefined ? { cassettesDir: opts.cassettesDir } : {}),
    });
    // M3 PR-22 activation point: `runMilestone` will return a
    // `MeterSnapshot` + a `criteria_satisfied` count harvested from
    // the QA result. Until then the call above throws — this branch
    // is unreachable today but locks the contract for the flip.
    const harvest = await harvestRunResult(run);
    const report = computeTpac(harvest.snapshot, {
      milestone: opts.milestone,
      fixture: opts.fixture,
      provider: opts.provider,
      criteria_satisfied: harvest.criteria_satisfied,
    });
    emitReport(io, opts.outputPath, report);
    return EXIT.SUCCESS;
  } catch (err) {
    if (
      err instanceof CassetteNotRecordedError ||
      err instanceof MilestoneInvocationDeferredError ||
      err instanceof NoSatisfiedCriteriaError
    ) {
      io.stderr.write(`${err.message}\n`);
      return EXIT.NOT_IMPLEMENTED;
    }
    io.stderr.write(
      `swt bench: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  } finally {
    if (run !== undefined) {
      disposeRun(run);
    }
  }
};

function resolveOptions(
  flags: Readonly<Record<string, string | boolean | undefined>>,
): BenchOptions {
  return {
    fixture: stringFlag(flags['fixture']) ?? DEFAULT_FIXTURE,
    provider: stringFlag(flags['provider']) ?? DEFAULT_PROVIDER,
    milestone: stringFlag(flags['milestone']) ?? DEFAULT_MILESTONE,
    cassettesDir: stringFlag(flags['cassettes']),
    outputPath: stringFlag(flags['output']),
  };
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveFixtureDir(cwd: string, fixture: string): string {
  const dir = FIXTURE_DIRS[fixture] ?? fixture;
  return join(cwd, 'packages', 'test-utils', 'golden', dir);
}

/**
 * Harvest the meter snapshot + satisfied-criteria count from a
 * completed milestone run. Today this throws
 * `MilestoneInvocationDeferredError` because `runMilestone` itself
 * throws before this is called — the function exists so the M3 PR-22
 * flip is local (replace the body with the real harvest off
 * `run.meterSnapshot` + `run.criteriaSatisfied` once those fields
 * land on `RunMilestoneResult`).
 */
async function harvestRunResult(
  _run: RunMilestoneResult,
): Promise<{ snapshot: MeterSnapshot; criteria_satisfied: number }> {
  throw new MilestoneInvocationDeferredError();
}

function emitReport(io: CommandIO, outputPath: string | undefined, report: TpacReport): void {
  const validated = TpacReportSchema.parse(report);
  const serialised = `${JSON.stringify(validated, null, 2)}\n`;
  if (outputPath !== undefined) {
    writeFileSync(outputPath, serialised, 'utf8');
    return;
  }
  io.stdout.write(serialised);
}
