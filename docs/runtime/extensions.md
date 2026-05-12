# Runtime — Pi Extensions

> **Status:** stub — populated incrementally as new extensions land.
>
> **Canonical reference:** [`TDD2.md` §5.4 (Pi Extension API)](../../TDD2.md).
> **Implementing package:** [`packages/runtime/src/extensions/`](../../packages/runtime/src/extensions/).
> **Owning ADRs:** [ADR-002](../decisions/ADR-002-extension-result-protocol.md) (result protocol) · [ADR-003](../decisions/ADR-003-quirks-json-over-shims.md) (provider quirks).

SWT registers a small set of Pi extensions at session-creation time. Each extension is a factory function that captures `pi` (the `ExtensionAPI` handle) in closure scope, so subsequent tool calls and event handlers reach back to Pi via the closure — never via `ctx.*`.

## Shipped extensions (Plan 01-02)

| Extension            | Built by                                                               | Purpose                                                                                                                                                                                                 |
| :------------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `result-protocol`    | `buildResultProtocolExtension({ defensivePlaceholder?: boolean })`     | Registers `swt_report_result` custom tool. Persists the `TaskResult` envelope via closure-captured `pi.appendEntry`. Defensive `agent_end` hook writes a placeholder if the agent never calls the tool. |
| `journal`            | `buildJournalExtension({ disabled?, sink?, resolvePath? })`            | Mirrors mapped `SwtEvent`s into a per-day JSONL at `<cwd>/.swt-planning/journal/<UTC-day>.jsonl`. M3 reads these for crash recovery.                                                                    |
| `provider-overrides` | `buildAllProviderConfigs()` (test seam) + the default-exported factory | Reads `runtime/src/providers/quirks.json` and registers per-provider compat + `thinkingLevelMap` overrides via Pi's `pi.registerProvider`. Adding a provider is a JSON edit.                            |

## The closure-captured `pi.appendEntry` invariant

Per ADR-002: `appendEntry` lives on `ExtensionAPI` (the value Pi hands the factory), NOT on `ExtensionContext` (the value Pi hands `execute()`). The structural type `PiExtensionContext` in `runtime/src/extensions/pi-types.ts` has no `appendEntry` field, so `ctx.appendEntry(...)` is a compile-time TS error. Three layers of enforcement:

1. **Compile time** — TS rejects the call.
2. **Test time** — `result-protocol.test.ts` asserts `'appendEntry' in ctx === false` for the structural shape + asserts `pi.appendEntry` is the one being called.
3. **Doc time** — this file, ADR-002, and inline comments in `result-protocol.ts`.

## Adding a new extension

1. Add `runtime/src/extensions/<name>.ts` exporting `buildXxxExtension(opts)` plus a default-exported preconfigured factory.
2. Use the local structural types from `pi-types.ts` rather than importing Pi's upstream types directly (Pi 0.74-alpha shape stability concern).
3. Export the builder + default from `runtime/src/extensions/index.ts`.
4. Re-export from `runtime/src/index.ts` so consumers can `import { buildXxxExtension } from '@swt-labs/runtime'`.
5. Tests live at `runtime/test/extensions/<name>.test.ts`. Cover the closure pattern, any defensive hooks, and the empty-state behaviour.
