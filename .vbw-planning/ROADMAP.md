# SWT v3 Roadmap

**Goal:** Ship SWT v3 — Pi-Native Coding Harness — against the acceptance criteria in TDD2 §1.2 (TPAC −40%, cache hit ≥70%, cost −50%, crash recovery 100%, provider failover < 30s MTTR).

> **Authoritative source:** `TDD2.md` at the repo root. On any conflict between this file and TDD2.md, TDD2.md wins; this file gets corrected in the same PR.

**Scope:** 6 phases (M1–M6), ~13 weeks of focused work, plan for 16 with normal slippage.

## Progress

| Phase | Status  | Plans written / executed | Tasks | Commits |
|-------|---------|-------------------------|-------|---------|
| 1 (M1 Foundation) | **In progress** (Plan 01-01 complete) | 3 / 1 | 15 / 5 | 5 |
| 2 (M2 Single-agent) | Pending | 0 / 0 | 0 / 0 | 0 |
| 3 (M3 Worktree dispatcher) | Pending | 0 / 0 | 0 / 0 | 0 |
| 4 (M4 Token meter & cache discipline) | Pending | 0 / 0 | 0 / 0 | 0 |
| 5 (M5 Multi-provider) | Pending | 0 / 0 | 0 / 0 | 0 |
| 6 (M6 Decommission, benchmark, ship) | Pending | 0 / 0 | 0 / 0 | 0 |

