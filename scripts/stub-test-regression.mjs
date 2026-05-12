#!/usr/bin/env node
/**
 * Regression suite runner — M2 PR-18.
 *
 * Invokes vitest against `test/regression/` and exits with vitest's
 * status. The PR-18 shipping state:
 *
 *   - `test/regression/diff-artefacts.test.ts` runs today (25 unit
 *     tests on the allowed-drift comparator).
 *   - `test/regression/ref-fastapi.regression.test.ts` ships with a
 *     `skipIf(!HAS_CASSETTE && !HAS_BASELINE)` activation guard. It
 *     stays skipped until the user-driven Anthropic cassette recording
 *     session lands the cassettes at
 *     `packages/test-utils/golden/ref-fastapi/cassettes/` and the
 *     v2.3.5 baseline at
 *     `packages/test-utils/golden/ref-fastapi/v2-baseline/.swt-planning/`.
 *
 * The script name keeps `stub-test-regression.mjs` for backward-compat
 * with the existing workflow trigger; the contents are no longer a stub.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = ['exec', 'vitest', 'run', 'test/regression/'];
const child = spawn('pnpm', args, {
  cwd: repoRoot,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
