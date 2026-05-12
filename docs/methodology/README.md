# Methodology

> **Status:** stub — populated as v3-specific methodology surfaces solidify.
>
> **Canonical reference:** [`TDD2.md` §6 (methodology overview)](../../TDD2.md).
> **Implementing package:** [`packages/methodology/`](../../packages/methodology/).

SWT's methodology is **preserved verbatim from v2.3.5 into v3**: six-agent SDLC (Scout, Architect, Lead, Dev, QA, Debugger), plan-then-execute phases, `.swt-planning/` artefacts (PROJECT, REQUIREMENTS, STATE, ROADMAP, per-phase plans and summaries), goal-backward QA with must-haves verdicts. v3 changes the runtime layer (Codex CLI subprocess → Pi) and adds parallel dispatch + caching discipline; the methodology itself does not change.

## Mintlify-format concepts (v2 docs, still applicable to v3)

The v2-era concept docs at `docs/concepts/*.mdx` remain accurate for v3:

- [`autonomy-levels.mdx`](../concepts/autonomy-levels.mdx) — cautious / standard / confident / pure-vibe.
- [`effort-levels.mdx`](../concepts/effort-levels.mdx) — thorough / balanced / fast / turbo.
- [`lifecycle-states.mdx`](../concepts/lifecycle-states.mdx) — phase + plan state machine.
- [`methodology.mdx`](../concepts/methodology.mdx) — full methodology overview.
- [`phases-plans-summaries.mdx`](../concepts/phases-plans-summaries.mdx) — artefact lifecycle.

These will migrate into `docs/methodology/` as plain markdown when the Mintlify hosted-site posture re-opens (per ADR-013 deferred until ~1000 users).

## v3-specific methodology additions

These haven't shipped yet; pointers for when they land:

| Topic                        | Lands in                   | Notes                                                                                               |
| :--------------------------- | :------------------------- | :-------------------------------------------------------------------------------------------------- |
| Role → tier defaults         | Plan 01-02 PR-08 (shipped) | [`docs/runtime/providers.md`](../runtime/providers.md) — per-role tier + thinking level.            |
| `swt_report_result` protocol | Plan 01-02 PR-09 (shipped) | Closure-captured `pi.appendEntry` per [ADR-002](../decisions/ADR-002-extension-result-protocol.md). |
| Parallel dispatch model      | M3 PR-22..PR-28            | One worktree per task per [ADR-008](../decisions/ADR-008-worktree-per-task.md).                     |
| Cache discipline             | M4 PR-32..PR-36            | TPAC −40% + cache hit ≥70% targets per TDD2 §1.2.                                                   |

This page expands incrementally.
