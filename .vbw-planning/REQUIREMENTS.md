# Requirements

Defined: 2026-05-11 · Resynced against TDD2: 2026-05-11

> **Authoritative source:** `TDD2.md` at the repo root. On any conflict between this file and TDD2.md, TDD2.md wins; this file gets corrected in the same PR.

## Requirements

### REQ-01: Pi SDK is the only runtime primitive

**Must-have.** v3 runs on `@earendil-works/pi-coding-agent` and `pi-ai`. No Codex / Claude-Code / Ollama subprocess paths. No LLM-vendor-specific code paths outside `packages/runtime/`. (TDD2 §1.3, §5.1)

### REQ-02: Vendor-agnostic provider abstraction with capability tiers

**Must-have.** Methodology names tiers (`cheap-fast` / `balanced` / `quality` / `reasoning`), not specific models. Tier → provider → model resolution happens in `runtime/providers/role-resolver.ts` consuming Pi's native provider catalogue. (TDD2 §7.1, §7.1.1)

### REQ-03: Worktree-isolated subagent dispatch with declared file claims

**Must-have.** Each dispatched task gets a git worktree at `.swt-planning/parallel/wt-<task-id>/`. Tasks declare a `claims[]` array; the claim registry serializes conflicting claims. (TDD2 §9.1, §9.2)

### REQ-04: DAG-based parallel execution of phase tasks via `depends_on`

**Must-have.** The DAG resolver computes execution batches; within a batch the dispatcher spawns up to `config.max_parallel_tasks` worktrees in parallel. (TDD2 §9.3)

### REQ-05: Token-meter instrumentation surfaced to the dashboard

**Must-have.** Per-task / per-phase / per-milestone / per-provider aggregation. Dashboard cache-hit panel, budget gauge, per-provider cost panel, TPAC panel. (TDD2 §8.1, §12.3)

### REQ-06: Methodology layer preserved verbatim

**Must-have.** `.swt-planning/` artefacts, phase lifecycle, six roles, must-haves, goal-backward QA tiers — all preserved. Schema gains a top-level `schema_version: 1` field (additive only). (TDD2 §11, §11.3)

### REQ-07: Hono + Solid + SSE dashboard migrated to consume Pi events

**Must-have.** Dashboard preserves layout-storage v2 (5-column main + tools array), cmd-K palette, permission gate (extended with `UiPermissionGate` for UI mutations). SSE source switches from codex hooks to `runtime/events.ts` normalized stream. (TDD2 §12)

### REQ-08: TPAC −40% vs Codex CLI baseline

**Must-have, P0 for v3.0 ship.** Measured on the `ref-fastapi` reference scenario (TDD2 Appendix D). M2 establishes the baseline; M4 must demonstrate the −40%. (TDD2 §1.2, §8.1, §13.4.2)

### REQ-09: Cache hit ratio ≥70% on Anthropic paths

