/**
 * Per-agent parity regression — Debugger.
 *
 * Phase 5 plan 05-02 T4 (REQ-22). Asserts the SWT Debugger agent
 * produces a debug-reports/*.md artefact whose semantic fingerprint
 * (headings + URLs) matches the v2.3.5 baseline.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cookHandler } from '../../../packages/cli/src/commands/cook.js';
import { runAgentParity } from '../../../packages/test-utils/src/run-agent-parity.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const CASSETTE = join(FIXTURE_ROOT, 'cassettes/debugger.jsonl');
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

describe.skipIf(!HAS_BASELINE)('agent-parity: debugger vs ref-fastapi v2.3.5 baseline', () => {
  it('produces a debug-reports/*.md matching the baseline by semantic-fingerprint', async () => {
    const result = await runAgentParity({
      role: 'debugger',
      fixture: 'ref-fastapi',
      cassettePath: CASSETTE,
      expectedArtefacts: ['debug-reports/incident-001.md'],
      invokeCook: async ({ cwd }) => {
        await cookHandler(
          { verb: 'cook', positionals: [], flags: {} },
          { stdout: process.stdout, stderr: process.stderr, cwd },
        );
      },
    });

    expect(result.violations).toHaveLength(0);

    const report = result.artefactsCaptured['debug-reports/incident-001.md'];
    expect(report?.length ?? 0).toBeGreaterThan(0);
  });
});

describe.skipIf(HAS_BASELINE)(
  'agent-parity: debugger — skipped (v2-baseline not yet recorded)',
  () => {
    it('scaffolding placeholder — plan 05-04 records v2-baseline; flip skipIf to activate', () => {
      expect(HAS_BASELINE).toBe(false);
    });
  },
);
