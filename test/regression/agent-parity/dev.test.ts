/**
 * Per-agent parity regression — Dev.
 *
 * Phase 5 plan 05-02 T4 (REQ-22). Asserts the SWT Dev agent produces
 * a SUMMARY.md byte-identical to the v2.3.5 baseline (the strictest
 * gate — Dev's SUMMARY.md IS the contract). Dev's source-code diff is
 * intentionally NOT line-level checked here per plan 05-02 §Decisions
 * R2: line-level diffs of generated code drift too much; the SUMMARY +
 * commit-message + file-list match is the load-bearing assertion.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cookHandler } from '../../../packages/cli/src/commands/cook.js';
import { runAgentParity } from '../../../packages/test-utils/src/run-agent-parity.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const CASSETTE = join(FIXTURE_ROOT, 'cassettes/dev.jsonl');
const BASELINE = join(FIXTURE_ROOT, 'v2-baseline/.swt-planning');
const HAS_BASELINE = existsSync(BASELINE);

describe.skipIf(!HAS_BASELINE)('agent-parity: dev vs ref-fastapi v2.3.5 baseline', () => {
  it('produces a SUMMARY.md byte-identical to the baseline', async () => {
    const result = await runAgentParity({
      role: 'dev',
      fixture: 'ref-fastapi',
      cassettePath: CASSETTE,
      expectedArtefacts: ['phases/01-foundation/01-01-SUMMARY.md'],
      invokeCook: async ({ cwd }) => {
        await cookHandler(
          { verb: 'cook', positionals: [], flags: {} },
          { stdout: process.stdout, stderr: process.stderr, cwd },
        );
      },
    });

    expect(result.violations).toHaveLength(0);

    // Schema-validity floor — non-empty + frontmatter present + required fields.
    const summary = result.artefactsCaptured['phases/01-foundation/01-01-SUMMARY.md'];
    expect(summary?.length ?? 0).toBeGreaterThan(0);
    expect(summary).toMatch(/^---\n/);
    expect(summary).toMatch(/\nphase:\s*\d/);
    expect(summary).toMatch(/\nfiles_modified:/);
  });
});

describe.skipIf(HAS_BASELINE)('agent-parity: dev — skipped (v2-baseline not yet recorded)', () => {
  it('scaffolding placeholder — plan 05-04 records v2-baseline; flip skipIf to activate', () => {
    expect(HAS_BASELINE).toBe(false);
  });
});
