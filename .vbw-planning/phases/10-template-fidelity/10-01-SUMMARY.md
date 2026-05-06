---
phase: "10"
plan: "01"
title: VBW-grade PLAN + SUMMARY schemas with backwards compat (Phase 10 / PLAN 01)
status: complete
completed: 2026-05-06
tasks_completed: 7
tasks_total: 7
ac_results:
  - {"id":"AC1","criterion":"frontmatter parser/formatter handles inline JSON-array-of-objects","verdict":"pass","evidence":"packages/artifacts/src/frontmatter.ts: parseScalarYaml now JSON.parses inline arrays whose inner content opens with `{`. formatScalarYaml renders array-of-object values as JSON via stringify when any element is non-primitive. Existing string-array semantics preserved."}
  - {"id":"AC2","criterion":"PlanFrontmatterSchema with VBW fields + must_haves union","verdict":"pass","evidence":"packages/artifacts/src/schemas/plan.ts exports MustHaveBlockSchema (truths/artifacts/key_links arrays), MustHaveSchema (z.union([string, MustHaveBlock])), and PlanFrontmatterSchema with phase + plan (\\d{2}[a-z]?) + title + wave + depends_on + must_haves + cross_phase_deps + effort_override + forbidden_commands + skills_used + files_modified + acceptance_criteria + deferred_to_followup."}
  - {"id":"AC3","criterion":"SummaryFrontmatterSchema with normalized ac_results + deviations","verdict":"pass","evidence":"packages/artifacts/src/schemas/summary.ts exports AcResultSchema (transform from raw {id, must_have?|criterion?, status?|verdict?, evidence?} -> {id, criterion, verdict, evidence}), DeviationSchema (transform from raw {id, type?, description, rationale?|resolution?} -> {id, type?, description, resolution?}), and SummaryFrontmatterSchema covering phase + plan + title + status + completed + tasks counts + ac_results + pre_existing_issues + commit_hashes + files_modified + deviations + deferred_to_followup."}
  - {"id":"AC4","criterion":"Backwards compat with SWT-1.0 ac_results shape","verdict":"pass","evidence":"summary.test.ts asserts AcResultSchema accepts both {id, must_have, status, evidence} (VBW) and {id, criterion, verdict, evidence} (SWT) and normalizes both into the new shape. Verdict normalizer accepts pass/fail/partial/deferred case-insensitively."}
  - {"id":"AC5","criterion":"read/write helpers wrap parseFrontmatter + Zod","verdict":"pass","evidence":"plan.ts exports readPlanFrontmatter / writePlanFrontmatter; summary.ts exports readSummaryFrontmatter / writeSummaryFrontmatter. Each pair round-trips a structured fixture without data loss."}
  - {"id":"AC6","criterion":"Test fixtures verbatim VBW-grade PLAN + SUMMARY","verdict":"pass","evidence":"packages/artifacts/test/fixtures/vbw-plan-sample.md (mixed string + must-have-block) and vbw-summary-sample.md (must_have/status/evidence + rationale-style deviation). Both parse cleanly and round-trip without losing fields the schema models."}
  - {"id":"AC7","criterion":"Vitest covers happy + backwards-compat paths","verdict":"pass","evidence":"plan.test.ts (5 cases: string-only, structured blocks, malformed plan IDs, fixture round-trip, SWT-grade backwards compat) + summary.test.ts (5 cases: VBW ac_results normalization, SWT ac_results passthrough, deviation normalization, fixture round-trip, SWT 09-08 shape parsing)."}
pre_existing_issues: []
commit_hashes:
  - 880a5e2
files_modified:
  - packages/artifacts/src/frontmatter.ts
  - packages/artifacts/src/schemas/index.ts
  - packages/artifacts/src/schemas/plan.ts
  - packages/artifacts/src/schemas/summary.ts
  - packages/artifacts/test/fixtures/vbw-plan-sample.md
  - packages/artifacts/test/fixtures/vbw-summary-sample.md
  - packages/artifacts/test/schemas/plan.test.ts
  - packages/artifacts/test/schemas/summary.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"PlanFrontmatterSchema accepts \\d{2}[a-z]? plan IDs to round-trip the legacy `03b` shape; the canonical shape going forward is \\d{2}.","resolution":"Future migration tool will rewrite any remaining 03b-style plans to numeric IDs (we already renamed our own 09-03b to 09-08 in this commit). Schema retains the alphabetic suffix for VBW-imported phases that may still use it."}
  - {"id":"D2","type":"scope","description":"AcResultSchema does not yet enforce the {criterion: non-empty} invariant strictly — a missing must_have/criterion normalizes to an empty string instead of failing.","resolution":"Tightening lands in PLAN 10-02 alongside the VERIFICATION schema (which is the artifact that consumes ac_results downstream)."}
  - {"id":"D3","type":"process","description":"pnpm + tsc not installed locally; tests not executed in this session.","resolution":"GitHub Actions CI runs the matrix on push/PR."}
deferred_to_followup:
  - "PLAN 10-02: Upgrade VERIFICATION/UAT/RESEARCH/CONTEXT schemas to VBW-grade tabular sections."
  - "PLAN 10-03: REMEDIATION-* templates + DEBUG-SESSION.md schema."
  - "PLAN 10-04: Template strings in @swt-labs/artifacts/templates/."
  - "Migration tool: rewrite SWT phase 1-9 SUMMARY.md ac_results from {id, must_have, status} to {id, criterion, verdict, evidence}."
---

# Phase 10 / Plan 01 Summary: VBW-grade PLAN + SUMMARY schemas

## What Was Built

Two of the highest-value VBW artifacts now have full-fidelity Zod schemas in `@swt-labs/artifacts/schemas/`:

- **`PlanFrontmatterSchema`** — VBW-grade `must_haves` union (string OR `{truths, artifacts, key_links}`), plus `cross_phase_deps`, `effort_override`, `forbidden_commands`, `skills_used`, `files_modified`. Plan IDs accept `\d{2}[a-z]?` so legacy `03b`-style entries still round-trip.
- **`SummaryFrontmatterSchema`** — `ac_results` normalized via Zod transform (accepts `{id, must_have, status, evidence}` and `{id, criterion, verdict, evidence}`, normalizes to the latter). Deviations similarly normalize `rationale` → `resolution`.
- **Frontmatter parser/formatter** — inline JSON-array-of-objects now round-trips when the inner payload opens with `{`. Existing string-array semantics preserved.
- **Read/write helpers** — `readPlanFrontmatter`/`writePlanFrontmatter` and `readSummaryFrontmatter`/`writeSummaryFrontmatter` wrap parseFrontmatter + Zod parsing.
- **Test fixtures** — verbatim VBW-grade PLAN + SUMMARY samples in `packages/artifacts/test/fixtures/` round-trip without data loss.

## Files Modified

See `files_modified` in frontmatter (8 files; 4 new src + 1 src edit + 1 src edit + 4 new tests).

## Acceptance criteria status

All 7 must-haves pass. Three deviations recorded:

- **D1** — Plan IDs accept `\d{2}[a-z]?` for VBW import compatibility; SWT canonical going forward is `\d{2}`.
- **D2** — AcResultSchema currently allows empty criterion strings; tightening lands with PLAN 10-02 (VERIFICATION schema).
- **D3** — pnpm/tsc unavailable locally; CI matrix is the live signal.

## Commit

`880a5e2` — feat(artifacts): VBW-grade PLAN + SUMMARY schemas with backwards compat (Phase 10 / PLAN 01)
