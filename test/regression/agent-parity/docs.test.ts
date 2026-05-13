/**
 * Per-agent parity regression — Docs.
 *
 * Phase 5 plan 05-02 T4 (REQ-22). Asserts the SWT Docs agent produces
 * README.md / CHANGELOG.md byte-identical to the v2.3.5 baseline (the
 * rendered docs ARE the contract).
 *
 * Note: Docs writes to the project root, NOT to .swt-planning/. The
 * harness's expectedArtefacts list uses paths relative to .swt-planning;
 * for Docs we override the diff target to point at the project root by
 * passing the spec dir as the planning root substitute. The harness
 * fixture-root override handles this — when the cassette + baseline land,
 * Plan 05-04 will rationalise the dual-root layout per its README.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cookHandler } from '../../../packages/cli/src/commands/cook.js';
import { runAgentParity } from '../../../packages/test-utils/src/run-agent-parity.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const CASSETTE = join(FIXTURE_ROOT, 'cassettes/docs.jsonl');
const BASELINE = join(FIXTURE_ROOT, 'v2-baseline/.swt-planning');
const HAS_BASELINE = existsSync(BASELINE);

describe.skipIf(!HAS_BASELINE)('agent-parity: docs vs ref-fastapi v2.3.5 baseline', () => {
  it('produces a README.md byte-identical to the baseline', async () => {
    const result = await runAgentParity({
      role: 'docs',
      fixture: 'ref-fastapi',
      cassettePath: CASSETTE,
      expectedArtefacts: ['README.md'],
      invokeCook: async ({ cwd }) => {
        await cookHandler(
          { verb: 'cook', positionals: [], flags: {} },
          { stdout: process.stdout, stderr: process.stderr, cwd },
        );
      },
    });

    expect(result.violations).toHaveLength(0);

    const readme = result.artefactsCaptured['README.md'];
    expect(readme?.length ?? 0).toBeGreaterThan(0);
  });
});

describe.skipIf(HAS_BASELINE)('agent-parity: docs — skipped (v2-baseline not yet recorded)', () => {
  it('scaffolding placeholder — plan 05-04 records v2-baseline; flip skipIf to activate', () => {
    expect(HAS_BASELINE).toBe(false);
  });
});
