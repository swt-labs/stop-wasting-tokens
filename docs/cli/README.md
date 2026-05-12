# CLI

> **Status:** stub — expanded as v3 verbs ship.
>
> **Canonical reference:** [`TDD2.md` §3.2 (verb surface)](../../TDD2.md).
> **Implementing package:** [`packages/cli/`](../../packages/cli/).

`swt` is the user-facing entry point. v2 inventory: 32 verbs (10 working, 22 placeholders); v3 inherits the same surface and fills in the placeholders milestone by milestone per the TDD2 §3.2.4 disposition table.

## Verb reference

The v2-era reference docs at `docs/reference/cli.mdx` describe the working v1 verb set verbatim and stay accurate for v3 until each verb's v3 changes ship. v3 verb deltas land in their owning milestones:

| Milestone                | Verbs becoming real (or changing)                                                                                                                                                                                                                                                                                             |
| :----------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 (Plans 01-01 + 01-02) | `doctor` (Pi peer-dep check), `init` (preserved), `vibe` (preserved with new spawner)                                                                                                                                                                                                                                         |
| M2                       | `plan`, `qa`, `map`, `research`, `phase`, `todo`, `assumptions` (+ `execute`/`fix`/`discuss`/`resume` folded into `vibe`), [**`rpc`** ✓](./verbs/rpc.md) (PR-20 — Pi RPC delegation, activates at M3 PR-22), [**`bench`** ✓](./verbs/bench.md) (PR-21 — TPAC reference benchmark, activates at M3 PR-22 + cassette recording) |
| M3                       | `debug`, `worktree`, `lease`, `cleanup` (new). Activates `rpc` (full `AgentSessionRuntime` wired).                                                                                                                                                                                                                            |
| M4                       | `pause` (Budget Gate-triggered)                                                                                                                                                                                                                                                                                               |
| M5                       | `skills` (Pi skill install + discovery)                                                                                                                                                                                                                                                                                       |
| M6                       | `archive`, `audit`, `whats-new`, `uninstall`, `migrate` (new)                                                                                                                                                                                                                                                                 |

## Per-verb reference

- [**`swt rpc`**](./verbs/rpc.md) (M2 PR-20) — delegate to Pi's JSON-RPC mode for external orchestrators. Structurally complete; live activation at M3 PR-22.
- [**`swt bench`**](./verbs/bench.md) (M2 PR-21) — replay the TPAC reference scenario and emit a validated `TpacReport`. Structurally complete; live activation requires user-driven cassette recording + M3 PR-22.

## What lives elsewhere

- Doctor's diagnostic surface → `packages/cli/src/commands/doctor.ts`.
- Vibe's six-mode orchestration → `packages/cli/src/commands/vibe.ts`.
- Router that dispatches verbs → `packages/cli/src/router.ts`.

This page expands as verbs land.
