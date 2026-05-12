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
 * **M2 PR-20 ship state — structurally complete; runtime-construction
 * deferred to M3 PR-22.** The full `AgentSessionRuntime` Pi needs
 * (returned by `createAgentSessionRuntime`) requires a real
 * `SessionManager` + a `CreateAgentSessionRuntimeFactory` + the
 * cwd-bound services that Pi's `main.ts` wires from its argv parser.
 * That same construction surface is what `session.prompt()` depends on
 * — both flip together at M3 PR-22 when the runtime layer wires real
 * Pi sessions. Until then, `runRpc` throws `RpcModeUnavailableError`
 * with a clear pointer to the activation gate.
 *
 * The Pi import + the delegation shape are locked in here so PR-22
 * activates with a single function-body replacement — no surface
 * change to `cli/src/commands/rpc.ts` or its tests.
 */

import { runRpcMode } from '@earendil-works/pi-coding-agent';

export interface RunRpcOptions {
  /**
   * Working directory the RPC session resolves paths against. Defaults to
   * the calling process's `process.cwd()`.
   */
  readonly cwd?: string;
  /**
   * Directory containing the SWT agent profile (the `.swt-planning/`-
   * adjacent agent config Pi resolves on startup). Defaults to
   * `~/.swt/agent/` per the documented v3 layout.
   */
  readonly agentDir?: string;
}

export class RpcModeUnavailableError extends Error {
  constructor() {
    super(
      `swt rpc: Pi AgentSessionRuntime construction is deferred until M3 PR-22.\n\n` +
        `The Pi RPC mode requires a fully-wired AgentSessionRuntime — the same ` +
        `infrastructure that backs SwtSession.prompt() (currently a no-op in v3 ` +
        `pre-M3). Both activate together at M3 PR-22 ("Wire real Pi session ` +
        `creation through createSession + createAgentSessionRuntime"). The ` +
        `runRpc surface + the Pi runRpcMode import are locked in here so PR-22 ` +
        `flips with a single function-body change.\n\n` +
        `Workaround for early testers: run Pi's binary directly via\n` +
        `  npx -p @earendil-works/pi-coding-agent pi --mode rpc\n` +
        `until the SWT-side wiring activates.`,
    );
    this.name = 'RpcModeUnavailableError';
  }
}

/**
 * Run Pi's RPC mode through SWT's runtime surface. Returns
 * `Promise<never>` because `runRpcMode` only resolves when the RPC
 * client disconnects (or the process is interrupted); the type matches
 * Pi's own signature so callers can't accidentally treat it as a
 * resolved promise.
 *
 * Today: throws `RpcModeUnavailableError` synchronously after
 * argument validation. PR-22 replaces the throw with the actual
 * `runRpcMode(runtime)` call.
 */
export async function runRpc(_opts: RunRpcOptions = {}): Promise<never> {
  // Reference the Pi import so the type system enforces the binding
  // stays valid through dist build + so a future Pi major version
  // bump that removes runRpcMode produces a clear compile error here
  // instead of silently breaking the RPC verb at runtime.
  void runRpcMode;
  throw new RpcModeUnavailableError();
}
