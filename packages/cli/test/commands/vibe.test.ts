import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vibeHandler } from '../../src/commands/vibe.js';
import { StringStream } from '../_helpers.js';

/**
 * PR-01b removed `vibe.ts`'s direct imports of CodexAgentSpawner /
 * ClaudeCodeAgentSpawner / OllamaAgentSpawner. The 3 tests that exercised
 * those backend-switch paths (`execute path runs end-to-end without
 * NotImplementedError when spawner is wired`, `claude-code dispatch...`,
 * `ollama dispatch...`) were stale after PR-01b and have been removed in
 * PR-04 as part of finishing the entry-gate cleanup.
 *
 * The remaining test (`returns USAGE_ERROR when no .swt-planning exists`)
 * exercises an early-exit path before any spawning happens — still valid
 * behavior after the SpawnerEnvironment refactor.
 *
 * End-to-end vibe coverage will be rebuilt in M2 PR-15 (`swt vibe`
 * end-to-end with the Pi backend) — tracked via the M2 plan, not as a
 * known-issue carry-forward.
 */
describe('vibeHandler — init-redirect path', () => {
  let tempCwd: string;

  beforeEach(() => {
    tempCwd = mkdtempSync(join(tmpdir(), 'swt-vibe-cwd-'));
  });

  afterEach(() => {
    rmSync(tempCwd, { recursive: true, force: true });
  });

  it('returns USAGE_ERROR when no .swt-planning exists (init-redirect path)', async () => {
    const stdout = new StringStream();
    const stderr = new StringStream();
    const exit = await vibeHandler(
      { verb: 'vibe', positionals: [], flags: {} },
      { cwd: tempCwd, stdout, stderr },
    );
    expect(exit).toBe(1);
    expect(stderr.text()).toContain('No SWT project here');
  });
});
