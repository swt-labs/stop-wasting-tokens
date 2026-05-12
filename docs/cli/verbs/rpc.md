# `swt rpc`

Delegate to Pi's JSON-RPC mode per TDD2 §3.2 + §5.

> **Status (M2 PR-20):** structurally complete — the Pi import, CLI wiring, and stdout/stderr separation are in place. Live activation is deferred to M3 PR-22, which wires the full `AgentSessionRuntime` construction that Pi RPC mode requires (the same infrastructure that backs `SwtSession.prompt()`). Today the verb returns `EXIT.NOT_IMPLEMENTED` (78) with a clear pointer to the activation gate.

## Synopsis

```bash
swt rpc
```

No flags today. PR-22 may add `--cwd <path>` + `--agent-dir <path>` overrides; the current handler already routes `io.cwd` into `runRpc({cwd})`.

## What it does

`swt rpc` surfaces Pi's [`runRpcMode`](https://github.com/earendil-works/pi-coding-agent) — a line-delimited JSON protocol that lets external orchestrators (IDE plugins, custom tooling, parent agent loops) drive a Pi coding session without a TUI or readline. Requests come in on **stdin**, responses + log events stream out on **stdout**, and SWT's own status messages go to **stderr**.

This is the same RPC surface Pi exposes when invoked directly as `pi --mode rpc` — SWT wraps it verbatim under the `swt` binary name. Users with SWT installed get Pi's RPC mode for free; no second CLI on `PATH`.

## I/O contract

| Stream   | Owner | Content                                                                |
| -------- | ----- | ---------------------------------------------------------------------- |
| `stdin`  | Pi    | JSON-RPC requests, one per line (commands, prompts, control messages). |
| `stdout` | Pi    | JSON-RPC responses + streaming events. **SWT never writes here.**      |
| `stderr` | SWT   | Pre-flight status, error messages, diagnostics.                        |

The stdout reservation is non-negotiable — any SWT-side output on stdout would corrupt the protocol stream the moment Pi starts emitting RPC events. The handler's tests assert `stdout.text() === ''` to catch any future regression.

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | RPC client disconnected cleanly (PR-22+ behaviour; not yet reachable today).                     |
| 2    | `EXIT.NOT_IMPLEMENTED` — deferred-mode error caught (today's default until M3 PR-22 activation). |
| 3    | `EXIT.RUNTIME_ERROR` — unexpected error from the runtime layer or downstream Pi.                 |

## Activation path

The verb activates without any surface change to the CLI handler the moment M3 PR-22 lands. Specifically:

1. **`packages/runtime/src/rpc-runner.ts`** — replace the body of `runRpc(opts)` with the real `createAgentSessionRuntime + runRpcMode(runtime)` sequence per Pi's `main.ts` reference implementation. Drop the `RpcModeUnavailableError` throw.
2. **No changes to `packages/cli/src/commands/rpc.ts`** — the handler's `try/await runRpc/catch` shape already routes the live case (returns `EXIT.SUCCESS` when Pi resolves on client disconnect).
3. **Tests** — the "M2 PR-20 deferred state" test inverts to assert `runRpc` reaches `runRpcMode`; a new test covers stdin/stdout round-trip through a mocked Pi.

The locked import of `runRpcMode` at the top of `rpc-runner.ts` is the regression guard — a future Pi major version that removes the export breaks the build here, not at runtime.

## Principle 1 invariant

Per [TDD2 §4.3](../../../TDD2.md):

> Only `packages/runtime/` imports `@earendil-works/*`. The rest of the codebase consumes Pi through the runtime adapter layer.

`swt rpc`'s handler imports `runRpc` from `@swt-labs/runtime` — NOT from `@earendil-works/pi-coding-agent`. A guard test in `packages/core/test/eslint-boundary.test.ts` (Plan 01-03 PR-10) enforces this at lint time.

## See also

- **TDD2 §3.2** — verb surface ownership.
- **TDD2 §5** — Pi runtime contract (RPC mode + interactive mode + print mode).
- **[`packages/runtime/src/rpc-runner.ts`](../../../packages/runtime/src/rpc-runner.ts)** — the runtime-layer entry point.
- **[`packages/cli/src/commands/rpc.ts`](../../../packages/cli/src/commands/rpc.ts)** — the CLI handler.
- **[Pi `runRpcMode` source](https://github.com/earendil-works/pi-coding-agent)** — protocol reference.
