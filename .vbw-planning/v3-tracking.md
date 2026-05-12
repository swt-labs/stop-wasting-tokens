# v3 Cross-milestone tracking

Live ledger surfacing PRs merged, ADRs decided, TPAC measurements, cache-hit ratios, and exit-gate signoffs across M1..M6. Updated in the same PR that lands each tracked item — **not retroactively**. Read by the dashboard's Milestones panel (M2+).

> **Authoritative source:** [`TDD2.md`](../TDD2.md) for design; this file for execution state.
> **Per-milestone plans:** [`.vbw-planning/phases/`](./phases/).
> **ADR index:** [`docs/decisions/README.md`](../docs/decisions/README.md).

> **Branch strategy (2026-05-12 pivot):** v3 development originally happened on a `v3-foundation` integration branch with the plan to merge into `main` at the M6 release gate (per TDD2 §13). That branch was retired 2026-05-12 — **v3 is now developed directly on `main`**. The "Merged" column in the tables below shows commits as they originally landed on `v3-foundation`; those commits are now on `main`'s history after the 2026-05-12 hard-reset + force-push. v2 stable patches stay on `v2-archive`; v3.0.0 still cuts from `main` at the M6 release gate.

## M1 — Foundation

**Status:** in progress (Plans 01-01 + 01-02 complete; Plan 01-03 in progress).
**Goal:** Pi integration scaffolded; vendor abstraction proven; methodology layer extracted intact; constitutional debt in v2.3.5 source discharged.

| PR                    | Subject                                                                        | Merged                   | ADRs touched              | Notes                                                                                          |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------- |
| PR-01a                | methodology → codex-driver edge break                                          | 2026-05-11 (`08579dc`)   | —                         | Entry gate; `writeAgentsMdBlock` moved to artifacts package                                    |
| PR-01b                | cli → {3-drivers} edge break + SpawnerEnvironment                              | 2026-05-11 (`e0bc8ce`)   | —                         | Entry gate; CommandIO carries spawnerEnv                                                       |
| PR-02                 | packages/runtime/ skeleton + Pi peerDep                                        | 2026-05-11 (`3050410`)   | 001 (A), 002 (P), 004 (A) | First Layer-1 package                                                                          |
| PR-03                 | packages/orchestration/ skeleton + PiSpawnerEnvironment                        | 2026-05-11 (`74c757c`)   | —                         | Probe through runtime, not direct Pi                                                           |
| PR-04                 | packages/shared/ — types + schemas                                             | 2026-05-11 (`0a623d2`)   | —                         | Leaf package; dashboard-core deleted                                                           |
| PR-05                 | Delete 3 drivers + .codex-plugin/                                              | 2026-05-11 (`c390d85`)   | 005 (A)                   | npm registry 404 verified pre-delete                                                           |
| PR-06                 | Cassette infrastructure (recorder + replayer)                                  | 2026-05-11 (`795a6cd`)   | 011 (P)                   | Cassette recording deferred to user session                                                    |
| PR-08                 | Provider quirks + role-resolver + ADR-003 Accepted                             | 2026-05-11 (`74b4086`)   | 003 (A)                   | Reordered ahead of PR-07 (no cassette dep)                                                     |
| PR-07                 | Token meter + per-provider extractors + telemetry registry                     | 2026-05-11 (`7fcb20f`)   | —                         | M1 event registry (4 events)                                                                   |
| PR-09                 | swt_report_result Extension + result harvest + ADR-002 Accepted                | 2026-05-11 (`df9cc78`)   | 002 (A)                   | Closure-captured `pi.appendEntry`; 3-layer invariant lock                                      |
| Plan 01-02 congruency | post-Plan-01-02 summary + state + roadmap + plan-01-03 baseline + changelog    | 2026-05-11 (`6dee380`)   | —                         | Docs-only                                                                                      |
| PR-10 Task 3          | Draft ADRs 006..013 + ADR index README                                         | 2026-05-11 (`a83b7e7`)   | 006..013                  | 6 Accepted, 6 Proposed, 1 Deferred                                                             |
| PR-10 Task 2          | v2→v3 migration guide                                                          | 2026-05-11 (`0ce520b`)   | —                         | 315 lines, 8 sections                                                                          |
| PR-10 Task 1          | docs/ topical reorg + ESLint §4.3 boundary rule + driver-mention purge         | 2026-05-11 (`c88fc79`)   | —                         | 16 v3 stub doc files; `eslint-boundary.test.ts` regression guard                               |
| PR-11 Task B          | reproducible-build CI job + 3 workflow stubs + v3-tracking.md + TDD2 §19 risks | 2026-05-12 (`6cebe5c`)   | 010 (A)                   | This file lands here + populated M1 PR rows                                                    |
| PR-11 Task A          | 33-test debt remediation + remove continue-on-error from Test step             | 2026-05-12 (`bb04054`)   | —                         | **M1 EXIT GATE.** 49 actual failures; umbrella issue #32; HIGH-priority security carry-forward |
| Plan 01-03 congruency | post-Plan-01-03 SUMMARY + STATE + ROADMAP + v3-tracking finalize + CHANGELOG   | 2026-05-12 (this commit) | —                         | Closes M1; no code change                                                                      |

