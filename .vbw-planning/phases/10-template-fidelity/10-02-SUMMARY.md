---
phase: "10"
plan: "02"
title: VBW-grade VERIFICATION body + UAT severity + RESEARCH schemas (Phase 10 / PLAN 02)
status: complete
completed: 2026-05-06
tasks_completed: 6
tasks_total: 6
ac_results:
  - {"id":"AC1","criterion":"VerificationDocSchema parses + renders the VBW multi-section body","verdict":"pass","evidence":"verification.ts: parseVerificationBody scans `## {Section}` headings followed by markdown tables and routes rows into the matching typed array (checks / artifact_checks / key_link_checks / anti_pattern_checks / convention_checks / requirement_mapping). renderVerificationBody emits the same layout when doc.layout='vbw'. SWT default ('swt') still emits the single Must-Have table. verification-body.test.ts covers 4 cases including round-trip of the verbatim VBW fixture."}
  - {"id":"AC2","criterion":"UatDocSchema severity_counts derived + round-tripped","verdict":"pass","evidence":"uat.ts: SeverityCountsSchema with critical/major/minor/cosmetic; deriveSeverityCounts(issue_records) fills the breakdown when not supplied; writer renders a `Severity Mix: 1 critical, 1 major` line at the top of the Issues body. uat-severity.test.ts covers 2 cases (derive + round-trip)."}
  - {"id":"AC3","criterion":"ResearchFrontmatterSchema + StandaloneResearchFrontmatterSchema with helpers","verdict":"pass","evidence":"schemas/research.ts: phase + plan? + gathered + sources_consulted + files_referenced + findings_summary + live_validation_required. read/write helpers wrap parseFrontmatter + Zod parse. research.test.ts covers 5 cases (minimal, full, malformed gathered, phase round-trip, standalone topic round-trip)."}
  - {"id":"AC4","criterion":"Frontmatter parser/formatter handles inline JSON object values","verdict":"pass","evidence":"frontmatter.ts: parseScalarYaml recognises `{...}` inline JSON objects via JSON.parse. formatScalarYaml renders plain object values via JSON.stringify. This unblocks severity_counts round-trip and any other future inline-object frontmatter fields."}
  - {"id":"AC5","criterion":"Backwards compat — existing callers don't break","verdict":"pass","evidence":"WriteVerificationOptions.doc and WriteUatOptions.doc both accept the z.input shape, so existing callers (qaHandler, verifyHandler, milestone tests, mechanical UAT writes) that omit defaulted fields like layout / artifact_checks / severity_counts continue to typecheck. plans_verified regex now accepts \\d{2}[a-z]? (mirrors PlanFrontmatterSchema)."}
  - {"id":"AC6","criterion":"Vitest covers VBW multi-section, UAT severity, RESEARCH","verdict":"pass","evidence":"9 new vitest cases: 4 verification-body (multi-section parse, fixture round-trip, SWT layout render, VBW layout render), 2 uat-severity (derive + round-trip), 5 research (minimal phase, full phase, malformed gathered, phase round-trip, standalone topic). 1 verbatim VBW VERIFICATION fixture (vbw-verification-multi-section.md) with all 6 section tables."}
pre_existing_issues: []
commit_hashes:
  - 4d07982
files_modified:
  - packages/artifacts/src/frontmatter.ts
  - packages/artifacts/src/qa/uat.ts
  - packages/artifacts/src/qa/verification.ts
  - packages/artifacts/src/schemas/index.ts
  - packages/artifacts/src/schemas/research.ts
  - packages/artifacts/test/fixtures/vbw-verification-multi-section.md
  - packages/artifacts/test/qa/uat-severity.test.ts
  - packages/artifacts/test/qa/verification-body.test.ts
  - packages/artifacts/test/schemas/research.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"Existing 09-VERIFICATION.md files keep the SWT single-table body layout; they parse cleanly through the new multi-section parser (the fallback path treats a pre-section table as Must-Have).","resolution":"Migration tool to rewrite to VBW layout is deferred — single-table layout is fully supported and round-trips today."}
  - {"id":"D2","type":"scope","description":"REMEDIATION-PLAN / REMEDIATION-RESEARCH / REMEDIATION-SUMMARY / DEBUG-SESSION schemas are not yet shipped — they are PLAN 10-03's scope.","resolution":"PLAN 10-03 will add the typed schemas; templates land in PLAN 10-04."}
  - {"id":"D3","type":"process","description":"pnpm + tsc not installed locally; tests not executed in this session.","resolution":"GitHub Actions CI runs the matrix on push/PR."}
deferred_to_followup:
  - "PLAN 10-03: REMEDIATION-PLAN / REMEDIATION-RESEARCH / REMEDIATION-SUMMARY / DEBUG-SESSION schemas."
  - "PLAN 10-04: Template strings under @swt-labs/artifacts/templates/."
  - "Migration tool: rewrite SWT phase 1-9 VERIFICATION.md from single-table to VBW multi-section layout."
---

# Phase 10 / Plan 02 Summary: VBW-grade VERIFICATION body + UAT severity + RESEARCH schemas

## What Was Built

Three template-fidelity upgrades layered on PLAN 10-01:

- **`VerificationDocSchema`** — `parseVerificationBody` and `renderVerificationBody` handle the VBW multi-section body layout (Must-Have / Artifact / Key-Link / Anti-pattern / Convention / Requirement Mapping). New fields default to `[]` so the SWT-1.0 single-table layout still works. `layout: 'swt' | 'vbw'` picks the renderer mode. `plans_verified` regex accepts the `\d{2}[a-z]?` shape.
- **`UatDocSchema`** — `severity_counts` field with critical/major/minor/cosmetic breakdown; `deriveSeverityCounts(issue_records)` fills it when not supplied; body renders a `Severity Mix` line at the top of Issues.
- **`ResearchFrontmatterSchema` + `StandaloneResearchFrontmatterSchema`** — typed read/write helpers for RESEARCH.md (phase + plan?) and STANDALONE-RESEARCH.md (topic).
- **Frontmatter parser/formatter** — handles inline JSON object values for round-trip of `severity_counts` and any other future inline-object fields.
- **Writer input compat** — both `WriteVerificationOptions.doc` and `WriteUatOptions.doc` accept the `z.input` shape so existing callers (qaHandler, verifyHandler, milestone tests, mechanical UAT writes) keep typechecking.

## Files Modified

See `files_modified` in frontmatter (9 files; 4 src edits + 1 new src + 1 src+test edit + 3 new tests + 1 new fixture).

## Acceptance criteria status

All 6 must-haves pass. Three deviations recorded:

- **D1** — Existing SWT single-table VERIFICATION layouts parse and round-trip; migration tool deferred.
- **D2** — REMEDIATION-* and DEBUG-SESSION schemas land in PLAN 10-03.
- **D3** — pnpm/tsc unavailable locally; CI matrix is the live signal.

## Commit

`4d07982` — feat(artifacts): VBW-grade VERIFICATION body + UAT severity + RESEARCH schemas (Phase 10 / PLAN 02)
