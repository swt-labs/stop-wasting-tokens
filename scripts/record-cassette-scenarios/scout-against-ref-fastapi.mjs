/**
 * Cassette scenario: scout-against-ref-fastapi.
 *
 * Drives the SWT Scout agent against the frozen `golden/ref-fastapi/spec/`
 * fixture (PROJECT.md + REQUIREMENTS.md). Captures the LLM round-trip
 * Scout produces while authoring its phase RESEARCH.md.
 *
 * **DEVN-02 — synthetic cassette path.** Phase 5 plan 05-02 task T3 is
 * shipping in an environment without an Anthropic API key. We follow the
 * plan 05-01 DEVN-02 pattern: produce a structurally-valid cassette
 * (CassetteHeaderSchema + CassetteInteractionSchema-valid) so the test
 * harness wiring lands deterministically, and document the re-record
 * obligation before Phase 5 closes. The synthetic interaction body
 * mirrors the real Scout's `POST /v1/messages` request shape so the
 * hash + headers_normalized columns parse cleanly through the replayer.
 *
 * Re-recording (developer-local, when an API key is available):
 *
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   pnpm record -- --scenario=scout-against-ref-fastapi \
 *     --provider=anthropic --model=claude-sonnet-4-5
 *
 * The `run({provider, model, apiKey})` async function below is what
 * `scripts/record-cassette.mjs` invokes once a real recording session
 * is wired through the cli's cookHandler.
 */

import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SPEC_DIR = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi/spec');

/**
 * Real-provider recording entry point — invoked by scripts/record-cassette.mjs
 * when a developer runs `pnpm record -- --scenario=scout-against-ref-fastapi`.
 *
 * Snake-game scenarios (plan 05-03) bootstrap a live cook turn against a
 * tmp project. For Scout we follow the same pattern: copy spec/ into a
 * tmp dir, set `SWT_DEBUG_ONLY_ROLE=scout`, invoke cookHandler in-process
 * with NODE_ENV=test so the test seam fires.
 */
export async function run({ provider, model, apiKey }) {
  if (!apiKey) {
    throw new Error(
      'scout-against-ref-fastapi: missing apiKey. Set ANTHROPIC_API_KEY before `pnpm record`.',
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'swt-rec-scout-ref-fastapi-'));
  cpSync(SPEC_DIR, tmpRoot, { recursive: true });
  process.env['NODE_ENV'] = 'test';
  process.env['SWT_DEBUG_ONLY_ROLE'] = 'scout';
  process.env['SWT_PLANNING_ROOT'] = join(tmpRoot, '.swt-planning');

  try {
    // Dynamic import so this module loads cleanly even if the cli
    // bundle isn't built yet (developer-local recording runs against
    // source).
    const { cookHandler } = await import('@swt-labs/cli/commands/cook');
    void provider;
    void model;
    await cookHandler(
      { verb: 'cook', positionals: [], flags: {} },
      { stdout: process.stdout, stderr: process.stderr, cwd: tmpRoot },
    );
  } finally {
    delete process.env['SWT_DEBUG_ONLY_ROLE'];
    delete process.env['NODE_ENV'];
    delete process.env['SWT_PLANNING_ROOT'];
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
