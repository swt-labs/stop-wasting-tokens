/**
 * Plan 15-01-01 T5 — byte-identical-output regression tests for the
 * 7 cook aliases (plan / execute / discuss / assumptions / archive / phase /
 * audit).
 *
 * For each alias, run `swt <verb> ...` and `swt cook --<flag> ...`
 * through `main()` with `CaptureStream`s wrapping stdout + stderr, then
 * assert:
 *   - stdout byte-identical
 *   - stderr byte-identical
 *   - exit code equal
 *
 * The aliases delegate in-process (see packages/cli/src/lib/alias-to-cook.ts
 * + the DEVN-02 design note there) — they build the same `ParsedArgv`
 * shape that the direct cook invocation builds, then hand to `cookHandler`.
 * In-process delegation makes byte-identicality automatic: no subprocess
 * startup ceremony, no PATH variance, no buffering differences.
 *
 * Test setup uses a tmp dir with **no `.swt-planning/` directory** so
 * cook hits its priority-1 routing branch ("Run swt init first") and
 * exits deterministically — no Pi spawn, no async LLM traffic, no
 * filesystem mutation.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../src/main.js';

class CaptureStream extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Invoke `main(argv)` in-process with capture streams + a clean tmp cwd.
 * Returns the exit code and captured streams as plain strings so the
 * caller can diff them byte-for-byte.
 */
async function runMain(argv: readonly string[], cwd: string): Promise<RunResult> {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  const code = await main(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

describe('Plan 15-01-01 T5 — byte-identical alias output', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swt-aliases-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // The 4 simple-flag aliases. Each maps `swt <verb>` to `swt cook --<flag>`
  // with no per-verb translation logic. Both invocations hit cook's
  // priority-1 init-required branch in our tmp cwd.
  const SIMPLE_CASES: ReadonlyArray<{
    readonly verb: string;
    readonly flag: string;
  }> = [
    { verb: 'execute', flag: '--execute' },
    { verb: 'discuss', flag: '--discuss' },
    { verb: 'assumptions', flag: '--assumptions' },
    { verb: 'archive', flag: '--archive' },
  ];

  for (const { verb, flag } of SIMPLE_CASES) {
    it(`swt ${verb} produces byte-identical output to swt cook ${flag}`, async () => {
      const aliasResult = await runMain([verb], tmp);
      const directResult = await runMain(['cook', flag], tmp);

      expect(aliasResult.stdout).toBe(directResult.stdout);
      expect(aliasResult.stderr).toBe(directResult.stderr);
      expect(aliasResult.code).toBe(directResult.code);
    });
  }

  // `plan` — string-valued flag (cook's `--plan` requires a value per
  // argv.ts:26 `plan: { type: 'string' }`). We test with an explicit NN
  // phase target so both invocations land in the same code path; the
  // alias's `aliasToCookPlan` lifts the first positional into the flag
  // value, producing `flags.plan = '03'` in both cases.
  //
  // DEVIATION NOTE: bare `swt plan` (no positional) is NOT byte-
  // identical to bare `swt cook --plan` — cook's argv parser rejects
  // `--plan` without a value with a USAGE_ERROR ("Option '--plan <value>'
  // argument missing"), while `swt plan` succeeds (its alias synthesizes
  // an empty-string value for flags.plan and reaches cookHandler). This
  // is intentional: the alias removes the surface-level positional
  // requirement. The byte-identicality contract holds for the with-NN
  // case, which is the documented user invocation pattern.
  it('swt plan 03 produces byte-identical output to swt cook --plan 03', async () => {
    const aliasResult = await runMain(['plan', '03'], tmp);
    const directResult = await runMain(['cook', '--plan', '03'], tmp);

    expect(aliasResult.stdout).toBe(directResult.stdout);
    expect(aliasResult.stderr).toBe(directResult.stderr);
    expect(aliasResult.code).toBe(directResult.code);
  });

  // `phase` — no-op forwarder. With no sub-flag set, both `swt phase`
  // and `swt cook` fall through to cook's state-driven routing (priority
  // 1 in our tmp cwd, since no .swt-planning/ exists).
  it('swt phase produces byte-identical output to swt cook (no sub-flag)', async () => {
    const aliasResult = await runMain(['phase'], tmp);
    const directResult = await runMain(['cook'], tmp);

    expect(aliasResult.stdout).toBe(directResult.stdout);
    expect(aliasResult.stderr).toBe(directResult.stderr);
    expect(aliasResult.code).toBe(directResult.code);
  });

  // `audit` — DEVN-02 partial: aliases to `--archive` until cook grows
  // a standalone `--audit-only` flag. Test asserts the partial alias
  // produces the same output as `swt cook --archive`.
  it('swt audit produces byte-identical output to swt cook --archive (DEVN-02 partial)', async () => {
    const aliasResult = await runMain(['audit'], tmp);
    const directResult = await runMain(['cook', '--archive'], tmp);

    expect(aliasResult.stdout).toBe(directResult.stdout);
    expect(aliasResult.stderr).toBe(directResult.stderr);
    expect(aliasResult.code).toBe(directResult.code);
  });
});

describe('Plan 15-01-01 T5 — alias verbs are no longer NOT_IMPLEMENTED stubs', () => {
  // Sanity check: assert each verb is wired to a real handler in the
  // registry and does NOT return EXIT.NOT_IMPLEMENTED (2). The byte-
  // identical-output tests above already prove this indirectly; this
  // case makes the regression intent explicit (catches a future revert
  // that re-wires the verb back through stubCommand).
  const ALIAS_VERBS = ['plan', 'execute', 'discuss', 'assumptions', 'archive', 'phase', 'audit'];

  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'swt-aliases-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  for (const verb of ALIAS_VERBS) {
    it(`swt ${verb} does not return EXIT.NOT_IMPLEMENTED`, async () => {
      const { code } = await runMain([verb], tmp);
      // Init-required path returns EXIT.SUCCESS (0). Anything other
      // than NOT_IMPLEMENTED (2) is acceptable here; the precise code
      // is covered by the byte-identical comparison above.
      expect(code).not.toBe(2);
    });
  }
});
