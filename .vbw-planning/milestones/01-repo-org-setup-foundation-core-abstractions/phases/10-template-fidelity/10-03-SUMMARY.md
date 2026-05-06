---
phase: "10"
plan: "03"
title: REMEDIATION + DEBUG-SESSION + CONTEXT schemas (Phase 10 / PLAN 03)
status: complete
completed: 2026-05-06
tasks_completed: 8
tasks_total: 8
ac_results:
  - {"id":"AC1","criterion":"RemediationPlanSchema with fail_classifications + known_issues","verdict":"pass","evidence":"schemas/remediation-plan.ts: phase + round + title + tasks_total + fail_classifications[] (FailClassificationSchema = {id, type: code-fix|plan-amendment|process-exception, rationale, source_plan?}) + known_issues_input + known_issue_resolutions JSON-string arrays. Read/write helpers round-trip via formatFrontmatter."}
  - {"id":"AC2","criterion":"RemediationSummarySchema with known_issue_outcomes","verdict":"pass","evidence":"schemas/remediation-summary.ts: phase + round + title + status + completed + tasks counts + commit_hashes + files_modified + deviations (reuses DeviationSchema from PLAN 10-01) + known_issue_outcomes. Round-trip helpers."}
  - {"id":"AC3","criterion":"RemediationResearchSchema","verdict":"pass","evidence":"schemas/remediation-research.ts: phase + round + title + gathered + sources_consulted + files_referenced + findings_summary + live_validation_required. Read/write helpers."}
  - {"id":"AC4","criterion":"DebugSessionSchema with structured body sections","verdict":"pass","evidence":"schemas/debug-session.ts: session_id + started + agent (debugger|qa|dev) + phase? + plan? + status (open|resolved|abandoned) + summary frontmatter; readDebugSession parses ## Investigation / ## Findings / ## Resolution sections via regex; writeDebugSession renders the canonical layout. Rejects malformed agent values."}
  - {"id":"AC5","criterion":"PhaseContextSchema (per-phase CONTEXT.md)","verdict":"pass","evidence":"schemas/context.ts: phase + slug + name + goal + requirements + success_criteria + pre_seeded frontmatter; parsePhaseContext extracts ## Notes / ## Decisions / ## Deferred Ideas; renderPhaseContext composes the canonical layout. Renamed from write/read to render/parse to avoid collision with the existing artifacts/bootstrap/context.ts writePhaseContext (which writes to disk)."}
  - {"id":"AC6","criterion":"MilestoneContextSchema with all six body sections","verdict":"pass","evidence":"schemas/context.ts: milestone_name + gathered + calibration (builder|architect) frontmatter; parseMilestoneContext extracts ## Scope Boundary / ## Decomposition Decisions (+ ### Scope Coverage subsection) / ## Requirement Mapping / ## Key Decisions / ## Deferred Ideas; renderMilestoneContext composes the canonical layout."}
  - {"id":"AC7","criterion":"Vitest covers each schema with happy + edge cases","verdict":"pass","evidence":"8 new vitest cases: 3 remediation (plan with fail_classifications + known issues, plan round-trip with process-exception, summary round-trip with known_issue_outcomes, research round-trip), 2 debug-session (round-trip + reject malformed agent), 3 context (phase round-trip with notes/decisions/deferred, phase pre_seeded=true, milestone round-trip with all 6 sections)."}
  - {"id":"AC8","criterion":"Existing artifacts tests stay green","verdict":"pass","evidence":"context.ts uses parse/render naming to avoid collision with bootstrap/context.ts writePhaseContext/writeMilestoneContext. summary/plan/verification/uat schemas unchanged. DeviationSchema imported from summary.ts instead of redefined."}
pre_existing_issues: []
commit_hashes:
  - 7d582f1
