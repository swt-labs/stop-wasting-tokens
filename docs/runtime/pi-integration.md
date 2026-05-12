# Runtime — Pi Integration

> **Status:** stub — populated incrementally as runtime topics solidify.
>
> **Canonical reference:** [`TDD2.md` §5 (Pi runtime adapter)](../../TDD2.md).
> **Implementing package:** [`packages/runtime/`](../../packages/runtime/).
> **Owning ADR:** [ADR-001 — Pi SDK as the runtime substrate](../decisions/ADR-001-pi-sdk-adoption.md).

Pi (`@earendil-works/pi-coding-agent`) is the only third-party runtime that SWT v3 imports directly. The `packages/runtime/` package is the single adapter layer; everything above it (orchestration, methodology, dashboard, CLI) speaks vendor-neutral types and never touches Pi.

## Quick reference

| Topic               | Pi surface                            | SWT surface                                       |
| :------------------ | :------------------------------------ | :------------------------------------------------ |
| Session creation    | `createAgentSession()`                | `createSession(opts)` in `runtime/src/session.ts` |
| Event normalisation | 14 Pi `AgentSessionEvent` types       | `mapPiEvent` → 6 `SwtEvent` variants              |
| Tool factories      | `pi.coding` + `pi.readonly`           | `createCodingTools` + `createReadOnlyTools`       |
| Probe               | direct package import + version check | `probePiAvailable()` (used by orchestration)      |
| Extensions          | `pi.registerTool` + `pi.appendEntry`  | `runtime/src/extensions/` (PR-09 + PR-08)         |

## Why a structural type mirror for `ExtensionAPI`?

Pi 0.74 is alpha; upstream types have shifted across patch releases. PR-09 (Plan 01-02) declares `PiExtensionAPI` and `PiExtensionContext` as structural mirrors in `runtime/src/extensions/pi-types.ts`. The mirror captures only the methods SWT uses (`registerTool`, `on`, `appendEntry`) and encodes the ADR-002 invariant at the type level — `PiExtensionContext` intentionally has no `appendEntry` field, so `ctx.appendEntry(...)` is a TS error. When Pi publishes 1.0, the mirror collapses to a thin re-export.

## What lives elsewhere

- Provider quirks + role resolver → [`docs/runtime/providers.md`](./providers.md).
- Token meter + extractor dispatch → [`docs/runtime/caching.md`](./caching.md) (caching) + the meter primitives in `runtime/src/meter/`.
- Cache breakpoint decisions → [`ADR-006`](../decisions/ADR-006-cache-control-breakpoint-placement.md).
- The result-protocol Extension + closure-captured `pi.appendEntry` → [`ADR-002`](../decisions/ADR-002-extension-result-protocol.md) + [`docs/runtime/extensions.md`](./extensions.md).

This page expands as the runtime layer's surface stabilises across M2..M5.
