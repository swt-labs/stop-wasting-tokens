/**
 * `runAgentParity` — per-role parity harness per Phase 5 plan 05-02 §5.1.
 *
 * Drives a single SWT agent role against a frozen fixture spec, replays the
 * recorded cassette for that role's LLM round-trips, and diffs the produced
 * artefacts against the v2.3.5 baseline using the per-role classifier
 * calibration from `diff-artefacts.ts` DEFAULT_CLASSIFIERS.
 *
 * **Test seam, not production.** The harness sets `SWT_DEBUG_ONLY_ROLE`
 * (gated on `NODE_ENV=test` in cook.ts) so the 11-priority router pins
 * to one role for the duration of the invocation. Tests `afterEach` is
 * responsible for clearing the env var; the harness restores its own
 * mutations in `finally`.
 *
 * **Dependency-cycle guard.** `@swt-labs/cli` already depends on
 * `@swt-labs/test-utils` (for the cassette types). To keep test-utils
 * leaf-level we accept the cook handler as an injected `invokeCook`
 * parameter rather than `import { cookHandler } from '@swt-labs/cli'`.
 * The 7 parity tests under `test/regression/agent-parity/` import
 * cookHandler from the cli package and pass it through.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installReplay, type ReplayHandle } from './cassettes/replayer.js';
import { classify, compareFile, type ArtefactCategory } from './diff-artefacts.js';

export type AgentRole = 'scout' | 'architect' | 'lead' | 'dev' | 'qa' | 'debugger' | 'docs';

/**
 * Outcome of a single per-role parity invocation.
 */
export interface AgentParityViolation {
  readonly path: string;
  readonly category: string;
  readonly detail: string;
}

export interface AgentParityResult {
  readonly violations: ReadonlyArray<AgentParityViolation>;
  /**
   * Snapshot of paths the harness inspected — useful for tests that want
   * to assert the schema-validity floor (non-empty + frontmatter parses)
   * after the harness cleans up its tmpdir.
   */
  readonly artefactsCaptured: Readonly<Record<string, string>>;
}

/**
 * Injected cook handler. The 7 parity tests pass
 * `(opts) => cookHandler(parsed, io)` from `@swt-labs/cli`. Kept abstract
 * here so `test-utils` doesn't have to import the cli package and create
 * a workspace dependency cycle (cli already depends on test-utils for
 * the cassette types).
 */
export type InvokeCook = (opts: InvokeCookOptions) => Promise<void>;

export interface InvokeCookOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface RunAgentParityOptions {
  readonly role: AgentRole;
  /** Fixture name relative to `packages/test-utils/golden/<fixture>/`. */
  readonly fixture: string;
  /** Absolute path to the per-role cassette JSONL. */
  readonly cassettePath: string;
  /**
   * Artefact paths (relative to `.swt-planning/`) that the test expects
   * the role to produce + diff against the baseline. Each is classified
   * by `DEFAULT_CLASSIFIERS` to pick the comparator.
   */
  readonly expectedArtefacts: ReadonlyArray<string>;
  /**
   * Injected cook handler. Required when the baseline tree is present
   * (the harness invokes it to drive the role). Tests that only exercise
   * the harness shape can omit it — the baseline-missing early-return
   * fires before the invocation.
   */
  readonly invokeCook?: InvokeCook;
  /** Override the fixture spec dir (defaults to `golden/<fixture>/spec`). */
  readonly fixtureRoot?: string;
  /** Override the baseline dir (defaults to `golden/<fixture>/v2-baseline/.swt-planning`). */
  readonly baselineRoot?: string;
  /**
   * Optional override for the golden tree root used by the default fixture
   * resolver. Defaults to the test-utils package's `golden/` folder. Tests
   * that point at a synthetic fixture pass an absolute path here.
   */
  readonly goldenRoot?: string;
}

/**
 * Invoke a single SWT agent role against a fixture, replay its cassette,
 * and diff the produced artefacts. Returns `violations: []` on full
 * parity; one entry per divergence otherwise.
 *
 * When the v2-baseline tree is absent (plan 05-04 owns its recording),
 * the harness returns early with a single `baseline-missing` violation so
 * downstream tests can `describe.skipIf(baselineMissing)` cleanly without
 * spending cycles on the cassette install + cook invocation.
 */