**Must-have, P0 for v3.0 ship.** Achieved via deterministic prompt prefix + stable artefact-block ordering + `cache_control: {type: 'ephemeral'}` breakpoint after the artefact block, before task-specific content. Min 1024 tokens per breakpoint (Anthropic's documented minimum). (TDD2 §8.2.1, §8.3, ADR-006)

### REQ-10: Cost per acceptance criterion −50% vs baseline

**Must-have, P0 for v3.0 ship.** Tracked by `runtime/meter/cost-aggregator.ts` using `ProviderModelConfig.cost`. Per-provider attribution surfaced in the dashboard's Per-Provider Cost panel. (TDD2 §1.2, §7.6)

### REQ-11: Crash-safety — resumable from disk after `kill -9`

**Must-have, P0.** Lock files at `.swt-planning/locks/`, PID liveness checks, structured journal at `.swt-planning/journal/<date>.jsonl`. M3 chaos test gates this on Linux + macOS + Windows. (TDD2 §4.4, §9.5, §14.10)

### REQ-12: Static-check verification ladder before any LLM QA

**Must-have.** Fixed order: typecheck → lint → format → unit → integration → regression → chaos → e2e → LLM QA. Non-configurable. (TDD2 Principle 6, §14.11)

### REQ-13: Fresh sessions per task by default

**Must-have.** New Pi session per Dev / Scout / Architect dispatch via `SessionManager.inMemory()` or `--no-session`. Session reuse requires explicit `reuseSession: true` + journal justification. (TDD2 Principle 7, §10.5)

### REQ-14: Strict layered architecture with downward-only deps

**Must-have.** L0 Pi SDK → L1 runtime → L2 orchestration → L3 methodology → L4 dashboard → L5 public surface. Enforced by ESLint `import/no-restricted-paths`. One controlled lateral channel: Pi Extension API in `runtime/extensions/`. (TDD2 §4.1, §4.3)

### REQ-15: Provider router strategies + fallback chains

**Must-have.** Strategies: `pinned`, `round-robin`, `tier-routed`, `cost-optimized`, `quality-pinned-cost-failover`. Fallback chain semantics with retry budget shared with Pi's `auto_retry_*` events. (TDD2 §7.3, §7.4)

### REQ-16: Budget Gate

**Must-have.** Configurable per-milestone / per-phase / per-task ceilings. Pressure thresholds: 70% → tier downgrade; 95% → milestone pause. State journaled. (TDD2 §8.4, ADR-007)

### REQ-17: Dashboard remains the primary UX

**Must-have.** CLI exists for headless / CI / power-user only. New features land in dashboard first; CLI parity follows. (TDD2 Principle 8)

### REQ-18: M1 ships a role-resolver + provider quirks file (NOT provider shims)

**Must-have.** Pi already supports 25+ providers natively. v3 does not write per-provider TypeScript shims at M1. It ships `runtime/providers/role-resolver.ts` consuming Pi's catalogue plus `runtime/providers/quirks.json` for overrides (Anthropic `thinkingLevelMap`, OpenAI `compat.maxTokensField`, etc.). (TDD2 §7.5, §13.1, ADR-003) — _supersedes the older TDD.md claim of "Anthropic + OpenAI shims at M1."_

### REQ-19: Migration script `swt migrate --to=v3`

**Must-have.** Upgrades v2.x `.swt-planning/` to v3 schema. Idempotent. Tested against three fixture cases. Writes `.swt-planning.v2-backup/` before migration. (TDD2 §11.3, §13.6, §18.3)

### REQ-20: Public reproducibility benchmark at M6

**Must-have, P0 for v3.0 ship.** Reference repo (`ref-fastapi` per Appendix D) + scripts demonstrating TPAC −40% / cache hit ≥70% / cost −50% vs naive Codex CLI on equivalent work. (TDD2 §1.3, §13.6, Appendix D)

### REQ-21: Pnpm workspaces, ESM-only, TypeScript strict, Vitest + tsup + ESLint + Prettier + Changesets

**Must-have.** Toolchain unchanged from v2.3.5. Node engine `>=20.18`. (TDD2 §6.4)

### REQ-22: Cassette-based deterministic LLM-replay test infrastructure

**Must-have.** `packages/test-utils/cassettes/` holds JSONL recordings. Recorder normalizes `cache_control` markers before body-hash. Replayer asserts byte-identical reproduction; mismatches fail tests. (TDD2 §14.7, ADR-011)

### REQ-23: Result protocol via Pi Extension custom tool (`swt_report_result`)

**Must-have.** Implemented as a custom tool registered via `pi.registerTool` in `runtime/extensions/result-protocol.ts`. Tool's `execute` writes a `custom` session entry via closure-captured `pi.appendEntry` (NOT `ctx.appendEntry` — see §5.4 boundary note). Returns `{terminate: true}`. Defensive `agent_end` hook writes a placeholder if the tool isn't called. (TDD2 §9.4, ADR-002) — _replaces the TDD.md claim of `shouldStopAfterTurn` / `report_result` as built-in Pi primitives._

### REQ-24: M1 entry-gate edge breaks (architectural-debt discharge)

**Must-have, prerequisite for M1.** Two v2.3.5 source edges violate the constitution and must be broken before any Pi integration:

- **PR-01a:** break `methodology → codex-driver` (`bootstrap.ts` import of `writeAgentsMdBlock`).
- **PR-01b:** break `cli → codex-driver` (`vibe.ts` import of `CodexAgentSpawner`; `doctor.ts` imports of `detectCodexVersion` + `CodexVersion`).
  Post-gate grep invariant: `grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" packages/ --exclude-dir={codex,claude-code,ollama}-driver` returns nothing. (TDD2 §11.5, §13.1.1)

### REQ-25: Dismantle the 21 `EXIT.NOT_IMPLEMENTED` stub verbs per the §3.2.4 disposition

**Must-have, spanning M2..M6.** 15 stubs become real verbs, 4 fold into `vibe`, 2 drop. Per-verb milestone assignment in TDD2 §3.2.4 table. The `commands/stubs.ts` file is deleted in M6 PR-46. (TDD2 §3.2.4, §13.6)

### REQ-26: Reproducible builds (byte-identical `dist/` from same commit)

**Must-have.** CI's `reproducible-build` job builds twice and diffs; any nondeterminism fails the merge. Supports npm provenance trust. (TDD2 §17.4, §15.2, ADR-010)

### REQ-27: 6-month LTS for v2.3.x after v3.0 ships

**Must-have, post-ship.** Security: 7-day backport SLA. Critical bugs: 14-day. Regressions: 30-day. After 6 months: `v2-archive` tag + README pointer. (TDD2 §17.6, ADR-012)

## Out of Scope

Codex / Claude-Code / Ollama as coexisting backends · Hosted/cloud dashboard · Multi-machine federation · Mobile / IDE-plugin UIs · Replacement of `.swt-planning/` filesystem schema · Public hosted documentation site at v3.0 launch (deferred per ADR-013). Full out-of-scope rationale in TDD2 §1.3.
