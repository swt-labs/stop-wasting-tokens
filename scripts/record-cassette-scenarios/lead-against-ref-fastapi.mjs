/**
 * Cassette scenario: lead-against-ref-fastapi.
 *
 * Drives the SWT lead agent against the frozen
 * `golden/ref-fastapi/spec/` fixture with the appropriate upstream
 * snapshot staged in `.swt-planning/` (research §1.4 role contract).
 *
 * **DEVN-02 — synthetic cassette path.** See the Scout scenario's
 * module docstring. The committed cassette is structurally valid but
 * its response body content is a placeholder; re-record against real
 * Anthropic before Phase 5 closes.
 *
 * Re-recording: `pnpm record -- --scenario=lead-against-ref-fastapi`.
 */

import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SPEC_DIR = join(REPO_ROOT, 'packages/test-utils/golden/ref-fastapi/spec');

export async function run({ provider, model, apiKey }) {
  if (!apiKey) {
    throw new Error(
      'lead-against-ref-fastapi: missing apiKey. Set ANTHROPIC_API_KEY before `pnpm record`.',
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'swt-rec-lead-ref-fastapi-'));
  cpSync(SPEC_DIR, tmpRoot, { recursive: true });
  process.env['NODE_ENV'] = 'test';
  process.env['SWT_DEBUG_ONLY_ROLE'] = 'lead';
  process.env['SWT_PLANNING_ROOT'] = join(tmpRoot, '.swt-planning');

  try {
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
