/**
 * Static-check ladder per TDD2 §11.2.
 *
 * The QA role runs four shell-invoked static checks in fixed order before
 * paying for an LLM call:
 *
 *   1. typecheck   — `pnpm typecheck` (tsc --build)
 *   2. lint        — `pnpm lint`
 *   3. format      — `pnpm format:check`
 *   4. unit tests  — `pnpm test`
 *
 * The ladder **short-circuits on first failure** — once typecheck fails,
 * lint won't run; once lint fails, format won't run; etc. This is by
 * design: each check builds on the previous (a typecheck failure usually
 * cascades to lint noise; format issues mask test failures). Running them
 * in order surfaces the cheapest fix first.
 *
 * Each check is a `StaticCheck` value (name + `run(cwd)` function) so the
 * registry is data, not classes. Tests can override the registry; the
 * production ladder uses the four-check default. The runner is decoupled
 * from the registry shape so M3 can add additional checks (e.g.,
 * size-budget, traceability) without reshaping the dispatch contract.
 *
 * **Why not `execFile`-with-argv?** — each `pnpm` script is itself a shell
 * pipeline (e.g., `pnpm test` runs `vitest run` which may itself spawn
 * children). `spawn` with `shell: true` lets the workspace's pnpm config
 * resolve naturally. The runner is invoked from a trusted methodology
 * surface (QA handler); the bash-guard fires before this surface is
 * reached for any LLM-originated command.
 */

import { spawn } from 'node:child_process';

export type StaticCheckStatus = 'passed' | 'failed';

export interface StaticCheckResult {
  readonly name: string;
  readonly status: StaticCheckStatus;
  readonly exitCode: number;
  readonly durationMs: number;
  /** Combined stdout+stderr tail (last ~4KB) — kept short to bound prompt tokens. */
  readonly outputTail: string;
}

export interface StaticCheck {
  readonly name: string;
  /** Returns a promise that resolves with the check result (never rejects). */
  readonly run: (cwd: string) => Promise<StaticCheckResult>;
}

/** Tail size for captured output — 4 KB is enough to surface useful errors
 *  without bloating the LLM context that follows on escalation. */
export const OUTPUT_TAIL_BYTES = 4096;

export function makeCommandCheck(name: string, command: string): StaticCheck {
  return {
    name,
    async run(cwd: string): Promise<StaticCheckResult> {
      return runShellCheck(name, command, cwd);
    },
  };
}

export const TYPECHECK: StaticCheck = makeCommandCheck('typecheck', 'pnpm typecheck');
export const LINT: StaticCheck = makeCommandCheck('lint', 'pnpm lint');
export const FORMAT_CHECK: StaticCheck = makeCommandCheck('format', 'pnpm format:check');
export const UNIT_TESTS: StaticCheck = makeCommandCheck('tests', 'pnpm test');

/** The canonical ladder order. Override by passing your own array to the runner. */
export const DEFAULT_STATIC_CHECKS: ReadonlyArray<StaticCheck> = [
  TYPECHECK,
  LINT,
  FORMAT_CHECK,
  UNIT_TESTS,
];

function runShellCheck(name: string, command: string, cwd: string): Promise<StaticCheckResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, { cwd, shell: true });
    const chunks: Buffer[] = [];
    const onData = (data: Buffer): void => {
      chunks.push(data);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      resolve({
        name,
        status: 'failed',
        exitCode: -1,
        durationMs: Date.now() - started,
        outputTail: `spawn error: ${err.message}`,
      });
    });
    child.on('close', (code) => {
      const exitCode = code ?? -1;
      resolve({
        name,
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        durationMs: Date.now() - started,
        outputTail: tailBuffer(chunks, OUTPUT_TAIL_BYTES),
      });
    });
  });
}

function tailBuffer(chunks: ReadonlyArray<Buffer>, maxBytes: number): string {
  const combined = Buffer.concat(chunks);
  if (combined.byteLength <= maxBytes) return combined.toString('utf8');
  return `...[${combined.byteLength - maxBytes} bytes truncated]...\n${combined.subarray(combined.byteLength - maxBytes).toString('utf8')}`;
}
