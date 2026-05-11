# Operations — Budget Gate

> **Status:** stub — expanded at M4 (Budget Gate ships).
>
> **Canonical reference:** [`TDD2.md` §8.4](../../TDD2.md).
> **Owning ADR:** [ADR-007 — Budget Gate downgrades at 70%, pauses at 95%](../decisions/ADR-007-budget-gate-semantics.md).

Two thresholds against the project's `budget_gate.ceiling_usd`:

- **70%** → downgrade subsequent dispatches one tier (`quality`→`balanced`, `balanced`→`cheap-fast`).
- **95%** → pause milestone; require explicit "Resume with bump" via the dashboard.

The meter (`runtime/src/meter/createTokenMeter`) feeds the percentage; the gate aggregates by milestone and surfaces the override + pause events in the dashboard's Tier panel and Budget gauge.

M4 PR-35 ships the gate. This page expands then.
