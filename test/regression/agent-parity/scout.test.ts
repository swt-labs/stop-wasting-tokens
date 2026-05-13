/**
 * Per-agent parity regression — Scout.
 *
 * Phase 5 plan 05-02 T4 (REQ-22). Asserts the SWT Scout agent produces
 * a RESEARCH.md artefact equivalent to the v2.3.5 baseline modulo the
 * `semantic-fingerprint` allow-list (headings + URL list) from
 * research §5.5.
 *
 * `describe.skipIf(!HAS_BASELINE)` keeps the suite green until plan
 * 05-04 records `v2-baseline/.swt-planning/`; the moment that tree
 * lands, this test activates without code changes.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cookHandler } from '../../../packages/cli/src/commands/cook.js';
import { runAgentParity } from '../../../packages/test-utils/src/run-agent-parity.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi');
const CASSETTE = join(FIXTURE_ROOT, 'cassettes/scout.jsonl');
const BASELINE = join(FIXTURE_ROOT, 'v2-baseline/.swt-planning');
const HAS_BASELINE = existsSync(BASELINE);

describe.skipIf(!HAS_BASELINE)('agent-parity: scout vs ref-fastapi v2.3.5 baseline', () => {
  it('produces a RESEARCH.md matching the baseline by semantic-fingerprint', async () => {
    const result = await runAgentParity({
      role: 'scout',
      fixture: 'ref-fastapi',
      cassettePath: CASSETTE,
      expectedArtefacts: ['phases/01-foundation/01-RESEARCH.md'],
      invokeCook: async ({ cwd }) => {
        await cookHandler(
          { verb: 'cook', positionals: [], flags: {} },
          { stdout: process.stdout, stderr: process.stderr, cwd },
        );
      },
    });

    expect(result.violations).toHaveLength(0);

    // Schema-validity floor — non-empty + frontmatter-parseable.
    const research = result.artefactsCaptured['phases/01-foundation/01-RESEARCH.md'];
    expect(research?.length ?? 0).toBeGreaterThan(0);
    expect(research).toMatch(/^---\n/);
  });
});

describe.skipIf(HAS_BASELINE)('agent-parity: scout — skipped (v2-baseline not yet recorded)', () => {
  it('scaffolding placeholder — plan 05-04 records v2-baseline; flip skipIf to activate', () => {
    expect(HAS_BASELINE).toBe(false);
  });
});
