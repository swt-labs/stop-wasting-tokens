# Changelog

All notable changes to this **planning workspace** are tracked here. This is *not* the changelog for the SWT v3 binary itself — that lives in `swt-labs/stop-wasting-tokens/CHANGELOG.md` once v3 code starts shipping.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

_(Nothing yet — the repo is ready for M1 PR-01a execution from a `v3-foundation` branch cut from `v2-archive`.)_

## [0.2.0] — 2026-05-11 (repository pivot)

### Changed

**`main` is now v3.** The `swt-labs/stop-wasting-tokens` repository has been pivoted: `main` now reflects the v3 redesign in progress (this workspace). The v2.3.5 codebase is preserved on the **`v2-archive`** branch and at all release tags `v1.0.0` through `v2.3.5`.

This is a repository-organization change, not a code/binary change:
- `stop-wasting-tokens@2.3.5` on npm is unaffected (its source is immutable in npm's registry).
- All v2 release tags remain intact and resolvable.
- The full v2 codebase is one click away on the `v2-archive` branch.
- All v2 GitHub issues and dependabot branches still exist; their `main`-referencing context is now stale-but-harmless (they target a branch that has moved on).

Open PRs (mostly dependabot dep bumps) targeting `main` will need to be re-targeted at `v2-archive` if their changes still apply; otherwise they can be closed as historical.

### Rationale

v3.0 has not shipped yet, but the v3 design (TDD2.md) is final and the M1 foundation plans are written. Making `main` the v3 default surfaces the design as the canonical entry point for new contributors, the executor (human or AI), and visitors browsing the repo. v2 stays first-class via `v2-archive` and tags — fully preserved for LTS patches per TDD2 §17.6.

## [0.1.0] — 2026-05-11

Initial commit of the SWT v3 planning workspace. Authored before any code work begins in `swt-labs/stop-wasting-tokens`.

### Added

- **`TDD2.md`** (≈266 KB) — authoritative v3 technical design, 2 review passes applied. Replaces `TDD.md` after recon-grounded corrections.
- **`TDD.md`** — original v3 design preserved as a historical record.
- **`.vbw-planning/research/recon.md`** — verified fact-base from `swt-labs/stop-wasting-tokens` v2.3.5 source + Pi SDK docs (`pi.dev/docs/latest` fetched 2026-05-11).
- **3 M1 Foundation plans** (107 KB total) covering PR-01a..PR-11:
  - `01-RESEARCH.md` — phase-wide research (3-driver-edge findings, AgentSpawner reuse, Pi peerDep policy).
  - `01-01-PLAN.md` — entry-gate edge breaks + architectural scaffolding (PR-01a, PR-01b, PR-02, PR-03, PR-04).
  - `01-02-PLAN.md` — driver cleanup + test infrastructure + first end-to-end (PR-05..PR-09).
  - `01-03-PLAN.md` — documentation + CI hardening + ADRs 006..013 + index (PR-10, PR-11).
- **VBW state files** synced to TDD2: `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`. All carry an "Authoritative source: TDD2.md" pointer.
- **13 ADR skeletons** documented in TDD2 §22 (5 Accepted at M1 entry/exit, 8 Proposed for later milestones).
- **`.gitignore`** excluding the read-only `swt-v2-source/` clone (4.3 MB), VBW runtime state (`.cache/`, `.metrics/`, session/notification logs), and per-phase compiled-context files.

### Reviewed & corrected

This section captures the substantive review work that improved the artifacts. Every issue had an explicit fix; nothing was deferred.

- **TDD2.md — 1st pass:** 11 BLOCKING/HIGH/MEDIUM issues remediated. Highlights:
  - Pi package namespace: `@mariozechner/*` → `@earendil-works/*` (verified against Pi docs).
  - `shouldStopAfterTurn` / `report_result` → replaced with documented Pi primitives (Extension `agent_end` hook + `{terminate: true}` tool return + closure-captured `pi.appendEntry`).
  - `cache_control` recast as provider-shim concern (not Pi-level).
  - Methodology → codex-driver edge break promoted to M1 *entry* gate.
  - M1 deliverables flipped: role-resolver + `quirks.json`, not per-provider TS shims.
- **TDD2.md — 2nd pass:** 17 additional inconsistencies remediated. Highlights:
  - §11.5 PR-numbering reconciled with §13.1.2 canonical (PR-01a/b entry-gate, PR-02 runtime, PR-03 orchestration, PR-04 shared, PR-05 driver-delete).
  - 4 stale `PR-01` / `PR-04 driver-deletion` references corrected.
  - §3.2.4 directory-tree comment corrected (22 → 21 stubs; DELETED → DISMANTLED).
  - `/api/worktree/*` → `/api/worktrees/*`.
  - Anthropic "header-based caching" mitigation replaced with body-side `cache_control` normalization in the cassette recorder.
  - ADR Proposed → Accepted lifecycle note added.
- **M1 plans review:** 17 issues remediated. Highlights:
  - `vibe.ts` imports from **all three drivers** (verified), not just codex — PR-01b expanded.
  - `SwtSession.attachMeter()` → meter via `SwtSessionOptions` (constructor-injected).
  - `resolveThinkingLevelForTier(tier)` → `resolveThinkingLevelForRole(role)` per TDD2 §10.5.
  - `core/src/types/codex-reasoning-effort.ts` explicitly deleted as a vendor leak.
  - PR-09 brittle `result.summary.toContain(...)` assertion → deterministic shape-only assertions.
  - `scout-noop.jsonl` → `scout-read-readme.jsonl` (descriptive cassette name).
  - GitHub-issue creation in PR-11 made explicit via `gh issue create` with auth prerequisite.
  - Cross-platform: `node -e` inline → `scripts/stub-test-*.mjs` per stub.
- **B-01 cascade:** 3-driver `vibe.ts` import truth propagated through TDD2 §1.5, §3.3, §11.5 (3 sites), §13.1.1, §13.1.2, and `recon.md` §1.3 + §3 corrections table.
- **File-guard foundation:** 26 commented `files_modified` entries across the 3 plans → bare-path entries. The VBW file-guard hook's awk parser doesn't strip inline `# comment` suffixes; bare paths are required for plan execution.

### Notes

- The cloned v2.3.5 source at `.vbw-planning/research/swt-v2-source/` is gitignored. It's read-only reference material with its own `.git` history. Pull a fresh clone if you need it: `gh repo clone swt-labs/stop-wasting-tokens .vbw-planning/research/swt-v2-source -- --depth=1`.
- **No SWT v3 code exists yet.** This workspace is design + plans; the executor builds the code in `swt-labs/stop-wasting-tokens` against the v3-foundation branch.

[Unreleased]: https://github.com/swt-labs/stop-wasting-tokens-v3-planning/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/swt-labs/stop-wasting-tokens-v3-planning/releases/tag/v0.1.0
