# Operations — Pre-Spawn Budget Projection

Operator-facing reference for the pre-spawn cost projection path (Phase 3 / G-R4).

> **Status (Phase 3 / G-R4, 2026-05-14):** live. The cost projector ships in `@swt-labs/runtime` (`packages/runtime/src/budget/cost-projector.ts`); `BudgetGate.project()` ships in `@swt-labs/runtime` (`packages/runtime/src/budget/gate.ts`); the cook callsite wiring ships in `@swt-labs/cli` (`packages/cli/src/commands/cook.ts`).
>
> **Companion reference:** [`budget.md`](./budget.md) — the after-the-fact Budget Gate.
> **Rate-card maintenance:** [`rate-card-refresh.md`](./rate-card-refresh.md) — how the rate card the projection prices against is kept current.

## What it does

The Budget Gate documented in [`budget.md`](./budget.md) is an **after-the-fact** guardrail: it watches the token meter and transitions `status` only **after** a turn has already spent the money. Pre-spawn projection adds a **forward-looking** guardrail that runs **before** the orchestrator session spawns — so an obviously-over-budget spawn is refused with **no money spent**.

`BudgetGate.project()` estimates a spawn's USD cost from three inputs:

1. **Prompt size** — the system + task prompt measured with the `Math.ceil(chars / 4)` char heuristic (zero npm dependency, vendor-agnostic by construction).
2. **Projected output** — the `maxTurns`-bounded worst case (`maxTurns × outputTokensPerTurn`) is the **gating** number; a fixed-multiplier mid-point is returned only as an informational `expected_cost_usd`.
3. **The per-provider rate card** — priced against the rate-card entry for the provider the router resolved, cold-cache by default (a halt-gate over-projects).

If the projection crosses the halt threshold, the spawn is halted pre-emptively: the cook callsite emits `cook.task_fail` (`reason: 'budget_projection_exceeded'`) + `cook.completion(failed)`, releases the worktree, and returns `EXIT.RUNTIME_ERROR` — `spawnFn` is never called.

The projection is emitted as the **`cook.budget_projected`** JSONL event on **every** spawn — both when it halts and when it passes — so the dashboard always sees the forecast.

### How it differs from the after-the-fact gate

|             | After-the-fact gate (`budget.md`)                                                                             | Pre-spawn projection (this doc)                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| When        | After each token-usage event                                                                                  | Before `spawnFn` runs                                                                                 |
| Trigger     | Cumulative `spent` crosses a threshold                                                                        | Projected `spent + projected_cost_usd` crosses the halt threshold                                     |
| Effect      | Transitions `status` (`ok` → `warning` → `paused`), fires `budget.warning` / `budget.pause` / `budget.resume` | Halts the spawn pre-emptively via `cook.task_fail` + `cook.completion(failed)` — no gate state change |
| Money spent | The crossing turn already spent                                                                               | None — the spawn never runs                                                                           |
| Event       | `budget.warning` / `budget.pause` / `budget.resume`                                                           | `cook.budget_projected` (every spawn)                                                                 |

Phase 3 added **no new gate state**. The projection path does not introduce an `exceeded` state — it halts via `BudgetGate.project()` returning `would_exceed: true`, which the cook callsite turns into a task failure. The gate's own state machine (`ok` / `warning` / `paused`) is untouched.

## Configuration

`.swt-planning/config.json` (or `BudgetConfigSchema` programmatically) — the projection knobs live in the same `budget_gate` block as the after-the-fact thresholds:

```json
{
  "budget_gate": {
    "schema_version": 1,
    "milestone_usd": 50.0,
    "tier_downgrade_threshold": 0.7,
    "pause_threshold": 0.95,
    "projection_enabled": true,
    "projection_halt_threshold": 0.9,
    "task_usd": 2.0
  }
}
```