export async function runAgentParity(opts: RunAgentParityOptions): Promise<AgentParityResult> {
  const goldenRoot = opts.goldenRoot ?? defaultGoldenRoot();
  const fixtureRoot = opts.fixtureRoot ?? join(goldenRoot, opts.fixture, 'spec');
  const baselineRoot =
    opts.baselineRoot ?? join(goldenRoot, opts.fixture, 'v2-baseline', '.swt-planning');

  // Baseline absent — emit a single skip-style violation and bail early.
  // Plan 05-04 records v2-baseline/; until then the per-role tests are
  // skipIf-guarded on `existsSync(BASELINE)` at the describe level, so this
  // path mostly serves the harness's own unit test.
  if (!existsSync(baselineRoot)) {
    return {
      violations: [
        {
          path: baselineRoot,
          category: 'baseline-missing',
          detail: 'v2-baseline/.swt-planning not recorded (plan 05-04 owns)',
        },
      ],
      artefactsCaptured: {},
    };
  }

  if (!existsSync(fixtureRoot)) {
    throw new Error(`runAgentParity: fixture spec not found at ${fixtureRoot}`);
  }
  if (!existsSync(opts.cassettePath)) {
    throw new Error(`runAgentParity: cassette not found at ${opts.cassettePath}`);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), `swt-parity-${opts.role}-`));
  cpSync(fixtureRoot, tmpRoot, { recursive: true });

  let handle: ReplayHandle | undefined;
  const prevEnv: Record<string, string | undefined> = {
    NODE_ENV: process.env['NODE_ENV'],
    SWT_DEBUG_ONLY_ROLE: process.env['SWT_DEBUG_ONLY_ROLE'],
    SWT_PLANNING_ROOT: process.env['SWT_PLANNING_ROOT'],
  };

  try {
    handle = installReplay(opts.cassettePath);
    process.env['NODE_ENV'] = 'test';
    process.env['SWT_DEBUG_ONLY_ROLE'] = opts.role;
    process.env['SWT_PLANNING_ROOT'] = join(tmpRoot, '.swt-planning');

    if (opts.invokeCook !== undefined) {
      await opts.invokeCook({
        cwd: tmpRoot,
        env: {
          NODE_ENV: 'test',
          SWT_DEBUG_ONLY_ROLE: opts.role,
          SWT_PLANNING_ROOT: join(tmpRoot, '.swt-planning'),
        },
      });
    }

    return diffArtefactsForRole(tmpRoot, baselineRoot, opts.expectedArtefacts);
  } finally {
    if (handle !== undefined) {
      try {
        handle.uninstall();
      } catch {
        // best-effort tear-down
      }
    }
    restoreEnv(prevEnv);
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort tear-down
    }
  }
}

function diffArtefactsForRole(
  tmpRoot: string,
  baselineRoot: string,
  expectedArtefacts: ReadonlyArray<string>,
): AgentParityResult {
  const violations: AgentParityViolation[] = [];
  const artefactsCaptured: Record<string, string> = {};

  for (const rel of expectedArtefacts) {
    const actualPath = join(tmpRoot, '.swt-planning', rel);
    const expectedPath = join(baselineRoot, rel);

    if (!existsSync(actualPath)) {
      violations.push({
        path: rel,
        category: 'missing',
        detail: `actual artefact not produced at ${actualPath}`,
      });
      continue;
    }
    if (!existsSync(expectedPath)) {
      violations.push({
        path: rel,
        category: 'baseline-missing',
        detail: `baseline has no ${rel}; cannot diff`,
      });
      continue;
    }

    const actual = readFileSync(actualPath, 'utf8');
    const expected = readFileSync(expectedPath, 'utf8');
    artefactsCaptured[rel] = actual;

    const category = classify(rel);
    const detail = compareFile(actual, expected, category);
    if (detail !== undefined) {
      violations.push({ path: rel, category, detail });
    }
  }

  return { violations, artefactsCaptured };
}

function defaultGoldenRoot(): string {
  // packages/test-utils/src/run-agent-parity.ts → packages/test-utils/golden
  return join(import.meta.dirname ?? '.', '..', 'golden');
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

// Re-export the underlying classifier types so the parity tests can type
// their `expectedArtefacts` against the same surface the harness uses.
export type { ArtefactCategory };
