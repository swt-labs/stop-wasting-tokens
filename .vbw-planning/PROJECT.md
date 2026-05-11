# SWT v3 — Pi-Native Coding Harness

> **Authoritative source:** `TDD2.md` at the repo root. On any conflict between this file and TDD2.md, TDD2.md wins; this file gets corrected in the same PR.

Full rewrite of `stop-wasting-tokens` on top of the `@earendil-works/pi-coding-agent` SDK: a vendor-agnostic, worktree-isolated coding harness that ships measurably fewer tokens per acceptance criterion than naive Codex CLI / Claude Code, while preserving SWT's six-agent SDLC methodology, planning artefacts, and goal-backward QA.

**Core value:** Token-efficient methodology-driven coding harness, vendor-agnostic by construction.

## Requirements

### Validated
- _(populated as M1 lands; nothing validated yet)_

### Active
- All `REQ-01..REQ-26` in `REQUIREMENTS.md` are in scope for v3.0.

### Out of Scope
- Codex CLI / Claude Code as alternate "backends" (TDD2 §1.3) — they are deleted, not coexisting.
- Hosted/cloud dashboard (localhost only, same as v2.x).
- Multi-machine federation; team-coordination features beyond `.swt-planning/parallel/` (v4 work).
- Mobile / IDE-plugin UIs beyond the TUI + dashboard.
- Replacement of `.swt-planning/` filesystem schema (additive `schema_version` only).
- Anything in `a_non_production_files/` in the v2 repo.

## Constraints

- **Runtime substrate:** `@earendil-works/pi-coding-agent` (peer dep). No Codex subprocess. No fork.
- **Layered architecture:** L0 Pi SDK → L1 runtime adapter → L2 orchestration → L3 methodology → L4 dashboard → L5 public surface. Downward-only deps; ESLint-enforced (TDD2 §4.3).
- **Methodology vendor-agnostic:** `grep -r '@earendil-works\|anthropic\|openai\|codex' packages/core/` returns nothing. Principle 1.
- **Determinism in the test path:** cassette-replayed token counts byte-identical across runs. Principle 12.
- **Crash-safety non-negotiable:** every worktree / session / long-running process resumable after `kill -9`. Principle 9.
- **Provider quirks file (`runtime/providers/quirks.json`) is the only place provider names appear outside `runtime/providers/`.** Principle 3 + ADR-003.
- **Cache_control lives at the provider-shim layer, not Pi-level.** ADR-004.
- **Pi peer-dependency policy:** `@earendil-works/pi-coding-agent` declared as `peerDependencies` with `"*"` range per Pi docs (TDD2 §5.1).
- **Reproducible builds:** two runs of `pnpm install --frozen-lockfile && pnpm build` produce byte-identical `dist/`. CI-asserted (TDD2 §15.2 reproducible-build job). ADR-010.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pi SDK as runtime substrate | Vendor-agnostic, parallel-capable, crash-safe; v2's Codex-subprocess path is the architectural ceiling | ADR-001; M1 PR-02/03 |
| Result protocol via Extension custom tool (`swt_report_result`), not via the non-existent `shouldStopAfterTurn` / `report_result` Pi primitives | Pi docs don't show those names; Extension API gives a documented contract | ADR-002; M3 PR-26 |
| Per-provider quirks JSON, not per-provider TS shims | Pi already supports 25+ providers natively; per-provider files invite bit rot | ADR-003; M1 PR-08 |
| Cache_control at provider-shim layer | Pi has no native `cache_control` API; caching is provider-specific (Anthropic body-side, OpenAI auto-cache) | ADR-004; M4 PR-32 |
| Delete `codex-driver`, `claude-code-driver`, `ollama-driver` wholesale | Co-existence multiplies surface area; users on those routes migrate via `swt migrate --to=v3` | ADR-005; M1 PR-05 |
| M1 entry gate = both codex-driver edges broken | `methodology → codex-driver` AND `cli → codex-driver` both source-imports verified in v2.3.5 | TDD2 §11.5 + §13.1.1; PR-01a + PR-01b |
| Dismantle the 21 v2 stub verbs per per-verb disposition; do NOT blanket-delete | Many stubs name v3 features (`worktree`, `lease`, `plan`, etc.); the right move is to implement, fold, or drop each individually | TDD2 §3.2.4 disposition table |
| Cache-control breakpoint after artefact block, before task-specific content | Caches the role-stable prefix; meets Anthropic's ≥1024-token minimum | ADR-006; M4 PR-32 |
| Budget Gate: 70% → tier downgrade; 95% → milestone pause | Aggressive enough to matter, not so eager it interrupts healthy phases | ADR-007; M4 PR-35 |
| One git worktree per dispatched task | Per-task isolation enables parallelism, simplifies claims, simplifies crash recovery | ADR-008; M3 PR-22 |
| Windows worktree path discipline: POSIX paths internally, 200-char cap, forced LF | Avoids documented git-worktree Windows quirks; chaos tests cross-OS | ADR-009; M3 PR-30 |
| Deterministic builds (byte-identical `dist/` from same commit) | Supply-chain hygiene; npm provenance trustworthiness | ADR-010; M1 PR-11 |
| Provider matrix tests use cassettes only; no real API keys in CI | Determinism + zero recurring cost + no secret-management burden | ADR-011; M1 PR-06 |
| 6-month LTS for v2.3.x after v3.0 ships | Bridges migration; explicit EOL prevents v2-forever drift | ADR-012; M6 PR-53 |
| No hosted documentation site at v3.0 | In-tree `docs/` is sufficient at current user scale; auto-generate from `docs/` if/when >1000 users | ADR-013 (deferred); M6 PR-47 |
| SWT tier `reasoning` → Pi `thinkingLevel: 'xhigh'` → provider string via `quirks.json#thinkingLevelMap` | One canonical chain (TDD2 §7.1.1); methodology never speaks provider strings | M1 PR-08 |
| `EXIT.NOT_IMPLEMENTED` constant retained in `exit-codes.ts` but never returned by a v3 verb | Preserves the numeric API for external grep-tooling that may depend on it | TDD2 §3.2.4 |
| Single CLI binary preserved at `./dist/cli.mjs` | Avoids churn for `npx swt` muscle memory | TDD2 §6.5 |
| Dashboard remains localhost-only in v3 | v4 work; cloud features are out of scope for v3 ship | TDD2 §1.3 |