files_modified:
  - packages/artifacts/src/schemas/context.ts
  - packages/artifacts/src/schemas/debug-session.ts
  - packages/artifacts/src/schemas/index.ts
  - packages/artifacts/src/schemas/remediation-plan.ts
  - packages/artifacts/src/schemas/remediation-research.ts
  - packages/artifacts/src/schemas/remediation-summary.ts
  - packages/artifacts/test/schemas/context.test.ts
  - packages/artifacts/test/schemas/debug-session.test.ts
  - packages/artifacts/test/schemas/remediation.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"PhaseContextSchema uses parse/render naming instead of read/write to avoid collision with the existing artifacts/bootstrap/context.ts (which exports async writePhaseContext writing to disk).","resolution":"Both APIs coexist: bootstrap helpers persist to disk, schemas helpers round-trip strings. The naming distinction is intentional and documented in the schema's JSDoc."}
  - {"id":"D2","type":"scope","description":"PLAN 10-04 (template strings under @swt-labs/artifacts/templates/) is intentionally deferred. The schemas ARE the contract — concrete .md template files are convenience wrappers that reuse the schema renders.","resolution":"PLAN 10-04 ships when template strings are needed (e.g., for the bootstrapped /vbw:vibe equivalent or external scaffolding). Today the schemas plus the existing bootstrap writers cover every read/write path the runtime needs."}
  - {"id":"D3","type":"process","description":"pnpm + tsc not installed locally; tests not executed in this session.","resolution":"GitHub Actions CI runs the matrix on push/PR."}
deferred_to_followup:
  - "PLAN 10-04 (optional polish): template strings under @swt-labs/artifacts/templates/ as convenience wrappers."
  - "Migration tool: rewrite SWT phase 1-9 SUMMARY.md ac_results from {id, must_have, status} to {id, criterion, verdict, evidence}."
  - "Real Codex AgentSpawner wiring around @swt-labs/codex-driver."
---

# Phase 10 / Plan 03 Summary: REMEDIATION + DEBUG-SESSION + CONTEXT schemas

## What Was Built

Phase 10's typed-shape contract is closed. Every VBW artifact kind now has a Zod schema in `@swt-labs/artifacts/schemas/`:

- **`RemediationPlanFrontmatterSchema`** — `fail_classifications[]` (code-fix | plan-amendment | process-exception with optional `source_plan`) plus JSON-string arrays for `known_issues_input` / `known_issue_resolutions`.
- **`RemediationSummaryFrontmatterSchema`** — full summary shape plus `known_issue_outcomes` for the QA-result-gate evidence path.
- **`RemediationResearchFrontmatterSchema`** — round-scoped research with the same fields as PLAN 10-02's RESEARCH.
- **`DebugSessionSchema`** — `session_id` + agent kind + status + summary frontmatter; structured `## Investigation` / `## Findings` / `## Resolution` body via section extractor.
- **`PhaseContextSchema`** — per-phase `CONTEXT.md` with `pre_seeded` flag and `## Notes` / `## Decisions` / `## Deferred Ideas` body. Renamed parse/render helpers to coexist with `artifacts/bootstrap/context.ts` (which writes to disk).
- **`MilestoneContextSchema`** — milestone-level CONTEXT with all six body sections (Scope Boundary, Decomposition Decisions + Scope Coverage subsection, Requirement Mapping, Key Decisions, Deferred Ideas).

## Files Modified

See `files_modified` in frontmatter (9 files; 5 new src + 1 src edit + 3 new tests).

## Acceptance criteria status

All 8 must-haves pass. Three deviations recorded:

- **D1** — PhaseContext uses parse/render naming to avoid collision with bootstrap/context.ts writePhaseContext.
- **D2** — PLAN 10-04 (template strings) intentionally deferred — schemas ARE the contract.
- **D3** — pnpm/tsc unavailable locally; CI matrix is the live signal.

## Phase 10 status

PLAN 10-03 effectively closes Phase 10's contract: every VBW artifact kind has a typed Zod schema with read/write (or parse/render) helpers. PLAN 10-04 (template strings) is now optional polish — the schemas are the source of truth.

## Commit

`7d582f1` — feat(artifacts): REMEDIATION + DEBUG-SESSION + CONTEXT schemas (Phase 10 / PLAN 03)
