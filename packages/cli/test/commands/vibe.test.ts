import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { vibeHandler } from '../../src/commands/vibe.js';
import { StringStream } from '../_helpers.js';

let tempCwd: string;
let tempCodexHome: string;
let tempClaudeConfigDir: string;
let originalCodexHome: string | undefined;
let originalClaudeConfigDir: string | undefined;
let originalPath: string | undefined;
let originalOllamaHost: string | undefined;
let activeServer: Server | undefined;

beforeEach(() => {
  tempCwd = mkdtempSync(join(tmpdir(), 'swt-vibe-cwd-'));
  tempCodexHome = mkdtempSync(join(tmpdir(), 'swt-vibe-codex-'));
  tempClaudeConfigDir = mkdtempSync(join(tmpdir(), 'swt-vibe-claude-'));
  originalCodexHome = process.env['CODEX_HOME'];
  originalClaudeConfigDir = process.env['CLAUDE_CONFIG_DIR'];
  process.env['CODEX_HOME'] = tempCodexHome;
  process.env['CLAUDE_CONFIG_DIR'] = tempClaudeConfigDir;
});

afterEach(async () => {
  rmSync(tempCwd, { recursive: true, force: true });
  rmSync(tempCodexHome, { recursive: true, force: true });
  rmSync(tempClaudeConfigDir, { recursive: true, force: true });
  if (originalCodexHome === undefined) {
    delete process.env['CODEX_HOME'];
  } else {
    process.env['CODEX_HOME'] = originalCodexHome;
  }
  if (originalClaudeConfigDir === undefined) {
    delete process.env['CLAUDE_CONFIG_DIR'];
  } else {
    process.env['CLAUDE_CONFIG_DIR'] = originalClaudeConfigDir;
  }
  if (originalPath !== undefined) {
    process.env['PATH'] = originalPath;
    originalPath = undefined;
  }
  if (originalOllamaHost !== undefined) {
    process.env['OLLAMA_HOST'] = originalOllamaHost;
    originalOllamaHost = undefined;
  } else {
    delete process.env['OLLAMA_HOST'];
  }
  if (activeServer !== undefined) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
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
    expect(out.text()).toContain('Backend: codex');
    expect(exit).toBe(0);
    // SUMMARY.md is the strongest end-to-end signal: vibeHandler → executeHandler →
    // LazyInstallSpawner → CodexAgentSpawner → execa(stub-codex) → handoff parsed
    // → writeSummary. cleanup() removes the agent profile from CODEX_HOME afterwards
    // so dev.toml absence is expected at this point.
    const summaryPath = join(tempCwd, '.swt-planning', 'phases', '01-wire', '01-01-SUMMARY.md');
    expect(existsSync(summaryPath)).toBe(true);
    expect(out.text()).not.toContain('degraded summary');
  });

  it('claude-code dispatch: backend=claude-code uses ClaudeCodeAgentSpawner', async () => {
    stagePlanningDir(tempCwd, { backend: 'claude-code' });
    const stubPath = mkdtempSync(join(tmpdir(), 'swt-vibe-stub-claude-'));
    writeFileSync(
      join(stubPath, 'claude'),
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(devHandoffJson() + '\n')});\nprocess.exit(0);\n`,
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
    expect(out.text()).toContain('Backend: claude-code');
    expect(exit).toBe(0);
    const summaryPath = join(tempCwd, '.swt-planning', 'phases', '01-wire', '01-01-SUMMARY.md');
    expect(existsSync(summaryPath)).toBe(true);
  });

  it('ollama dispatch: backend=ollama uses OllamaAgentSpawner against a stub HTTP server', async () => {
    const { port, server } = await startOllamaStubServer(devHandoffJson());
    activeServer = server;
    originalOllamaHost = process.env['OLLAMA_HOST'];
    process.env['OLLAMA_HOST'] = `http://127.0.0.1:${port}`;

    stagePlanningDir(tempCwd, { backend: 'ollama' });

    const out = new StringStream();
    const err = new StringStream();

    const exit = await vibeHandler(
      { command: 'vibe', flags: {}, positionals: [] },
      { cwd: tempCwd, stdout: out, stderr: err },
    );

    expect(err.text()).not.toContain('Not yet implemented');
    expect(out.text()).toContain('Route: execute');
    expect(out.text()).toContain('Backend: ollama');
    expect(exit).toBe(0);
    const summaryPath = join(tempCwd, '.swt-planning', 'phases', '01-wire', '01-01-SUMMARY.md');
    expect(existsSync(summaryPath)).toBe(true);
  });
});

function stagePlanningDir(
  root: string,
  configOverrides: Record<string, unknown> = {},
): void {
  const planningDir = join(root, '.swt-planning');
  const phaseDir = join(planningDir, 'phases', '01-wire');
  mkdirSync(phaseDir, { recursive: true });
  writeFileSync(join(planningDir, 'PROJECT.md'), '# Test\n');
  writeFileSync(
    join(planningDir, 'config.json'),
    JSON.stringify({ effort: 'fast', autonomy: 'pure-vibe', ...configOverrides }),
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

function devHandoffJson(): string {
  return JSON.stringify({
    from: 'dev',
    to: 'orchestrator',
    kind: 'dev-summary',
    payload: {
      phase: '01',
      plan: '01',
      title: 'wire backend',
      status: 'complete',
      tasks_completed: 1,
      tasks_total: 1,
      commit_hashes: [],
      files_modified: [],
      deviations: [],
    },
    metadata: { created_at: new Date().toISOString() },
  });
}

function startOllamaStubServer(handoffJson: string): Promise<{ port: number; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        // Emit a single text chunk containing the entire handoff JSON, then a final done line.
        const stream = [
          JSON.stringify({
            model: 'llama3.2',
            message: { role: 'assistant', content: handoffJson },
            done: false,
          }),
          JSON.stringify({
            model: 'llama3.2',
            message: { role: 'assistant', content: '' },
            done: true,
            prompt_eval_count: 100,
            eval_count: 50,
          }),
        ].join('\n');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.end(stream);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ port, server });
    });
  });
}
