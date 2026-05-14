# Operations — Budget Gate

Operator-facing reference for the M4 Budget Gate per TDD2 §8.4.

> **Status (M4 PR-35 + PR-38, 2026-05-12):** live. Gate ships in `@swt-labs/runtime`; dashboard route + panel ship in `@swt-labs/dashboard`. ADR-007 Accepted.
>
> **Canonical reference:** [`TDD2.md` §8.4](../../TDD2.md).
> **Owning ADR:** [ADR-007 — Budget Gate downgrades at 70%, pauses at 95%](../decisions/ADR-007-budget-gate-semantics.md).

## What it does

The Budget Gate is the automated guardrail between a misbehaving agent loop and your monthly LLM bill. It:

1. **Watches every token usage event** flowing through the meter (`runtime/src/meter/createTokenMeter`).
2. **Fires structured events** when cumulative spend crosses configured thresholds.
3. **Surfaces pause/resume UX** on the dashboard for operator intervention.

Two thresholds against the project's `budget_gate.milestone_usd` ceiling:

| Pressure                             | Event            | Operator-facing surface                                                                                                                |
| ------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `≥ 70%` (`tier_downgrade_threshold`) | `budget.warning` | Methodology layer downgrades subsequent dispatches one tier (`quality → balanced`, `balanced → cheap-fast`); dashboard shows amber bar |
| `≥ 95%` (`pause_threshold`)          | `budget.pause`   | New dispatches blocked; dashboard shows red bar + "Bump ceiling" form                                                                  |
| after bump drops pressure < 70%      | `budget.resume`  | Gate state resets to `ok`; methodology resumes normal tier dispatch                                                                    |

**Each event fires exactly once per crossing.** Sustained-warning ticks don't re-emit. A single observation that crosses both thresholds in one tick fires `budget.warning` then `budget.pause` in order.

## Configuration

`.swt-planning/config.json` (or `BudgetConfigSchema` programmatically):

```json
{
  "budget_gate": {
    "schema_version": 1,
    "milestone_usd": 50.0,
    "tier_downgrade_threshold": 0.7,
    "pause_threshold": 0.95,
    "projection_enabled": true,
    "projection_halt_threshold": 0.9
  }
}
```

| Field                      | Default | Notes                                                                                                     |
| -------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `milestone_usd`            | _none_  | Required. Hard ceiling in USD for the whole milestone.                                                    |
| `phase_usd`                | _none_  | Optional per-phase cap (default: `milestone_usd / total_phases`).                                         |
| `task_usd`                 | _none_  | Optional per-task cap. Skipped when undefined. — now consumed by the pre-spawn projection as a per-spawn cap (a projection over `task_usd` halts the spawn). |
| `tier_downgrade_threshold` | `0.70`  | Fraction in [0, 1]. When pressure first crosses, `budget.warning` fires + methodology downgrades tier.    |
| `pause_threshold`          | `0.95`  | Fraction in [0, 1]. When pressure first crosses, `budget.pause` fires + dashboard surfaces the resume UX. |
| `projection_enabled`       | `true`  | Pre-spawn cost projection toggle. When false, only the after-the-fact path runs.                          |
| `projection_halt_threshold`| _reuses `pause_threshold`_ | Optional. Projection-path halt cutoff in [0, 1]; reuses `pause_threshold` when omitted.       |

For the pre-spawn projection path, see [`budget-projection.md`](./budget-projection.md).

## Dashboard UX

The Budget panel is in the right column of the dashboard. It renders:

- **Spend / Ceiling** rows (formatted USD)
- **Pressure bar** colour-coded by status (green/amber/red)
- **Status pill** (`ok` / `warning` / `paused`)
- **Bump form** — only visible when `status === 'paused'`. Enter a dollar amount + click "Bump ceiling" to POST `/api/budget/bump`.

The bump form is the canonical resume path. There's no "wait it out" because the meter is monotonic — pressure only goes up unless the ceiling does.

### Empty state

When the methodology layer hasn't wired a live `BudgetGate` to the dashboard (greenfield daemon, or no active session), the panel renders **"No budget gate wired"**. The route registers unconditionally with a `() => null` getter; live-meter wire-up is M4 ops plumbing tracked separately.

## Programmatic API

```ts
import { createBudgetGate } from '@swt-labs/runtime';

const gate = createBudgetGate({
  config: {
    schema_version: 1,
    milestone_usd: 50,
    tier_downgrade_threshold: 0.7,
    pause_threshold: 0.95,
  },
  meter, // your TokenMeter instance
});

const unsubscribe = gate.subscribe((event) => {
  if (event.type === 'budget.warning') {
    // methodology: downgrade subsequent dispatches one tier
  }
  if (event.type === 'budget.pause') {
    // halt new dispatches; surface dashboard resume UX
  }
  if (event.type === 'budget.resume') {
    // resume normal dispatch tier
  }
});

// Operator-driven resume (typically called via /api/budget/bump):
gate.bumpCeiling(25); // raise ceiling by $25

// Inspect state at any time:
const { spent_usd, ceiling_usd, pressure, status } = gate.state();

// Clean up:
unsubscribe();
gate.dispose();
```

## Failure modes

| Scenario                                    | Behaviour                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Meter ticks faster than subscribers handle  | Each tick re-evaluates synchronously; threshold-crossing state machine doesn't duplicate events. 100/sec sustained run emits 1 warning. |
| `bumpCeiling(delta)` with `delta < 0`       | Ceiling decreases. Pressure recomputed; can push state from `ok` → `warning` or `paused` on subsequent ticks. Used cautiously by tests. |
| Ceiling becomes 0 (negative bump beyond it) | `pressure()` returns 0 by definition (NaN guard). Future ticks accrue cost without crossing thresholds until ceiling is bumped above 0. |
| Gate disposed during a tick                 | `dispose()` unsubscribes from the meter cleanly; queued subscribers receive no further events.                                          |

## See also

- **TDD2 §8.4** — Budget Gate decision authority.
- **[ADR-007](../decisions/ADR-007-budget-gate-semantics.md)** — Accepted at M4 PR-38.
- **[`packages/runtime/src/budget/gate.ts`](../../packages/runtime/src/budget/gate.ts)** — gate implementation.
- **[`packages/dashboard/src/server/routes/budget.ts`](../../packages/dashboard/src/server/routes/budget.ts)** — dashboard route.
- **[`packages/dashboard/src/client/components/BudgetPanel.tsx`](../../packages/dashboard/src/client/components/BudgetPanel.tsx)** — operator UX.
