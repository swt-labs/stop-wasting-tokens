import { spawn as childSpawn } from 'node:child_process';

import {
  createLineBuffer,
  formatUserReplyMarker,
  type ParsedMarker,
} from './markers.js';
import type {
  AskUserReply,
  AskUserRequest,
  MethodologyAgent,
  MethodologyAgentResult,
  MethodologyAgentRunOpts,
} from './methodology-agent.js';

/**
 * Production methodology-agent backend that wraps `codex exec` via
 * `child_process.spawn` (NOT execa) so we get a streaming bidirectional
 * stdin/stdout pipe.
 *
 * The class implements the `MethodologyAgent` interface from 02-03; the
 * `runMethodologyLoop` orchestration in `loop.ts` is unchanged. What this
 * file adds is the bridge between the marker convention (shipped in 02-03)
 * and a real Codex CLI subprocess.
 *
 * Architectural note (locked in `v2-agent-prompt-protocol.md`):
 *   - Agent emits `<<<ASK_USER:{json}>>>` on its own stdout.
 *   - Daemon parses the marker, surfaces the question via the SSE channel.
 *   - User replies; daemon writes `<<<USER_REPLY:{json}>>>\n` to the
 *     agent's stdin.
 *   - Agent reads stdin line-buffered, parses the reply, continues.
 *
 * The agent's prompt template is responsible for instructing Codex to
 * emit + read markers. That prompt-engineering work is not part of this
 * plan (see 02-04-PLAN.md "What this plan does NOT ship").
 *
 * Tool-call intercept (Phase 3 / DashboardPermissionGate) is wired the
 * same way: agents emit a `<<<TOOL_CALL:{json}>>>` marker; the daemon
 * routes through `opts.requestApproval`. When that protocol marker
 * lands, this class will read the same line buffer for it.
 */
export interface SpawnedProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  /** Resolves when the child exits. */
  exitPromise: Promise<{ exitCode: number; signal: NodeJS.Signals | null }>;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (
  bin: string,
  args: readonly string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
) => SpawnedProcess;

const defaultSpawn: SpawnFn = (bin, args, opts) => {
  const child = childSpawn(bin, [...args], {
    cwd: opts.cwd,
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!child.stdout || !child.stderr || !child.stdin) {
    throw new Error('child_process.spawn returned a child without piped stdio');
  }
  const exitPromise = new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on('exit', (code, signal) => {
        resolve({ exitCode: code ?? -1, signal });
      });
    },
  );
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    stdin: child.stdin,
    exitPromise,
    kill: (sig) => child.kill(sig),
  };
};

export interface CodexMethodologyAgentOptions {
  /** Path to the codex binary. Default: `'codex'`. */
  bin?: string;
  /** Codex agent role / profile. Default: `'dev'`. */
  role?: string;
  /** Codex sandbox mode. Default: `'workspace-write'`. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Codex approval policy. Default: `'on-request'`. */
  approval?: 'untrusted' | 'on-request' | 'never';
  /** Working directory for the spawned child. Default: `process.cwd()`. */
  cwd?: string;
  /** Override env passed to the child. */
  env?: NodeJS.ProcessEnv;
  /**
   * Inject a spawn function for tests. Default uses `node:child_process.spawn`
   * with `stdio: ['pipe', 'pipe', 'pipe']`.
   */
  spawnFn?: SpawnFn;
  /**
   * Number of stderr lines to keep for the failure message. Default: 20.
   * The full stderr is forwarded to `onStdoutLine` (channel: 'stderr')
   * regardless; this only controls how much survives in the result.error.
   */
  stderrTailLines?: number;
}

export class CodexMethodologyAgent implements MethodologyAgent {
  readonly #bin: string;
  readonly #role: string;
  readonly #sandbox: NonNullable<CodexMethodologyAgentOptions['sandbox']>;
  readonly #approval: NonNullable<CodexMethodologyAgentOptions['approval']>;
  readonly #cwd: string;
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #spawnFn: SpawnFn;
  readonly #stderrTail: number;

