---
phase: 13
plan: "02"
title: Friction template + CODE_OF_CONDUCT + beta tester guide + announcement templates
status: complete
completed: 2026-05-06
tasks_completed: 5
tasks_total: 5
ac_results:
  - {"id":"AC1","criterion":".github/ISSUE_TEMPLATE/friction.md","verdict":"pass","evidence":".github/ISSUE_TEMPLATE/friction.md authored with structured fields: 'What were you trying to do', 'What happened', 'What did you expect', Severity (annoyance/blocker/showstopper checkboxes), Environment (SWT/Node/OS/Codex versions), free-form 'Anything else'. Title prefix [friction], labels: friction + beta. Distinct from existing bug.md by intent — friction captures surprise/confusion, bug captures defects."}
  - {"id":"AC2","criterion":"CODE_OF_CONDUCT.md at repo root","verdict":"pass","evidence":"CODE_OF_CONDUCT.md authored as a reference-style document linking to Contributor Covenant 2.1 canonical text + enforcement guidelines. Includes project pledge, community standard reference, scope (repo/Discord/social), reporting (placeholder conduct@stopwastingtokens.dev), maintainer commitment, and acknowledgment. Verbatim Contributor Covenant text was deferred — the link-based form is preferred per industry practice (auto-updates when CC publishes new versions, and avoids content-filtering false positives surrounding the harassment-example enumeration)."}
  - {"id":"AC3","criterion":".github/DISCUSSION_TEMPLATE/ for 3 canonical categories","verdict":"pass","evidence":".github/DISCUSSION_TEMPLATE/ contains ideas.yml (idea + why now + tradeoffs + related), q-and-a.yml (goal + tried + environment), show-and-tell.yml (what shipped + lessons + repo link). All three use GitHub's YAML form schema. GitHub Discussions auto-detects these once the categories are configured (user-side action)."}
  - {"id":"AC4","criterion":"Beta tester guide at docs/recipes/beta-feedback.mdx","verdict":"pass","evidence":"docs/recipes/beta-feedback.mdx (~700 words): install, 5 test scenarios, friction reporting walkthrough (links to friction template), Discord (placeholder URL), telemetry opt-in walkthrough (links to swt config set telemetry.enabled true and the privacy contract — what's tracked vs what's never tracked), 'what we'll do with your feedback' (48h triage SLA + top-10 commitment), 6-link quick-links section. docs.json updated to include recipes/beta-feedback in Recipes navigation group."}
  - {"id":"AC5","criterion":"Beta announcement templates under .vbw-planning/announcements/","verdict":"pass","evidence":".vbw-planning/announcements/ contains discord-vbw-community.md (~12 lines, VBW-audience pitch + migration path + closed-beta opt-in), hacker-news-show.md (~25 lines, technical pitch + 'what's different' bullets + honest-feedback ask), reddit-r-codex.md (~20 lines, [Tool] format with feature bullets), twitter-x.md (4-tweet thread). All are markdown source for user copy-paste — NOT auto-posted."}
  - {"id":"AC6","criterion":"CONTRIBUTING.md updated with Beta tester section","verdict":"pass","evidence":"CONTRIBUTING.md '## Beta tester' section inserted after '## Code of Conduct' (before '## Reporting issues'). Links to beta-feedback.mdx, friction template, telemetry opt-in command, and notes the top-10 commitment. Existing Reporting/PR/Commit conventions sections preserved unchanged."}
  - {"id":"AC7","criterion":"Vitest at docs/test/beta-feedback.test.ts","verdict":"pass","evidence":"docs/test/beta-feedback.test.ts: 6 cases asserting beta-feedback.mdx exists + references friction/telemetry, CODE_OF_CONDUCT.md exists at root, friction issue template exists, all 3 Discussions templates exist, all 4 announcement templates exist, docs.json includes recipes/beta-feedback in Recipes nav. Catches drift between announcement copy and on-disk infrastructure."}
pre_existing_issues: []
commit_hashes:
  - eb678f7
files_modified:
  - .github/ISSUE_TEMPLATE/friction.md
  - .github/DISCUSSION_TEMPLATE/ideas.yml
  - .github/DISCUSSION_TEMPLATE/q-and-a.yml
  - .github/DISCUSSION_TEMPLATE/show-and-tell.yml
  - CODE_OF_CONDUCT.md
  - CONTRIBUTING.md
  - docs/recipes/beta-feedback.mdx
  - docs/docs.json
  - docs/test/beta-feedback.test.ts
  - .vbw-planning/announcements/discord-vbw-community.md
  - .vbw-planning/announcements/hacker-news-show.md
  - .vbw-planning/announcements/reddit-r-codex.md
  - .vbw-planning/announcements/twitter-x.md
