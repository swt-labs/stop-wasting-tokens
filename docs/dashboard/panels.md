# Dashboard — Panels

> **Status:** stub — expanded as panels land per milestone.
>
> **Canonical reference:** [`TDD2.md` §12 (dashboard panels)](../../TDD2.md).
> **Implementing package:** [`packages/dashboard/`](../../packages/dashboard/).

The dashboard is a localhost-only web surface that renders live project state. Panels are the user-facing primitives — each panel reads from a specific schema in `@swt-labs/shared/schemas/` and a specific SSE event stream.

## Panel inventory (by milestone where the panel ships)

| Panel             |     Milestone     | Backing schema                      | Data source                                 |
| :---------------- | :---------------: | :---------------------------------- | :------------------------------------------ |
| Phases            | M1 (v2 carryover) | `SnapshotSchema`                    | `STATE.md` + per-phase summaries            |
| Plans             | M1 (v2 carryover) | `PlanSchema`                        | `*-PLAN.md` files                           |
| Agent timeline    |        M2         | `SwtEvent` stream                   | Pi events normalised by `mapPiEvent`        |
| Log stream        |        M2         | log lines                           | SSE log feed                                |
| Token meter       |        M2         | `MeterSnapshot`                     | `createTokenMeter` snapshot                 |
| Tier overrides    |        M4         | dispatch records                    | Budget Gate event log                       |
| Cache hit ratio   |        M4         | per-turn usage                      | `extractUsage` outputs                      |
| Budget gauge      |        M4         | `BudgetStateSchema`                 | `.swt-planning/budget-state.json`           |
| TPAC panel        |        M4         | TPAC measurements                   | bench output                                |
| Worktrees         |        M3         | claim registry                      | `claim-registry.ts` state                   |
| Per-provider cost |        M5         | `MeterRecord[]` grouped by provider | `groupRecordsByDimension(snap, 'provider')` |

Most panels are v2 carryovers that the dashboard already renders today. M2's "agent timeline" + "log stream" + "token meter" are the first v3 native panels. M4's cache + budget panels are the M4 acceptance criteria's user-facing surface.

This page expands as each panel ships.
