import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vibeHandler } from '../../src/commands/vibe.js';
import { StringStream } from '../_helpers.js';

let tempCwd: string;
let tempCodexHome: string;
let originalCodexHome: string | undefined;
let originalPath: string | undefined;

beforeEach(() => {
  tempCwd = mkdtempSync(join(tmpdir(), 'swt-vibe-cwd-'));
  tempCodexHome = mkdtempSync(join(tmpdir(), 'swt-vibe-codex-'));
  originalCodexHome = process.env['CODEX_HOME'];
  process.env['CODEX_HOME'] = tempCodexHome;
});

afterEach(() => {
  rmSync(tempCwd, { recursive: true, force: true });
  rmSync(tempCodexHome, { recursive: true, force: true });
  if (originalCodexHome === undefined) {
    delete process.env['CODEX_HOME'];
  } else {
    process.env['CODEX_HOME'] = originalCodexHome;
  }
  if (originalPath !== undefined) {
    process.env['PATH'] = originalPath;
    originalPath = undefined;
  }
});

describe('vibeHandler — CodexAgentSpawner wiring', () => {
  it('returns USAGE_ERROR when no .swt-planning exists (init-redirect path)', async () => {
    const stdout = new StringStream();
    const stderr = new StringStream();

    const exit = await vibeHandler(
      { command: 'vibe', flags: {}, positionals: [] },
      { cwd: tempCwd, stdout, stderr },
    );

    expect(exit).toBe(1);
    expect(stderr.text()).toContain('No SWT project here');
  });

  it('execute path runs end-to-end without NotImplementedError when spawner is wired', async () => {
    stagePlanningDir(tempCwd);
    // Force `codex` lookups onto a tmp PATH containing a stub binary that
    // emits a valid Dev handoff envelope. This proves the wiring runs through
    // CodexAgentSpawner → spawnCodex → execa → child process all the way back
    // to runDev parsing the structured handoff and writing SUMMARY.md.
    const stubPath = mkdtempSync(join(tmpdir(), 'swt-vibe-stub-'));
    const handoff = {
      from: 'dev',
      to: 'orchestrator',
      kind: 'dev-summary',
      payload: {
        phase: '01',
        plan: '01',
        title: 'wire codex driver',
        status: 'complete',
        tasks_completed: 1,
        tasks_total: 1,
        commit_hashes: [],
        files_modified: [],
        deviations: [],
      },
      metadata: { created_at: new Date().toISOString() },
    };
    writeFileSync(
      join(stubPath, 'codex'),
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(handoff) + '\n')});\nprocess.exit(0);\n`,
      { mode: 0o755 },
    );
    originalPath = process.env['PATH'];
    process.env['PATH'] = `${stubPath}:${originalPath ?? ''}`;

    const out = new StringStream();
    const err = new StringStream();

    const exit = await vibeHandler(
      { command: 'vibe', flags: {}, positionals: [] },
      { cwd: tempCwd, stdout: out, stderr: err },
    );

    rmSync(stubPath, { recursive: true, force: true });

    expect(err.text()).not.toContain('Not yet implemented');
    expect(out.text()).toContain('Route: execute');
    expect(exit).toBe(0);
    // SUMMARY.md is the strongest end-to-end signal: vibeHandler → executeHandler →
    // LazyInstallSpawner → CodexAgentSpawner → execa(stub-codex) → handoff parsed
    // → writeSummary. cleanup() removes the agent profile from CODEX_HOME afterwards
    // so dev.toml absence is expected at this point.
    const summaryPath = join(tempCwd, '.swt-planning', 'phases', '01-wire', '01-01-SUMMARY.md');
    expect(existsSync(summaryPath)).toBe(true);
    expect(out.text()).not.toContain('degraded summary');
  });
});

function stagePlanningDir(root: string): void {
  const planningDir = join(root, '.swt-planning');
  const phaseDir = join(planningDir, 'phases', '01-wire');
  mkdirSync(phaseDir, { recursive: true });
  writeFileSync(join(planningDir, 'PROJECT.md'), '# Test\n');
  writeFileSync(
    join(planningDir, 'config.json'),
    JSON.stringify({ effort: 'fast', autonomy: 'pure-vibe' }),
  );
  writeFileSync(
    join(planningDir, 'ROADMAP.md'),
    '# Roadmap\n\n## Phases\n\n- [ ] 01: wire (`01-wire`)\n',
  );
  writeFileSync(
    join(planningDir, 'STATE.md'),
    '# State\n\n## Current Phase\n\n01-wire\n',
  );
  writeFileSync(
    join(phaseDir, '01-01-PLAN.md'),
    `---
phase: '01'
plan: '01'
title: wire
wave: 1
depends_on: []
files_modified: []
---
# Plan
`,
  );
}
