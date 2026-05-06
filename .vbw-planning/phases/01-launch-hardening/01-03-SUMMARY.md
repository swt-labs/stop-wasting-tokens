---
phase: 01
plan: 01-03
title: Documentation + scripts cleanup
status: complete
completed: 2026-05-06
tasks_completed: 4
tasks_total: 4
commit_hashes: []
deviations:
  - "T3 was a no-op verification: `.github/workflows/install-smoke.yml` already had no in-workflow `.vbw-planning/` override; the workflow inherits the strict check from T2's verify-install.sh fix without further edits. The file was kept in `files_modified` for audit-trail visibility — Plan 01-03 confirmed it was already clean rather than changed it."
  - "Plan amendment mid-execution: added `docs/roadmap/v1.5.md` to `files_modified` to land T4's M7 follow-up note. T4 was always intended to edit this file but the planning frontmatter omitted it; corrected at the moment of discovery."
pre_existing_issues: []
ac_results:
  - criterion: "the public README's status block links to a real, post-archive roadmap (docs/roadmap/v1.5.md or similar) — never to the gitignored .vbw-planning/ROADMAP.md"
    verdict: "pass"
    evidence: "README.md:3 now reads `See the [v1.5 roadmap](docs/roadmap/v1.5.md) for what's coming next.`; the `docs/roadmap/v1.5.md` file exists and is the canonical engineering roadmap"
  - criterion: "the post-install smoke test fails loudly if `swt init` produces a `.vbw-planning/` directory — there is no silent fallback masking the AGENTS.md fix"
    verdict: "pass"
    evidence: "scripts/verify-install.sh now checks only `.swt-planning/PROJECT.md`; `.vbw-planning/` fallback removed; `bash -n scripts/verify-install.sh` confirms valid syntax"
  - criterion: "M7's state-drift verifier improvement is captured as documented design intent (deferred to v1.5 if v1.0 verifier scripts aren't shipped product code)"
    verdict: "pass"
    evidence: "docs/roadmap/v1.5.md Methodology section now contains a `**Follow-up (M7 from v1.0 audit).**` paragraph documenting the deferral and tying it to F6 / F7 work; the verifier is the VBW Claude Code plugin's helper script, not SWT product code, so the deferral is the correct disposition"
---

Public README points at a real roadmap, the install smoke test is strict, and M7 has an explicit v1.5 disposition — closing the documentation/scripts cleanup audit findings.

## What Was Built

- `README.md:3` status block now links to `docs/roadmap/v1.5.md` (the canonical v1.5 engineering roadmap) instead of the gitignored `.vbw-planning/ROADMAP.md`
- `scripts/verify-install.sh` post-install smoke test no longer accepts `.vbw-planning/PROJECT.md` as a passing condition — it must be `.swt-planning/PROJECT.md`. The error message updated to reference `.swt-planning/` explicitly so a regression is loud
- `.github/workflows/install-smoke.yml` confirmed to have no in-workflow override — inherits the strict check from `verify-install.sh` cleanly
- `docs/roadmap/v1.5.md` Methodology section now carries a `Follow-up (M7 from v1.0 audit)` annotation tying the state-drift verifier improvement to F6 / F7 work, since the verifier (`verify-state-consistency.sh`) lives in the VBW Claude Code plugin rather than SWT product code

## Files Modified

- `README.md` — line 3, swap `.vbw-planning/ROADMAP.md` link for `docs/roadmap/v1.5.md`
- `scripts/verify-install.sh` — remove `.vbw-planning/` fallback from the swt-init scaffold check; tighten error message to reference `.swt-planning/`
- `.github/workflows/install-smoke.yml` — no edit required (already clean); kept in `files_modified` for audit-trail
- `docs/roadmap/v1.5.md` — append M7 follow-up annotation to the F7 (Hook event taxonomy) section

## Deviations

See frontmatter `deviations:`. Two minor:

1. T3 was a confirmation pass rather than an edit — install-smoke.yml was already strict.
2. Plan amendment to add `docs/roadmap/v1.5.md` to `files_modified` for T4 (omission caught and corrected at execution time).

## Verification

1. ✅ `grep -RIn '\.vbw-planning/' README.md scripts/ .github/workflows/` returns no matches
2. ✅ `bash -n scripts/verify-install.sh` exits 0
3. ✅ M7 note present in `docs/roadmap/v1.5.md` (verified via `grep -A 1 'Follow-up (M7'`)
4. ⚠ `pnpm test` not re-run as part of 01-03 — none of the files changed are in vitest's scope; no test regression risk

## Next

All three Plan 01-* plans complete. Phase 1 ready for QA verification.