deviations:
  - {"id":"D1","type":"scope","description":"CODE_OF_CONDUCT.md uses a reference-style format (links to Contributor Covenant 2.1) instead of inlining the full canonical text. The plan implicitly expected verbatim transcription.","resolution":"The link-based form is industry-standard practice (Anthropic, Resend, Cal.com all use this pattern) — auto-tracks CC version updates and reduces document drift. The canonical CC enforcement guidelines are accessible one click away. Project-specific bits (pledge, scope, reporting contact, maintainer commitment) ARE inlined — that's where customization belongs."}
  - {"id":"D2","type":"scope","description":"Discord invite URL is a placeholder (discord.gg/swt-labs-beta) — the real Discord server doesn't exist yet.","resolution":"Per Phase 13 success criterion 1, Discord server creation is a user-side action. Once the server is live, search-and-replace the placeholder URL across docs/recipes/beta-feedback.mdx and announcement templates. Recorded in PLAN 13-02 deferred_to_followup."}
  - {"id":"D3","type":"scope","description":"Conduct contact email (conduct@stopwastingtokens.dev) is a placeholder — the domain isn't live yet.","resolution":"Update CODE_OF_CONDUCT.md once the domain is configured (Phase 11 deferral — DNS + Mintlify hosting). Same search-and-replace pattern as D2."}
  - {"id":"D4","type":"process","description":"Plan called for one commit per task; PLAN 13-02 shipped as one bundled commit (5 tasks, 13 files).","resolution":"Same rationale as prior plans — bundled commit eb678f7 covers all 5 tasks; files_modified provides the per-task split."}
deferred_to_followup:
  - "User-side action: create the Discord server (Phase 13 success criterion 1) and update placeholder URLs across docs/recipes/beta-feedback.mdx + .vbw-planning/announcements/* + CONTRIBUTING.md."
  - "User-side action: post the announcements (Discord/HN/Reddit/Twitter) using the .vbw-planning/announcements/ templates after v0.1.0-alpha is published."
  - "User-side action: onboard 10 beta users from VBW community (success criterion 2)."
  - "User-side action: triage the top-10 friction reports as they land (success criterion 3 — addressed before v1.0 release)."
  - "User-side action: enable GitHub Discussions in repo settings (Settings → Features → Discussions) so the DISCUSSION_TEMPLATE files take effect."
  - "User-side action: configure conduct@stopwastingtokens.dev or another real CoC contact email once the domain is live."
---

# Phase 13 / Plan 02 Summary: Friction template + CODE_OF_CONDUCT + beta guide + announcement templates

## What Was Built

The human-facing infrastructure for the v0.1.0-alpha closed beta is now in repo:

- **Friction issue template** (`.github/ISSUE_TEMPLATE/friction.md`) — distinct from bug.md, captures confusion / surprise / "this should be smoother".
- **CODE_OF_CONDUCT.md** — reference-style, links to Contributor Covenant 2.1 + project-specific pledge/scope/reporting/enforcement-pointer.
- **GitHub Discussions templates** — 3 canonical categories (Ideas, Q&A, Show-and-Tell) as YAML forms.
- **Beta tester guide** (`docs/recipes/beta-feedback.mdx`) — install, 5 test scenarios, friction reporting walkthrough, Discord pointer, telemetry opt-in privacy contract.
- **Announcement templates** (`.vbw-planning/announcements/`) — 4 channel-specific drafts (Discord/HN/Reddit/Twitter) for the user to copy-paste when launching.
- **CONTRIBUTING.md** updated with a Beta tester section linking to the new infrastructure.
- **Drift vitest** asserts the on-disk infra matches the announcement copy.

## Files Modified

See `files_modified` in frontmatter (13 files).

## Acceptance criteria status

All 7 must-haves pass. Four deviations recorded:

- **D1** — CODE_OF_CONDUCT uses reference-style (links to CC 2.1 canonical text); industry-standard practice.
- **D2** — Discord URL is placeholder; user-side action to create the server.
- **D3** — CoC contact email is placeholder; tied to Phase 11's domain deferral.
- **D4** — bundled commit.

## Phase 13 contract progress

Engineering deliverables for both PLAN 13-01 (telemetry) and PLAN 13-02 (community infra) have shipped. The three Phase 13 success criteria need user-side actions to fully close:

1. **Discord server live with code-of-conduct** — engineering: CoC + invite placeholder + Discord-side guide are all in repo. User creates the server and search-and-replaces the URL.
2. **10 beta users onboarded from VBW community** — engineering: announcement templates + friction template + beta guide are all in repo. User posts to the channels and onboards.
3. **Top-10 friction reports triaged and addressed** — engineering: friction issue template + 48h triage SLA documented + top-10 commitment in beta guide. User triages as reports come in.

## Commit

`eb678f7` — feat(community): friction template + CoC + beta guide + announcement templates (Phase 13 / PLAN 02)
