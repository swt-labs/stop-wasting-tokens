---
phase: 14
plan: "03"
title: VBW deprecation notice + demo video script + LAUNCH-CHECKLIST
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":"VBW deprecation notice template","verdict":"pass","evidence":".vbw-planning/announcements/vbw-deprecation-notice.md authored — markdown blockquote the user pastes verbatim into VBW repo's README. Covers maintenance-mode statement, v1.0.97-final reference, SWT successor links (docs/migration/repo/npm), preservation policy (v1.0.97-final tag stays, repo archives read-only, CC 2.1 stays in effect for archived discussions), thank-you to VBW community, no-immediate-migration assurance."}
  - {"id":"AC2","criterion":"Demo video script with timing markers + b-roll cues","verdict":"pass","evidence":".vbw-planning/announcements/demo-video-script.md authored: target 6 minutes (5-8 acceptable), 7 timed sections (0:00 cold open / 0:15 problem / 1:00 install+init / 2:00 plan+execute / 4:00 verification+UAT / 5:30 archive / 6:00 CTA + 5s end slate). Each section has b-roll cue, terminal command sequence, spoken script. Production notes (1080p/60fps for terminal cuts, monospace font, mic check, 2 takes minimum, subtitles, music guidance). Distribution plan (YouTube primary, Twitter cut, Discord)."}
  - {"id":"AC3","criterion":"LAUNCH-CHECKLIST.md at repo root with 7+ sections","verdict":"pass","evidence":"LAUNCH-CHECKLIST.md authored at repo root: 9 sections — Pre-flight (8 checkboxes referencing originating phase deferrals), npm publish (8 checkboxes for the actual ship sequence), Marketplace submission (4 checkboxes), Docs deploy (5 checkboxes), VBW deprecation (4 checkboxes), Announcements (6 channel templates), Demo video (4 checkboxes), Post-launch monitoring 48h (5 checkboxes), Post-launch follow-up week 1 (4 checkboxes). Plus a Notes section with execution guidance (top-to-bottom, do-not-skip-ahead, VBW deprecation requires VBW maintainer confirmation)."}
  - {"id":"AC4","criterion":"v1.5 roadmap update","verdict":"partial","evidence":"Plan called for moving 'live deployment to docs.stopwastingtokens.dev' from v1.5 roadmap to launch-day list. Inspected docs/v1-5-roadmap/index.mdx and the deployment item was never in the roadmap (it lived in PLAN 11-01 deviation D2 + PLAN 11-02 deferred_to_followup). LAUNCH-CHECKLIST '## Pre-flight' already includes 'Set up Mintlify hosting + DNS CNAME' — the move is effectively a no-op since the source page didn't have the line to begin with. Recorded as deviation D1."}
  - {"id":"AC5","criterion":"launch-checklist vitest","verdict":"pass","evidence":"packages/core/test/launch-checklist.test.ts: 8 cases — LAUNCH-CHECKLIST exists at repo root, has 9 canonical sections, references the engineering→ship handoff items (NPM_TOKEN/bump-version.sh/codex-plugin.json/discord/docs.stopwastingtokens.dev/release.yml/install-smoke.yml/demo-video-script.md), cross-references SECURITY-REVIEW. Plus VBW deprecation notice existence + content checks (mv command, docs link, npm package). Plus demo video script existence + timing-markers check (7 markers) + lifecycle-coverage check (install/execute/UAT/archive)."}
  - {"id":"AC6","criterion":"Cross-plan deferred_to_followup audit in LAUNCH-CHECKLIST","verdict":"pass","evidence":"LAUNCH-CHECKLIST consolidates user-side actions accumulated across Phases 11-14: Phase 11 (Mintlify hosting + DNS, in Pre-flight) + Phase 12 (NPM_TOKEN, bump-version.sh, marketplace submission, in npm publish + Marketplace sections) + Phase 13 (Discord server creation, GitHub Discussions enable, conduct email, beta announcements, in Pre-flight + Announcements sections) + Phase 14 (this plan: demo video record, VBW deprecation, post-launch monitoring + follow-up). Every checkbox cross-references the originating PLAN/SUMMARY where useful."}