  constructor(opts: CodexMethodologyAgentOptions = {}) {
    this.#bin = opts.bin ?? 'codex';
    this.#role = opts.role ?? 'dev';
    this.#sandbox = opts.sandbox ?? 'workspace-write';
    this.#approval = opts.approval ?? 'on-request';
    this.#cwd = opts.cwd ?? process.cwd();
    this.#env = opts.env;
    this.#spawnFn = opts.spawnFn ?? defaultSpawn;
    this.#stderrTail = opts.stderrTailLines ?? 20;
  }

  async run(opts: MethodologyAgentRunOpts): Promise<MethodologyAgentResult> {
    const argv = this.#composeArgv(opts.prompt);
    const child = this.#spawnFn(this.#bin, argv, {
      cwd: this.#cwd,
      ...(this.#env !== undefined ? { env: this.#env } : {}),
    });

    const stderrTail: string[] = [];

    // Pump stderr to onStdoutLine (channel separation handled by the SSE
    // log.append event's `channel` field — runMethodologyLoop publishes
    // stdout-channel events but the agent can also surface stderr by
    // calling onStdoutLine directly. For simplicity, all child output
    // becomes stdout-channel here; future iteration can split.)
    bindLineStream(child.stderr, (line) => {
      stderrTail.push(line);
      if (stderrTail.length > this.#stderrTail) stderrTail.shift();
      opts.onStdoutLine(`[stderr] ${line}`);
    });

    // Stdout drives the marker round-trip + non-marker forwarding.
    const buffer = createLineBuffer({
      onMarker: (marker) => {
        void this.#handleMarker(marker, opts, child);
      },
      onStdoutLine: (line) => opts.onStdoutLine(line),
    });
    bindLineStream(child.stdout, (line) => buffer.push(line + '\n'));

    // Abort propagation: kill the child when the loop signals abort.
    if (opts.abortSignal) {
      opts.abortSignal.addEventListener(
        'abort',
        () => {
          child.kill('SIGTERM');
        },
        { once: true },
      );
    }

    const { exitCode, signal } = await child.exitPromise;
    // Give any pending stdin/stderr data events one more event-loop tick
    // to flush before we read stderrTail or finalize. In real Node
    // child_process, stderr usually drains before the 'exit' event
    // fires, but some buffered data may still be queued for the next
    // tick — without this await, a child that emits stderr immediately
    // before exiting can race the exit promise and lose lines.
    await new Promise<void>((resolve) => setImmediate(resolve));
    buffer.flush();

    if (exitCode === 0 && signal === null) {
      return { success: true };
    }
    if (signal === 'SIGTERM' && opts.abortSignal?.aborted) {
      return { success: false, error: 'aborted' };
    }
    const tail = stderrTail.slice(-this.#stderrTail).join('\n').trim();
    const reason =
      signal !== null
        ? `codex killed by signal ${signal}`
        : `codex exited with code ${exitCode}`;
    return {
      success: false,
      error: tail.length > 0 ? `${reason}: ${tail}` : reason,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // private
  // ────────────────────────────────────────────────────────────────────────

  #composeArgv(prompt: string): readonly string[] {
    return [
      'exec',
      '--cd',
      this.#cwd,
      '--profile',
      this.#role,
      '--sandbox',
      this.#sandbox,
      '--ask-for-approval',
      this.#approval,
      prompt,
    ];
  }

  async #handleMarker(
    marker: ParsedMarker,
    opts: MethodologyAgentRunOpts,
    child: SpawnedProcess,
  ): Promise<void> {
    if (marker.kind !== 'ASK_USER') {
      // USER_REPLY markers should never arrive on stdout — they're what we
      // write to stdin. Silently drop; the convention is server-to-agent.
      return;
    }
    // The marker payload is Zod-validated by tryParseMarker (it rejects
    // payloads missing subtype/question), so the cast through `unknown`
    // is safe.
    const payload = marker.payload as unknown as AskUserRequest;
    const reply: AskUserReply = await opts.askUser(payload);
    try {
      const line = formatUserReplyMarker(reply);
      child.stdin.write(line);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      opts.onStdoutLine(`[swt] failed to write USER_REPLY to agent stdin: ${message}`);
    }
  }
}

function bindLineStream(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = '';
  stream.setEncoding?.('utf8');
  stream.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      onLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      onLine(buffer);
      buffer = '';
    }
  });
}
