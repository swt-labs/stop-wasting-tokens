/**
 * Cassette scenario: architect-against-ref-fastapi.
 *
 * Drives the SWT Architect agent against the frozen
 * `golden/ref-fastapi/spec/` fixture, with an upstream Scout snapshot
 * already staged in `.swt-planning/`. Captures the LLM round-trip the
 * Architect produces while authoring CONTEXT.md / CONCERNS.md /
 * PATTERNS.md.
 *
 * **DEVN-02 — synthetic cassette path.** See the Scout scenario's
 * module docstring. Same re-record obligation applies to all 7 roles
 * before Phase 5 closes; the synthetic cassette is structurally valid
 * (header + monotonic interactions) but its response body content is a
 * placeholder.
 *
 * Re-recording: `pnpm record -- --scenario=architect-against-ref-fastapi`.
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
      'architect-against-ref-fastapi: missing apiKey. Set ANTHROPIC_API_KEY before `pnpm record`.',
    );
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'swt-rec-architect-ref-fastapi-'));
  cpSync(SPEC_DIR, tmpRoot, { recursive: true });
  process.env['NODE_ENV'] = 'test';
  process.env['SWT_DEBUG_ONLY_ROLE'] = 'architect';
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
