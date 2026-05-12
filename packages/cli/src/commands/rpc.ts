/**
 * `swt rpc` — delegate to Pi's JSON-RPC mode per TDD2 §3.2 + §5.
 *
 * Pi exposes a line-delimited-JSON RPC protocol that lets external
 * orchestrators drive a coding agent without a TUI or readline. SWT
 * surfaces it verbatim under the `swt` binary so users who already
 * have SWT installed don't need a second Pi CLI on PATH.
 *
 * Per Principle 1 (TDD2 §4.3): this handler does NOT import
 * `@earendil-works/*` directly. It calls `runRpc` from
 * `@swt-labs/runtime` which owns the Pi import.
 *
 * **Output convention (TDD2 §3.2.4):** Pi reserves stdout for the
 * RPC log stream; SWT writes its own status messages to stderr to
 * avoid corrupting the protocol stream. This handler honours that —
 * any pre-flight banner / error message goes to `io.stderr`, never
 * `io.stdout`.
 *
 * **Today's behaviour:** delegates to `runRpc()` which throws
 * `RpcModeUnavailableError` because the underlying Pi
 * `AgentSessionRuntime` construction is deferred to M3 PR-22. The
 * handler catches the deferred-mode error, prints it to stderr, and
 * returns `EXIT.NOT_IMPLEMENTED` (78). PR-22 flips this — no surface
 * change here.
 */

import { RpcModeUnavailableError, runRpc } from '@swt-labs/runtime';

import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

export const rpcHandler: CommandHandler = async (_parsed, io: CommandIO): Promise<ExitCode> => {
  try {
    // `runRpc` resolves to `Promise<never>` — on successful activation
    // it only "returns" when the RPC client disconnects (the typesys
    // contract says never). The `await` here is purely for control
    // flow; the only paths out of `runRpc` today are exceptions.
    await runRpc({ cwd: io.cwd });
    // Unreachable in normal operation; included so the function has a
    // syntactically-reachable exit path that satisfies TypeScript's
    // control-flow analysis.
    return EXIT.SUCCESS;
  } catch (err) {
    if (err instanceof RpcModeUnavailableError) {
      io.stderr.write(`${err.message}\n`);
      return EXIT.NOT_IMPLEMENTED;
    }
    io.stderr.write(
      `swt rpc: unexpected error — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return EXIT.RUNTIME_ERROR;
  }
};
