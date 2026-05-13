/**
 * Per-agent parity regression — Architect.
 *
 * Phase 5 plan 05-02 T4 (REQ-22). Asserts the SWT Architect agent
 * produces CONTEXT.md / CONCERNS.md / PATTERNS.md artefacts equivalent
 * to the v2.3.5 baseline modulo the `semantic-fingerprint` allow-list
 * (headings + URL list).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cookHandler } from '../../../packages/cli/src/commands/cook.js';
import { runAgentParity } from '../../../packages/test-utils/src/run-agent-parity.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const CASSETTE = join(FIXTURE_ROOT, 'cassettes/architect.jsonl');
const BASELINE = join(FIXTURE_ROOT, 'v2-baseline/.swt-planning');
const BASELINE_STATE = join(BASELINE, 'STATE.md');
function isPlaceholderBaseline(): boolean {
  // Plan 05-04 T3 ships a DEVN-03 sentinel STATE.md. Until a real
  // v2.3.5 recording replaces it, the regression test SKIPs.
  if (!existsSync(BASELINE_STATE)) return true;
  try {
    return readFileSync(BASELINE_STATE, 'utf-8').includes('DEVN-03 placeholder');
  } catch {
    return true;
  }
}
const HAS_BASELINE = existsSync(BASELINE) && !isPlaceholderBaseline();

describe.skipIf(!HAS_BASELINE)('agent-parity: architect vs ref-fastapi v2.3.5 baseline', () => {
  it('produces CONTEXT/CONCERNS/PATTERNS matching the baseline by semantic-fingerprint', async () => {
    const result = await runAgentParity({
      role: 'architect',
      fixture: 'ref-fastapi',
      cassettePath: CASSETTE,
      expectedArtefacts: [
        'phases/01-foundation/CONTEXT.md',
        'phases/01-foundation/CONCERNS.md',
        'phases/01-foundation/PATTERNS.md',
      ],
      invokeCook: async ({ cwd }) => {
        await cookHandler(
          { verb: 'cook', positionals: [], flags: {} },
          { stdout: process.stdout, stderr: process.stderr, cwd },
        );
      },
    });

    expect(result.violations).toHaveLength(0);

    // Schema-validity floor — primary CONTEXT.md present + non-empty.
    const ctx = result.artefactsCaptured['phases/01-foundation/CONTEXT.md'];
    expect(ctx?.length ?? 0).toBeGreaterThan(0);
  });
});

describe.skipIf(HAS_BASELINE)(
  'agent-parity: architect — skipped (v2-baseline not yet recorded)',
  () => {
    it('scaffolding placeholder — plan 05-04 records v2-baseline; flip skipIf to activate', () => {
      expect(HAS_BASELINE).toBe(false);
    });
  },
);
