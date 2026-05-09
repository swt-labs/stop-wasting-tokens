import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CommandBodySchema, type CommandResponse } from '@swt-labs/dashboard-core';
import type { Hono } from 'hono';

import { classifyVerb } from '../lib/allowed-verbs.js';

/**
 * Per-verb timeout budgets (ms). The defaults are tight on purpose — the
 * dashboard command bar is for fast read-only inspection, not long-running
 * work. Users with slow networks or large projects can override the floor
 * via `SWT_DASHBOARD_COMMAND_TIMEOUT_MS_DEFAULT`; per-verb caps still apply
 * unless the env override exceeds them, in which case the env wins.
 */
const TIMEOUT_BY_VERB: Record<string, number> = {
  help: 5_000,
  version: 5_000,
  status: 5_000,
  doctor: 15_000,
  'detect-phase': 15_000,
  update: 30_000,
};
const DEFAULT_TIMEOUT_MS = 10_000;

function resolveTimeoutMs(verb: string): number {
  const envOverride = process.env['SWT_DASHBOARD_COMMAND_TIMEOUT_MS_DEFAULT'];
  const envParsed = envOverride !== undefined ? Number.parseInt(envOverride, 10) : NaN;
  const envFloor = Number.isFinite(envParsed) && envParsed > 0 ? envParsed : DEFAULT_TIMEOUT_MS;
  const verbBudget = TIMEOUT_BY_VERB[verb];
  if (verbBudget === undefined) return envFloor;
  return Math.max(verbBudget, envFloor);
}

/**
 * Resolve the cli.mjs the daemon should spawn. Both bundles ship side-by-side
 * in `dist/` per `tsup.config.ts`, so when the daemon is loaded as the
 * published `dashboard-server.mjs`, its sibling is `cli.mjs`. Falls back to
 * the PATH-resolved `swt` binary if the adjacent file isn't present (e.g.,
 * in-repo dev with unbundled daemon source where `import.meta.url` is a `.ts`
 * file). The fallback also covers the case where someone has run the daemon
 * source directly via tsx — there's no adjacent cli.mjs there, but the user
 * presumably has `swt` on PATH for that mode anyway.
 */
function resolveCliEntry(): { mode: 'node-bundle'; script: string } | { mode: 'path' } {
  try {
    const here = fileURLToPath(import.meta.url);
    // Build path: <bundle dir>/cli.mjs
    const adjacent = join(dirname(here), 'cli.mjs');
    if (existsSync(adjacent)) return { mode: 'node-bundle', script: adjacent };
  } catch {
    /* fallthrough to PATH resolution */
  }
  return { mode: 'path' };
}

function tokenize(input: string): string[] {
  // Tight, intentional split: whitespace-separated tokens, no shell parsing.
  return input
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function execSwt(args: readonly string[], cwd: string, timeoutMs: number): Promise<CommandResponse> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let resolved = false;
    const entry = resolveCliEntry();
    const [command, fullArgs] =
      entry.mode === 'node-bundle' ? ['node', [entry.script, ...args]] : ['swt', [...args]];
    const child = spawn(command, fullArgs, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const verb = args[0]?.toLowerCase() ?? null;
    const finish = (exitCode: number): void => {
      if (resolved) return;
      resolved = true;
      resolve({
        ok: exitCode === 0,
        exit_code: exitCode,
        stdout,
        stderr,
        duration_ms: Date.now() - startedAt,
        routing_decision: 'literal',
        verb,
      });
    };
    const timer = setTimeout(() => {
      if (resolved) return;
      child.kill('SIGTERM');
      stderr += `\n[dashboard] swt ${args.join(' ')} exceeded ${timeoutMs}ms; killed.\n`;
      finish(124);
    }, timeoutMs);
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
    const firstToken = tokens[0] ?? '';
    const routing = classifyVerb(firstToken);

    if (routing.decision === 'rejected_interactive') {
      const response: CommandResponse = {
        ok: false,
        exit_code: 2,
        stdout: '',
        stderr:
          `swt ${routing.verb}: interactive verbs aren't supported via the dashboard command bar — ` +
          `run from your terminal instead.\n`,
        duration_ms: 0,
        routing_decision: 'rejected_interactive',
        verb: routing.verb,
      };
      return c.json(response);
    }

    if (routing.decision === 'rejected_unknown') {
      const response: CommandResponse = {
        ok: false,
        exit_code: 2,
        stdout: '',
        stderr:
          `swt: unknown command "${routing.verb}". Try one of: help, status, doctor, ` +
          `detect-phase, version, update. Or run interactive verbs (vibe, watch) from your terminal.\n`,
        duration_ms: 0,
        routing_decision: 'rejected_unknown',
        verb: routing.verb,
      };
      return c.json(response);
    }

    const timeoutMs = resolveTimeoutMs(routing.verb);
    const result = await execSwt(tokens, cwd, timeoutMs);
    return c.json(result);
  });
}
