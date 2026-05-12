---
adr: 007
title: Budget Gate downgrades tier at 70%, pauses milestone at 95%
status: Accepted
decided: 2026-05-12
pr: M4 PR-35 (implementation) + PR-38 (promotion)
supersedes: TDD2 §8.4
related: ADR-006
---

# ADR-007 — Budget Gate downgrades at 70%, pauses at 95%

**Status:** Accepted (M4 PR-35 shipped the implementation; PR-38 promoted at Plan 04-01 close)

## Context

A runaway phase — agent loops chasing a fix, prompt grows unbounded, parallel
batch fans out faster than the meter cares to count — can burn a user's
monthly LLM budget in hours. v3's value proposition is the opposite of that.
SWT needs an automated guardrail that intervenes before the budget runs out,
not after. The intervention must be deterministic and surface clearly in the
dashboard so the operator can intervene if they disagree with the auto-action.

Two thresholds are needed:

- **Downgrade threshold** — drop a tier so subsequent dispatches use a cheaper
  model. Aggressive enough to slow burn rate; not so eager that healthy
  milestones get throttled.
- **Pause threshold** — stop all new dispatches; require explicit operator
  action to resume. Aggressive enough that the budget can't be exhausted
  silently; not so eager that one expensive turn pauses everything.

Both thresholds must be configurable per project (some teams want stricter
guardrails). The defaults set here are the empirically-chosen starting point.

## Decision

Two thresholds, both configurable in `.swt-planning/config.json` under
`budget_gate.{downgrade_at_pct, pause_at_pct}`:

- **70% of ceiling reached** → downgrade subsequent dispatches one tier:
  - `quality` → `balanced`
  - `balanced` → `cheap-fast`
  - `cheap-fast` → stays at `cheap-fast` (no further downgrade)
  - `reasoning` → `quality` (reasoning tier is a separate axis; downgrade
    drops the thinking-level too, per the role-resolver's combined output)
- **95% of ceiling reached** → pause milestone:
  - Block all new dispatches (in-flight ones continue to completion).
  - Surface a "Resume with bump" prompt in the dashboard requiring the
    operator to either raise the ceiling, abandon the milestone, or accept
    the pause.

The ceiling itself is the `budget_gate.ceiling_usd` field in config; the meter
(M1 PR-07's `createTokenMeter` + `calculateCost`) feeds the gate's percentage
calculation. Per-task records carry the dimensions; the gate aggregates by
milestone.

## Consequences

Easier:

- Cost surprises become impossible without a deliberate operator click.
- Audit trail: every downgrade + pause is a structured event in the journal
  (M3 crash-recovery substrate), so post-hoc analysis is straightforward.
- Empirical thresholds can be tuned per project without code changes
  (config edit + restart).

Harder:

- A bad tier downgrade may produce lower-quality output silently —
  Architect's output suffers more from `quality → balanced` than Scout's
  does from `balanced → cheap-fast`. Mitigation: the dashboard's Tier
  panel (TDD2 §7.2) surfaces every override with the trigger reason
  ("Budget Gate 70%"), so operators see the trade-off.
- A 95% pause in the middle of a parallel batch leaves in-flight tasks
  to complete. The gate doesn't preempt them (preemption costs more than
  it saves in token waste). The pause UI shows in-flight task count.

## Validation (M4 PR-38, 2026-05-12)

Three implementation layers validate the decision:

**Layer 1 — Pure event-driven state machine (PR-35).** `createBudgetGate({config, meter, clock?})` in `packages/runtime/src/budget/gate.ts` subscribes to `METER_UPDATED`. Threshold-crossing state machine emits `budget.warning` at `tier_downgrade_threshold` (default 0.70), `budget.pause` at `pause_threshold` (default 0.95), `budget.resume` after `bumpCeiling` drops pressure below warning. Pure event-driven; no IO. Validated by `packages/runtime/test/budget/gate.test.ts` (12 tests):

- **Idempotency** — sustained ticks above the threshold emit exactly one event per crossing. A 100-tick rapid-fire warning-band run emits exactly one `budget.warning`.
- **Single-tick double-fire** — first observation that crosses both thresholds in one go fires `budget.warning` THEN `budget.pause` in order.
- **Resume path** — `bumpCeiling(delta_usd)` drops pressure below warning → state resets to `ok`, `budget.resume` fires, future crossings can re-fire.
- **Partial recovery** — bump-into-warning (pressure ≥ 0.70 but < 0.95) preserves `warning` state and clears `paused_at`.
- **Custom thresholds** — `tier_downgrade_threshold: 0.5` + `pause_threshold: 0.9` work end-to-end with the same state machine.
- **Lifecycle** — `dispose()` unsubscribes from the meter (no further events); `subscribe()` returns a stable unsubscribe function.

**Layer 2 — Dashboard route + bump action (PR-35).** `GET /api/budget/sse` streams `BudgetGateState` snapshots (initial + on every gate event). `POST /api/budget/bump` accepts `{delta_usd: number}` and calls `gate.bumpCeiling`. Validated by `packages/dashboard/test/budget-route.test.ts` (7 tests):

- Null gate → `tpac.snapshot` carries `state: null` and `POST /api/budget/bump` returns 503.
- Wired gate → emit current state on connect; re-emit after every gate event.
- Bump happy path → `bumpCeiling` called with the right `delta_usd`; response carries the new state.
- Input validation → non-finite `delta_usd`, missing field, invalid JSON body all → HTTP 400.

**Layer 3 — Operator-facing pause/resume UX (PR-35).** `BudgetPanel` SolidJS component renders:

- Spend / ceiling / pressure bar with status pill colour-coded ok/warning/paused.
- Paused-state-only bump form that POSTs `{delta_usd}` to `/api/budget/bump`.
- Empty state when gate is null.

The pause/resume cycle is exercisable end-to-end from the dashboard — configure a low ceiling, drive it past 95%, the panel shows paused, the operator types a bump amount + clicks "Bump ceiling", state resets to ok. The "Resume with bump" UX from the ADR's Decision section is implemented exactly.
