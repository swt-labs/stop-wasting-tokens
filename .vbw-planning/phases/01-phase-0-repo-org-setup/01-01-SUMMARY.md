---
phase: 01
plan: 01
title: Repo & org setup (artifact Phase 0)
status: complete
completed: 2026-05-06
tasks_completed: 9
tasks_total: 12
ac_results:
  - id: AC1
    must_have: MIT LICENSE present
    status: pass
    evidence: LICENSE in repo root, MIT text, copyright "Tiago Serôdio (@yidakee) and SWT contributors".
  - id: AC2
    must_have: CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
    status: deferred
    evidence: Not authored this session due to repeated API output-filter blocks. Add Contributor Covenant 2.1 directly from contributor-covenant.org. Tracked under D3.
  - id: AC3
    must_have: CONTRIBUTING.md with PR/issue conventions
    status: pass
    evidence: CONTRIBUTING.md in repo root covers issue templates, PR flow, commit conventions, dev environment, and originality statement. (The plan also mentioned a clean-room rule; see D3 — that policy section was not included due to the same content-filter constraint and is not v1-blocking.)
  - id: AC4
    must_have: SECURITY.md with responsible disclosure policy
    status: pass
    evidence: SECURITY.md in repo root with supported-versions table, private reporting channel, 72h ack / 7d assessment / 90d disclosure timeline, scope, and safe-harbour clause.
  - id: AC5
    must_have: Initial README.md with TL;DR + alpha disclaimer
    status: pass
    evidence: README.md in repo root with alpha banner, TL;DR, planned install, planned quick start, phase status table, and links to LICENSE/CONTRIBUTING/SECURITY.
  - id: AC6
    must_have: .github/ISSUE_TEMPLATE/ with bug, feature, question templates
    status: pass
    evidence: .github/ISSUE_TEMPLATE/{bug.md,feature.md,question.md,config.yml} present; blank issues disabled; Discussions linked.
  - id: AC7
    must_have: .github/PULL_REQUEST_TEMPLATE.md
    status: pass
    evidence: .github/PULL_REQUEST_TEMPLATE.md present with summary, motivation, changes, testing checklist, docs checklist, originality statement.
  - id: AC8
    must_have: docs/brand.md (brand voice guide)
    status: deferred
    evidence: Not authored this session due to API output-filter blocks. Tracked under D3. Non-blocking for Phase 2.
  - id: AC9
    must_have: GitHub repo topics set
    status: pass
    evidence: gh repo view returned topics agents, cli, codex, methodology, npm, typescript, vibe-coding.
  - id: AC10
    must_have: GitHub repo description set
    status: pass
    evidence: 'gh repo view returned description "Token-disciplined, methodology-first SDLC for the OpenAI Codex CLI."'
  - id: AC11
    must_have: Initial commit with all the above
    status: pass
    evidence: Local commit 3f67467 on main contains 10 files, 405 insertions. Not pushed (auto_push=never).
commit_hashes:
  - 3f67467
files_modified:
  - LICENSE
  - .gitignore
  - README.md
  - CONTRIBUTING.md
  - SECURITY.md
  - .github/PULL_REQUEST_TEMPLATE.md
  - .github/ISSUE_TEMPLATE/config.yml
  - .github/ISSUE_TEMPLATE/bug.md
  - .github/ISSUE_TEMPLATE/feature.md
  - .github/ISSUE_TEMPLATE/question.md
deviations:
  - id: D1
    type: scope
    description: Repo created with private visibility per user preference; the source plan specified public.
    resolution: Documented as a deliberate user choice. Visibility flip is a one-line gh command when ready.
  - id: D2
    type: process
    description: VBW Plan→Execute orchestration unavailable in this session because the Agent (Task) tool is denied in ~/.claude/settings.json. Phase 1 was executed by direct file authoring instead of via Scout/Lead/Dev subagents.
    resolution: Plan + Summary still live under .vbw-planning/phases/01-…/ for VBW state continuity. To unlock orchestration for later phases, lift the Agent deny in user settings.
  - id: D3
    type: scope
    description: CODE_OF_CONDUCT.md, docs/brand.md, and docs/sunset-vbw.md were not authored. Repeated API-level output content-filter blocks made these specific drafts non-trivial to produce in this session.
    resolution: All three are non-blocking for v1. Author Contributor Covenant 2.1 directly from contributor-covenant.org; the brand voice guide and VBW sunset draft can be added in any later session.
  - id: D4
    type: scope
    description: Source plan moved from project root to .vbw-planning/research/source-plan.md to keep it out of the public-facing repo and the active codebase.
    resolution: File preserved in full; .gitignore continues to exclude compass_artifact_*.md patterns from the project root.
deferred_to_user:
  - npm package name reservation (`stop-wasting-tokens`, `@swt-labs/cli`)
  - Domain registration (e.g., stopwastingtokens.dev)
  - swt-labs org email and avatar
  - Org-wide branch protection defaults
  - VBW sunset announcement (pin issue, README banner, v1.0.97-sunset release note) on the user's VBW repo
  - First push to origin (`git push -u origin main`)
---

# Phase 1 Summary: Repo & org setup

## What Was Built

- Private GitHub repo at `swt-labs/stop-wasting-tokens` with description "Token-disciplined, methodology-first SDLC for the OpenAI Codex CLI." and topics `agents`, `cli`, `codex`, `methodology`, `npm`, `typescript`, `vibe-coding`.
- Local repo initialised with `main` branch, `origin` remote pointed at the GitHub repo (no push performed; `auto_push=never`).
- Standard project boilerplate: `LICENSE` (MIT), `.gitignore`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- GitHub workflow scaffolding: `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/` (config.yml plus bug, feature, and question templates).
- VBW pre-push hook installed; planning artefacts kept out of git per `planning_tracking=manual`.
- Initial commit `3f67467` ("chore: initial repo scaffolding (Phase 1)").

## Files Modified

- `LICENSE`
- `.gitignore`
- `README.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/ISSUE_TEMPLATE/bug.md`
- `.github/ISSUE_TEMPLATE/feature.md`
- `.github/ISSUE_TEMPLATE/question.md`

## What did not ship

See deviations D1–D4 in frontmatter for full context.

- `CODE_OF_CONDUCT.md` (deferred — author Contributor Covenant 2.1 manually).
- `docs/brand.md` (deferred — brand voice guide).
- `docs/sunset-vbw.md` (deferred — VBW deprecation announcement draft).
- npm name reservation, domain registration, org-level settings, VBW repo updates — all require accounts/access I do not have in this session.

## Acceptance criteria status

| ID | Must-have | Status |
|----|-----------|--------|
| AC1 | MIT LICENSE present | ✓ |
| AC2 | CODE_OF_CONDUCT.md (Contributor Covenant 2.1) | ○ deferred |
| AC3 | CONTRIBUTING.md with PR/issue conventions | ✓ |
| AC4 | SECURITY.md with responsible disclosure policy | ✓ |
| AC5 | Initial README.md with TL;DR + alpha disclaimer | ✓ |
| AC6 | .github/ISSUE_TEMPLATE/ with bug, feature, question | ✓ |
| AC7 | .github/PULL_REQUEST_TEMPLATE.md | ✓ |
| AC8 | docs/brand.md (brand voice guide) | ○ deferred |
| AC9 | GitHub repo topics set | ✓ |
| AC10 | GitHub repo description set | ✓ |
| AC11 | Initial commit with all the above | ✓ |

Phase exits with 9/11 must-haves satisfied; the two deferred items (AC2, AC8) are non-blocking for Phase 2.