| Field                       | Default                    | Notes                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection_enabled`        | `true`                     | Pre-spawn cost projection toggle. Projection is **ON by default**. Set `false` to fall back to after-the-fact-only behaviour — `project()` then short-circuits to `would_exceed: false` while still returning an honest `projected_pressure` for telemetry. |
| `projection_halt_threshold` | _reuses `pause_threshold`_ | Optional fraction in `[0, 1]`. The projection-path halt cutoff. When omitted the projection reuses `pause_threshold`. Lets operators be **stricter pre-spawn than post-spawn** — e.g. halt projections at `0.90` but only hard-pause actuals at `0.95`.     |
| `task_usd`                  | _none_                     | Optional per-task cap. Previously declared-but-unconsumed in `BudgetConfigSchema`; **now live** as a per-spawn cap — a projection with `projected_cost_usd > task_usd` halts the spawn regardless of milestone pressure. Skipped when undefined.            |

The after-the-fact fields (`milestone_usd`, `phase_usd`, `tier_downgrade_threshold`, `pause_threshold`) are documented in [`budget.md`](./budget.md) and are unchanged.

## Confidence + assumptions

Each projection carries a `confidence` band and an `assumptions[]` honesty list.

**`confidence`** is one of:

- **`low`** — the resolved provider is not in the rate card, so the projection was priced via the fallback (first anthropic) entry.
- **`medium`** — a rate-card entry was found for the provider, and the `maxTurns` worst case was cross-checked against the fixed-multiplier expected mid-point.
- **`high`** — **reserved for a future plan** with real per-role historical output averages. It is **not reachable in Phase 3** — Phase 3 caps at `medium`.

**`confidence` is a DISPLAY concern only.** The halt decision is binary (`would_exceed`) and is computed purely from the conservative worst-case number — `project()` **never** reads `projection.confidence`. A low-confidence projection that still shows `would_exceed: true` is _exactly_ when to halt: low confidence means the estimate is uncertain, not that it is safe. The dashboard renders `confidence` so an operator can judge a halt — but it never softens the gate.

**`assumptions[]`** is a short, human-readable list (each entry capped at ~80 chars, max 8 entries, always-present notes first) that the dashboard renders so operators can see _what the projection assumed_:

- the char/4 input-token heuristic,
- the `maxTurns`-bounded output worst case,
- cold-cache pricing (the whole prompt priced at `input_per_1k`),
- the rate-card source (and, on a provider miss, the fallback note).

## Complement, not replace

Pre-spawn projection **complements** the after-the-fact file-meter — it does not replace it (research §4.3):

- The **file-meter → gate subscription stays the actual-spend ground truth** and is **untouched**. It remains the exact backstop that catches estimation error mid-flight.
- `BudgetGate.project()` is a **pure, side-effect-free forward guard**. It never mutates `spent` / `status` / `warning_fired_at` / `paused_at`, never fires a `BudgetEvent`, and never calls `evaluate()`. It only _reads_ the live `ceiling` + `spent` and returns a `BudgetProjectionResult`.
- The projection catches **obvious** overruns pre-spawn; the file-meter remains the **exact** safety net for everything the estimate gets wrong.

### Best-effort degradation

A projection error **never blocks a cook turn**. The pre-spawn path degrades gracefully to after-the-fact-only when:

- the rate card is **missing or malformed** — the best-effort `createRateCardSource(...).readCurrent()` load is wrapped in `try/catch`; a load failure skips projection and the spawn proceeds,
- `projection_enabled` is `false` — `project()` short-circuits, no halt,
- there is **no budget gate** for the session — nothing to project against,
- `projectSpawnCost` / `gate.project` throws inside the handler — the throw is swallowed with a one-line stderr notice and the handler returns `undefined`, so the spawn proceeds and the file-meter backstop stays the safety net.

The **only** intentional spawn-aborting throw is `BudgetProjectionExceededError`, raised by `runSpawnWithFallback` on a genuine `would_exceed: true` result.

## Related

- [`packages/runtime/src/budget/cost-projector.ts`](../../packages/runtime/src/budget/cost-projector.ts) — the pure cost projector (`estimateTokens`, `projectSpawnCost`, the `CHARS_PER_TOKEN` / `DEFAULT_OUTPUT_*` constants).
- [`packages/runtime/src/budget/gate.ts`](../../packages/runtime/src/budget/gate.ts) — `BudgetGate.project()` + the `BudgetProjectionResult` interface.
- [`packages/shared/src/schemas/budget.ts`](../../packages/shared/src/schemas/budget.ts) — `BudgetConfigSchema` (`projection_enabled` + `projection_halt_threshold` + `task_usd`).
- [`packages/shared/src/schemas/events.ts`](../../packages/shared/src/schemas/events.ts) — the `cook.budget_projected` JSONL event schema.
- [`budget.md`](./budget.md) — the after-the-fact Budget Gate this path complements.
- [`rate-card-refresh.md`](./rate-card-refresh.md) — how the rate card the projection prices against is maintained.
