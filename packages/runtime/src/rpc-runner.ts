/**
 * Pi RPC-mode delegator per TDD2 §3.2 + §5.
 *
 * Pi exposes a JSON-RPC protocol mode (`runRpcMode`) that lets external
 * orchestrators drive a coding agent via line-delimited JSON over
 * stdin/stdout — no TUI, no readline, no interactive input. SWT
 * surfaces this verbatim under the `swt rpc` binary name so users
 * who already use SWT don't need a separate Pi CLI install.
 *
 * Per Principle 1 (TDD2 §4.3): this file is one of the few inside
 * `@swt-labs/runtime` that imports `@earendil-works/pi-coding-agent`
 * value-level. The rest of the codebase (orchestration, methodology,
 * dashboard, cli) imports `runRpc` from here.
 *
 * **M3 PR-S activation.** `runRpc` builds an `AgentSessionRuntime` via
 * `createAgentSessionRuntime` + the cwd-bound services factory, then
 * delegates to `runRpcMode(runtime)`. The call resolves on clean
 * client disconnect (returns `void`) — Pi's `runRpcMode` signature is
 * `Promise<never>` because it only resolves when the process gets
 * interrupted, but at the SWT surface we treat clean disconnect as
 * `resolve(undefined)`.
 *
 * The `RpcModeUnavailableError` class stays exported for one cycle
 * for backwards compatibility — older builds that catch it on the
 * import chain still resolve cleanly. The throw site is replaced.
 */

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  runRpcMode,
  type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';

export interface RunRpcOptions {
  /**
   * Working directory the RPC session resolves paths against. Defaults to
   * the calling process's `process.cwd()`.
   */
  readonly cwd?: string;
  /**
   * Directory containing Pi's agent profile (auth, settings, models).
   * Defaults to Pi's `getAgentDir()` which resolves to `~/.pi/agent/`.
   */
  readonly agentDir?: string;
}

/**
 * Kept for backwards compatibility with downstream consumers that
 * catch it on the import chain from older SWT builds. Never thrown
 * by `runRpc` today.
 */
export class RpcModeUnavailableError extends Error {
  constructor() {
    super(
      `swt rpc: Pi RPC mode is unavailable in this runtime build. ` +
        `This error is preserved for backwards compatibility but is ` +
        `no longer thrown by default — \`runRpc\` invokes ` +
        `\`runRpcMode\` directly.`,
    );
    this.name = 'RpcModeUnavailableError';
  }
}

/**
 * Run Pi's RPC mode through SWT's runtime surface. Returns `Promise<void>`
 * because the call resolves on clean RPC-client disconnect (Pi's
 * `runRpcMode` types this as `Promise<never>` since it only ever
 * resolves on process interruption, but we treat that as a normal
 * resolution at the SWT boundary).
 *
 * Construction errors (Pi can't read auth, no model available, etc.)
 * propagate as thrown errors — the `swt rpc` handler catches them and
 * exits with `EXIT.RUNTIME_ERROR`.
 */
export async function runRpc(opts: RunRpcOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const agentDir = opts.agentDir ?? getAgentDir();
  const sessionManager = SessionManager.create(cwd);

  const createRuntime: CreateAgentSessionRuntimeFactory = async (runtimeOpts) => {
    const services = await createAgentSessionServices({
      cwd: runtimeOpts.cwd,
      agentDir: runtimeOpts.agentDir,
    });
    const sessionResult = await createAgentSessionFromServices({
      services,
      sessionManager: runtimeOpts.sessionManager,
      ...(runtimeOpts.sessionStartEvent !== undefined
        ? { sessionStartEvent: runtimeOpts.sessionStartEvent }
        : {}),
    });
    return { ...sessionResult, services, diagnostics: services.diagnostics };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
  });

  await runRpcMode(runtime);
}
