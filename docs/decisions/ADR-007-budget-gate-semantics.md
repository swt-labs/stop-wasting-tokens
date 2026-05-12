---
adr: 007
title: Budget Gate downgrades tier at 70%, pauses milestone at 95%
status: Proposed
decided: 2026-05-11
pr: M4 PR-35
supersedes: TDD2 §8.4
related: ADR-006
---

# ADR-007 — Budget Gate downgrades at 70%, pauses at 95%

**Status:** Proposed (promotes to Accepted when M4 PR-35 lands the implementation)

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