**Phase 1 plan breakdown:**
- `01-01-PLAN.md` (wave 1): 5 tasks — PR-01a, PR-01b, PR-02, PR-03, PR-04 — entry-gate edge breaks + architectural scaffolding. **✓ COMPLETE** as of 2026-05-11 (commits `08579dc`, `e0bc8ce`, `3050410`, `74c757c`, `0a623d2`; SUMMARY at `phases/01-m1-foundation/01-01-SUMMARY.md` documents 8 deviations + 17/19 pass on ac_results).
- `01-02-PLAN.md` (wave 2): 5 tasks — PR-05, PR-06, PR-07, PR-08, PR-09 — driver cleanup + test infrastructure + first e2e. **⏳ Next.** Cassette recording (PR-06) requires a one-time developer-local run against a real provider API (Anthropic or OpenRouter fallback) — see plan body.
- `01-03-PLAN.md` (wave 3): 5 tasks — PR-10 (Tasks 1–3), PR-11 (Tasks 4–5) — docs reorg + CI hardening + ADRs 006..013 + ESLint enforcement + `.vbw-planning/v3-tracking.md`. **⏳ After 01-02.** Note: the v3.0.0-alpha.1 CHANGELOG section + the v3-redesign README banner already pre-shipped in commit `c5b3b9a` (within Plan 01-01's docs commit batch); PR-10 Task 1's remaining scope is the full `docs/` topical reorganization per TDD2 §18.1 + the driver-mention purge from existing README body.

---

## Phase List

- [ ] [Phase 1: M1 Foundation](#phase-1-m1-foundation)
- [ ] [Phase 2: M2 Single-agent path](#phase-2-m2-single-agent-path)
- [ ] [Phase 3: M3 Worktree dispatcher](#phase-3-m3-worktree-dispatcher)
- [ ] [Phase 4: M4 Token meter & cache discipline](#phase-4-m4-token-meter-cache-discipline)
- [ ] [Phase 5: M5 Multi-provider](#phase-5-m5-multi-provider)
- [ ] [Phase 6: M6 Decommission, benchmark, ship](#phase-6-m6-decommission-benchmark-ship)

---

## Phase 1: M1 Foundation

**Goal:** Pi integration scaffolded; vendor abstraction proven; methodology layer extracted intact; constitutional debt in v2.3.5 source discharged.

**Target:** 2 weeks. Detailed PR table in TDD2 §13.1.2.

**Requirements:** REQ-01, REQ-02, REQ-06, REQ-11, REQ-14, REQ-18, REQ-21, REQ-22, REQ-23, REQ-24, REQ-26

**Entry gate (must hold BEFORE phase 1 starts):**
- PR-01a merged: `methodology → codex-driver` edge broken (`bootstrap.ts` rewired through `core/abstractions/AgentSpawner`).
- PR-01b merged: `cli → codex-driver` edges broken (`vibe.ts`, `doctor.ts` rewired through `core/abstractions/SpawnerEnvironment`).
- Grep invariant: `grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" packages/ --exclude-dir={codex,claude-code,ollama}-driver` returns nothing.

**Success Criteria (exit gate):**
- `packages/core/` extracted with all methodology logic; no `@earendil-works/*`, anthropic, openai, or codex strings.
- `packages/runtime/` exposes the SWT-local `createSession()`, tool factories, event normalization, token meter.
- `packages/orchestration/` has role-resolver + minimal single-task dispatcher (no worktrees yet).
- `runtime/providers/quirks.json` + role-resolver populated; tier → model maps live. **(Not provider shims — per REQ-18 / ADR-003.)**
- `packages/test-utils/` cassette infrastructure online; one Scout cassette as proof.
- Unit tests pass for `core/`, `runtime/`, `orchestration/`, `shared/` in isolation with mocked Pi.
- Integration test dispatches a no-op Scout task against a cassette and gets back a parsed `TaskResult`.
- `grep -r "codex exec\|@swt-labs/{codex,claude-code,ollama}-driver" packages/` returns nothing.
- Token meter records correct `input` / `output` / `cacheRead` / `cacheWrite` numbers against the cassette (delta = 0 tokens).
- `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build` all green on the M1 branch.
- CI matrix green on Linux / macOS / Windows × Node 20 / 22.
- ESLint `import/no-restricted-paths` rule enforced and passing.
- ADRs Accepted: ADR-001..ADR-005. Proposed: ADR-010, ADR-011 (Accepted later in M1).
- CI `Test` step becomes required (`continue-on-error: false`); 33 v2.x test failures remediated.

**Dependencies:** None (entry gate is the prerequisite).

---

## Phase 2: M2 Single-agent path

**Goal:** End-to-end methodology flow runs on Pi for one provider; no worktrees, no parallel. The **fixed TPAC baseline** is established here for M4's −40% target.

**Target:** 2 weeks. Detailed PR table in TDD2 §13.2.1.

**Requirements:** REQ-06, REQ-07, REQ-12, REQ-13, REQ-25 (ex-stub verb implementations begin)

**Success Criteria:**
- Lead / Dev runs through dispatcher in sequence (one Dev task at a time).
- QA runs the static-check ladder; escalates to LLM only on failures.
- Artefact pipeline writes / reads `.swt-planning/` identically to v2.x.
- Dashboard existing panels work against the new SSE event stream (visual regression test green).
- `UiPermissionGate` lands; routes wired through the composite gate.
- `swt rpc` verb delegates to Pi `runRpcMode` without protocol modification.
- `swt bench` verb prototype runs the `ref-fastapi` scenario and reports TPAC.
- Reference `ref-fastapi` milestone runs end-to-end on Anthropic; artefacts byte-identical (modulo timestamps) to recorded v2.x golden run.
- Regression cassette-replay suite passes.
- **TPAC measured and recorded as the fixed baseline** for M4's −40% target.
- Ex-stub verbs implemented per §3.2.4 disposition for M2: `plan`, `qa`, `map`, `research`, `phase`, `todo`, `assumptions` (plus `execute` / `fix` / `discuss` / `resume` folded into `vibe`).

**Dependencies:** Phase 1.

---

## Phase 3: M3 Worktree dispatcher

**Goal:** Subagent + worktree system online; parallel Dev tasks within a phase; crash recovery verified across Linux / macOS / Windows.

**Target:** 3 weeks. Detailed PR table in TDD2 §13.3.1.

**Requirements:** REQ-03, REQ-04, REQ-11, REQ-25 (ex-stub verb implementations continue)

**Success Criteria:**
- `worktree-manager.ts`, `claim-registry.ts`, `dag-resolver.ts`, `lock-files.ts` all implemented and tested.
- **`swt_report_result` Extension custom tool wired** (registered via `pi.registerTool` with closure-captured `pi.appendEntry`). Defensive `agent_end` hook writes a placeholder if the tool isn't called. — *per ADR-002; replaces the older TDD.md `shouldStopAfterTurn` + `report_result` claims.*
- Worktrees panel live in dashboard.
- Crash test (M3 acceptance criterion): `SIGKILL` the orchestrator mid-phase; restart; phase completes correctly. Runs on Linux + macOS + Windows.
- 3-task phase with declared `depends_on` runs as `[T01, T02 parallel] → [T03 after both]`, each in its own worktree.
- Edit attempted outside a task's claim is rejected, logged, and retried with corrective prompt.
- Wall-clock for the 3-task phase ≥ 30% faster than sequential.
- Windows worktree path discipline holds (POSIX paths internally, 200-char cap, forced LF).
- Ex-stub verbs implemented per §3.2.4 disposition for M3: `debug`, `worktree`, `lease` (plus the new `swt cleanup` verb for retention sweep).

**Dependencies:** Phase 2.

---

## Phase 4: M4 Token meter & cache discipline

**Goal:** Explicit context injection deployed; cache-hit ratio measured high; **TPAC −40% vs the M2 baseline** demonstrated on the `ref-fastapi` scenario.

**Target:** 2 weeks. Detailed PR table in TDD2 §13.4.1.

**Requirements:** REQ-05, REQ-08, REQ-09, REQ-10, REQ-16, REQ-25 (M4 verbs)

**Success Criteria:**
- `buildPrompt()` deterministic context construction with fixed block ordering (PROJECT → REQUIREMENTS → STATE → PHASE → cache breakpoint → task).
- Anthropic `cache_control: {type: 'ephemeral'}` breakpoint insertion at `cacheBreakpointIndex` (after artefacts, before task-specific content).
- OpenAI auto-cache observation + measurement wired.
- Anthropic prompt-cache hit rate ≥ 70% on a 5-task phase of the `ref-fastapi` scenario.
- Budget Gate live: hard ceiling pauses milestone; 70% pressure → tier downgrade; 95% → pause.
- Dashboard cache-hit panel, budget gauge, TPAC panel all live.
- **TPAC measurement on M2 reference shows −40% vs M2 baseline.** Hard requirement — no merge of the M4-finish PR otherwise.
- Ex-stub verb implemented for M4: `pause` (needed by the Budget Gate pause flow).
- ADRs Accepted: ADR-006 (cache-control placement), ADR-007 (budget-gate semantics).

**Dependencies:** Phase 3.

---

## Phase 5: M5 Multi-provider

**Goal:** Cross-vendor parallelism; provider fallbacks; router strategies fully online.

**Target:** 2 weeks. Detailed PR table in TDD2 §13.5.1.

**Requirements:** REQ-02, REQ-15, REQ-18, REQ-25 (M5 verbs)

**Success Criteria:**
- OpenRouter shim configured through `quirks.json` (covers GLM, Kimi, DeepSeek, Llama via Pi's `openai-completions` API type with per-model overrides).
- Optional Gemini shim with hard warnings about ToS / OAuth risk.
- Router strategies: `pinned`, `round-robin`, `tier-routed`, `cost-optimized`, `quality-pinned-cost-failover`.
- Fallback chain: primary fails → automatic failover with retry budget shared with Pi's `auto_retry_*` events.
- Per-provider cost panel in dashboard.
- 3-task parallel batch runs each task on a different provider; all complete; result-protocol parses identically across providers.
- Simulated primary-provider outage (mock 503) triggers fallback; milestone progresses.
- Ex-stub verb implemented for M5: `skills` (wraps Pi's skill install + discovery).

**Dependencies:** Phase 4.

---

## Phase 6: M6 Decommission, benchmark, ship

**Goal:** v3.0 ships with public benchmark; all v2.x Codex-era code paths fully removed; migration path verified end-to-end; v2.3.x LTS branch cut.

**Target:** 2 weeks. Detailed PR table in TDD2 §13.6.1.

**Requirements:** REQ-19, REQ-20, REQ-25 (M6 verbs), REQ-27 (LTS cut)

**Success Criteria:**
- All Codex-era code paths verified removed (`grep -r "codex exec\|codex-driver\|claude-code-driver\|ollama-driver" packages/` returns nothing).
- `commands/stubs.ts` deleted (PR-46) after the §3.2.4 disposition table is exhausted — no v3 verb returns `EXIT.NOT_IMPLEMENTED`.
- Documentation rewrite for vendor-agnostic posture (`docs/` reorganized per TDD2 §18.1).
- Public benchmark scenario published: `ref-fastapi` reference repo + scripts demonstrating TPAC −40% / cache hit ≥70% / cost −50% on Anthropic AND OpenAI side-by-side.
- `swt migrate --to=v3` successfully upgrades v2.x `.swt-planning/` to v3 schema on three test fixtures. Backup written to `.swt-planning.v2-backup/`.
- All P0 dashboard panels green.
- All test suites pass: unit, integration, provider matrix, regression, e2e, chaos.
- `v3.0.0` published to npm with provenance + signed tag (`git verify-tag v3.0.0` succeeds).
- LTS branch `release/v2.3-lts` cut. README updated with EOL date.
- Ex-stub verbs implemented for M6: `archive`, `audit`, `whats-new`, `uninstall` (plus the new `swt migrate` verb).
- ADRs Accepted: ADR-012 (LTS), ADR-013 (docs-site posture deferred).

**Dependencies:** Phase 5.

---

## Total estimated effort

~13 weeks focused work. Plan for 16 with normal slippage. Biggest unknowns: M1 (cassette infrastructure) and M4 (TPAC −40% may need iteration; contingency in TDD2 §13.4.3).
