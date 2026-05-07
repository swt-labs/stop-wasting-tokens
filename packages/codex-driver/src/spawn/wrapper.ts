import { BackendError, type SpawnRequest, type SpawnResult } from '@swt-labs/core';
import { execa, type ExecaError } from 'execa';


import { parseStream, type UsageChunk } from './parser.js';

export interface SpawnFlags {
  /** Overrides --profile (defaults to the spec's role). */
  readonly profile?: string;
  /** Overrides --sandbox (defaults to the spec's sandbox_mode). */
  readonly sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Overrides --ask-for-approval (defaults to 'on-request'). */
  readonly approval?: 'untrusted' | 'on-request' | 'never';
  /** Override the path to the codex binary (default 'codex'). */
  readonly bin?: string;
  /** Override env passed to the child process. */
  readonly env?: NodeJS.ProcessEnv;
}

function composeArgv(request: SpawnRequest, flags: SpawnFlags): string[] {
  const argv: string[] = ['exec', '--json', '--cd', request.cwd];

  argv.push('--profile', flags.profile ?? request.spec.role);
  argv.push('--sandbox', flags.sandbox ?? request.spec.sandbox_mode ?? 'workspace-write');
  argv.push('--ask-for-approval', flags.approval ?? 'on-request');

  argv.push(request.prompt);
  return argv;
}

export async function spawnCodex(
  request: SpawnRequest,
  flags: SpawnFlags = {},
): Promise<SpawnResult> {
  const bin = flags.bin ?? 'codex';
  const argv = composeArgv(request, flags);

  try {
    const result = await execa(bin, argv, {
      cwd: request.cwd,
      env: flags.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      reject: false,
    });

    const lines = parseStream(result.stdout);
    let text: string | undefined;
    let handoff: Readonly<Record<string, unknown>> | undefined;
    // Last-write-wins: Codex may emit multiple usage chunks during a session;
    // the final chunk reflects the canonical session tally.
    let usage: UsageChunk | undefined;
    for (const parsed of lines) {
      if (parsed.handoff !== undefined) handoff = parsed.handoff;
      if (parsed.usage !== undefined) usage = parsed.usage;
      if (parsed.text !== undefined) {
        text = text === undefined ? parsed.text : `${text}${parsed.text}`;
      }
    }

    if (result.exitCode !== 0) {
      return {
        role: request.spec.role,
        success: false,
        ...(text !== undefined ? { text } : {}),
        ...(handoff !== undefined ? { handoff } : {}),
        ...(usage !== undefined ? { usage } : {}),
        error: result.stderr.trim() || `codex exited with status ${result.exitCode ?? -1}`,
      };
    }

    return {
      role: request.spec.role,
      success: true,
      ...(text !== undefined ? { text } : {}),
      ...(handoff !== undefined ? { handoff } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };
  } catch (cause) {
    const err = cause as ExecaError;
    throw new BackendError(`codex spawn failed: ${err.shortMessage ?? err.message}`, {
      cause,
      context: { bin, argv },
    });
  }
}
