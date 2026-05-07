import { BackendError, type SpawnRequest, type SpawnResult } from '@swt-labs/core';
import { execa, type ExecaError } from 'execa';

import { parseStream, type UsageChunk } from './parser.js';

export interface SpawnFlags {
  /** Override the path to the claude binary (default 'claude'). */
  readonly bin?: string;
  /** Override env passed to the child process. */
  readonly env?: NodeJS.ProcessEnv;
  /** Bare mode skips Claude Code's hooks/LSP/plugins — useful in tests. */
  readonly bare?: boolean;
  /** Pass-through `--allowed-tools` whitelist. */
  readonly allowed_tools?: readonly string[];
}

function composeArgv(request: SpawnRequest, flags: SpawnFlags): string[] {
  const argv: string[] = ['--print', '--output-format', 'stream-json'];

  if (request.spec.model.length > 0 && request.spec.model !== 'default') {
    argv.push('--model', request.spec.model);
  }

  if (request.spec.developer_instructions.length > 0) {
    argv.push('--system-prompt', request.spec.developer_instructions);
  }

  argv.push('--session-id', request.session_id);
  argv.push('--add-dir', request.cwd);

  if (flags.allowed_tools !== undefined && flags.allowed_tools.length > 0) {
    argv.push('--allowed-tools', flags.allowed_tools.join(' '));
  }

  if (flags.bare === true) {
    argv.push('--bare');
  }

  argv.push(request.prompt);
  return argv;
}

export async function spawnClaude(
  request: SpawnRequest,
  flags: SpawnFlags = {},
): Promise<SpawnResult> {
  const bin = flags.bin ?? 'claude';
  const argv = composeArgv(request, flags);

  try {
    const result = await execa(bin, argv, {
      cwd: request.cwd,
      ...(flags.env !== undefined ? { env: flags.env } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      reject: false,
    });

    const lines = parseStream(result.stdout);
    let text: string | undefined;
    let handoff: Readonly<Record<string, unknown>> | undefined;
    // Last-write-wins: Claude Code may emit multiple usage events; the final
    // result-typed chunk reflects the canonical session tally.
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
        error: result.stderr.trim() || `claude exited with status ${result.exitCode ?? -1}`,
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
    throw new BackendError(`claude spawn failed: ${err.shortMessage ?? err.message}`, {
      cause,
      context: { bin, argv },
    });
  }
}
