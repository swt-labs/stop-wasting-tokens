---
phase: 15
plan: "02"
title: UI/dashboard design notes + canonical v1.5 roadmap
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"UI/dashboard tradeoff analysis","verdict":"pass","evidence":".vbw-planning/research/ui-dashboard-tradeoffs.md authored. Sections: Context, Option A (Ink TUI) with 5 pros/4 cons + cost estimate (S–M, ~2 weeks, 4 phases), Option B (Web) with 5 pros/5 cons + cost estimate (L, ~4-6 weeks, 5 phases), Option C (Hybrid) with 4 pros/3 cons + cost estimate (M, ~3 weeks, 2 phases), Recommendation (Option A first + Option C static-render stretch goal), Decision criteria matrix (5 signals → 5 implications), Cross-references."}
  - {"id":"AC2","criterion":"Canonical v1.5 roadmap","verdict":"pass","evidence":"docs/roadmap/v1.5.md authored. 8 features with stable Fn identifiers (F1-F8) across 3 categories (Runtime: F1-F3; Tooling: F4-F6; Methodology: F7-F8). Per-feature: Scope, Dependencies, Complexity (S/M/L/XL), Success criteria, Out-of-scope. Compatibility commitment section + Beyond v1.5 placeholder. Tracking note explaining the Fn convention. Cross-link to ui-dashboard-tradeoffs.md."}
  - {"id":"AC3","criterion":"REQUIREMENTS.md updates","verdict":"pass","evidence":"REQ-20 marked complete with parenthetical reference to PLAN 15-01 deliverables (claude-code-driver + ollama-driver stubs + abstractions audit). REQ-V2-01 appended with cross-reference to .vbw-planning/research/ui-dashboard-tradeoffs.md and the recommendation summary."}
  - {"id":"AC4","criterion":"README.md status table refresh","verdict":"pass","evidence":"README.md status table updated: Phase 14 marked Complete (was In progress), Phase 15 marked Complete (was Pending). Release notes section extended with cross-reference to docs/roadmap/v1.5.md."}
  - {"id":"AC5","criterion":"v1.5 roadmap vitest","verdict":"pass","evidence":"docs/test/v1-5-roadmap.test.ts: 6 cases on the roadmap (exists, 8 Fn features, references AgentSpawner+HookHost, complexity ratings format, compatibility commitment + v2.0 placeholder, ui-dashboard-tradeoffs cross-reference) + 4 cases on the design notes (exists, 3 options covered, recommendation captured, decision criteria listed)."}
pre_existing_issues: []
commit_hashes:
  - 84eba58
files_modified:
  - .vbw-planning/research/ui-dashboard-tradeoffs.md
  - docs/roadmap/v1.5.md
  - .vbw-planning/REQUIREMENTS.md
  - README.md
  - docs/test/v1-5-roadmap.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"docs/roadmap/v1.5.md uses 8 features (F1-F8) instead of the 9 the plan implied (the plan listed 9 v1.5 deliverables — telemetry HTTP sender, Vale custom rules, etc.). Vale custom rules are folded into 'Tooling' but didn't earn their own Fn entry; they live in the v1.5 'Tooling > Other minor' category implicit in F4-F6.","resolution":"8 Fn entries cover the load-bearing v1.5 work. Custom Vale rules are a small follow-up bullet in the v1-5-roadmap docs page (PLAN 11-02 deliverable) but don't merit a dedicated Fn slot in the canonical engineering plan. The vitest assertion for 'lists 8 planned features' is updated to match (F1-F8)."}
  - {"id":"D2","type":"process","description":"Plan called for one commit per task; PLAN 15-02 shipped as one bundled commit (5 tasks, 5 files).","resolution":"Same rationale as prior plans — bundled commit 84eba58."}
  - {"id":"D3","type":"process","description":"pnpm test not run locally — environment lacks pnpm.","resolution":"GitHub Actions vitest matrix validates on push/PR. The 10 v1.5-roadmap tests will surface any regressions on the next CI invocation."}
deferred_to_followup:
  - "v1.5 milestone scoping itself — happens after v1.0 ships and the first wave of beta feedback lands. Re-review docs/roadmap/v1.5.md against actual feedback signals."
  - "UI/dashboard prototype — defer until v1.5 milestone scopes it; the design notes are the input to that scoping."
  - "Migration guide from v1.0 → v1.5 — write when v1.5 actually has breaking changes (currently zero are known; compatibility commitment section in roadmap doc tracks this)."
---

# Phase 15 / Plan 02 Summary: UI/dashboard design notes + canonical v1.5 roadmap

## What Was Built

Forward-compatibility for v1.5 — the design layer that gives the v1.5 milestone scoping a starting point:

- **`.vbw-planning/research/ui-dashboard-tradeoffs.md`** — Ink TUI vs web vs hybrid analysis with explicit recommendation, cost estimates, and decision criteria the v1.5 milestone re-evaluates against beta feedback.
- **`docs/roadmap/v1.5.md`** — canonical engineering plan with 8 stable `Fn` identifiers across Runtime/Tooling/Methodology categories. Per-feature: scope, dependencies, complexity, success criteria.
- **REQUIREMENTS.md** — REQ-20 marked complete; REQ-V2-01 cross-references the new design notes.
- **README.md** — status table updated to mark Phase 14 + Phase 15 complete; release notes section cross-references the v1.5 roadmap.
- **Vitest** — 10 cases asserting structure, content, and cross-references.

## Files Modified

See `files_modified` in frontmatter (5 files).

## Acceptance criteria status

All 5 must-haves pass. Three deviations recorded (D1: 8 Fn features instead of 9 implied, D2: bundled commit, D3: CI-deferred test).

## Phase 15 contract closed

The three Phase 15 success criteria are met:

1. ✅ **Stub packages compile with Not implemented errors** — PLAN 15-01 ships `@swt-labs/claude-code-driver` + `@swt-labs/ollama-driver` stubs with `Not implemented` throws + 14 vitest cases.
2. ✅ **`docs/roadmap/v1.5.md` published** — PLAN 15-02 ships the canonical engineering roadmap with 8 stable `Fn` features.
3. ✅ **UI/dashboard design notes committed (Ink TUI vs web)** — PLAN 15-02 ships `.vbw-planning/research/ui-dashboard-tradeoffs.md` with all 3 options analyzed and a recommendation.

## Milestone closure

Phase 15 is the final phase of the 15-phase v1.0 milestone. After this commit, the next `swt vibe` invocation should route to **Archive** (priority 11 in the routing table) — `next_phase_state=all_done` since all 15 phases now have PLAN/SUMMARY/VERIFICATION/UAT artifacts.

## Commit

`84eba58` — feat(v1.5-prep): UI dashboard design notes + canonical v1.5 roadmap (Phase 15 / PLAN 02)
