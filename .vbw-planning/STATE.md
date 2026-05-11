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
| Adopt `@earendil-works/pi-coding-agent` as v3 runtime substrate | 2026-05-11 | Vendor-neutral, parallel-capable, crash-safe; owns the runtime instead of subprocessing Codex. ADR-001. |
| Result protocol via Pi Extension API custom tool + closure-captured `pi.appendEntry` | 2026-05-11 | Pi has no `shouldStopAfterTurn` / `report_result` primitives (TDD.md hallucinated those); Extension API is the documented contract. ADR-002. |
| Provider quirks live in one `quirks.json` consumed by one extension (not per-provider TS shims) | 2026-05-11 | Pi already natively supports 25+ providers; per-provider files invite bit rot. ADR-003. |
| Cache_control at provider-shim layer, not Pi-session level | 2026-05-11 | Pi has no native `cache_control` API; caching is provider-specific (Anthropic body-side, OpenAI auto-cache). ADR-004. |
| Delete `codex-driver`, `claude-code-driver`, `ollama-driver` wholesale; no co-existence | 2026-05-11 | Co-existence multiplies surface area; migration handled by `swt migrate --to=v3`. ADR-005. |
| M1 entry gate = both `methodology → codex-driver` AND `cli → {codex,claude-code,ollama}-driver` edges broken before any Pi work | 2026-05-11 | Recon verified `vibe.ts` imports all 3 driver spawners (not just codex). Constitutional debt must clear first. TDD2 §11.5 + §13.1.1. |
| `SwtSession` meter attached via constructor (`SwtSessionOptions.meter`), not via post-construction method | 2026-05-11 | Plans review found `attachMeter()` would create awkward lifecycle; construction-time attachment makes meter a stable session invariant. |
| Thinking-level resolution is per-ROLE, not per-tier (`resolveThinkingLevelForRole`) | 2026-05-11 | Plans review caught: two roles can share a tier but want different thinking levels (Architect vs Dev both `quality`/`balanced` per TDD2 §10.5). |
| Repository pivot: `main` = v3 design + plans; v2.3.5 preserved on `v2-archive` branch | 2026-05-11 | User decision (this session). v2 LTS continues via `release/v2.3-*` branches; dependabot retargeted via main's new `.github/dependabot.yml`. |
| Single-agent planning output (no Scout/Lead subagent pipeline used) | 2026-05-11 | Task tool unavailable in this Claude Code harness — TDD2 + plans authored as single-agent output. Documented as caveat in plan headers; functionally equivalent artifacts. |

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
- 2026-05-11: Wrote 3 M1 plans for Phase 1 (M1 Foundation). 01-RESEARCH.md (12 KB) — phase-wide research findings (F-01..F-08, 4 patterns, 5 risks, 4 recommendations). 01-01-PLAN.md (34 KB, 5 tasks) — entry-gate edge breaks + architectural scaffolding (PR-01a, PR-01b, PR-02, PR-03, PR-04). 01-02-PLAN.md (43 KB, 5 tasks) — driver cleanup + test infrastructure + first end-to-end (PR-05..PR-09). 01-03-PLAN.md (31 KB, 5 tasks) — docs reorganization + CI hardening + ADR drafts 006..013 (PR-10, PR-11). 15 tasks total covering all 12 M1 PRs (PR-01a, PR-01b, PR-02 through PR-11).
- 2026-05-11: M1 plans review pass — 17 issues remediated. Critical fixes: vibe.ts imports ALL 3 drivers (verified — TDD2/recon undercounted; PR-01b expanded); SwtSession.attachMeter() → SwtSessionOptions.meter (constructor injection); resolveThinkingLevelForTier → resolveThinkingLevelForRole per TDD2 §10.5; codex-reasoning-effort.ts explicitly DELETE (vendor leak in core/types/); Pi `dependencies` pinned-range instead of `"*"` (reproducibility per ADR-010); ADR-001..005 drafting moved into Plan 01-01 (their justifying PRs), not Plan 01-03 (ownership confusion fix); cassette renamed scout-noop → scout-read-readme (descriptive); PR-09 brittle `result.summary.toContain` removed (deterministic shape-only assertions); Anthropic header-based-caching mitigation replaced with cassette-recorder body-side normalization; CONTRIBUTING.md correct root path (was wrong docs/operations/contributing.md); cross-platform `.mjs` stub scripts (not `node -e` inline); 5 helper-function sketches added (makeMockSwtSession, makeAgentSpawnerFromDispatcher, enrichWithFileMetadata, getTaskIdFromCtx, MockSpawnerEnvironment); GitHub-issue creation via `gh issue create` (not manual web UI step).
- 2026-05-11: B-01 cascade fix — propagated "vibe.ts imports all 3 drivers, not 1" correction across TDD2 (§1.5 strategy summary; §3.3 dep-graph constitutional debt; §11.5 Edge B + PR table + PR sequence + dependency graph section, 5 sites; §13.1.1 entry gate; §13.1.2 PR-01b deliverables row) and recon.md (§1.3 architectural-debt findings; §3 corrections table; §5 outline).
- 2026-05-11: File-guard foundation fix — stripped 26 inline `# comment` suffixes from `files_modified` entries across all 3 plans. The VBW file-guard hook's awk parser doesn't strip inline comments, so the comment-suffix entries would have blocked executor edits at execution time. Now bare paths only; ready for executor consumption.
- 2026-05-11: Git initialized (`chore(init): bootstrap SWT v3 planning workspace`). 15 tracked files (TDD.md, TDD2.md, CLAUDE.md, .gitignore, .vbw-planning/, README/CHANGELOG); 9378 insertions. `.gitignore` excludes swt-v2-source/ clone (4.3 MB, has its own .git), VBW runtime state (.cache/, .metrics/, session/notification logs), per-phase compiled-context files.
- 2026-05-11: README.md and CHANGELOG.md authored — orient new visitors, document workspace structure, 0.2.0 entry capturing the pivot history.
- 2026-05-11: REPOSITORY PIVOT (swt-labs/stop-wasting-tokens). v2.3.5 (SHA 01fb59a) preserved as new `v2-archive` branch on remote. Force-pushed local main → remote main with `--force-with-lease` (lease verified against 01fb59a). New remote main HEAD = f1f6604 (v3 design + plans + dependabot.yml). All 30 release tags (v1.0.0..v2.3.5) intact; stop-wasting-tokens@2.3.5 npm package unaffected; 14 dependabot PRs auto-closed and their branches auto-deleted as cascading side-effect (repo's auto-delete-head-branches setting).
- 2026-05-11: v2 LTS retargeting on remote. (a) New `.github/dependabot.yml` on main with `target-branch: v2-archive` — dependabot will scan v2-archive Mondays and raise PRs against v2-archive. (b) v2-archive workflow triggers retargeted (chore(ci) commit 906f2cc): ci.yml/codeql.yml/vale.yml push+PR triggers now `['v2-archive', 'release/v2.3-*']`; release.yml push trigger now `['v2-archive']`; install-smoke.yml unchanged (branch-independent). (c) Repo description rewritten to reflect the v3 design / v2 LTS split. Topics: added pi, pi-sdk, redesign; removed codex.