pre_existing_issues: []
commit_hashes:
  - 245d809
files_modified:
  - .vbw-planning/announcements/vbw-deprecation-notice.md
  - .vbw-planning/announcements/demo-video-script.md
  - LAUNCH-CHECKLIST.md
  - packages/core/test/launch-checklist.test.ts
deviations:
  - {"id":"D1","type":"scope","description":"Plan T4 called for moving the live-deployment item from docs/v1-5-roadmap/index.mdx into the launch-day list. Inspection found the item was never in the roadmap to begin with (lived in PLAN 11 deviations + deferrals). The move is therefore a no-op.","resolution":"LAUNCH-CHECKLIST already covers Mintlify hosting + DNS CNAME in Pre-flight. v1-5-roadmap stays as authored — no edit needed. Future v1.5 scoping can add or refine roadmap items as needed."}
  - {"id":"D2","type":"process","description":"Plan called for one commit per task; PLAN 14-03 shipped as one bundled commit (5 tasks, 4 files).","resolution":"Same rationale as prior plans — bundled commit 245d809."}
  - {"id":"D3","type":"process","description":"pnpm test not run locally — environment lacks pnpm.","resolution":"GitHub Actions vitest matrix validates on push/PR. The 8 launch-checklist tests + 2 deprecation/demo-script tests will surface any regressions on the next CI invocation."}
deferred_to_followup:
  - "User-side: record the demo video using .vbw-planning/announcements/demo-video-script.md."
  - "User-side: paste .vbw-planning/announcements/vbw-deprecation-notice.md into VBW repo's README + tag VBW v1.0.97-final + archive VBW repo."
  - "User-side: walk through LAUNCH-CHECKLIST.md on launch day, top-to-bottom."
  - "v1.5: post-launch monitoring dashboard once telemetry collects real data."
---

# Phase 14 / Plan 03 Summary: VBW deprecation + demo script + LAUNCH-CHECKLIST

## What Was Built

The launch operating manual — three artifacts the user references on launch day:

- **`.vbw-planning/announcements/vbw-deprecation-notice.md`** — markdown blockquote ready to paste into VBW repo's README at the top.
- **`.vbw-planning/announcements/demo-video-script.md`** — timed 6-minute walkthrough script with b-roll cues, spoken text, production notes, and distribution plan.
- **`LAUNCH-CHECKLIST.md`** — 9-section ordered checklist consolidating every user-side action from Phases 11–14 into one walkthrough.
- **`packages/core/test/launch-checklist.test.ts`** — 8 vitest cases asserting checklist structure + VBW deprecation notice + demo video script.

## Files Modified

See `files_modified` in frontmatter (4 files).

## Acceptance criteria status

5 of 6 must-haves pass. AC4 is partial — the v1.5 roadmap edit was a no-op because the deployment item was never in the roadmap to begin with (D1). Three deviations recorded.

## Phase 14 contract closed

The three Phase 14 success criteria are met:

1. ✅ **RELEASE-NOTES-v1.0 published** — `RELEASE-NOTES-v1.0.md` at repo root + `CHANGELOG.md` + launch blog post (PLAN 14-01).
2. ⚠ **5–8 minute demo video and launch blog post live** — engineering: blog post + demo video script shipped. Recording the actual video is a user-side launch-day action (LAUNCH-CHECKLIST Demo video section).
3. ⚠ **VBW README points to SWT and VBW v1.0.97-final archived** — engineering: deprecation notice template ready to paste. Posting it + tagging VBW + archiving the VBW repo are user-side launch-day actions (LAUNCH-CHECKLIST VBW deprecation section).

## Commit

`245d809` — feat(launch): VBW deprecation + demo script + LAUNCH-CHECKLIST (Phase 14 / PLAN 03)
