# State

**Project:** SWT v3 — Pi-Native Coding Harness
**Milestone:** M1 Foundation

## Current Phase
Phase: 1 of 6 (M1 Foundation)
Plans: 0/3
Progress: 0%
Status: ready

## Phase Status
- **Phase 1 (M1 Foundation):** Planned
- **Phase 2 (M2 Single Agent Path):** Pending
- **Phase 3 (M3 Worktree Dispatcher):** Pending
- **Phase 4 (M4 Token Meter Cache Discipline):** Pending
- **Phase 5 (M5 Multi Provider):** Pending
- **Phase 6 (M6 Decommission Benchmark Ship):** Pending

## Key Decisions
| Decision | Date | Rationale |
|----------|------|-----------|
| _(No decisions yet)_ | | |

## Todos
None.

## Blockers
None.

## Activity Log
- 2026-05-11: Created M1 Foundation milestone (6 phases)
- 2026-05-11: Cloned SWT v2.3.5 source into .vbw-planning/research/swt-v2-source/ (shallow); fetched Pi SDK docs from pi.dev/docs/latest
- 2026-05-11: Wrote recon report .vbw-planning/research/recon.md (12 KB) covering v2 package inventory, Pi API verification, TDD.md corrections
- 2026-05-11: Drafted TDD2.md (238 KB / 4497 lines) — supersedes TDD.md; grounded in cloned source + verified Pi docs; flagged 11 TDD.md errors corrected, 12 ADR seeds, 24 risk-register rows, 7 GitHub Actions workflow specs
- 2026-05-11: TDD2.md accuracy review pass — found 2 blocking + 4 high + 10 medium issues; remediated all in-place (261 KB / 4914 lines). Highlights: corrected `ctx.appendEntry` → closure-captured `pi.appendEntry` (Pi API misuse); replaced stubs.ts blanket-delete with 21-row per-verb disposition table; corrected `.nvmrc` (20) and docs/ count (41); expanded M1 entry gate to cover `cli → codex-driver` edges (PR-01a/b); unified reasoning-tier mapping behind canonical §7.1.1 chain (SWT tier → Pi xhigh → provider string via thinkingLevelMap); added missing reproducible-build CI job + GPG-import step in release.yml; drafted concise ADR-003..013 skeletons (13 total)
- 2026-05-11: TDD2.md second-pass review — found 17 additional inconsistencies introduced or missed in the first pass; all remediated. Highlights: §11.5 PR-numbering conflict with §13.1.2 reconciled (canonical numbering: PR-01a/b entry-gate, PR-02 runtime, PR-03 orchestration, PR-04 shared, PR-05 driver-delete); fixed 4 stale "PR-01" / "PR-04 driver-deletion" references; corrected §3.2.4 directory-tree comment (22 → 21 + DELETED → DISMANTLED); fixed §3.2.5 `/api/worktree/*` → `/api/worktrees/*`; replaced wrong "Anthropic header-based caching" mitigation with body-side cache_control normalization in cassette recorder; added ADR Proposed→Accepted lifecycle note; added §13 meta-note bridging disposition table to per-milestone PR tables. Final size: 261 KB / ~4920 lines.
- 2026-05-11: Resynced VBW state files against TDD2 (the new authoritative source). PROJECT.md rewritten with grounded constraints (Pi peer-dep, layered arch, cache at provider shim, reproducible builds) and a 20-row Key Decisions table mapping to the 13 ADRs. REQUIREMENTS.md expanded from 23 → 27 entries: corrected REQ-18 (role-resolver + quirks.json, NOT provider shims at M1); added REQ-23 (Extension result-protocol replacing shouldStopAfterTurn/report_result), REQ-24 (M1 entry-gate edge breaks), REQ-25 (21-stub disposition), REQ-26 (reproducible builds), REQ-27 (v2.3.x LTS). ROADMAP.md Phase 1 success criteria corrected (no provider shims; entry-gate explicit), Phase 3 corrected (`swt_report_result` Extension tool replaces `shouldStopAfterTurn`/`report_result` claims), Phase 6 corrected (stubs.ts deleted per disposition, not blanket). All three files now carry an "Authoritative source: TDD2.md" pointer at the top.