**Test posture at PR-11 Task B close** (this PR):

- runtime: 88 passing + 1 skipped (cassette-gated)
- orchestration: 19 passing + 1 skipped (cassette-gated)
- core: structural ESLint boundary test passes; 5 pre-existing v2.3.5 `launch-checklist.test.ts` failures remain for PR-11 Task A
- dashboard: 1 pre-existing `LogPanel.tsx(78,9)` TS2322 carry-forward for PR-11 Task A
- All workspace typecheck green except dashboard carry-forward

**ADRs Accepted at M1 close (target):** 6 — 001, 002, 003, 004, 005, 010. Matches TDD2 §22.14 verbatim.

## M2 — Single-agent path

**Status:** Pending (M1 must close first).
**Goal:** End-to-end methodology flow runs on Pi for one provider; no worktrees, no parallel; TPAC baseline established.

Sections + tables added when M2 enters.

## M3 — Worktree dispatcher

**Status:** Pending.
**Goal:** Subagent + worktree system online; parallel Dev tasks within a phase; crash recovery verified across Linux/macOS/Windows.

## M4 — Token meter + cache discipline

**Status:** Pending.
**Goal:** TPAC −40% vs M2 baseline; cache hit ≥70%; Budget Gate live.

## M5 — Multi-provider

**Status:** Pending.
**Goal:** Cross-vendor parallelism; provider fallbacks; router strategies online.

## M6 — Decommission + benchmark + ship

**Status:** Pending.
**Goal:** v3.0 ships with public benchmark; all v2.x Codex-era code paths removed; migration path verified end-to-end; v2.3.x LTS branch cut.

---

## Metrics (filled in over time)

| Milestone       | TPAC       | Cache hit ratio    | Cost / criterion | Notes                                                 |
| --------------- | ---------- | ------------------ | ---------------- | ----------------------------------------------------- |
| M2 baseline     | TBD        | n/a (M4 territory) | TBD              | Established at M2 close; reference for M4 −40% target |
| M4 target       | −40% vs M2 | ≥70%               | −50% vs M2       | Hard merge gate per TDD2 §13.4.2                      |
| M5 cross-vendor | TBD        | TBD                | TBD              | Provider matrix measurements at M5 close              |
| M6 launch       | TBD        | TBD                | TBD              | Public benchmark numbers in the v3.0.0 launch post    |

## Exit-gate signoffs

| Milestone | Exit-gate criteria                                 | Signoff date   | Reference                                                                                                                                                               |
| --------- | -------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1        | All criteria in TDD2 §13.1.3 pass                  | **2026-05-12** | PR-11 Task A merge commit `bb04054`. CI matrix all 4 gates green locally; cross-OS run pending post-push. 6 ADRs Accepted, 6 Proposed, 1 Deferred matching TDD2 §22.14. |
| M2        | TPAC baseline measured + recorded                  | TBD            | M2 PR-21 merge                                                                                                                                                          |
| M3        | Chaos suite green on all 3 OSes                    | TBD            | M3 PR-29 merge                                                                                                                                                          |
| M4        | TPAC −40% + cache ≥70% demonstrated on ref-fastapi | TBD            | M4 PR-36 merge                                                                                                                                                          |
| M5        | Provider matrix passes + failover simulated        | TBD            | M5 PR-44 merge                                                                                                                                                          |
| M6        | v3.0.0 published with provenance + signed tag      | TBD            | release.yml workflow                                                                                                                                                    |
