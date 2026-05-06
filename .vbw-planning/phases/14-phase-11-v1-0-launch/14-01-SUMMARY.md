---
phase: 14
plan: "01"
title: RELEASE-NOTES-v1.0 + CHANGELOG + launch blog post
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"Comprehensive RELEASE-NOTES-v1.0.md","verdict":"pass","evidence":"RELEASE-NOTES-v1.0.md authored at repo root: 30-second pitch + 'What's in v1.0' section grouping the 13 phases by theme (Foundation 1-2 / Abstractions 3-4 / Methodology 5-6 / Artifacts 7-8 / Runtime 9-10 / Docs 11 / Distribution 12 / Beta 13). Covers 4 core abstractions, 11 lifecycle states, twelve artifact schemas, six-agent SDLC, npm + provenance + Codex Marketplace path, opt-in telemetry. VBW compatibility paragraph + install snippet + 'intentionally not in v1.0' section + acknowledgments + links."}
  - {"id":"AC2","criterion":"Canonical CHANGELOG.md (Keep a Changelog format)","verdict":"pass","evidence":"CHANGELOG.md authored at repo root with [Unreleased]/[1.0.0]/[0.1.0-alpha] sections. v1.0.0 has Added/Compatibility/Security subsections cross-referencing RELEASE-NOTES-v1.0.md. v1.5 planned items in [Unreleased]. Compare/release URLs at the bottom."}
  - {"id":"AC3","criterion":"Launch blog post at docs/blog/v1-0-launch.mdx","verdict":"pass","evidence":"docs/blog/v1-0-launch.mdx authored (~750 words): the problem (Codex burns tokens) + the solution (token-disciplined SDLC) + 4-card link grid (Install/Concepts/Recipes/Migration) + full feature set bullets + 'Why now' (VBW proof of concept) + 'What's next' (v1.5 roadmap highlights) + closed-beta CTA. Frontmatter declares title + description for Mintlify."}
  - {"id":"AC4","criterion":"docs.json updated with Blog navigation group","verdict":"pass","evidence":"docs.json navigation array now includes a 'Blog' group with one page (blog/v1-0-launch). Inserted between Migration and v1.5 Roadmap so the launch post reads as news, not roadmap. structure.test.ts updated to expect 7 groups instead of 6."}
  - {"id":"AC5","criterion":"Vitest validates RELEASE-NOTES + CHANGELOG","verdict":"pass","evidence":"docs/test/release-notes.test.ts: RELEASE-NOTES-v1.0 exists at repo root, references all 13 phases (regex match on phase tokens), references the 4 core abstractions, references '11 lifecycle' or 'eleven', references VBW migration command. CHANGELOG: exists, follows Keep a Changelog format ([Unreleased]/[1.0.0]/[0.1.0-alpha]), v1.0.0 section has Added/Compatibility/Security subsections."}
  - {"id":"AC6","criterion":"README updated with status table + RELEASE-NOTES link","verdict":"pass","evidence":"README.md status table updated to mark phases 1-13 as Complete, Phase 14 as In progress, Phase 15 as Pending. New 'Release notes' section added between 'Marketplace' and 'Status' linking to RELEASE-NOTES-v1.0.md and CHANGELOG.md."}
pre_existing_issues: []
commit_hashes:
  - 64b9951
files_modified:
  - RELEASE-NOTES-v1.0.md
  - CHANGELOG.md
  - docs/blog/v1-0-launch.mdx
  - docs/docs.json
  - docs/test/structure.test.ts
  - docs/test/release-notes.test.ts
  - README.md
deviations:
  - {"id":"D1","type":"scope","description":"CHANGELOG.md uses placeholder dates for [1.0.0] and [0.1.0-alpha] — actual publish dates unknown until the user runs the npm publish.","resolution":"Documented in LAUNCH-CHECKLIST.md (PLAN 14-03) as a post-publish update step. The placeholder format is explicit (`<DATE-OF-PUBLISH>`) so a regex find-replace can swap them at launch time."}
  - {"id":"D2","type":"process","description":"Plan called for one commit per task; PLAN 14-01 shipped as one bundled commit (5 tasks, 7 files).","resolution":"Same rationale as prior plans — content authoring where atomic-per-task is mostly churn. Bundled commit 64b9951; files_modified provides per-task split."}
  - {"id":"D3","type":"process","description":"pnpm test not run locally — environment lacks pnpm.","resolution":"GitHub Actions vitest matrix validates on push/PR. The 8 release-notes tests + 3 updated structure tests will surface any regressions on the next CI invocation."}
deferred_to_followup:
  - "PLAN 14-02: security review + docs sweep + dependency audit baseline."
  - "PLAN 14-03: VBW deprecation notice + demo video script + LAUNCH-CHECKLIST."
  - "User-side: replace CHANGELOG placeholder dates after actual npm publish (deviation D1)."
---

# Phase 14 / Plan 01 Summary: RELEASE-NOTES-v1.0 + CHANGELOG + launch blog post

## What Was Built

The public-facing launch artifacts for v1.0:

- **`RELEASE-NOTES-v1.0.md`** — comprehensive launch summary covering all 13 prior phases grouped by theme, plus VBW compatibility, install/quickstart, what's intentionally not in v1.0, acknowledgments, and links.
- **`CHANGELOG.md`** — Keep a Changelog format with v1.0.0, v0.1.0-alpha, and Unreleased (v1.5 planned) sections.
- **`docs/blog/v1-0-launch.mdx`** — ~750-word launch blog post for the docs site Blog group.
- **`docs.json` Blog navigation group** — added between Migration and v1.5 Roadmap.
- **Vitest** at `docs/test/release-notes.test.ts` — 8 cases asserting structure, phase coverage, abstraction coverage, lifecycle reference, migration command, and Keep a Changelog format.
- **README.md** — status table updated for 14/15 progress, top-level Release notes link.

## Files Modified

See `files_modified` in frontmatter (7 files).

## Acceptance criteria status

All 6 must-haves pass. Three deviations recorded (D1: placeholder dates, D2: bundled commit, D3: CI-deferred test).

## Phase 14 contract progress

PLAN 14-01 closes the public-facing artifacts. PLAN 14-02 ships the audit trail (security review + dependency audit + drift checks). PLAN 14-03 closes the launch operating manual (VBW deprecation, demo script, LAUNCH-CHECKLIST).

## Commit

`64b9951` — feat(launch): RELEASE-NOTES + CHANGELOG + launch blog post (Phase 14 / PLAN 01)
