/**
 * Per-agent parity regression — Lead.
 *
 * Phase 5 plan 05-02 T4 (REQ-22). Asserts the SWT Lead agent produces
 * a PLAN.md whose task-content fingerprint matches the v2.3.5 baseline
 * (task IDs may drift; task content must match).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cookHandler } from '../../../packages/cli/src/commands/cook.js';
import { runAgentParity } from '../../../packages/test-utils/src/run-agent-parity.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const CASSETTE = join(FIXTURE_ROOT, 'cassettes/lead.jsonl');
const BASELINE = join(FIXTURE_ROOT, 'v2-baseline/.swt-planning');
const HAS_BASELINE = existsSync(BASELINE);

describe.skipIf(!HAS_BASELINE)('agent-parity: lead vs ref-fastapi v2.3.5 baseline', () => {
  it('produces a PLAN.md whose task-content fingerprint matches the baseline', async () => {
    const result = await runAgentParity({
      role: 'lead',
      fixture: 'ref-fastapi',
      cassettePath: CASSETTE,
      expectedArtefacts: ['phases/01-foundation/01-01-PLAN.md'],
      invokeCook: async ({ cwd }) => {
        await cookHandler(
          { verb: 'cook', positionals: [], flags: {} },
          { stdout: process.stdout, stderr: process.stderr, cwd },
        );
      },
    });

    expect(result.violations).toHaveLength(0);

    // Schema-validity floor — non-empty + YAML frontmatter present.
    const plan = result.artefactsCaptured['phases/01-foundation/01-01-PLAN.md'];
    expect(plan?.length ?? 0).toBeGreaterThan(0);
    expect(plan).toMatch(/^---\n/);
    expect(plan).toMatch(/\nphase:\s*\d/);
    expect(plan).toMatch(/\nplan:\s*['"]?\d/);
  });
});

describe.skipIf(HAS_BASELINE)(
  'agent-parity: lead — skipped (v2-baseline not yet recorded)',
  () => {
    it('scaffolding placeholder — plan 05-04 records v2-baseline; flip skipIf to activate', () => {
      expect(HAS_BASELINE).toBe(false);
    });
  },
);
