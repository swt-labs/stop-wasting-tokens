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
 * **Today's behaviour (PR-T):** the live emit path is wired. `runMilestone`
 * drives `runVibe` against the fixture and returns a real `MeterSnapshot`
 * + `criteriaSatisfied`; this handler reduces that to a validated
 * `TpacReport` and emits JSON to stdout (or `--output <file>`). The
 * remaining gate is cassette presence — `CassetteNotRecordedError` and
 * `NoSatisfiedCriteriaError` map to `EXIT.NOT_IMPLEMENTED` (2);
 * unexpected errors map to `EXIT.RUNTIME_ERROR` (3). Recording the
 * Anthropic cassettes + pre-populating the fixture remain user-driven
 * follow-ups.
 */

import { writeFileSync } from 'node:fs';
import { posix } from 'node:path';

import { computeTpac, NoSatisfiedCriteriaError } from '@swt-labs/orchestration';
import { TpacReportSchema, type TpacReport } from '@swt-labs/shared';
import {
  CassetteNotRecordedError,
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
    run = await runMilestone({
      fixture: fixtureRoot,
      milestone: opts.milestone,
      ...(opts.cassettesDir !== undefined ? { cassettesDir: opts.cassettesDir } : {}),
    });
    const report = computeTpac(run.meterSnapshot, {
      milestone: opts.milestone,
      fixture: opts.fixture,
      provider: opts.provider,
      criteria_satisfied: run.criteriaSatisfied,
    });
    emitReport(io, opts.outputPath, report);
    return EXIT.SUCCESS;
  } catch (err) {
    if (err instanceof CassetteNotRecordedError || err instanceof NoSatisfiedCriteriaError) {
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
  flags: Readonly<Record<string, string | string[] | boolean | undefined>>,
): BenchOptions {
  return {
    fixture: stringFlag(flags['fixture']) ?? DEFAULT_FIXTURE,
    provider: stringFlag(flags['provider']) ?? DEFAULT_PROVIDER,
    milestone: stringFlag(flags['milestone']) ?? DEFAULT_MILESTONE,
    cassettesDir: stringFlag(flags['cassettes']),
    outputPath: stringFlag(flags['output']),
  };
}

function stringFlag(value: string | string[] | boolean | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveFixtureDir(cwd: string, fixture: string): string {
  const dir = FIXTURE_DIRS[fixture] ?? fixture;
  // ADR-009: keep fixture paths POSIX-form even on Windows runners.
  return posix.join(cwd.replace(/\\/g, '/'), 'packages', 'test-utils', 'golden', dir);
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
