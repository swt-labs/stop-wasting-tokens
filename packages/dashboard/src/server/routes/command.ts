import { spawn } from 'node:child_process';

import { CommandBodySchema, type CommandResponse } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

const TIMEOUT_MS = 10_000;
const FORBIDDEN_VERBS = new Set(['dashboard', 'watch']);

function tokenize(input: string): string[] {
  // Tight, intentional split: whitespace-separated tokens, no shell parsing.
  // Quoted args and shell metacharacters are deliberately not supported —
  // for advanced invocations the user runs `swt` directly in their terminal.
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function execSwt(args: readonly string[], cwd: string): Promise<CommandResponse> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let resolved = false;
    const child = spawn('swt', [...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (exitCode: number): void => {
      if (resolved) return;
      resolved = true;
      resolve({
        ok: exitCode === 0,
        exit_code: exitCode,
        stdout,
        stderr,
        duration_ms: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      if (resolved) return;
      child.kill('SIGTERM');
      stderr += `\n[dashboard] swt ${args.join(' ')} exceeded ${TIMEOUT_MS}ms; killed.\n`;
      finish(124);
    }, TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      stderr += `\n[dashboard] failed to spawn swt: ${err.message}\n`;
      finish(127);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      finish(code ?? 0);
    });
  });
}

export function registerCommandRoute(app: Hono, cwd: string): void {
  app.post('/api/command', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const parsed = CommandBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const tokens = tokenize(parsed.data.input);
    if (tokens.length === 0) {
      return c.json({ error: 'empty_input' }, 400);
    }
    const verb = tokens[0]?.toLowerCase() ?? '';
    if (FORBIDDEN_VERBS.has(verb)) {
      const reason =
        verb === 'dashboard'
          ? "you're already running it; use a separate terminal if you need a second instance"
          : 'the Ink TUI requires an interactive terminal — run it from your shell instead';
      const response: CommandResponse = {
        ok: false,
        exit_code: 1,
        stdout: '',
        stderr: `swt ${verb}: not supported via dashboard — ${reason}\n`,
        duration_ms: 0,
      };
      return c.json(response);
    }
    const result = await execSwt(tokens, cwd);
    return c.json(result);
  });
}
