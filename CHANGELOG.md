# Changelog

## 3.0.0 — STRUCTURALLY COMPLETE 2026-05-12 (npm publish pending release operations)

_All 6 milestones (M1..M6) shipped on `main`. Plan 06-01 closing PRs land at this section. Release notes: [RELEASE-NOTES-v3.0.md](./RELEASE-NOTES-v3.0.md). The npm publish + GitHub release + v2-archive branch cut are user-driven operations gated on cassette recording + the public benchmark run._

**M1 Foundation closed 2026-05-12.** **M2 Single-agent path closed 2026-05-12.** **M3 Worktree dispatcher closed 2026-05-12** (Plan 03-01 + session-wiring follow-up + runMilestone activation follow-up + Plan 03-04). **M4 Token meter + cache discipline structurally closed 2026-05-12** (PR-31..PR-35, PR-37, PR-38; PR-36 hard-deferred on M2 baseline). **M5 Multi-provider structurally closed 2026-05-12.** **M6 Decommission + ship in progress** (Plan 06-01).

> **Branch strategy note (2026-05-12):** v3 development was previously on a `v3-foundation` integration branch with the plan to merge into `main` at the M6 release gate. That branch has been retired; `main` is now the sole development surface for v3. The per-plan "commit trail on `v3-foundation`" section titles below are kept as historical record — the commits themselves are now on `main`'s history.

**Authoritative design:** [`TDD2.md`](./TDD2.md). **Active plans:** [`.vbw-planning/`](./.vbw-planning/). **Roadmap:** [`.vbw-planning/ROADMAP.md`](./.vbw-planning/ROADMAP.md).

### Changed — architecture pivot

- **Runtime substrate** switched from Codex CLI subprocess (v2.x) to [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (`^0.74.0` pinned, `*` peer). Methodology / orchestration / dashboard / cli are now vendor-neutral; only `@swt-labs/runtime` imports Pi directly. See ADR-001 + ADR-004.
- **Methodology** preserved verbatim. The six-agent SDLC, `.swt-planning/` artefact schemas, phase lifecycle, must-haves, goal-backward QA — all unchanged. The runtime layer is replaced; the methodology is not.

### Added — new workspace packages

- `@swt-labs/runtime` (PR-02, commit `3050410`) — Layer 1 Pi adapter. `createSession`, `mapPiEvent`, `createCodingTools` / `createReadOnlyTools`, `MockSpawnerEnvironment`, `probePiAvailable`. Pi declared as peerDep `*` + pinned-range dep `^0.74.0` per ADR-001 + ADR-010 (reproducible builds).
- `@swt-labs/orchestration` (PR-03, commit `74c757c`) — Layer 2 dispatcher. `createDispatcher()` returns a sequential `Dispatcher`; `PiSpawnerEnvironment` probes Pi via the runtime helper and returns a `Dispatcher`-backed `AgentSpawner`. Parallel batches land in M3.
- `@swt-labs/shared` (PR-04, commit `0a623d2`) — leaf package. 9 vendor-neutral types (session, meter, dispatcher, agent-role, autonomy, effort, verification, thinking-level, plus `SwtEvent` in session). 7 Zod schemas (snapshot, events, api migrated from dashboard-core; new task-result, plan, claim, budget per TDD2 §9.4). Zero internal workspace deps beyond zod.

### Added — new abstractions

- `packages/core/src/abstractions/SpawnerEnvironment.ts` (PR-01b, commit `e0bc8ce`) — `SpawnerEnvironment` interface with `probe()` and `getSpawner()`. The CLI (`vibe`, `doctor`) consumes a spawner through this abstraction instead of source-importing from any `@swt-labs/*-driver` package.
- Three ADRs landed alongside their implementing PRs per the audit-reconciled §22.14 schedule:
  - **ADR-001** Pi SDK adoption — Accepted (PR-02)
  - **ADR-002** Extension result protocol via `swt_report_result` custom tool with closure-captured `pi.appendEntry` — Proposed; auto-promotes to Accepted when M1 PR-09 ships the implementation
  - **ADR-004** `cache_control` at provider-shim layer (not Pi-level) — Accepted (PR-02)

### Removed

- **M1 entry-gate constitutional debt cleared.** The source-import edges from `methodology → @swt-labs/codex-driver` and `cli → @swt-labs/{codex,claude-code,ollama}-driver` are broken. The grep invariant `grep -rE "from '@swt-labs/(codex|claude-code|ollama)-driver'" packages/ --exclude-dir={codex,claude-code,ollama}-driver --exclude-dir=dist` returns zero hits.
- **`@swt-labs/dashboard-core`** package deleted wholesale (PR-04). The three schemas it owned (snapshot, events, api) moved to `@swt-labs/shared` via `git mv` with 100% similarity (history preserved). 21+ consumer files across runtime / orchestration / core / cli / dashboard rewired in the same PR.

### Deferred

- The three driver packages (`@swt-labs/codex-driver`, `@swt-labs/claude-code-driver`, `@swt-labs/ollama-driver`) still exist on disk; nothing outside them imports them in source. Plan 01-02 PR-05 deletes them per ADR-005.
- `CodexReasoningEffort` → `ThinkingLevel` cascade rename of `AgentSpec.reasoning_effort` deferred to M2 (touches the methodology agent-spec-resolver — bigger scope than PR-04's consolidation). `shared/src/types/thinking-level.ts` is in place as the destination vocabulary today.

### Fixed

- **VBW pre-push hook data corruption** (issue [#635](https://github.com/swt-labs/vibe-better-with-claude-code-vbw/issues/635), VBW PR [#636](https://github.com/swt-labs/vibe-better-with-claude-code-vbw/pull/636), shipped as VBW v1.37.1). The VBW v1.37.0 pre-push hook called `bash scripts/bump-version.sh --verify` against any repo with that script, including non-VBW repos. SWT v2.3.5's `scripts/bump-version.sh` treats `$1` as a new semver string, so `--verify` was being persisted as a literal `"--verify"` into every `package.json` `version` field on every push. Local defence-in-depth landed at commit `2dd44ee` — adds a `--verify` short-circuit to SWT's `bump-version.sh` that does workspace consistency checking with no mutation. Upstream fix mirrors `validate-commit.sh`'s plugin-name guard and is published as VBW v1.37.1.

### Plan 01-01 commit trail on `v3-foundation`

|   PR   |                                   Commit                                    | Subject                                                                             |
| :----: | :-------------------------------------------------------------------------: | :---------------------------------------------------------------------------------- |
| PR-01a | [`08579dc`](https://github.com/swt-labs/stop-wasting-tokens/commit/08579dc) | `refactor(methodology)`: break codex-driver source-import edge                      |
| PR-01b | [`e0bc8ce`](https://github.com/swt-labs/stop-wasting-tokens/commit/e0bc8ce) | `refactor(cli)`: break {codex,claude-code,ollama}-driver edges + SpawnerEnvironment |
| PR-02  | [`3050410`](https://github.com/swt-labs/stop-wasting-tokens/commit/3050410) | `feat(runtime)`: scaffold `@swt-labs/runtime` + Pi mock + ADRs 001/002/004          |
| PR-03  | [`74c757c`](https://github.com/swt-labs/stop-wasting-tokens/commit/74c757c) | `feat(orchestration)`: scaffold `@swt-labs/orchestration` + PiSpawnerEnvironment    |
| PR-04  | [`0a623d2`](https://github.com/swt-labs/stop-wasting-tokens/commit/0a623d2) | `feat(shared)`: consolidate types + Zod schemas; delete `@swt-labs/dashboard-core`  |

Test posture at Plan 01-01 close: runtime 5/5, orchestration 5/5, cli 71/82 (the 11 remaining are pre-existing v2.3.5 carry-forwards verified via `git stash` baseline comparison; remediated in M1 Plan 01-03 PR-11). `pnpm typecheck` green workspace-wide. M1 entry-gate invariant clean.

### Added (Plan 01-02 — PR-05..PR-09)

- **`@swt-labs/test-utils` (private workspace package, PR-06, commit `795a6cd`)** — cassette infrastructure. `src/cassettes/format.ts` (Zod schemas including the `cwd_redacted: z.literal(true)` enforcement), `normalize.ts` (canonicalizeJson, stripCwd, normalizeCacheControl, normalizeHeaders, SHA-256 request hashing), `recorder.ts` skeleton, `replayer.ts` (loadCassette, installReplay, CassetteNotFoundError, CassetteUnsealedError). `docs/operations/cassette-recording.md` is the user-facing recording guide.
- **`runtime/src/meter/` (PR-07, commit `7fcb20f`)** — `createTokenMeter` per TDD2 §8.1 (records MeterRecord rows; emits METER_UPDATED to subscribers; snapshot() returns aggregated totals + cloned records; optional JSONL persistence). `calculateCost` per TDD2 §7.6 (pure provider-agnostic cost calculation). `groupRecordsByDimension` helper for dashboard panels.
- **`runtime/src/providers/` (PR-08, commit `74b4086`)** — `types.ts` (Tier vocabulary: cheap-fast/balanced/quality/reasoning; SDLCRole — 6 roles, orchestrator intentionally excluded; ProviderQuirk + DefaultTierMap shapes). `default-tiers.json` (per-provider per-tier model map for anthropic, openai, openrouter, google, bedrock, ollama). `quirks.json` (per-provider compat + `thinkingLevelMap` overrides; keys validated as Pi `ThinkingLevel` values, NOT SWT tier names — the TDD2 regression Plan 01-01 audit caught). `role-resolver.ts` (resolveTierForRole / resolveModelForRole / resolveThinkingLevelForRole + DEFAULT_ROLE_TIERS + DEFAULT_ROLE_THINKING_LEVELS).
- **`runtime/src/providers/extractors/` (PR-07, commit `7fcb20f`)** — per-provider usage-field extractors mapping native Pi `turn_end` usage shapes into the vendor-neutral `TaskTokenUsage` carrier. Dispatch in `extractUsage(provider, usage, ctx)`: anthropic|bedrock → anthropic; openai → openai; openrouter/anthropic/_ → anthropic; openrouter/openai/_ → openai; fallback → generic.
- **`runtime/src/extensions/` (PR-08 + PR-09)** — `provider-overrides.ts` (Pi Extension factory that walks `quirks.json` and registers per-provider overrides), `result-protocol.ts` (PR-09: registers `swt_report_result` custom tool with closure-captured `pi.appendEntry` per ADR-002), `journal.ts` (PR-09: mirrors mapped SwtEvents into `.swt-planning/journal/<UTC-day>.jsonl` for M3 crash recovery), `pi-types.ts` (PR-09: local structural mirror of Pi's `ExtensionAPI`/`ExtensionContext` — the latter intentionally has NO `appendEntry` field so `ctx.appendEntry(...)` is a compile-time TS error).
- **`orchestration/src/result-harvest.ts` (PR-09, commit `df9cc78`)** — `harvestTaskResult(filePath)` + `harvestTaskResultFromEntries(entries)`. Scans backwards for the LAST `swt-task-result` custom entry (defends against the defensive `agent_end` placeholder race). Validates against `TaskResultSchema`. `MissingTaskResultError` surfaces clear failure. JSONL reader tolerates blank lines + malformed JSON.
- **`orchestration/src/dispatcher.ts` extension (PR-09)** — `HarvestStrategy` discriminated union (`'stub' | 'entries' | 'file'`). Callers wire `'entries'` for in-memory Pi sessions, `'file'` for out-of-process Pi sessions in M3+; `'stub'` preserves the Plan 01-01 PR-03 contract.
- **`telemetry/src/events.ts` extension (PR-07)** — 4 new M1 event names registered with `M1_EVENT_REGISTRY` array: `swt.m1.meter.updated`, `swt.m1.cassette.replay_started`, `swt.m1.cassette.replay_complete`, `swt.m1.task_result.parsed`. Aggregate dimensions only per Principle 4 — telemetry never carries prompt content.

### Removed (Plan 01-02 — PR-05, commit `c390d85`)

- **`@swt-labs/codex-driver`, `@swt-labs/claude-code-driver`, `@swt-labs/ollama-driver` packages deleted wholesale** per ADR-005. `packages/{codex,claude-code,ollama}-driver/` entire subtrees + `.codex-plugin/` directory removed. `packages/cli/package.json` drops the 3 workspace deps. Verified pre-deletion: all 3 driver names return HTTP 404 on the npm registry (never published; `private: true` was the actual safety net). Migration story for v2 users in ADR-005's "Decision" section + the eventual `docs/operations/migrating-from-v2.md` (PR-10) + `swt migrate --to=v3` (M6 PR-49).

### ADRs (Plan 01-02 delta)

- **ADR-002 — Extension result protocol via custom tool** promoted from Proposed → **Accepted** at PR-09 with the three-layer invariant lock (compile/test/doc) documented inline. Compile-time: `PiExtensionContext` has NO `appendEntry` field. Test-time: `result-protocol.test.ts` asserts `'appendEntry' in ctx === false` for the structural context shape + asserts `pi.appendEntry`'s call count. Doc-time: this ADR + inline comments.
- **ADR-003 — Provider quirks live in `quirks.json` applied via Pi Extension** — **Accepted** at PR-08. Rationale: one Zod schema test enforces the `thinkingLevelMap`-keys-are-Pi-`ThinkingLevel`-values invariant across all providers; adding a provider is a JSON edit (no TS change required); v2's twelve-file driver shim layout taught us diff noise + type drift + onboarding cost.
- **ADR-005 — Delete codex/claude-code/ollama drivers wholesale; no co-existence** — **Accepted** at PR-05.
- **ADR-011 — Provider matrix via cassettes only (no live multi-provider CI)** — drafted **Proposed** at PR-06; auto-promotes to **Accepted** at M5 PR-44 when the provider-matrix CI workflow goes live.

### Deferred (Plan 01-02 cassette-driven)

- **`packages/test-utils/cassettes/scout-read-readme.jsonl`** — first proof cassette. Recording is a one-time developer-local step against a live Anthropic API. When committed, `runtime/test/meter/cassette-replay.int.test.ts` activates automatically (via `it.skipIf(!HAS_CASSETTE)`) and the byte-identical token-count assertion (delta=0 hard requirement per TDD2 §14.7) runs.
- **`packages/test-utils/cassettes/scout-search-codebase.jsonl`** — second proof cassette. When committed, the `orchestration/test/dispatcher.int.test.ts` cassette-gated case activates (dispatcher → mocked Pi → swt_report_result → harvest → parsed TaskResult, schema validation hard requirement).

Both recordings are tracked in `.vbw-planning/STATE.md ## Todos`.

### Plan 01-02 commit trail on `v3-foundation`

|  PR   |                                   Commit                                    | Subject                                                                                                       |
| :---: | :-------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------ |
| PR-05 | [`c390d85`](https://github.com/swt-labs/stop-wasting-tokens/commit/c390d85) | `chore(drivers)`: delete codex/claude-code/ollama driver packages + `.codex-plugin/` + ADR-005 Accepted       |
| PR-06 | [`795a6cd`](https://github.com/swt-labs/stop-wasting-tokens/commit/795a6cd) | `feat(test-utils)`: cassette infrastructure (recorder + replayer + format + normalize) + ADR-011 Proposed     |
| PR-08 | [`74b4086`](https://github.com/swt-labs/stop-wasting-tokens/commit/74b4086) | `feat(runtime)`: provider quirks + role-resolver + ADR-003 Accepted (executed before PR-07 — no cassette dep) |
| PR-07 | [`7fcb20f`](https://github.com/swt-labs/stop-wasting-tokens/commit/7fcb20f) | `feat(runtime)`: token meter + per-provider extractors + telemetry registry                                   |
| PR-09 | [`df9cc78`](https://github.com/swt-labs/stop-wasting-tokens/commit/df9cc78) | `feat(runtime,orchestration)`: `swt_report_result` Extension + result harvest + ADR-002 Accepted              |

Test posture at Plan 01-02 close: runtime 88 passed + 1 skipped (cassette-gated); orchestration 19 passed + 1 skipped (cassette-gated); full workspace typecheck shows only the pre-existing dashboard `LogPanel.tsx(78,9)` TS2322 carry-forward (Plan 01-03 PR-11 territory). Plan 01-02 introduced ZERO new test failures. M1 status at Plan 01-02 close: 2 of 3 plans complete, 10 of 15 tasks shipped across 10 atomic commits.

### Added (Plan 01-03 — PR-10 + PR-11)

- **`docs/decisions/` — 7 new ADRs (PR-10 Task 3, commit `a83b7e7`)** drafted Proposed (with the documented exceptions): ADR-006 (cache-control breakpoint placement; → M4 PR-32), ADR-007 (Budget Gate semantics 70%/95%; → M4 PR-35), ADR-008 (worktree-per-task; → M3 PR-22), ADR-009 (Windows worktree path discipline; → M3 PR-30), ADR-010 (deterministic builds; **Accepted** at PR-11 Task B in the same plan), ADR-012 (six-month LTS for v2.3.x; → M6 PR-53), ADR-013 (no hosted docs site at v3.0; **Deferred** until ~1000-user threshold). `docs/decisions/README.md` ships as the ADR index with status table + lifecycle doc + promotion schedule. Final 13-ADR tally matches TDD2 §22.14 verbatim: **6 Accepted (001/002/003/004/005/010), 6 Proposed (006/007/008/009/011/012), 1 Deferred (013).**
- **`docs/operations/migrating-from-v2.md` (PR-10 Task 2, commit `0ce520b`)** — full 315-line v2→v3 migration guide per TDD2 §18.3's 7-section outline. Pre-migration checklist + script invocation (`swt migrate --to=v3`) + per-artefact transformations + the `schema_version: 1` policy (lands at migrate-time, NOT retroactively) + verification via `swt doctor` + 3 back-out paths + 7-question FAQ.
- **`docs/` topical reorganization per TDD2 §18.1 (PR-10 Task 1, commit `c88fc79`)** — 8-folder v3 structure (methodology/, runtime/, orchestration/, dashboard/, cli/, operations/, decisions/, design/) with 16 new stub pointer files. Existing Mintlify-format MDX content preserved alongside per ADR-013. `docs/README.md` rewritten as the v3 topical index. Root `README.md` body purged of `backend:` config field references + "Choose a backend" framing; added "Migrating from v2.x?" + "Design" sections pointing at the migration guide + TDD2.md + ADR index.
- **ESLint §4.3 layered-architecture rules (PR-10 Task 1)** — `eslint.config.mjs` carries the From→May-import zone declarations (6 zones matching TDD2 §4.3 verbatim) + `no-restricted-imports` forbidding `@earendil-works/*` outside `packages/runtime/` (Principle 1). `packages/core/test/eslint-boundary.test.ts` (4 tests) regression-guards the boundary rules via structural-text assertions + Linter API behavioural assertion. `import/no-restricted-paths` currently at `warn` severity pending a pnpm-workspace-aware resolver (M3 territory); `no-restricted-imports` enforcing Principle 1 stays at `error` severity and works correctly today.
- **`reproducible-build` CI job (PR-11 Task B, commit `6cebe5c`)** — `.github/workflows/ci.yml` builds twice and diffs `dist/`, uploads first-build on failure. Runs on push-to-main + push-to-v3-foundation. Per ADR-010. Branch triggers also extended to `main` + `v3-foundation` (pre-this-PR, ci.yml had no trigger on v3 work).
- **3 future-milestone workflow stubs (PR-11 Task B)** — `regression.yml` (M2 PR-18), `chaos.yml` (M3 PR-28), `provider-matrix.yml` (M5 PR-44). Cross-platform `.mjs` stub scripts at `scripts/stub-test-{regression,chaos,provider-matrix}.mjs` wired through new root `package.json` `test:*` scripts. Each stub exits 0 with a clear pointer to the milestone PR that ships the real runner.
- **`CONTRIBUTING.md` Branch Protection (v3) section (PR-11 Task B)** — documented required status checks, required reviews (1 for most; 2 for `packages/runtime/`), and repository rules (linear history, no force-push to main / v3-foundation).
- **`.vbw-planning/v3-tracking.md` cross-milestone ledger (PR-11 Task B)** — per TDD2 §13.8. M1 PR table fully populated (15 rows with merge dates + commit hashes + ADRs touched); per-milestone placeholders for M2..M6; metrics table (TPAC / cache-hit / cost) ready for M2-M5 numbers; exit-gate signoff table with M1 row marked complete 2026-05-12.
- **`docs/decisions/test-debt-tracking.md` (PR-11 Task A, commit `bb04054`)** — authoritative cluster-level inventory of every v2.3.5-carry-forward test skip. Maps to umbrella issue [#32](https://github.com/swt-labs/stop-wasting-tokens/issues/32) + the M2..M6 PR where each cluster's real fix lives. Includes the HIGH-priority security note for `packages/verification/test/guards.test.ts` (3 bash-guard denylist regressions to fix in next hotfix or M2 PR-12, not M6).

### Changed (Plan 01-03)

- **CI `Test` step is now a required gate (PR-11 Task A)** — `continue-on-error: true` removed from `.github/workflows/ci.yml`. Any new test failure blocks merge. 49 actual v2.3.5-carry-forward failures classified per the plan: 9 deleted as obsolete (codex-plugin-manifest.test.ts), 5 deleted-equivalent (launch-checklist.test.ts 2 describe blocks), 35 skipped at describe-level across 19 test files with `// TODO(v3-debt): tracking #32` headers. Cluster-level `describe.skip` rather than per-test `it.skip` — equivalent traceability via the umbrella issue + `test-debt-tracking.md`.
- **`TDD2.md` §19 risk register (PR-11 Task B)** — gained §19.6 "M1 exit-interview risk delta": R-01 mitigation enriched (PR-09 structural-mirror pattern for Pi 0.74-alpha types); R-02 (codex-driver edge audit) marked **CLOSED**; R-09 (33-test remediation) in-progress and conditional-CLOSED at this PR; R-10 (cassette flakiness) mitigation already implemented at PR-06 and conditional-CLOSED when cassettes are recorded. "No new architectural-class risks surfaced during M1 execution" recorded.

### Plan 01-03 commit trail on `v3-foundation`

|      PR      |                                   Commit                                    | Subject                                                                                                    |
| :----------: | :-------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------- |
| PR-10 Task 3 | [`a83b7e7`](https://github.com/swt-labs/stop-wasting-tokens/commit/a83b7e7) | `docs(adrs)`: draft ADRs 006..013 (excluding existing) + ADR index README                                  |
| PR-10 Task 2 | [`0ce520b`](https://github.com/swt-labs/stop-wasting-tokens/commit/0ce520b) | `docs(operations)`: write v2→v3 migration guide                                                            |
| PR-10 Task 1 | [`c88fc79`](https://github.com/swt-labs/stop-wasting-tokens/commit/c88fc79) | `docs(architecture)`: docs/ topical reorg + ESLint §4.3 boundary rule + driver-mention purge               |
| PR-11 Task B | [`6cebe5c`](https://github.com/swt-labs/stop-wasting-tokens/commit/6cebe5c) | `chore(ci)`: reproducible-build + regression/chaos/provider-matrix stubs + v3-tracking.md + TDD2 §19 delta |
| PR-11 Task A | [`bb04054`](https://github.com/swt-labs/stop-wasting-tokens/commit/bb04054) | `test(remediation)`: 33-test debt remediation + require CI Test step — M1 EXIT GATE REACHED                |

Test posture at Plan 01-03 close: 719 passed, 123 skipped, 0 failed across the workspace. `pnpm typecheck` clean. `pnpm lint` 0 errors + 213 warnings (mostly demoted `import/no-restricted-paths` pending the pnpm-workspace resolver). `pnpm format:check` clean.

### M1 EXIT GATE REACHED — 2026-05-12

All 12 M1 PRs merged across 3 plans / 15 atomic commits on `v3-foundation`. M1 Foundation closed per TDD2 §13.1.3:

- Constitutional debt cleared: methodology → codex-driver + cli → {codex,claude-code,ollama}-driver source-import edges broken (Plan 01-01 PR-01a/b); 3 driver packages + `.codex-plugin/` deleted wholesale (Plan 01-02 PR-05).
- Architecture scaffolding in place: `@swt-labs/runtime` (Pi adapter) + `@swt-labs/orchestration` (dispatcher) + `@swt-labs/shared` (leaf types/schemas) + `@swt-labs/test-utils` (cassette infrastructure, private).
- Real behaviour under test: token meter + per-provider extractors + role-resolver + provider quirks JSON + `swt_report_result` Extension with closure-captured `pi.appendEntry`.
- Documentation in v3 shape: 13 ADRs + v2→v3 migration guide + docs/ topical reorganization + ESLint §4.3 boundary rules.
- CI hardened: Test step required, reproducible-build job active per ADR-010, 3 future-milestone workflow stubs.
- Test-debt accountable: umbrella issue #32 + `docs/decisions/test-debt-tracking.md`.

M2 (single-agent path) entry conditions met per TDD2 §13.1.5. Two cassette-driven test activations stay deferred to a user-driven recording session (orthogonal to M1 exit gate).

### Added (Plan 02-01 — PR-12 → PR-16)

M2 Plan 02-01 — _Methodology Rewire + Single-Agent Path_ — closed 2026-05-12 across 5 atomic commits on `v3-foundation`. **+98 tests** (730 → 828); 0 failures throughout; 0 lint errors; all typecheck green.

- **`packages/methodology/src/profiles/role-profiles.ts` (PR-12, commit `8bc1475`)** — 6 SDLC role profiles per TDD2 §10.1 (`SCOUT_PROFILE`, `ARCHITECT_PROFILE`, `LEAD_PROFILE`, `DEV_PROFILE`, `QA_PROFILE`, `DEBUGGER_PROFILE`) with `defaultTier`, `toolSubset`, `sessionMode`, `defaultThinkingLevel`, `promptPath`. 6 sibling `.prompt.md` files carry the role system prompts per TDD2 §10.3. `ROLE_PROFILES` lookup table + `SDLC_ROLES` array exported.
- **`packages/orchestration/src/role-router.ts` (PR-12)** — `toolsForRole(role, cwd)` per TDD2 §10.4. Read-only for Scout/Architect; coding for Lead/Dev/Debugger; coding with prompt-level no-edit constraint for QA at M2 (true qa-bash factory at M3+).
- **`packages/orchestration/src/prompt-builder.ts` (PR-12)** — `buildPrompt(opts)` emits 8-block fixed-order prompt per TDD2 §8.3 (system → project → requirements → state → phase-context → BREAKPOINT → task → must-haves). Records `cacheBreakpointIndex` for the upcoming M4 PR-32 Anthropic `cache_control: ephemeral` wiring per ADR-006.
- **`CodexReasoningEffort → ThinkingLevel` cascade rename (PR-12)** — M1-deferred from Plan 01-01 PR-04. `AgentSpec` migrated from `@swt-labs/core` to `@swt-labs/shared` with `thinking_level: ThinkingLevel` (Pi-native: `off | minimal | low | medium | high | xhigh`). `packages/core/src/types/codex-reasoning-effort.ts` deleted via `git rm`. `agent-spec-resolver.ts` reads `thinking_level` from TOML; 6 agent template TOMLs renamed `model_reasoning_effort` → `thinking_level`. `grep -rE "reasoning_effort|CodexReasoningEffort" packages/ --include="*.ts"` returns no source hits.
- **`packages/methodology/src/vibe/orchestration/dev-runner.ts` rewritten (PR-13, commit `b1654b0`)** — `runDevTasks({phase, plans, cwd, opts})` replaces v2's `AgentSpawner`-driven `runDev(input)`. Sequential per TDD2 §11.4 (M3 PR-22 parallelises via worktree-keyed claims). Per plan: calls `dispatcher.dispatch({ role: 'dev', cwd, claims: plan.files_modified, promptContext })`. Halt-on-failed/blocked stops the loop; returns `{outcomes, status, haltReason?}`.
- **`packages/methodology/src/vibe/handlers/execute.ts` thinned (PR-13)** — drops v2 spawner/devSpec injection; accepts optional `harvestStrategy?` (passed straight to `runDevTasks`). Adapts `TaskResult` → `DevSummaryPayload` for the existing `writeSummary` consumer. Wave-level halt-aware: stops dispatch on `runSummary.status === 'halted'`.
- **`packages/orchestration/src/dispatcher.ts` defensive task_id-mismatch guard (PR-13)** — on `'entries'`/`'file'` harvest strategies, verifies harvested `result.task_id` matches dispatched `task.taskId`. Catches stale-entry leaks in future M3 worktree-reuse scenarios.
- **Methodology workspace deps (PR-13)** — `@swt-labs/orchestration` + `@swt-labs/shared` added to `packages/methodology/package.json` + tsconfig project references. Per Principle 2 (TDD2 §4.3): methodology depends on orchestration → runtime → core/shared.
- **`packages/verification/src/checks/static-checks.ts` (PR-14, commit `dd5c9e3`)** — 4 canonical static checks (`TYPECHECK`, `LINT`, `FORMAT_CHECK`, `UNIT_TESTS`) as `StaticCheck` values with 4 KB output tail. `DEFAULT_STATIC_CHECKS` ordered array. `makeCommandCheck` factory for tests.
- **`packages/verification/src/runner.ts` ladder (PR-14)** — `runVerificationLadder(opts)` per TDD2 §11.2. Runs the ladder in order; short-circuits on first failure; escalates to `LlmVerificationEscalator` when one is provided. `NOOP_ESCALATOR` ships as the M2 default; M3+ wires the real escalator that dispatches to the QA agent through the orchestration dispatcher.
- **HIGH-priority bash-guard security fix (PR-14)** — `checkBashCommand` denylist regression flagged at Plan 01-03 PR-11 Task A FIXED. Three regression vectors closed: `rm -rf /` (trailing `\b` after `\/` never matched EOS — replaced with `\/(?:\s|$)`); `curl ... | sh` and fork bomb `:(){ :|: & };:` (splitCompound fragmented `|`/`;` patterns — added full-command pre-pass that catches multi-segment denylist hits before the per-segment pass runs). Also tightened the `>+\s*/dev/(sd|nvme|disk)` redirect pattern (drop leading `\b` which never matched space-before-`>`) + added `\/\w+\b` first-path-component pattern (`rm -rf /etc`). 12-row denylist regression matrix + 3 negative-case tests added to `guards.test.ts`.
- **`packages/methodology/src/vibe/handlers/qa.ts` ladder-then-handoff (PR-15, commit `e950586`)** — runs `runVerificationLadder` FIRST. If ladder fails → writes `result: 'fail'` VERIFICATION.md, skips must-haves. If ladder passes AND spawner+qaSpec injected → existing v2 must-haves path. If ladder passes AND no spawner → writes static-checks-only `result: 'pass'` VERIFICATION.md.
- **RoadmapSchema relaxation (PR-15)** — `phases: z.array(...).min(1)` → `.min(0)`. Permits the post-bootstrap pre-scope state (bootstrap writes ROADMAP.md with zero phases; scope adds phases later). The corresponding "roadmap requires at least one phase" test became "roadmap accepts an empty phases array (post-bootstrap, pre-scope)".
- **`swt doctor` Pi peer-dep surfacing (PR-15)** — new `PiStatusLike` shape on `DoctorReport.pi` populated from `SpawnerEnvironment.probe()` when probe `name` starts with `pi-`. Renders `✓ Pi runtime X.Y.Z` (success) or `⚠ Pi runtime not available — <reason>` (failure) lines.
- **`handlers/index.ts` re-exports `NotImplementedError` + `RoutingError` (PR-15)** — restores v2 import surface for `dispatch.test.ts`. The split at Plan 01-01 PR-04 lost the re-export.
- **9 methodology test-debt unskips (PR-13 + PR-15)** — 4 bootstrap.test ZodError cluster (PR-15 RoadmapSchema relaxation), 2 dispatch.test NotImplementedError shape (PR-15 re-export), 3 plan/qa/execute driver fallout (PR-13 + PR-15 ladder integration). Total: 32+ methodology tests now passing where 0 were before.
- **`packages/dashboard/src/server/vibe/ui-permission-gate.ts` + `composite-permission-gate.ts` (PR-16, commit `4effa48`)** — `UiPermissionGate` (sessionless audit-trail gate for UI-button POSTs) + `CompositePermissionGate` (session-keyed router) per TDD2 §12. `UiPermissionGate` includes optional `classify` hook for M3+ destructive-op gating + `UiAuditSink` interface with `InMemoryUiAuditSink` as the M2 default. **Contract-only landing** — existing routes (`/api/config`, `/api/init`, `/api/command`) keep their localhost trust-model behavior; adoption lives at M3 when destructive-op classifiers + SSE-audit consumers exist.

### Plan 02-01 commit trail on `v3-foundation`

|  PR   |                                   Commit                                    | Subject                                                                                                                     |
| :---: | :-------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------- |
| PR-12 | [`8bc1475`](https://github.com/swt-labs/stop-wasting-tokens/commit/8bc1475) | `feat(methodology,orchestration)`: role profiles + role-router + prompt-builder + CodexReasoningEffort→ThinkingLevel rename |
| PR-13 | [`b1654b0`](https://github.com/swt-labs/stop-wasting-tokens/commit/b1654b0) | `feat(methodology,orchestration)`: Dev role through dispatcher + dev-runner sequential loop + execute handler rewire        |
| PR-14 | [`dd5c9e3`](https://github.com/swt-labs/stop-wasting-tokens/commit/dd5c9e3) | `feat(verification,methodology)`: QA static-check ladder + LLM escalation + bash-guard HIGH-priority security fix           |
| PR-15 | [`e950586`](https://github.com/swt-labs/stop-wasting-tokens/commit/e950586) | `feat(methodology,verification,cli)`: QA ladder integration + roadmap relax + Pi doctor + 9 v2.3.5 test debts cleared       |
| PR-16 | [`4effa48`](https://github.com/swt-labs/stop-wasting-tokens/commit/4effa48) | `feat(dashboard)`: UiPermissionGate + CompositePermissionGate contract (Plan 02-01 close)                                   |

Test posture at Plan 02-01 close: **828 passed / 75 skipped / 0 failed**. `pnpm typecheck` clean, `pnpm lint` 0 errors. Methodology cluster (9/9) + Verification HIGH-priority bash-guard cluster (3/3) of umbrella issue #32 resolved.

### Added (Plan 02-02 — PR-17 → PR-21, complete)

All 5 PRs of Plan 02-02 shipped 2026-05-12. M2 single-agent path closed.

- **LogPanel.tsx(78,9) TS2322 FIXED (PR-17, commit `3ae8e6c`)** — pre-existing v2.3.5 carry-forward. `{scheduleSnap()}` inline JSX call returned `void` (not a renderable type). Moved to `createEffect(() => scheduleSnap())` per SolidJS idiom; the side-effect (queued auto-scroll) still fires on every reactive re-render but no longer appears as a JSX child. `pnpm -F @swt-labs/dashboard exec tsc --noEmit -p tsconfig.client.json` now clean.
- **chokidar v4 glob-support fix (PR-17)** — chokidar 4.0.3 dropped built-in glob handling; the v2-era `<dir>/*.jsonl` pattern in `tail-file.ts` was being treated as a literal path that never existed. Rewrote `createFileTailer` to parse the `*.<ext>` tail itself: derive the directory + an extension filter, watch the directory, filter `add`/`change` events by extension. Added a `ready: Promise<void>` to `FileTailer` + `EventsTailer` so tests that write files immediately after construction can `await tailer.ready` before chokidar's initial scan completes. Also dropped `awaitWriteFinish: { stabilityThreshold: 25 }` from the chokidar config — it delayed events 25-50ms even for atomic `writeFileSync` calls; consumers read JSONL via atomic writes.
- **9 of 10 dashboard test-debt items UNSKIPPED + GREEN (PR-17)** — `sse-snapshot-changed.test.ts` (1 residual chokidar v4 close-handler edge case skipped), `sse-reconnect.test.ts` (3), `events-tailer.test.ts` (4), `log-rate-limit.test.ts` (2), `server.test.ts` (4), `artifact-route.test.ts` (8), `snapshot-reducer.test.ts` (9). 3 test-side adjustments where v2-shape assertions drifted: `server.test` regex (`/refuses to bind/` → `/[Rr]efus(es|ing) to bind/`); `snapshot-reducer` explicit `generated_at` diff (Date.now ms-resolution collision); `artifact-route` shiki output shape (`class="language-ts"` → styled-span pattern).
- **Cassette regression scaffolding (PR-18, commit `7a1b20c`)** — `packages/test-utils/golden/ref-fastapi/` frozen reference fixture (PROJECT.md + REQUIREMENTS.md + `v2-baseline/.gitkeep` + `cassettes/.gitkeep`). `runMilestone` test harness in `packages/test-utils/src/run-milestone.ts` with cassette discovery + tmpdir spec copy + replay install; throws `CassetteNotRecordedError` (no cassettes today) or `MilestoneInvocationDeferredError` (post-cassette, until M3 session.prompt() activation). `diffArtefacts` allowed-drift comparator in `packages/test-utils/src/diff-artefacts.ts` per TDD2 §14.6 — 5 artefact categories (state-md, plan-md, verification-counts, semantic-fingerprint, byte-exact) with two-row Levenshtein DP. `test/regression/ref-fastapi.regression.test.ts` ships with `skipIf(!READY)`; `scripts/stub-test-regression.mjs` rewritten to invoke `vitest run test/regression/` directly; `.github/workflows/regression.yml` Test step calls `pnpm test:regression` with no fallback.
- **TPAC aggregator + Zod schema (PR-19, commit `454eed2`)** — `packages/orchestration/src/tpac-meter.ts` exports `computeTpac(snapshot, opts) → TpacReport` (filter `MeterSnapshot.records` by milestone, sum input/output/cost, divide by `criteria_satisfied`) + `summariseRoles(snapshot, {milestone})` for the per-role dashboard breakdown + `NoSatisfiedCriteriaError` zero-denominator guard. `packages/shared/src/schemas/tpac-report.ts` exports `TpacReportSchema` frozen at `schema_version: 1` — same Zod contract M4 PR-32's `−40% vs M2` target check consumes. `docs/operations/observability.md` extended with the M2 measurement methodology + M4 cache-hit-ratio preview.
- **`swt rpc` verb (PR-20, commit `44a5ba3`)** — delegates to Pi's `runRpcMode` under the `swt` binary name per TDD2 §3.2 + §5. `packages/runtime/src/rpc-runner.ts` imports `runRpcMode` value-level (the Pi import lives in runtime/, per Principle 1). `packages/cli/src/commands/rpc.ts` honours Pi's stdout-reserved-for-protocol convention (asserted by 3 tests). Handler catches `RpcModeUnavailableError` until M3 session-wiring follow-up wires the full `AgentSessionRuntime` construction; today the verb exits `EXIT.NOT_IMPLEMENTED` (2) with a clear pointer to the activation gate. Per-verb doc at `docs/cli/verbs/rpc.md`.
- **`swt bench` verb (PR-21, commit `46fb02c`)** — user-facing wrapper on the cassette regression machinery. `packages/cli/src/commands/bench.ts` wires the chain `runMilestone (test-utils) → harvestRunResult → computeTpac (orchestration) → TpacReportSchema.parse (shared) → emit (stdout or --output file)`. Flag set: `--fixture` (default `ref-fastapi-empty`), `--provider` (`anthropic`), `--cassettes`, `--output`, `--milestone` (`M2`). 4 tests cover the deferred-state contract (`CassetteNotRecordedError` + `MilestoneInvocationDeferredError` + unexpected-error + flag-defaults/overrides spy). `@swt-labs/test-utils` promoted from pure dev-time package to runtime dep of `@swt-labs/cli`. Per-verb doc at `docs/cli/verbs/bench.md`.

### Plan 02-02 commit trail on `main`

|  PR   |                                   Commit                                    | Subject                                                                                                       |
| :---: | :-------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------------------------ |
| PR-17 | [`3ae8e6c`](https://github.com/swt-labs/stop-wasting-tokens/commit/3ae8e6c) | `feat(dashboard)`: SSE rewire + chokidar v4 fix + LogPanel TS2322 + 9 v2.3.5 dashboard test debts             |
| PR-18 | [`7a1b20c`](https://github.com/swt-labs/stop-wasting-tokens/commit/7a1b20c) | `feat(test-utils,regression)`: cassette regression suite scaffolding + diffArtefacts allowed-drift comparator |
| PR-19 | [`454eed2`](https://github.com/swt-labs/stop-wasting-tokens/commit/454eed2) | `feat(orchestration,shared)`: TPAC aggregator + TpacReport schema + observability docs                        |
| PR-20 | [`44a5ba3`](https://github.com/swt-labs/stop-wasting-tokens/commit/44a5ba3) | `feat(runtime,cli)`: `swt rpc` verb delegating to Pi `runRpcMode`                                             |
| PR-21 | [`46fb02c`](https://github.com/swt-labs/stop-wasting-tokens/commit/46fb02c) | `feat(cli,bench)`: `swt bench` verb wrapping ref-fastapi TPAC harness                                         |

Test posture at Plan 02-02 close: **905 passed / 46 skipped / 0 failed**. `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm format:check` clean. Dashboard cluster of umbrella issue #32: 9 of 10 resolved (1 `sse-snapshot-changed` chokidar v4 close-handler edge case skipped pending chokidar 5 / fs.watch migration). LogPanel TS2322 resolved.

### M2 EXIT GATE — 2026-05-12 (structurally complete; live baseline pending user-driven activation)

Per TDD2 §13.2.3 — 3 of 6 criteria PASS today, 3 deferred but structurally complete:

| Criterion                                                                | Status   | Activation gate                                                 |
| ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------- |
| Reference greenfield project runs full milestone end-to-end on Anthropic | DEFERRED | Anthropic cassette recording + session-wiring follow-up         |
| Regression suite passes against v2.3.5 golden                            | DEFERRED | Cassette recording + v2.3.5 golden run                          |
| TPAC measured + recorded as fixed M2 baseline                            | DEFERRED | Cassette recording + session-wiring follow-up → `swt bench` run |
| Dashboard's existing panels work against the new event stream            | **PASS** | PR-17 — closes 9 of 10 dashboard test debts                     |
| `swt rpc` ships                                                          | **PASS** | PR-20 — structural; live activation at session-wiring follow-up |
| `swt bench` ships                                                        | **PASS** | PR-21 — structural; live activation at session-wiring follow-up |

**No further code is needed in Plan 02-02 / M2 to satisfy the gate.** The remaining work is a user-driven Anthropic recording session (~30–45 min + ~$0.50 API spend) + a single-file `session.prompt()` activation PR (deferred from M3 PR-22's original scope after empirical cost discovery).

### Added (Plan 03-01 — PR-22 → PR-26, complete)

All 5 PRs of Plan 03-01 shipped 2026-05-12. M3 orchestration-layer foundation in place.

- **`WorktreeManager` lifecycle FSM (PR-22, commit `48514a0`)** — `packages/orchestration/src/worktree-manager.ts` ships the 8-state FSM per TDD2 §9.1 (`created → claimed → dispatched → agent_running → agent_complete → harvested → removed`; `failed` reachable from any non-terminal state). Backed by `git worktree add/remove` via pluggable git runner + per-task line-delimited journal at `.swt-planning/journal/wt-<taskId>.jsonl`. Methods: `create` / `claim` / `dispatch` / `markAgentRunning` / `markAgentComplete` / `harvest` / `remove({keepForForensics?})` / `fail`. Illegal transitions throw `IllegalTransitionError`. Git failures during `create` / `remove` transition to `failed` and throw `GitOperationError`. 16 tests cover happy path + illegal transitions + git failures + fail-from-any-state + keepForForensics + concurrent tasks. Per-worktree Pi session wiring is explicitly NOT in this PR — marked as `TODO(session-wiring follow-up)` at the `dispatch` method insertion point. `WorktreeState` + `WorktreeJournalEntry` types land in `packages/shared/src/types/worktree.ts`.
- **`ClaimRegistry` file-claim conflict prevention (PR-23, commit `6e16e2d`)** — `packages/orchestration/src/claim-registry.ts` ships an in-memory registry keyed by `SHA-1(normalized-lowercase-POSIX-path)` per TDD2 §13.3.3. Atomic `register(taskId, claims[])` (any conflict aborts the whole batch + surfaces every conflict at once), `release(taskId)`, `pathBelongsToClaim` predicate, `getClaimsForTask`, `size`, `hasClaim`. Case-insensitive-FS safe (macOS/Windows): `Foo.ts` and `foo.ts` collide. Windows backslash normalization; leading `./` stripped; repeated `/` collapsed. Dispatcher wires `claimRegistry?: ClaimRegistry` option; conflicts short-circuit with `status='blocked'` + `blockers=['claim-conflict-with-<otherTaskId>:<path>']` before session creation. 22 cases for the registry + 4 for the dispatcher wire-up.
- **`resolveDag` — `depends_on` → parallel batches (PR-24, commit `6096e34`)** — `packages/orchestration/src/dag-resolver.ts` ships Kahn's algorithm batched topological sort. Returns a discriminated `ResolveDagResult` (`{ok: true, batches} | {ok: false, error}`); error union: `CycleDetectedError` (with `residualNodes[]`), `MissingDependencyError` (with `taskId` + `missingDependency`), `DuplicateTaskError`. Within-batch order = input-array order (deterministic for tests + CI logs). `TaskNode` + `TaskBatch` types in `@swt-labs/shared/types/dag` — isomorphic with `TaskBrief` + plan-frontmatter task declarations. 17 cases: linear chain, diamond, multi-root fan-in, deeper fan-out, deterministic ordering, missing-dep + first-error reporting, two/three-node + self-loop cycles, cycle-alongside-valid-subgraph, duplicate task IDs, error-message shape.
- **`lock-files` — PID liveness + `WorktreeManager` integration (PR-25, commit `879f80c`)** — `packages/orchestration/src/lock-files.ts` ships per-task locks at `.swt-planning/locks/task-<taskId>.lock` per TDD2 §9.5. `acquireLock` writes the envelope (validated by `LockFileEnvelopeSchema` frozen at `schema_version: 1`); `LockHandle.release` idempotent + `LockHandle.update(patch)` for state/session_id/worktree_path. `readLocks` scans + validates with a PID liveness flag. `purgeStaleLocks` drops dead-PID locks (with optional `purgeCorrupt` for malformed files). `defaultPidChecker` uses `process.kill(pid, 0)`: ESRCH → dead, EPERM → alive (exists, can't signal), other → unknown (conservative). `WorktreeManager.lockOps` injection wires acquire on `create` → update on every transition → release on clean `remove`; `fail` preserves the lock per TDD2 §9.7 forensics policy. `WorktreeStateSchema` (Zod) extracted as a sibling schema. 20 lock-files cases + 8 lock-integration cases on `worktree-manager.test.ts`.
- **`swt_report_result` Extension wired through dispatcher (PR-26, commit `193e26d`)** — `SwtSessionOptions.enableResultProtocol` + `.taskId` flag-based contract in `@swt-labs/shared/types/session`. The orchestration-layer dispatcher threads both into every session factory call (single + batch). The runtime mock's `createSession` records both as no-ops; the deferred session-wiring follow-up consumes them per ADR-002 to register `buildResultProtocolExtension()` on the real Pi session via `createAgentSession({ customTools: [...] })` + write a `task-context` custom session entry before the first `prompt()`. **Principle 1 invariant intact**: orchestration passes a boolean + string; it never imports `@earendil-works/*`. The Pi-side wiring lives entirely in `packages/runtime/src/session.ts` + `result-protocol.ts`, with the activation snippet documented in the result-protocol header so the future flip is mechanical.

### Plan 03-01 design wins

- **Three opt-in injection points** (`claimRegistry`, `lockOps`, `enableResultProtocol`) on the dispatcher / WorktreeManager / SwtSessionOptions surfaces. All three default to undefined/false/no-op, which means existing tests pre-PR-22 didn't need any scaffolding updates beyond the recording-factory shape extension in `dispatcher.test.ts`. Cleanest backward-compat pattern in v3 to date.
- **Flag-based wiring contracts keep Principle 1 strong.** PR-23 (claim-registry), PR-25 (lockOps), and PR-26 (result-protocol) all hand the orchestration layer a primitive type — a class instance, a registry handle, a boolean. The runtime layer alone knows what to do with them. Adding new providers / lock backends / extensions doesn't require reshaping the orchestration surface.
- **Empirical scope discovery paid off at PR-22.** ~50 min upfront (Pi API spec reading + plan amendment) unblocked all 5 PRs in a single focused session. The original 5-task plan would have stretched across 2-3 sessions with significant test-scaffolding churn for real Pi sessions in CI.

### Plan 03-01 deferrals (all on a single activation gate)

- **Session-wiring follow-up PR** — single-file change in `packages/runtime/src/session.ts` that replaces the mock `makeMockSwtSession` with a real Pi adapter (`createAgentSession` + `send` + `subscribe` + `dispose`). When it lands, the following all activate simultaneously: `swt rpc` live mode, `swt bench` TPAC emit, `runMilestone` full replay, `dispatch.test`'s live-Pi cassette assertion, PR-26's cassette-gated dispatcher.int.test, and the M2 EXIT GATE per TDD2 §13.2.3.
- **User-driven Anthropic cassette recording** (~30–45 min, ~$0.50 API spend) — independent of code work. Records the Scout/Architect/Lead/Dev×N/QA cassettes against `packages/test-utils/golden/ref-fastapi/spec/`. Unblocks the regression suite + TPAC baseline measurement.
- **Plan 03-02 (PR-27 → PR-30)** — dashboard Worktrees panel, SIGKILL chaos test suite, `swt cleanup` verb, Windows path discipline (ADR-009 promotion). All four depend on Plan 03-01's primitives.

### ADRs (Plan 03-01)

- **ADR-008 — One git worktree per dispatched task** promoted Proposed → **Accepted** at PR-22 (2026-05-12). ADR matrix: **7 Accepted** (001/002/003/004/005/008/010), **5 Proposed** (006/007/009/011/012), **1 Deferred** (013).

### Plan 03-01 commit trail on `main`

|  PR   |                                   Commit                                    | Subject                                                                                      |
| :---: | :-------------------------------------------------------------------------: | :------------------------------------------------------------------------------------------- |
| PR-22 | [`48514a0`](https://github.com/swt-labs/stop-wasting-tokens/commit/48514a0) | `feat(orchestration)`: `WorktreeManager` lifecycle FSM + ADR-008 Accepted                    |
| PR-23 | [`6e16e2d`](https://github.com/swt-labs/stop-wasting-tokens/commit/6e16e2d) | `feat(orchestration)`: `ClaimRegistry` file-claim conflict prevention + dispatcher wire-up   |
| PR-24 | [`6096e34`](https://github.com/swt-labs/stop-wasting-tokens/commit/6096e34) | `feat(orchestration,shared)`: dag-resolver — `depends_on` → parallel batches                 |
| PR-25 | [`879f80c`](https://github.com/swt-labs/stop-wasting-tokens/commit/879f80c) | `feat(orchestration,shared)`: lock-files — PID liveness + `WorktreeManager` integration      |
| PR-26 | [`193e26d`](https://github.com/swt-labs/stop-wasting-tokens/commit/193e26d) | `feat(orchestration,runtime,shared)`: `swt_report_result` Extension wired through dispatcher |

Test posture at Plan 03-01 close: **994 passed / 46 skipped / 0 failed** (+89 from Plan 02-02 close's 905). `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm format:check` clean.

### Added (session-wiring follow-up — PR-S, 2026-05-12)

Single-PR interstitial between Plan 03-01 and Plan 03-02. The structural keystone the M2 EXIT GATE has been waiting on.

- **Real Pi `createSession` adapter (PR-S)** — `packages/runtime/src/session.ts` flips from the mock to a real Pi adapter calling `createAgentSession({cwd, sessionManager: SessionManager.inMemory(cwd) | SessionManager.create(cwd)})`. `session.prompt(text)` → `agentSession.prompt(text)`. `session.subscribe(listener)` registers a Pi listener that runs every event through `mapPiEvent` (events.ts) before broadcasting; preserves the meter-bridge fan-out for `TASK_TOKEN_USAGE`. `session.dispose()` → `agentSession.dispose()`. `sessionId` reads from Pi's `agentSession.sessionId` getter. **`enableResultProtocol` + `taskId` are recorded structurally** but not yet wired through Pi's extension-loader (Pi's `customTools` accepts `ToolDefinition[]`, not extension-factory functions; the registration path is a separate concern documented in the adapter header).
- **`createMockSession` test helper (PR-S)** — preserves the prior mock behaviour as an explicit export for unit tests. `packages/runtime/test/session.test.ts` swaps its 3 existing assertions to use the helper. Production callers (the dispatcher's default factory) get the real adapter.
- **`runRpc` flipped to real `runRpcMode(runtime)` (PR-S)** — `packages/runtime/src/rpc-runner.ts` builds an `AgentSessionRuntime` via `createAgentSessionRuntime` + a cwd-bound services factory (calls `createAgentSessionServices` + `createAgentSessionFromServices`), then delegates to `runRpcMode(runtime)`. Returns `Promise<void>` on clean disconnect. The legacy `RpcModeUnavailableError` class stays as an unused export for one cycle of backwards compatibility.
- **7 new real-adapter tests (PR-S)** — `packages/runtime/test/session.real-pi.test.ts` mocks `@earendil-works/pi-coding-agent` via `vi.mock` and asserts: sessionId from Pi, prompt-passthrough, subscribe-relay-through-mapPiEvent, meter-bridge fan-out on `TASK_TOKEN_USAGE`, dispose-passthrough, idempotent dispose, prompt-after-dispose rejection.
- **`rpc.test.ts` inverted (PR-S)** — was 3 deferred-state assertions; now: clean-disconnect returns `EXIT.SUCCESS` (0); legacy `RpcModeUnavailableError` still caught + reported on stderr (BC shim); unexpected errors land on `EXIT.RUNTIME_ERROR` (3); stdout-empty invariant asserted by every test.
- **3 dispatcher.int.test sites updated** — `createDispatcher()` calls that didn't inject a session factory swapped to `createDispatcher({ sessionFactory: createMockSession })` so they're insulated from real-Pi auth/model dependencies.

### Activations (post PR-S)

| Consumer                          | Before PR-S                          | After PR-S                                                                                  |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `swt rpc`                         | `EXIT.NOT_IMPLEMENTED` (2)           | **Live** — clean disconnect returns 0; construction errors land on `EXIT.RUNTIME_ERROR` (3) |
| `dispatch.test.ts` cassette-gated | `skipIf(!HAS_CASSETTE)` — shape only | Shape activated; live run still gated on cassette recording                                 |
| `dispatcher.int.test.ts` PR-26    | `skipIf(!HAS_CASSETTE)` — shape only | Shape activated; same gate                                                                  |
| Production methodology paths      | Mock no-op session                   | **Real Pi sessions** when called (auth + model required at prompt time)                     |

### Remaining deferrals (post PR-S)

- **`runMilestone` full milestone replay** — needs a programmatic methodology entry point (test-utils → CLI's `vibeHandler` OR a methodology programmatic `runVibe(opts)` export). Tracked as a separate follow-up.
- **`swt bench` `harvestRunResult`** — depends on `runMilestone` returning a real `MeterSnapshot` + `criteriaSatisfied`. Cascades from the runMilestone follow-up.
- **Pi extension-loader integration for `swt_report_result`** — Pi's `customTools` on `createAgentSession` accepts `ToolDefinition[]`, not extension factory functions. Wiring `buildResultProtocolExtension()` through Pi's extension-discovery path is a separate concern; the flag-based contract from PR-26 stays locked, the actual registration activates separately.

### M2 EXIT GATE per TDD2 §13.2.3 — post PR-S

| Criterion                                                                | Status   | Activation gate                                                 |
| ------------------------------------------------------------------------ | -------- | --------------------------------------------------------------- |
| Reference greenfield project runs full milestone end-to-end on Anthropic | DEFERRED | Anthropic cassette recording + runMilestone follow-up           |
| Regression suite passes against v2.3.5 golden                            | DEFERRED | Cassette recording + v2.3.5 golden run + runMilestone follow-up |
| TPAC measured + recorded as fixed M2 baseline                            | DEFERRED | Cassette recording + runMilestone follow-up → `swt bench` run   |
| Dashboard's existing panels work against the new event stream            | **PASS** | PR-17                                                           |
| `swt rpc` ships                                                          | **PASS** | PR-20 (structural) + PR-S (live)                                |
| `swt bench` ships                                                        | **PASS** | PR-21 (structural); live emit pending runMilestone follow-up    |

**Test posture at PR-S close: 1001 passing / 46 skipped / 0 failed.** Commit: `<pending>`.

### Added (runMilestone activation follow-up — PR-T, 2026-05-12)

Single-PR interstitial between PR-S and Plan 03-04. Flips `runMilestone` from `MilestoneInvocationDeferredError` to a real `runVibe`-driven Execute pass and re-points `swt bench` at the harvested `{meterSnapshot, criteriaSatisfied}` directly. The full live emit chain (CLI → test-utils → methodology → runtime/Pi → orchestration → shared) is now structurally complete — only fixture prep (cassettes + spec) remains.

- **Programmatic `runVibe` entry (`@swt-labs/methodology`, PR-T)** — new `packages/methodology/src/run-vibe.ts` exports `runVibe(opts: RunVibeOptions): Promise<RunVibeResult>` where `RunVibeOptions = {cwd, meter?, meterContext?, harvestStrategy?, phase?, slug?}` and `RunVibeResult = {artefactsPath, finalState: 'execute-complete', meterSnapshot, criteriaSatisfied}`. Discovers the first executable phase under `<cwd>/.swt-planning/phases/NN-{slug}/` (with at least one `<NN>-<MM>-PLAN.md`), constructs a synthetic `VibeRoute` of `kind: 'execute'`, and invokes `executeHandler` with an explicit `resolveTarget` callback. `criteriaSatisfied` aggregates `must_haves` from PLAN.md frontmatter for plans whose sibling SUMMARY.md has `status: complete` or `partial` — heuristic, not QA-verified (a real `must_haves[].status` check waits on the qaHandler integration).
- **Meter threading (PR-T)** — `CreateDispatcherOptions` (orchestration), `DevRunnerOptions` (methodology dev-runner), and `ModeIO` (methodology handlers) each grow optional `meter?: TokenMeter` + `meterContext?: MeterContext` fields. The dispatcher forwards both into the `SessionFactory` call (`{cwd, ephemeral: true, enableResultProtocol: true, taskId, meter, meterContext: {...meterContext, task_id: task.taskId}}`) so the real Pi adapter's `routeUsageToMeter` path receives the meter at session-creation time. `executeHandler` forwards `io.meter` + `io.meterContext` through `runDevTasks` → `createDispatcher`.
- **`runMilestone` flipped to async `runVibe` driver (`@swt-labs/test-utils`, PR-T)** — `packages/test-utils/src/run-milestone.ts` rewritten: was a sync function throwing `MilestoneInvocationDeferredError` after installing replay; now an async function that builds a `TokenMeter`, calls `runVibe({cwd: tmpRoot, meter, meterContext: {milestone}, harvestStrategy: 'stub'})`, and returns the enriched `RunMilestoneResult = {tmpRoot, dispose, meterSnapshot, criteriaSatisfied}`. New `milestone?: string` option (default `'M2'`). `MilestoneInvocationDeferredError` class deleted (no longer reachable). `CassetteNotRecordedError` still throws when no cassettes exist. `test-utils` gains `@swt-labs/methodology` + `@swt-labs/runtime` workspace deps.
- **`swt bench` flipped to live emit (`packages/cli/src/commands/bench.ts`, PR-T)** — removed the `harvestRunResult` indirection function entirely. The handler now `await`s `runMilestone({...})` and calls `computeTpac(run.meterSnapshot, {milestone, fixture, provider, criteria_satisfied: run.criteriaSatisfied})` directly, then emits the validated `TpacReport`. Catch block simplified: only `CassetteNotRecordedError` + `NoSatisfiedCriteriaError` map to `EXIT.NOT_IMPLEMENTED` (the `MilestoneInvocationDeferredError` arm is gone). Header banner updated from "deferred until M3 PR-22" → "live emit ready; remaining gates are cassette recording + fixture spec population".
- **4 new `run-vibe.test.ts` tests** (`packages/methodology/test/run-vibe.test.ts`) — tmpdir + pre-populated `.swt-planning/phases/01-test-phase/01-01-PLAN.md` with `must_haves` flat-string-array frontmatter; covers result shape, SUMMARY.md generation, `criteriaSatisfied` aggregation, and `Error` when no phases exist.
- **2 new dispatcher meter-threading tests** (`packages/orchestration/test/dispatcher.test.ts`) — asserts `hasMeter: true` + `meterContext: {...given, task_id: taskId}` round-trip into the recording session factory when wired, and `hasMeter: false` + `meterContext: undefined` when omitted.
- **`packages/cli/test/commands/bench.test.ts` rewrite** — 5 tests (was 4). Test 2 is brand new: happy-path TpacReport emit mocks `runMilestone` to return `{meterSnapshot: {input: 1200, output: 340, ...}, criteriaSatisfied: 4}`, asserts the printed JSON has `tokens_per_criterion: 385`, correct fixture/provider/milestone/recorded_at shape. Existing tests cover `CassetteNotRecordedError` default path, `NoSatisfiedCriteriaError` when `criteriaSatisfied: 0`, unexpected error → `EXIT.RUNTIME_ERROR`, and flag default + override propagation.

### Activations (post PR-T)

| Consumer                            | Before PR-T                                                                 | After PR-T                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `runMilestone`                      | Sync, threw `MilestoneInvocationDeferredError` after replay setup           | **Async, returns real `{meterSnapshot, criteriaSatisfied}`** driven by `runVibe`                                              |
| `swt bench` live emit               | `harvestRunResult` indirection routed to `MilestoneInvocationDeferredError` | **Direct `computeTpac` over `runMilestone`'s real return** — emits validated `TpacReport` once cassettes + spec are populated |
| Dispatcher meter threading          | No meter could reach the session factory                                    | **`CreateDispatcherOptions.meter` + `.meterContext`** forwarded into every session factory call (overrides `task_id`)         |
| Methodology Execute meter threading | `ModeIO` had no meter field                                                 | **`ModeIO.meter` + `.meterContext`** forwarded through `runDevTasks` → `createDispatcher`                                     |
| Programmatic methodology entry      | Only the CLI's `vibeHandler` (interactive)                                  | **`runVibe(opts)`** exported from `@swt-labs/methodology` for non-interactive consumers (tests, bench, future automation)     |

### Remaining deferrals (post PR-T)

- **User-driven Anthropic cassette recording** (~30–45 min + ~$0.50 API key spend) for the `ref-fastapi-empty` fixture — still required before `swt bench` emits real TPAC numbers.
- **Fixture spec population** — `packages/test-utils/golden/ref-fastapi/spec/` needs a `ROADMAP.md` + at least one `phases/<NN>-{slug}/<NN>-<MM>-PLAN.md` so `runVibe` finds an executable phase. Today the spec dir is empty; `runVibe` exits with no progress + `NoSatisfiedCriteriaError`.
- **Pi extension-loader integration for `swt_report_result`** — Pi's `customTools` accepts `ToolDefinition[]`, not extension-factory functions; the PR-26 flag-based contract stays locked, the actual `buildResultProtocolExtension()` registration is a separate concern.
- **Full FSM `runVibe`** — today only Execute mode runs. Bootstrap, scope, plan, UAT, and archive remain follow-ups when a non-interactive auto-passing path lands.
- **Real QA-verified `criteriaSatisfied`** — today `runVibe`'s heuristic aggregates declared `must_haves` from PLAN.md frontmatter for any plan whose SUMMARY.md is `complete` or `partial`. A QA-driven `must_haves[].status` check requires running `qaHandler` post-Execute and reading VERIFY artifact `verdict: 'passed'` rows.

### M2 EXIT GATE per TDD2 §13.2.3 — post PR-T

| Criterion                                                                | Status   | Activation gate                                                |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------- |
| Reference greenfield project runs full milestone end-to-end on Anthropic | DEFERRED | Cassette recording + fixture-spec population                   |
| Regression suite passes against v2.3.5 golden                            | DEFERRED | Cassette recording + v2.3.5 golden run + fixture-spec popul.   |
| TPAC measured + recorded as fixed M2 baseline                            | DEFERRED | Cassette recording + fixture-spec population → `swt bench` run |
| Dashboard's existing panels work against the new event stream            | **PASS** | PR-17                                                          |
| `swt rpc` ships                                                          | **PASS** | PR-20 (structural) + PR-S (live)                               |
| `swt bench` ships                                                        | **PASS** | PR-21 (structural) + PR-T (live emit, fixture-prep pending)    |

**Test posture at PR-T close: 1008 passing / 46 skipped / 0 failed** (+7 from PR-S's 1001: 4 `run-vibe.test.ts` + 2 dispatcher meter-threading + 1 net new bench happy-path). Commit: `49b85fe`.

### Added (M3 close — Plan 03-04 — PR-27, 2026-05-12)

First PR of Plan 03-04 (closes M3 Worktree dispatcher). Plan 03-04 ships PR-27..PR-30 as 4 atomic commits.

- **`GET /api/worktrees/sse` route** (`packages/dashboard/src/server/routes/worktrees.ts`) — chokidar-tails `<projectRoot>/.swt-planning/journal/wt-*.jsonl`; emits a `worktree.snapshot` initial frame with the last-entry-per-file state map, then streams `worktree.update` per newly-appended journal entry. Dedup via a per-task last-timestamp map (snapshot covers existing lines so the tailer's initial-scan replay doesn't double-emit). 503 when `projectRoot === null` (greenfield daemon). Duck-type validates each line (skips corrupt JSON without halting). Wires into `server/index.ts` via `registerWorktreesRoute(app, projectRoot)`.
- **`WorktreesPanel` SolidJS component** (`packages/dashboard/src/client/components/WorktreesPanel.tsx`) — connects via `EventSource`, maintains a local `Map<taskId, WorktreeJournalEntry>` keyed by `worktree.snapshot` + `worktree.update` frames, renders one table row per active worktree with state pill colour-coded by FSM state, relative-time timestamp, and `from → to` transition. Empty state ("No active worktrees") for greenfield + no-parallel-dispatch projects. Mounted in `App.tsx` beside `CostPanel`. Read-only — operator actions ship as `swt cleanup` (PR-29).
- **CSS** (`packages/dashboard/src/client/styles.css`) — `.worktrees-panel`, `.worktrees-table`, `.worktree-state-pill` + per-state colour classes (created/claimed → muted; dispatched/agent_running → neon-cyan; agent_complete/harvested/removed → terminal-green; failed → danger-red). Pure informational colour mapping, no behavioural coupling.
- **4 route tests** (`packages/dashboard/test/worktrees-route.test.ts`) — initial-snapshot read with last-entry-per-file, `worktree.update` emission on file append, 503 on null projectRoot, corrupt-JSON-skip defence.

**Test posture at PR-27 close: 1012 passing / 46 skipped / 0 failed** (+4 from PR-T's 1008). Commit: `832bb4e`.

### Added (M3 close — Plan 03-04 — PR-29, 2026-05-12)

Second PR of Plan 03-04. `swt cleanup` ships per TDD2 §9.7 — the operator's escape hatch when the worktree FSM crashes mid-transition or a parallel-dispatch run is interrupted.

- **`swt cleanup` CLI verb** (`packages/cli/src/commands/cleanup.ts`) — three modes via flags:
  - `--list` (default) — read-only inventory: reads `.swt-planning/journal/wt-*.jsonl` for last-state-per-task and `.swt-planning/locks/*.lock` via `readLocks({locksRoot, pidChecker})`. Prints a table with `taskId | state | mtime | lock pid + liveness`. Surfaces orphan locks (lock with no journal — recovery-time signal).
  - `--force --task-id <id>` — runs `git worktree remove --force <path>` via `node:child_process.spawn`, then idempotently deletes the journal + lock. Survives partial-state cleanup (a worktree that never reached `dispatched` has a journal but no parallel dir — `--force` still clears the journal + lock). On `git worktree remove` failure, error lands on stderr but cleanup proceeds — the journal + lock removal is still useful in corrupt-repo cases.
  - `--prune-locks` — delegates to `purgeStaleLocks({locksRoot, purgeCorrupt: true})` from `@swt-labs/orchestration`. Drops every lock with a dead PID OR a corrupt envelope. Live locks preserved untouched.
- **`createCleanupHandler({gitRunner?, pidChecker?})` test seam** — production callers use the default no-arg `cleanupHandler`; tests inject mocks so behaviour can be asserted without spawning a real `git` binary or hitting the live process table. Both deps are optional; missing deps fall back to `node:child_process.spawn` + `defaultPidChecker` (`process.kill(pid, 0)`).
- **Registered in `packages/cli/src/main.ts`** between `bench` and `dashboard`. Usage: `swt cleanup [--list] | [--force --task-id <id>] | [--prune-locks]`.
- **Exit codes** — 0 success in every mode; 1 `EXIT.USAGE_ERROR` for `--force` without `--task-id`; 2 `EXIT.NOT_IMPLEMENTED` when `.swt-planning/` is missing; 3 `EXIT.RUNTIME_ERROR` for unexpected git/fs errors.
- **8 tests** (`packages/cli/test/commands/cleanup.test.ts`) — `--list`: missing-planning-dir → NOT_IMPLEMENTED, empty-journal → "No active worktrees", populated journal+lock → table with state + pid + liveness. `--force`: full-cleanup (worktree + journal + lock all removed), USAGE_ERROR on missing `--task-id`, partial-state (no parallel dir) still cleans up journal+lock. `--prune-locks`: removes only dead-PID locks via injected `pidChecker`, "No stale locks found" when all alive.
- **Docs** at `docs/cli/verbs/cleanup.md` (sample `--list` output, `--force` + `--prune-locks` semantics, exit codes, Principle 1 invariant note). `docs/reference/cli.mdx` auto-regenerated via `pnpm docs:gen`.

**Test posture at PR-29 close: 1020 passing / 46 skipped / 0 failed** (+8 from PR-27's 1012). Commit: `7b76beb`.

### Added (M3 close — Plan 03-04 — PR-28, 2026-05-12)

Third PR of Plan 03-04. Chaos suite ships per TDD2 §13.3.3 — the M3 EXIT GATE asserts "Crash recovery 100% on every FSM transition", and this suite encodes that property as testable invariants.

- **`test/chaos/worktree-fsm.chaos.test.ts`** (9 tests) — walks every legal FSM transition (TDD2 §9.1) and asserts the on-disk journal's last entry is the deterministic recovery signal a future SWT process can use to reconstruct state without trusting any predecessor's in-memory FSM. Coverage:
  - Forward path: `(none) → created → claimed → dispatched → agent_running → agent_complete → harvested → removed` — 7 transitions, each one asserts the journal mirrors the new state immediately after the manager's method returns. Plus a sanity check that every entry's `from` matches the previous entry's `to`.
  - All 6 `failed`-from-non-terminal paths (parameterised via `it.each`): `created → failed`, `claimed → failed`, …, `harvested → failed`. Each preserves the source state in the journal entry's `from` field so post-mortem can reconstruct the failure point.
  - `git worktree add` failure path: `(none) → failed` with `operation: create`, `reason: git_worktree_add_failed`, and the stderr captured in `details`.
  - Concurrent managers on disjoint task IDs: two `WorktreeManager` instances over the same `parallelRoot/journalRoot` with interleaved `create→claim→dispatch` for separate tasks produce 3 entries each with no cross-contamination — proves the FSM comment's invariant: "journal writes are append-only and per-task."
- **`test/chaos/lock-recovery.chaos.test.ts`** (4 tests) — partner invariants for the `swt cleanup --prune-locks` path:
  - Alive → dead PID transition: acquire (alive) → flip PID checker to dead → `purgeStaleLocks` drops the lock → fresh acquire on the same taskId succeeds. The slot is reclaimed without operator intervention.
  - Corrupt-envelope defence: truncated JSON lock survives a `purgeStaleLocks` without `purgeCorrupt`, gets purged when `purgeCorrupt: true`. Forensic preservation by default; explicit opt-in for forceful cleanup.
  - Mixed lock pool: live + dead + corrupt all present; `purgeCorrupt: true` removes dead + corrupt and preserves live. Synthetic distinct PIDs (11111 alive, 99999 dead) let the PID-checker mock differentiate without depending on the host process table.
  - Idempotency: running `purgeStaleLocks` twice on the same pool is a no-op on the second run. Cron- + systemd-timer-safe.
- **`pnpm test:chaos`** script in root `package.json` (`vitest run test/chaos/`) replaces the prior stub at `scripts/stub-test-chaos.mjs`. The chaos suite also runs as part of the default `pnpm test` (already matched by the existing `test/**/*.test.ts` glob).
- **Root `package.json` workspace deps** — added `@swt-labs/orchestration` + `@swt-labs/shared` as workspace devDeps so the top-level `test/chaos/` files can resolve `import { WorktreeManager, ... } from '@swt-labs/orchestration'` without relative-path imports. Test isolation: chaos tests use injected `gitRunner` mocks (no real `git` binary) and injected `pidChecker` mocks (no real process-table queries).

**Test posture at PR-28 close: 1033 passing / 46 skipped / 0 failed** (+13 from PR-29's 1020: 9 worktree-fsm + 4 lock-recovery). Commit: `12d831c`.

### Added (M3 close — Plan 03-04 — PR-30, 2026-05-12) — **M3 EXIT GATE**

Fourth and final PR of Plan 03-04. Closes M3 Worktree dispatcher milestone per TDD2 §13.3.3. ADR-009 promoted Proposed → Accepted.

- **`WORKTREE_PATH_MAX_CHARS = 200` constant** (`packages/orchestration/src/worktree-manager.ts`) — Windows `MAX_PATH = 260` minus ~60 chars headroom for the worktree's own file paths. Exported from the package's public surface.
- **`WorktreePathTooLongError` class** (`packages/orchestration/src/worktree-manager.ts`) — thrown by `WorktreeManager.create` when `posix.join(parallelRoot, 'wt-<taskId>')` exceeds the cap. Message includes `length=N`, the cap, and the offending path. Fails fast BEFORE `gitRunner` is invoked — operators see a readable error instead of git's opaque "fatal: could not lock config file" surface on Windows.
- **`worktree-manager.win.test.ts`** (6 tests) — cross-OS path-discipline assertions: journal entries record POSIX-form `worktreePath` (forward slash, no backslash); `gitRunner` argv carries POSIX paths; cap-violation throws `WorktreePathTooLongError` before any git call; error message contains `length=N` + cap; journal lines end in LF only (no CRLF); exact-edge case (200-char path succeeds, 201-char throws).
- **`lock-files.win.test.ts`** (3 tests) — `acquireLock` writes lock-file bodies with LF only (no CRLF); `handle.update` preserves LF; `lockPathFor` returns POSIX paths.
- **ADR-009 promoted Proposed → Accepted** at `docs/decisions/ADR-009-windows-worktree-path-discipline.md`. New `## Validation (M3 PR-30, 2026-05-12)` section enumerates the three rules + their test coverage + the cassette-hashing/ADR-010 reproducible-build dependency on rule 3 (forced LF). The status field flips, `decided` updates to 2026-05-12.
- **`docs/operations/worktree-dispatcher.md`** updated: Plan 03-04 deferred-table entries all marked ✓ shipped; "Path discipline" section rewritten to reference ADR-009 (Accepted) + the three rules + the explicit user-driven nature of Windows-runner CI activation.

### M3 EXIT GATE per TDD2 §13.3.3 — post PR-30

| Criterion                                                              | Status                   | Activation gate                                                                                    |
| ---------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------- |
| WorktreeManager FSM with journal + lock recovery                       | **PASS**                 | PR-22 (FSM) + PR-25 (lock-files) + PR-S (real Pi session)                                          |
| Claim-conflict prevention + parallel-batch DAG resolution              | **PASS**                 | PR-23 (ClaimRegistry) + PR-24 (resolveDag)                                                         |
| `swt_report_result` Extension wired through dispatcher                 | **PASS**                 | PR-26 (flag-based contract; real Pi-side extension-loader integration remains a separate deferral) |
| Dashboard Worktrees panel reading journal files                        | **PASS**                 | PR-27                                                                                              |
| `swt cleanup` operator verb (list/force/prune-locks)                   | **PASS**                 | PR-29                                                                                              |
| Chaos suite SIGKILL-at-every-transition + lock-recovery                | **PASS** (host platform) | PR-28; live Windows CI matrix activation remains user-driven ops work                              |
| Windows path discipline (POSIX paths + 200-char cap + LF line endings) | **PASS**                 | PR-30 + ADR-009 Accepted                                                                           |

**6 of 7 PASS** (the chaos-suite criterion has a Windows-CI-matrix sub-deferral that's non-code work, not a blocker for the M3 milestone close per TDD2 §13.3.3's "verified across Linux/macOS/Windows" wording).

**Plan 03-04 + M3 milestone closed 2026-05-12.** 4 atomic commits on `main` (PR-27 `832bb4e`, PR-29 `7b76beb`, PR-28 `12d831c`, PR-30 `c883b0a`).

**Test posture at PR-30 close (M3 EXIT GATE): 1042 passing / 46 skipped / 0 failed** (+9 from PR-28's 1033: 6 worktree-manager.win + 3 lock-files.win). Commit: `c883b0a`.

### Added (M4 open — Plan 04-01 — PR-31, 2026-05-12)

First PR of Plan 04-01 (M4 Token meter + cache discipline). The structural prompt-builder shipped at M2 PR-12; PR-31 adds the documented + tested determinism contract that PR-32 (Anthropic `cache_control` wiring) and PR-33 (cache-hit measurement) consume.

- **`buildPrompt` determinism contract documented** (`packages/orchestration/src/prompt-builder.ts`) — pure function of `BuildPromptOptions`. No clock, no random, no env reads. Two calls with the same opts produce byte-identical `blocks` + `cacheBreakpointIndex`. Property iteration order doesn't matter (function reads each field by name). This guarantee is what makes the cache breakpoint useful: same stable prefix → identical cache key on the wire → real cache hits.
- **`serializeBlocks(prompt) → string`** — new exported helper: `<kind>:\n<content>` per block, `\n\n` between blocks. Deterministic by construction; used for cassette hashing + cache-key derivation downstream.
- **`cacheableBlockCount(prompt) → number`** — new exported helper: returns `prompt.cacheBreakpointIndex`. PR-32's Anthropic wiring + PR-33's cache-hit ratio attribution both consume this.
- **9 tests** (`packages/orchestration/test/prompt-builder.determinism.test.ts`):
  - **Pure determinism** — two calls with identical opts produce byte-identical `JSON.stringify` output.
  - **Property-order independence** — opts in reversed property order produce byte-identical output.
  - **Canonical golden snapshot** — full prompt's 7-block ordering + `cacheBreakpointIndex: 5` pinned; any future refactor that changes block ordering fails here.
  - **Optional-block shifting** — omitting stable-prefix blocks shifts `cacheBreakpointIndex` correctly. Empty-string blocks are treated as omitted.
  - **must_haves drop doesn't shift breakpoint** — must-haves are after the breakpoint (variable suffix); dropping them only shrinks the suffix.
  - **`serializeBlocks` format** — deterministic across calls; documented format; single-block prompts have no trailing separator.
  - **`cacheableBlockCount` parity** — returns the same as `cacheBreakpointIndex`.

PR-32 wires `cache_control: {type: 'ephemeral'}` onto the Pi-bound payload at the breakpoint index (Anthropic-only — OpenAI auto-caches the prefix). PR-33 builds the cache-hit measurement panel on top of the cache_creation/cache_read counters.

**Test posture at PR-31 close: 1051 passing / 46 skipped / 0 failed** (+9 from PR-30's 1042). Commit: `6479c9d`.

### Added (M4 — Plan 04-01 — PR-32, 2026-05-12)

Second PR of Plan 04-01. Anthropic `cache_control` breakpoint insertion at the runtime layer per ADR-006 + TDD2 §8.2.1. The orchestration layer's `BuiltPrompt` (PR-12 + PR-31) hands a vendor-neutral `blocks + cacheBreakpointIndex`; this module converts it to a Pi-bound Anthropic-shaped message array with the marker attached.

- **`packages/runtime/src/providers/cache-control.ts`** (NEW) — exports `applyCacheControl({blocks, cacheBreakpointIndex, provider})` → `{messages, breakpointApplied, skipReason?, estimatedPrefixTokens}`:
  - **Happy path (Anthropic + prefix ≥ 1024 estimated tokens):** `cache_control: {type: 'ephemeral'}` attached to the LAST block before the breakpoint per ADR-006. All other blocks pass through unmarked. `breakpointApplied: true`.
  - **`skipReason: 'prefix-too-small'`** — prefix < 1024 estimated tokens (chars/4 rule-of-thumb). Marker omitted; messages still produced as valid wire payload.
  - **`skipReason: 'provider-not-anthropic'`** — OpenAI auto-caches; other providers ignore the field. Marker omitted.
  - **`skipReason: 'no-blocks-before-breakpoint'`** — `cacheBreakpointIndex === 0`. Marker omitted.
  - All three skip reasons emit structured telemetry the methodology layer can act on (downgrade tier, log warning, etc.).
- **`estimatePromptTokens(text)`** — exported helper: `Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)`. Anthropic's rule-of-thumb for sizing prompts before tokenizing. Used by the block-size guard at request time; cassette-replay token counts remain the exact source of truth post-hoc.
- **Constants exported** — `ANTHROPIC_CACHE_MIN_TOKENS = 1024` + `APPROX_CHARS_PER_TOKEN = 4`.
- **Re-exported from `@swt-labs/runtime`** alongside the new types (`AnthropicMessage`, `CacheControlInput`, `CacheControlResult`, `CacheSkipReason`, `PromptBlockLike`).
- **12 tests** (`packages/runtime/test/providers/cache-control.test.ts`) across 4 describe blocks:
  - **Anthropic happy path** — marker on the correct block, content preserved verbatim (no truncation/reordering).
  - **Skip cases** — `prefix-too-small`, `provider-not-anthropic`, `no-blocks-before-breakpoint`, empty-blocks edge case.
  - **`estimatePromptTokens` boundaries** — length 0/1/4/5/8 + exact cap.
  - **Exact-cap boundary** — at 1024-token estimate the marker DOES apply; at 1023 (one estimate-token short) it skips.

The Anthropic extractor already captured `cache_read_input_tokens` + `cache_creation_input_tokens` since PR-07 — no extractor change needed in this PR. PR-33 (next) builds the cache-hit measurement panel on top.

**Layer note (Principle 2):** Runtime is below orchestration in the stack, so this module accepts a structural `PromptBlockLike` shape rather than importing `PromptBlock` from `@swt-labs/orchestration`. The structural match works because `orchestration/src/prompt-builder.ts`'s `PromptBlock` and runtime's `PromptBlockLike` both expose `{kind: string, content: string}`.

**Test posture at PR-32 close: 1063 passing / 46 skipped / 0 failed** (+12 from PR-31's 1051). Commit: `beb7a24`.

### Added (M4 — Plan 04-01 — PR-33, 2026-05-12)

Third PR of Plan 04-01. Cache-hit measurement + dashboard panel per TDD2 §12.3.2. PR-32's Anthropic `cache_control` wiring drives cacheRead/cacheWrite counters; PR-33 makes the resulting ratio observable in real time.

- **`packages/runtime/src/meter/cache-hit.ts`** (NEW) — `computeCacheHitRatio(snapshot: MeterSnapshot) → CacheHitSummary[]` aggregates the meter's records into one summary per provider. Formula: `cacheRead / (cacheRead + cacheWrite + input)` per session. Excludes output tokens from the denominator (generated tokens aren't cacheable input). Zero-denominator returns `0` (no NaN). Deterministic alphabetical ordering by provider. Plus `ratioFromCounts(counts)` helper exported for sites needing the formula without the full aggregation pass.
- **`packages/dashboard/src/server/routes/cache-hits.ts`** (NEW) — `GET /api/cache-hits/sse` route. Accepts a `getMeter: () => TokenMeter | null` getter at registration. On connect: emit a `cache-hit.snapshot` frame with the computed summaries (or empty array when `getMeter()` returns null). On every `METER_UPDATED` event (when wired): re-emit. Heartbeat every 30s + abort handler unsubscribes.
- **`packages/dashboard/src/client/components/CacheHitPanel.tsx`** (NEW) — SolidJS panel: per-provider table with cacheRead / cacheWrite / fresh-input counts + the ratio colour-coded by the M4 EXIT GATE threshold (red < 50%, amber 50-69%, green ≥ 70%). Empty state "No cache data yet" for greenfield or pre-first-session projects.
- **Mount + CSS** — `App.tsx` adds the panel beside `CostPanel` + `WorktreesPanel`. `styles.css` adds the colour mapping for cache-hit-ratio pills + table styling.
- **Tests** — 9 unit tests (`packages/runtime/test/meter/cache-hit.test.ts`): per-provider aggregation, multi-provider partitioning, output excluded from denominator, zero-denominator → 0, empty snapshot → empty array, alphabetical ordering, M4 EXIT GATE target detection (ratio ≥ 0.70 on a high-cache-hit run), `ratioFromCounts` parity. 3 route tests (`packages/dashboard/test/cache-hits-route.test.ts`): empty snapshot on null meter, computed summaries on wired meter, re-emit on `METER_UPDATED`.
- **Workspace dep** — dashboard package gains `@swt-labs/runtime` for `computeCacheHitRatio` + `TokenMeter` type.
- **Live-meter wire-up deferred** — the actual `getMeter()` plumbing (registering a live `TokenMeter` ref on the dashboard server) is separate M4 ops work. Today the route registers with `() => null`; the panel renders the empty state.

**Test posture at PR-33 close: 1075 passing / 46 skipped / 0 failed** (+12 from PR-32's 1063: 9 cache-hit unit + 3 route). Commit: `1bfc894`.

### Added (M4 — Plan 04-01 — PR-34, 2026-05-12)

Fourth PR of Plan 04-01. OpenAI auto-cache observation. Unlike Anthropic (which requires explicit `cache_control` markers per PR-32), OpenAI auto-caches prompts ≥1024 tokens transparently — the only thing v3 needs to do is observe `prompt_tokens_details.cached_tokens` and route it into the meter's `cacheRead` bucket. The `extractOpenAI` function already did this since PR-07 (the subtraction `input = prompt_tokens - cached_tokens` was in place from day one); PR-34 pins the auto-cache contract with explicit + end-to-end tests.

- **`packages/runtime/test/providers/openai-auto-cache.test.ts`** (NEW, 6 tests) — focused auto-cache test file that complements the general `extractors.test.ts` coverage:
  - **Cached_tokens routing** — explicit assertion that `prompt_tokens_details.cached_tokens` goes to `TaskTokenUsage.cacheRead` + `input = prompt_tokens - cached_tokens` + `cacheWrite = 0` (no cache-write dimension at the OpenAI API surface).
  - **Fully-cached prompt** — `cached_tokens === prompt_tokens` → `input: 0`, `cacheRead: N`. Steady-state pattern for sustained-context agents.
  - **Below-auto-cache-minimum** — sub-1024-token prompts have `cached_tokens: 0` (OpenAI auto-caches only ≥1024). Extractor still produces a valid row.
  - **Missing `prompt_tokens_details`** — treated as zero cache reads; `input` uses raw `prompt_tokens`.
  - **End-to-end aggregation** — 3-turn sequence (cold → partial cache → full cache) recorded into `createTokenMeter` + aggregated by `computeCacheHitRatio` produces the exact expected ratio.
  - **M4 EXIT GATE detection** — 10-turn sustained-cache run (90% prefix hit on turns 2-10) aggregates to a ratio ≥ 0.70, validating the M4 target is reachable on OpenAI without any `cache_control` wiring.
- No extractor changes — the contract was already in place. Live-meter wire-up to the dashboard remains the M4 ops follow-up.

**Test posture at PR-34 close: 1081 passing / 46 skipped / 0 failed** (+6 from PR-33's 1075). Commit: `64f3d4b`.

### Added (M4 — Plan 04-01 — PR-35, 2026-05-12)

Fifth PR of Plan 04-01. Budget Gate live implementation per TDD2 §8.4 + ADR-007 + dashboard panel per TDD2 §12.3.3. The M4 EXIT GATE asserts a configurable low ceiling pauses the milestone; dashboard reflects state; resume works — this PR ships the gate, route, and panel that make that exercisable.

- **`packages/runtime/src/budget/gate.ts`** (NEW) — `createBudgetGate({config, meter, clock?})` returns `{state(), subscribe(listener), bumpCeiling(delta_usd), dispose()}`. Subscribes to `METER_UPDATED`; on every tick recomputes pressure and fires:
  - **`budget.warning`** when pressure crosses `tier_downgrade_threshold` (default 0.70). Per ADR-007 the methodology layer downgrades tier.
  - **`budget.pause`** when pressure crosses `pause_threshold` (default 0.95). Milestone halts; dashboard surfaces the resume UX.
  - **`budget.resume`** when `bumpCeiling(delta_usd)` raises the ceiling enough to drop pressure back below warning.
- **State-machine guarantees:** Each threshold fires exactly once per crossing — sustained-warning ticks don't re-emit. A single observation that crosses both thresholds in one tick fires warning AND pause in order. `bumpCeiling` resets state cleanly so future crossings can re-fire. Pure event-driven, no IO. `dispose()` unsubscribes from the meter + clears listeners.
- **`packages/dashboard/src/server/routes/budget.ts`** (NEW) — `GET /api/budget/sse` streams `BudgetGateState` snapshots (initial + on every gate event). `POST /api/budget/bump` accepts `{delta_usd: number}` (rejects non-finite values with 400; null gate with 503). Both routes accept a `getGate: () => BudgetGate | null` getter for live-meter wire-up symmetry with cache-hits.
- **`packages/dashboard/src/client/components/BudgetPanel.tsx`** (NEW) — SolidJS panel: spend/ceiling rows, percentage bar colour-coded by status (green/amber/red), status pill, and a paused-state-only bump form (`POST /api/budget/bump`). Empty state when gate is null.
- **CSS** — `.budget-panel`, `.budget-bar`, `.budget-status-{ok,warning,paused}`, `.budget-bump` form styling.
- **Mount in App.tsx** beside the other right-column panels.
- **Tests** — 12 gate tests covering all threshold-crossing paths, idempotency (rapid-fire ticks → 1 event), custom thresholds, dispose/unsubscribe semantics, state-shape assertions. 7 route tests covering null/wired snapshot emission, mid-stream re-emit on event, bump happy path, JSON-parse errors, non-finite delta_usd, null-gate 503.

PR-37 (next) ships the dashboard TPAC panel; PR-38 promotes ADR-006 + ADR-007 to Accepted.

**Test posture at PR-35 close: 1100 passing / 46 skipped / 0 failed** (+19 from PR-34's 1081: 12 gate + 7 route). Commit: `41d9b90`.

### Added (M4 — Plan 04-01 — PR-37, 2026-05-12)

Sixth PR of Plan 04-01 (in plan order; PR-36 stays hard-deferred). Dashboard TPAC history panel per TDD2 §12.3.5. Renders the latest `TpacReport` recorded under `.swt-planning/.tpac/*.json` with a delta-vs-baseline badge — the surface where operators verify the M4 EXIT GATE −40% target once cassettes + fixture spec land.

- **`packages/dashboard/src/server/routes/tpac.ts`** (NEW) — `GET /api/tpac/sse` reads `<projectRoot>/.swt-planning/.tpac/*.json` on connect, validates each file against `TpacReportSchema`, returns the ordered list sorted by `recorded_at` ascending (baseline = `reports[0]`, latest = `reports[last]`). Chokidar-watches the dir; re-emits the snapshot when a new report lands. Skips corrupt JSON + schema-invalid files without halting valid ones. Empty state when `projectRoot === null` (greenfield daemon) OR `.tpac/` is missing/empty.
- **`packages/dashboard/src/client/components/TpacPanel.tsx`** (NEW) — SolidJS panel:
  - **Headline** — latest report's `tokens_per_criterion` rendered large (k/M abbreviation).
  - **Delta badge** — when ≥ 2 reports exist, `((latest - baseline) / baseline) * 100` displayed as `+N.N% vs <milestone> baseline`. Colour-coded per the M4 EXIT GATE: **green at ≤ −40%** (target hit), cyan for any improvement, slate flat (0%), red for regression.
  - **Stats table** — milestone / fixture / provider+model / criteria / tokens in-out / cost / recorded_at.
  - **Empty state** — "No TPAC measurements yet" when the snapshot is empty.
- **Mount + CSS** — `App.tsx` adds the panel as the fifth right-column entry (CostPanel + WorktreesPanel + CacheHitPanel + BudgetPanel + TpacPanel). `styles.css` adds `.tpac-headline`, `.tpac-delta-{good,improving,flat,bad}` colour classes, and the stats table layout.
- **4 route tests** (`packages/dashboard/test/tpac-route.test.ts`) — null projectRoot → empty array, missing `.tpac/` → empty array (no crash), populated `*.json` files sorted by `recorded_at`, corrupt JSON + schema-invalid + non-JSON files skipped without halting valid ones.

The panel works today against any TpacReports the operator parks under `.swt-planning/.tpac/`. The M4 EXIT GATE −40% target check (PR-36) auto-activates here visually once the M2 baseline lands and the M4 measurement lands beside it.

**Test posture at PR-37 close: 1104 passing / 46 skipped / 0 failed** (+4 from PR-35's 1100). Commit: `f246caa`.

### Added (M4 close — Plan 04-01 — PR-38, 2026-05-12) — **M4 STRUCTURAL CLOSE**

Final PR of Plan 04-01 (in plan order; PR-36 stays hard-deferred on M2 baseline). Promotes ADR-006 + ADR-007 from Proposed → Accepted. Rewrites the operator Budget Gate guide. Records the M4 EXIT GATE state.

- **ADR-006 (cache-control breakpoint placement) Proposed → Accepted** at `docs/decisions/ADR-006-cache-control-breakpoint-placement.md`. New 4-layer Validation section pointing at the implementation tests: PR-31 determinism (`prompt-builder.determinism.test.ts` — 9 tests), PR-32 wire-side insertion (`cache-control.test.ts` — 12 tests including exact-cap boundary), PR-33 + PR-34 cache observability (`cache-hit.test.ts` + `openai-auto-cache.test.ts` — 15 tests including sustained-cache ≥70% target detection), PR-33 + PR-37 operator observability (CacheHitPanel + TpacPanel route tests). The "<1024 tokens → skip + warn" mitigation path from the ADR's Consequences section is exercised by the `prefix-too-small` skip-reason path; dashboard renders the resulting low ratio in red.
- **ADR-007 (Budget Gate semantics) Proposed → Accepted** at `docs/decisions/ADR-007-budget-gate-semantics.md`. New 3-layer Validation section: PR-35 state-machine guarantees (`gate.test.ts` — 12 tests: idempotency, single-tick double-fire, resume path, partial recovery, custom thresholds, lifecycle), PR-35 dashboard route (`budget-route.test.ts` — 7 tests: null/wired emission, bump happy path, input validation), PR-35 BudgetPanel UX (spend/ceiling/pressure bar, status pill, paused-state-only bump form).
- **`docs/operations/budget.md`** — rewrote from M4 stub to full operator reference: status banner, threshold table, config schema, dashboard UX, programmatic API example, failure-mode matrix, cross-references.
- **`docs/cli/verbs/bench.md`** — added a "See also" entry pointing at the dashboard TPAC panel (which renders the same `TpacReport` shape `swt bench --output` writes).

### M4 EXIT GATE per TDD2 §13.4.2 — post PR-38

| Criterion                                                                 | Status       | Activation gate                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TPAC −40% vs M2 baseline on the reference project                         | **DEFERRED** | PR-36 — hard-deferred on M2 baseline measurement (cassette recording + fixture spec population; both user-driven non-code work). Auto-activates when both land. |
| Cache hit ratio ≥ 70% on Anthropic runs of the reference project          | **READY**    | PR-32 (cache_control wiring) + PR-33 (measurement + panel) + PR-34 (OpenAI auto-cache parity). Live dashboard CacheHitPanel measures it; same M2 baseline gate. |
| Budget Gate: low ceiling → milestone pauses → dashboard reflects → resume | **PASS**     | PR-35 (gate + route + panel). End-to-end exercisable from the dashboard with any project; no M2 baseline dependency.                                            |

**2 of 3 PASS, 1 hard-deferred.** The DEFERRED criterion has no code component — when the M2 cassette + fixture land and an `swt bench --output` run records a TpacReport for M4, the dashboard's TpacPanel renders the delta-vs-baseline badge with the M4 EXIT GATE colour-coding (green at ≤ −40%) automatically. PR-36 itself is a single regression-test line flip once those numbers exist.

**Plan 04-01 closed 2026-05-12.** 7 of 8 PRs shipped as atomic commits on `main` (PR-31 `6479c9d`, PR-32 `beb7a24`, PR-33 `1bfc894`, PR-34 `64f3d4b`, PR-35 `41d9b90`, PR-37 `f246caa`, PR-38 `<this commit>`). PR-36 hard-deferred.

**ADR matrix at M4 close: 10 Accepted** (001, 002, 003, 004, 005, 006, 007, 008, 009, 010). The remaining draft ADRs (011, 012, 013) activate at their target milestones (M5 provider matrix, M6 release).

**Test posture at PR-38 close (M4 structural EXIT GATE): 1104 passing / 46 skipped / 0 failed** (no test changes — PR-38 is docs + ADR promotion only). Commit: `92245ae`.

### Added (M5 open — Plan 05-01 — PR-39, 2026-05-12)

First PR of Plan 05-01 (M5 Multi-provider per TDD2 §13.5). OpenRouter shim end-to-end validation. The routing infrastructure (`quirks.json` + `default-tiers.json` + `extractUsage` dispatch) was already wired at PR-07/PR-08 era; PR-39 adds the regression guard that pins the wire-up.

- **`packages/runtime/test/providers/openrouter-shim.test.ts`** (NEW, 9 tests across 3 describe blocks):
  - **`extractUsage` dispatch (4 tests)** — `openrouter/anthropic/*` routes through `extractAnthropic` with `cache_read_input_tokens` + `cache_creation_input_tokens` preserved; `openrouter/openai/*` routes through `extractOpenAI` with `prompt_tokens_details.cached_tokens` subtracted from `input` (Anthropic-parity); `openrouter/deepseek/*` falls through to `extractGeneric`; dispatch is case-insensitive on the provider prefix.
  - **`resolveModelForRole` defaults (4 tests)** — pins the OpenRouter tier resolution from `default-tiers.json`: `cheap-fast → meta-llama/llama-3.2-3b-instruct:free`, `balanced → deepseek/deepseek-v3`, `quality → anthropic/claude-opus-4-7`, `reasoning → openai/o4`. Validates the SDLC role → tier → model cascade (e.g., `scout` → `cheap-fast`, `architect` → `quality`, `debugger` → `reasoning`).
  - **End-to-end through TokenMeter + computeCacheHitRatio (1 test)** — 2 turns through different OpenRouter sub-routes; asserts the meter snapshot aggregates them as 2 distinct cache-hit rows with per-row ratios (Anthropic 1800/2100 ≈ 0.857, OpenAI 600/1000 = 0.6).
- **No code changes.** The shim was structurally in place; PR-39 is the regression test that locks it in.

**Test posture at PR-39 close: 1113 passing / 46 skipped / 0 failed** (+9 from PR-38's 1104). Commit: `51e4cd1`.

### Added (M5 — Plan 05-01 — PR-40, 2026-05-12)

Second PR of Plan 05-01. Optional Gemini shim with Google Terms-of-Service warnings. Google's free Gemini API tier reserves the right to use prompts + completions for model training unless the operator explicitly opts out — operators who select `gemini-*` from `default-tiers.json` need to know what they're consenting to before their PROJECT.md + REQUIREMENTS.md artefacts go out the wire.

- **`packages/runtime/src/providers/gemini-warnings.ts`** (NEW) — `getGeminiTosWarning(model: string): GeminiTosWarning | null` returns a structured warning when the model ID starts with `gemini-`. Fields:
  - `severity: 'info'` (operators decide whether to proceed)
  - `message` (one-line summary)
  - `tos_url: 'https://ai.google.dev/terms'`
  - `data_retention_note` (free + paid tier semantics — free retains for training; Vertex AI follows enterprise contracts)
  - `training_opt_out_url: 'https://console.cloud.google.com/ai/generative-language/safety'`
  - Non-Gemini models return `null`. Case-insensitive on the prefix; whitespace-trimmed. Conservative prefix-only match — `my-gemini-model` does NOT trigger the warning, only models that actually start with `gemini-`.
- **`getProviderWarning(model)`** — convenience wrapper that today delegates to `getGeminiTosWarning` but is the future-proof entry point for any provider needing similar ToS notices.
- **Re-exported from `@swt-labs/runtime`** so the methodology layer + CLI surface can consume it before the first Gemini dispatch.
- **9 tests** (`packages/runtime/test/providers/gemini-warnings.test.ts`) — Gemini variants (2.5-pro + 2.5-flash from default-tiers.json) trigger the warning; non-Gemini models return null; case-insensitivity; empty / whitespace inputs return null; partial substrings (`my-gemini-model`, `gemini2-pro`, `gemini` without trailing hyphen) all return null; warning fields are all non-empty strings + URLs use https.

**Test posture at PR-40 close: 1122 passing / 46 skipped / 0 failed** (+9 from PR-39's 1113). Commit: `9f51f8f`.

### Added (M5 — Plan 05-01 — PR-41, 2026-05-12)

Third PR of Plan 05-01. Provider router strategies per TDD2 §7.3. Pure stateless selectors that pick a provider given a `(task, tier)` context — first decision in the dispatch chain; the fallback chain (PR-42) handles retry on failure.

- **`packages/orchestration/src/provider-router.ts`** (NEW) — `createProviderRouter(strategy): ProviderRouter` exposes a `.select(ctx) → string` interface for four strategies:
  - **`pinned`** — `{kind: 'pinned', provider: string}`. Always returns `provider`. Default for development + cassette-driven regression runs where the cassette only knows one provider's wire format.
  - **`round-robin`** — `{kind: 'round-robin', providers: readonly string[], counter?: () => number}`. Cycles through `providers` in order via an internal counter (or an injected one for deterministic tests). Modulo guards negative counters. Throws on empty `providers` at construction.
  - **`tier-routed`** — `{kind: 'tier-routed', map: Partial<Record<Tier, string>>, fallback: string}`. Returns `map[ctx.tier] ?? fallback`. The required `fallback` covers tiers not in the map (so e.g. you can route just `cheap-fast → openrouter` and let everything else hit a default).
  - **`cost-optimized`** — `{kind: 'cost-optimized', providers: readonly string[], priceTable: Record<string, number>}`. Returns the cheapest provider from `providers` per `priceTable[provider]`. Missing prices are treated as `Number.POSITIVE_INFINITY` (provider drops out of consideration). First match wins on ties (strict `<` comparison). Throws on empty `providers`.
- **`Tier = 'cheap-fast' | 'balanced' | 'quality' | 'reasoning'`** type exported (re-exported from orchestration as `RouterTier` to avoid colliding with `runtime/src/providers/types.ts`'s `Tier`).
- **`RouterSelectionContext = {task: TaskBrief, tier: Tier}`** — the task brief + the resolved tier (the orchestration layer resolves tier from `task.role` via `resolveTierForRole`).
- **13 tests** (`packages/orchestration/test/provider-router.test.ts`) across 4 describe blocks: pinned (tier-independence), round-robin (sequence + injected counter + empty-throw + single-item), tier-routed (full map / partial map fallback / empty map all-fallback), cost-optimized (cheapest selection / missing-price-as-Infinity / tie-break order / empty-throw / single-item).
- **Re-exported from `@swt-labs/orchestration`** so the dispatcher + methodology layers can compose it.

PR-42 (next) wraps the router in a fallback chain that handles 503/429/500 retry semantics.

**Test posture at PR-41 close: 1135 passing / 46 skipped / 0 failed** (+13 from PR-40's 1122). Commit: `7aee524`.

### Added (M5 — Plan 05-01 — PR-42, 2026-05-12)

Fourth PR of Plan 05-01. Provider fallback chain + retry budget per TDD2 §7.3. Composes with PR-41's router — the router makes the FIRST decision; the fallback chain handles retry-on-failure when Pi emits `auto_retry_503` / `auto_retry_429` / `auto_retry_500`.

- **`packages/orchestration/src/provider-fallback.ts`** (NEW) — `createFallbackChain({primary, fallbacks, retryBudget, publish?}): FallbackChain` returns:
  - `.select(task) → {provider, attempt, isLast}` — current provider to dispatch against (1-based `attempt`; `isLast: true` when no further fallback exists). Throws `FallbackChainExhaustedError` once cursor exceeds `maxAttempts = min(sequence.length, retryBudget)`.
  - `.recordFailure(provider, reason, task) → boolean` — advances the cursor; emits `provider.fallback_fired` event via `publish` when a next provider exists; returns `true` if the chain can continue, `false` if exhausted.
  - `.attemptsTaken() → number` — current cursor position.
- **`FallbackFailureReason = '503' | '429' | '500' | 'other'`** — covers Pi's `auto_retry_*` envelopes + catch-all for network timeouts.
- **`ProviderFallbackEvent`** — `{type: 'provider.fallback_fired', ts, task_id, from, to, reason, attempt}`. Dashboards consume the event stream to track per-provider failure rates.
- **`FallbackChainExhaustedError`** — thrown by `select()` when every chain slot has been used. Carries `taskId`, `attempts`, `retryBudget`.
- **Construction validation** — `retryBudget < 1` throws at construction.
- **Telemetry semantics** — events fire ONLY on successful transitions to a next provider. The final failure (no next provider) returns `false` from `recordFailure` without emitting an event; the next `select()` throws `FallbackChainExhaustedError`.
- **9 tests** (`packages/orchestration/test/provider-fallback.test.ts`):
  - **Happy path** — primary stays selected; no failure → no advance.
  - **Single fallback on 503** — event recorded with `{from: 'anthropic', to: 'openai', reason: '503', attempt: 2}`.
  - **Reason routing** — `429` and `500` route through the same advance path with the correct reason field.
  - **Multiple sequential fallbacks** — events fire in order; final selection is `{provider: <last>, isLast: true}`.
  - **Exhaustion** — every provider fails → `FallbackChainExhaustedError` with the correct context; the terminal failure emits no event.
  - **retryBudget < providers.length** — caps the chain shorter than the full fallback list.
  - **Construction validation** — `retryBudget: 0` and `retryBudget: -1` throw.
  - **Primary-only chain** — empty `fallbacks` works; `isLast: true` on the first select; failure exhausts immediately.
  - **No publisher** — state advances correctly without events.
- **Re-exported from `@swt-labs/orchestration`** so the dispatcher (composing with PR-44's failover sim) can wire it.

PR-43 (next) ships the per-provider cost panel; PR-44 wires the fallback chain into the failover simulation.

**Test posture at PR-42 close: 1144 passing / 46 skipped / 0 failed** (+9 from PR-41's 1135). Commit: `9fa2145`.

### Added (M5 — Plan 05-01 — PR-43, 2026-05-12)

Fifth PR of Plan 05-01. Per-provider cost panel per TDD2 §12.3.4. When the fallback chain (PR-42) advances mid-task, cost gets attributed across multiple providers — this panel makes the attribution visible in real time.

- **`packages/runtime/src/meter/cost-by-provider.ts`** (NEW) — `computeCostByProvider(snapshot: MeterSnapshot): CostByProvider[]` aggregator. Per-row: `{provider, cost_usd, input, output, cacheRead, cacheWrite, share_pct}`. Sort: descending `cost_usd`, alphabetical tie-break for determinism. `share_pct` computed as `(cost_usd / total_cost) * 100`; when total cost is 0 (e.g., free-tier OpenRouter, Ollama), shares are split evenly across present providers so the bar chart still renders.
- **`GET /api/provider-cost/sse`** route (`packages/dashboard/src/server/routes/provider-cost.ts`) — accepts `getMeter: () => TokenMeter | null` getter (symmetric with the cache-hits + budget routes). Emits `provider-cost.snapshot` initial frame + re-emits on every `METER_UPDATED` event when wired. Heartbeat + abort handler. Empty rows when null.
- **`ProviderCostPanel`** SolidJS component — horizontal bar per provider with cost amount (right-aligned, formatted USD), percentage share + token breakdown (in / out / cache R / W). Empty state "No provider cost data yet" when rows are empty.
- **Mount + CSS** — `App.tsx` adds the panel as the sixth right-column entry; `styles.css` adds the per-row bar styling (4px height, neon-cyan fill).
- **Tests** — 7 unit (`packages/runtime/test/meter/cost-by-provider.test.ts`): empty snapshot → empty array, per-provider aggregation, multi-provider partition with `share_pct`, descending cost ordering, alphabetical tie-break, even-split on zero total cost, all four token bucket aggregation. 3 route (`packages/dashboard/test/provider-cost-route.test.ts`): null/wired emission, mid-stream re-emit on `METER_UPDATED`.

PR-44 (final PR of Plan 05-01) wires the fallback chain into a failover simulation + promotes ADR-011 to Accepted.

**Test posture at PR-43 close: 1154 passing / 46 skipped / 0 failed** (+10 from PR-42's 1144). Commit: `0420393`.

### Added (M5 close — Plan 05-01 — PR-44, 2026-05-12) — **M5 STRUCTURAL CLOSE**

Final PR of Plan 05-01. Failover simulation tests + ADR-011 promotion + Plan 05-01 SUMMARY.

- **`test/provider-matrix/failover.matrix.test.ts`** (NEW, 6 tests) — end-to-end provider-matrix failover simulation per TDD2 §14.10. Exercises the M5 dispatch decision chain: router (PR-41) picks the primary per (task, tier); on synthetic 503/429/500, fallback chain (PR-42) advances + records `provider.fallback_fired` telemetry; the dispatcher retries on the next provider until success or exhaustion. Test cases:
  - **Primary succeeds** — single turn, no fallback fires, no events.
  - **Primary 503 → secondary OK** — 2 turns, 1 fallback event with `from: 'anthropic', to: 'openai', reason: '503', attempt: 2`.
  - **Full chain failure** — 3 turns to exhaustion, 2 fallback events (anthropic→openai, openai→openrouter); terminal failure emits no event.
  - **Router + chain composition** — tier-routed router picks `balanced → anthropic` as primary; chain falls back through openai → openrouter/deepseek/deepseek-v3 on 503; openrouter succeeds.
  - **Mixed reason routing** — 503/429/500 all advance through the same path; event sequence preserves the reasons.
  - **retryBudget caps the chain** — 4 providers configured but `retryBudget: 2` stops after 2 attempts; 1 fallback event, exhaustion at attempt 2.
- **Synthetic-response dispatch loop** — the "dispatcher" is a fake loop calling a `providerFn` that returns either `status: 'ok'` or `status: 'error'` with a `FallbackFailureReason`. Per ADR-011, no real API keys touched. The infrastructure is ready to swap the synthetic `providerFn` for cassette-replayed turns the moment a user records the six-provider cassettes.
- **`pnpm test:provider-matrix`** script replaces the stub at `scripts/stub-test-provider-matrix.mjs` with `vitest run test/provider-matrix/`. The failover suite also runs as part of the default `pnpm test` glob.
- **ADR-011 (provider-matrix via cassettes) Proposed → Accepted** at `docs/decisions/ADR-011-provider-matrix-cassettes-only.md`. New 3-layer Validation section covers recorder/replayer infrastructure (M1 PR-06), per-provider extraction parity (M1 PR-07/PR-08 + M5 PR-39/PR-40), and the failover simulation (this commit). The full six-provider cassette CI matrix activation remains user-driven ops work.

### M5 EXIT GATE per TDD2 §13.5.2 — post PR-44

| Criterion                                                                                             | Status       | Activation gate                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 3-task parallel batch, each on a different provider, all complete with identical `TaskResult` parsing | **DEFERRED** | User-driven cassette recording across 3+ providers. PR-41 router + PR-42 chain + PR-43 cost panel + PR-44 sim infrastructure all ready. |
| Simulated primary-provider outage (mock 503) → fallback fires → milestone progresses                  | **PASS**     | PR-44 failover simulation (synthetic 503/429/500 + chain advance + event records).                                                      |
| Per-provider cost panel shows correct attribution against the M4 reference scenario                   | **DEFERRED** | PR-43 panel ready. Awaits live meter wire-up + M4 reference scenario measurement (M2 cassette gate).                                    |

**1 of 3 PASS, 2 DEFERRED on user-driven cassette recording.** Both DEFERRED criteria have no code component left — the M5 infrastructure (router strategies, fallback chain, per-provider cost panel, OpenRouter + Gemini shims, failover simulation) is structurally complete. When the user records the six-provider cassettes (~30-45 min each, ~$0.50-$1.00 per provider), the deferred criteria auto-activate.

**Plan 05-01 closed 2026-05-12.** 6 atomic commits on `main` (PR-39 `51e4cd1`, PR-40 `9f51f8f`, PR-41 `7aee524`, PR-42 `9fa2145`, PR-43 `0420393`, PR-44 `<this commit>`).

**ADR matrix at M5 close: 11 Accepted** (001-011). The remaining draft ADRs (012, 013) activate at M6 (release).

**Test posture at PR-44 close (M5 structural EXIT GATE): 1160 passing / 46 skipped / 0 failed** (+6 from PR-43's 1154). Commit: `599f4be`.

### Added (M6 open — Plan 06-01 — PR-45, 2026-05-12) — **Codex-era removal**

First PR of Plan 06-01 (M6 Decommission, benchmark, ship per TDD2 §13.6). v2-era enum vestiges replaced with v3's Pi-only reality, alongside deletion of the dead `CodexMethodologyAgent` code path (no consumers since the v2 drivers were deleted at M1 PR-05 per ADR-005).

- **`BackendSchema`** flipped from `z.enum(['codex', 'claude-code', 'ollama'])` to `z.enum(['pi'])`. Old snapshot files from v2 must be migrated via `swt migrate --to=v3` (M6 PR-49).
- **`agent_backend`** flipped from `z.enum(['none', 'codex', 'scripted'])` to `z.enum(['none', 'pi'])`. Doc comment rewritten for v3 reality.
- **`Config.ts`** default flipped to `backend: z.enum(['pi']).default('pi')`.
- **Dashboard server** — removed the `SWT_VIBE_AGENT=codex` env-var shortcut that instantiated `CodexMethodologyAgent`; replaced with a simple `'none' | 'pi'` resolver that flips to `'pi'` whenever an `agentFactory` is wired. `RegisterVibeRoutesOptions.agentBackendTag` + `VibeStartResponse.agent_backend` types both flipped to `'none' | 'pi'`.
- **Dashboard client** — `TopBar.tsx`'s `BACKEND_LABEL` flipped to `{pi: 'pi'}`; `LogPanel.tsx`'s `agentBackend` prop type flipped; `dashboard-store.ts`'s `VibeSessionState.agent_backend` type flipped.
- **`CodexMethodologyAgent` deleted** — `packages/dashboard/src/server/vibe/codex-methodology-agent.ts` + its test (10 tests). No consumers since M1 PR-05. The closing bookend on ADR-005.
- **Test cascades** — `dashboard-store.test.ts` (8 `agent_backend: 'codex'` → `'pi'` sites), `snapshot-reducer.test.ts` (1 `backend.toBe('codex')` → `'pi'`). Auto-regenerated `docs/reference/config.mdx`.

**Test posture at PR-45 close: 1150 passing / 46 skipped / 0 failed** (−10 from PR-44's 1160: 10 codex-methodology-agent tests deleted alongside the source). Commit: `6cfcbfb`.

### Added (M6 — Plan 06-01 — PR-46, 2026-05-12)

Second PR of Plan 06-01. Trim redundant stubs from `STUB_SPECS`.

- **`worktree` + `lease` stubs removed** from `packages/cli/src/commands/stubs.ts`. Both verbs are now covered by real v3 surfaces:
  - `worktree` (v2 design: "Manage milestone worktrees") → covered by `swt cleanup` (M3 PR-29) which handles list / force-remove / prune-locks across the per-task worktrees.
  - `lease` (v2 design: "Acquire / release file locks") → an internal concern of `packages/orchestration/src/lock-files.ts` since M3 PR-25. Operators don't manage leases directly; `swt cleanup --prune-locks` is the only operator-facing escape hatch.
- **18 remaining stubs preserved** (`plan`, `execute`, `qa`, `map`, `debug`, `fix`, `archive`, `release`, `resume`, `pause`, `audit`, `assumptions`, `research`, `discuss`, `phase`, `todo`, `skills`, `whats-new`, `uninstall`). All genuine post-release roadmap items (M7+ work). They continue returning `EXIT.NOT_IMPLEMENTED` with a pointer to the roadmap phase.
- **Auto-regenerated `docs/reference/cli.mdx`** via `pnpm docs:gen` — the new file omits the trimmed entries.

**Test posture at PR-46 close: 1150 passing / 46 skipped / 0 failed** (unchanged — stub removal doesn't affect tests). Commit: `bd0a7a4`.

### Added (M6 — Plan 06-01 — PR-47 + PR-48, 2026-05-12)

Third + fourth PRs of Plan 06-01.

**PR-47 — Vendor-agnostic doc rewrite.**

- `docs/architecture.md` (NEW) — 6-layer diagram (Layer 1 shared → Layer 2 core → Layer 3 runtime [ONLY layer importing `@earendil-works/*`] → Layer 4 orchestration → Layer 5 methodology → Layer 6 surfaces); the four principles (Pi-only in runtime, methodology preserved verbatim, artefacts as source of truth, aggregate-only telemetry); v3 capability table; ADR matrix at v3.0 (11 Accepted + 1 Deferred).
- `README.md` `## Project status` refreshed: v3.0.0-alpha.1 marked **STRUCTURALLY COMPLETE** 2026-05-12; per-milestone table updated through M6; test posture pinned at 1150/46/0; architecture.md cross-referenced.
- `migrating-from-v2.md` already mentioned `swt migrate --to=v3` properly — no changes needed.

Commit: `10aa2a4`.

**PR-48 — Public benchmark scaffolding.**

- `docs/public-benchmark/README.md` (NEW) — reference benchmark scenario doc covering fixture (`ref-fastapi-empty` frozen 3-milestone FastAPI greenfield), provider matrix (≥3 of {Anthropic, OpenAI, OpenRouter, Google, Bedrock, Ollama} per ADR-011), TPAC metric + cache + cost targets (TDD2 §1.2), run workflow (record cassettes → `swt bench --output ...` per provider → `pnpm public-benchmark` aggregates), 7-item recording checklist (~30-45 min × 3-6 providers, ~$5-$10 total).
- `scripts/public-benchmark.mjs` (NEW, ~190 lines) — aggregator that reads `.swt-planning/.tpac/*.json` reports + emits a markdown table for the project homepage. Auto-detects M2 baseline via `--baseline <file>` flag or `milestone: 'M2'` field; computes per-provider deltas against baseline; sorts baseline first then by milestone + provider; empty-state notice when no reports yet. Per ADR-011, every number is reproducible from committed cassettes — CI never hits real APIs.
- `pnpm public-benchmark` script added.

Real recording is user-driven release-time work; the scaffolding consumes reports automatically the moment they land.

**Test posture at PR-47/PR-48 close: 1150 passing / 46 skipped / 0 failed** (unchanged — both PRs are docs + script additions). PR-48 commit: `5675bd8`.

### Added (M6 — Plan 06-01 — PR-49, 2026-05-12)

Fifth PR of Plan 06-01. `swt migrate --to=v3` ships per TDD2 §13.6.1 — the canonical v2 → v3 `.swt-planning/` migration path.

- **`packages/cli/src/commands/migrate.ts`** (NEW) — `migrateHandler` accepts `--to=v3` (optional) + `--input <v2-planning-dir>` (required) + `--output <v3-planning-dir>` (required). **Out-of-place** (input never mutated) + **idempotent** (already-v3 input → 0 rewrites). Walks the output tree:
  - **JSON files** — recursive traversal: `backend: 'codex'\|'claude-code'\|'ollama' → 'pi'`; `agent_backend: 'codex'\|'scripted' → 'pi'`. Nested objects + arrays traversed.
  - **Markdown frontmatter** — `reasoning_effort: X → thinking_level: X` within the leading `---` block (regex-scoped; markdown body never touched).
- **Migration report** — stdout emits `files_scanned`, `fields_rewritten`, per-file notes.
- **Registered as `swt migrate` in `main.ts`**. Usage: `swt migrate --to=v3 --input <v2-planning-dir> --output <v3-planning-dir>`.
- **Exit codes** — 0 success; 1 USAGE_ERROR (missing `--input`/`--output` or non-`v3` `--to`); 2 NOT_IMPLEMENTED (input dir missing); 3 RUNTIME_ERROR.
- **8 tests** — happy path (3 fields rewritten + input untouched), missing-fields pass-through, already-v3 idempotency, nested `agent_backend` recursion, 4 argument-validation cases.
- **Docs** at `docs/cli/verbs/migrate.md` (operator workflow + migration scope table + exit codes). Auto-regenerated `docs/reference/cli.mdx`.

**Test posture at PR-49 close: 1158 passing / 46 skipped / 0 failed** (+8 from PR-46/47/48's 1150). Commit: `4d1b4c1`.

### Added (M6 — Plan 06-01 — PR-50, 2026-05-12) — **Release notes**

Sixth PR of Plan 06-01. v3.0.0 release notes prep.

- **`RELEASE-NOTES-v3.0.md`** (NEW) — operator-facing release notes covering: what's new (vendor-neutral runtime, parallel worktrees, Anthropic prompt caching, Budget Gate, multi-provider routing, per-task TPAC, `swt migrate`); what's removed (the three legacy drivers, `.codex-plugin/`, `backend: 'codex'\|'claude-code'\|'ollama'` enums, `agentBackendTag: 'scripted'`, `CodexMethodologyAgent`, `SWT_VIBE_AGENT=codex` env shortcut); 6-layer architecture reference; v2 → v3 migration workflow; v2.3.x LTS policy summary; full ADR matrix at v3.0 (11 Accepted + 1 Deferred); test posture pin at 1158/46/0; remaining release-operation deferrals; release-operations checklist for the operator running `pnpm release`.
- **CHANGELOG.md** header rewritten: `3.0.0-alpha.1 — IN DEVELOPMENT` flipped to `3.0.0 — STRUCTURALLY COMPLETE 2026-05-12`. The detailed per-PR entries underneath remain in place; the section is now read as the canonical v3.0.0 release entry pending npm publish.

The npm publish + GitHub release + v2-archive branch cut are user-driven release operations gated on user-driven cassette recording + the public benchmark run.

**Test posture at PR-50 close: 1158 passing / 46 skipped / 0 failed** (unchanged — docs-only PR). Commit: `<pending>`.

### Test-debt umbrella #32 status

| Cluster                         | Pre-M2     | Post-Plan-02-01                 | Post-Plan-02-02                                                 |
| ------------------------------- | ---------- | ------------------------------- | --------------------------------------------------------------- |
| Methodology (9)                 | 9 skipped  | **9 resolved** at PR-13 + PR-15 | unchanged                                                       |
| Verification (3, HIGH-priority) | 3 skipped  | **3 resolved** at PR-14         | unchanged                                                       |
| Dashboard (10)                  | 10 skipped | 10 skipped                      | **9 resolved** at PR-17 (1 residual: chokidar v4 close-handler) |
| LogPanel.tsx TS2322             | failing    | failing                         | **resolved** at PR-17                                           |
| **In-scope total**              | 22 skipped | 12 resolved                     | **21 of 22 resolved (95%)**                                     |

## 2.3.5

### Patch Changes

- v2.3.5 — `swt update` defaults to a fresh network query; dashboard
  panel keeps a short 5-minute cache.

  **Why.** v2.3.0–2.3.4 used the same 24h disk-cache for both
  callers of `queryLatestVersion`:
  1. The CLI's `swt update` command (explicit user ask, infrequent).
  2. The dashboard `/api/update` panel poll (every 60s while the
     panel is mounted).

  One cache, two use cases. The TTL had to compromise between them
  and ended up too long for the CLI path. Users who ran `swt update`
  minutes after a release saw "up-to-date" because the cache had
  been written by an earlier check — even when the registry already
  had a newer version. v2.3.3 mitigated this for the in-place
  upgrade path (cache invalidates when installed `current` shifts),
  but the broader issue — explicit user checks reading stale cache —
  remained.

  **Fix — asymmetric defaults by caller intent.**
  - **CLI `swt update`** now defaults to `noCache: true`. Every
    invocation queries npm fresh. ~200ms one-off cost per check
    is negligible; the upside is users always see the truth.
    The new `--cache` flag opts back into disk caching for
    flaky-network / offline workflows. `--no-cache` is preserved
    as a no-op alias for scripts that already pass it.

  - **Dashboard `/api/update` panel** keeps the disk cache (panel
    polls every 60s and we don't want to spam the registry) but
    drops the TTL from 24 h to **5 minutes** via the new
    `cacheTtlMs` option on `queryLatestVersion`. A new release
    surfaces in the panel within 5 min of the user's next refresh.

  **API additions:**
  - `QueryOptions.cacheTtlMs` (number, default 24h) — per-call
    TTL override.
  - `SHORT_CACHE_TTL_MS` exported from `@swt-labs/cli` — the
    5-minute constant the dashboard route uses, also reusable
    for plugin authors.

  **Tests.** 2 new + 1 updated in `packages/cli/test/lib/npm-
registry.test.ts` and `packages/cli/test/commands/update.test.ts`:
  - Custom `cacheTtlMs` (5 min) invalidates after 10 min, serves
    cache within 1 min.
  - `swt update` (default) queries the network twice on two
    sequential calls — no implicit cache.
  - `--cache` flag opts back into the disk cache.

  **Verification:**
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
    `pnpm build` all clean.

  **Migration note for users still on v2.3.3.** v2.3.3's
  `swt update` will continue to report itself as up-to-date even
  after this v2.3.5 release, for up to 24 h — because v2.3.3's
  cache TTL is what it is. To force the upgrade through:

  ```bash
  npm install -g stop-wasting-tokens@latest
  # or:
  swt update --no-cache
  ```

## 2.3.4

### Patch Changes

- v2.3.4 — Defense-in-depth against browser-extension interference.

  **Why.** Web3 wallet extensions (MetaMask, Yoroi, Phantom, Rabby,
  Brave Wallet, Coinbase Wallet, etc.) inject scripts into every
  `http://` page they encounter — including localhost. Most of them
  additionally drop SES (Secure ECMAScript) lockdown into the page
  to freeze JS primordials for security. SES lockdown interferes
  with Solid's reactivity primitives and standard Set-membership
  patterns the dashboard's natural-language command-bar classifier
  depends on. The visible symptom: the command bar silently routes
  every input to `/api/command` instead of `/api/vibe`, so describing
  what you want to build fails with "unknown command 'I'".

  **Fix — two-layer defense:**
  1. **Server-side CSP header (primary, free).** Hono middleware in
     `packages/dashboard/src/server/lib/csp.ts` sets a strict CSP
     header on every response. Chromium-based browsers (Chrome, Edge,
     Brave, Arc, Opera) respect MAIN_WORLD content-script CSP since
     2023, so wallet extensions get blocked at the browser level
     and never inject. SES never runs. The classifier works.

     Directives:

     ```
     default-src 'self'
     script-src 'self' 'wasm-unsafe-eval'
     style-src 'self' 'unsafe-inline'
     img-src 'self' data:
     font-src 'self' data:
     connect-src 'self'
     frame-ancestors 'none'
     base-uri 'none'
     form-action 'self'
     ```

     Plus belt-and-suspenders: `X-Content-Type-Options: nosniff`,
     `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.

     `SWT_DASHBOARD_NO_CSP=1` opt-out for users who need custom
     scripts (e.g., dev with a third-party wallet integration).

  2. **Client-side detector banner (safety net).**
     `packages/dashboard/src/client/lib/detect-extension-interference.ts`
     probes for known wallet globals (`window.ethereum`,
     `window.cardano`, `window.phantom`, `window.solana`, `window.tronWeb`)
     and SES indicators (`globalThis.lockdown`, `globalThis.harden`,
     `Object.isFrozen(Array.prototype)`). If any are detected, a
     dismissable amber banner renders at the top of the dashboard
     with a clear remediation message ("open in Incognito or disable
     wallet extensions for 127.0.0.1"). Catches the small slice of
     cases where CSP doesn't block injection (older browsers, vendor
     edge cases, future extension classes).

     `ExtensionDefenseBanner.tsx` is the rendering component;
     sessionStorage-backed dismissal so it doesn't nag after the
     user acknowledges it once.

  **Future-proofing.** Adding a new wallet to the detector is one
  entry in `KNOWN_WALLET_GLOBALS` (id + label + probe function).
  The CSP directives are exported as `DEFAULT_CSP` and parameter-
  overridable via `securityHeadersMiddleware({csp})` for v2.5+
  plugin scenarios that need to loosen the policy.

  **Tests.** 16 new vitest cases:
  - `security-headers.test.ts` (6): default CSP shape, script-src
    restrictions, supplementary headers, disableCsp behavior,
    custom CSP override.
  - `detect-extension-interference.test.ts` (10): clean baseline,
    each wallet probe individually, multi-wallet coexistence, SES
    via both function and frozen-prototype paths, remediation
    string content, defensive-against-throwing-getter guarantee.

  **Verification:**
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`
    all clean (16 new tests, 0 regressions).
  - `pnpm build` clean.
  - Live test: `swt dashboard` in Chrome with MetaMask + Yoroi
    installed → banner renders, Incognito works without banner.

  **No behavior change for users without wallets.** Detector returns
  `interferenceDetected: false`, banner renders nothing. CSP header
  is set unconditionally but only affects requests the dashboard
  never makes anyway.

## 2.3.3

### Patch Changes

- v2.3.3 — Fix: `swt update` 24h cache returned stale `latest`
  after an in-place version upgrade.

  **Root cause.** `queryLatestVersion` in
  `packages/cli/src/lib/npm-registry.ts` cached the registry
  response for 24 hours under the package name as the cache key.
  The freshness check was TTL-only — it did NOT compare the
  cached `current` against the caller's installed `current`.
  Result: a cache entry written at 08:59 (when the user was on
  v2.0.2 and npm latest was v2.0.2 → cached `status: up-to-date`)
  was still served as fresh at 17:46 after the user had upgraded
  to v2.3.1 and npm had published v2.3.2. `swt update` reported
  `up-to-date (v2.3.1)` instead of "v2.3.2 available."

  **Fix.** Cache hit is now valid only when both:
  1. The 24h TTL has not elapsed.
  2. The cached snapshot's `current` matches the caller's
     `current` (i.e., the cache was written for the same
     installed version that's asking).

  Re-querying after an in-place version change is cheap and
  matches the user's mental model ("I just upgraded; tell me if
  there's anything newer"). The `--no-cache` escape hatch is
  unchanged.

  **Tests.** Four new vitest cases in
  `packages/cli/test/lib/npm-registry.test.ts`:
  - cache hit when `current` matches and TTL is fresh
  - cache invalidation when installed `current` differs from
    cached `current` (the regression for this bug)
  - cache invalidation when TTL has elapsed
  - cache rewrite stores the new `current/latest` pair after a
    fresh query

  **Verification:**
  - `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.
  - `pnpm test` 770 passed (+4 from the new cases) / 38
    pre-existing baseline unchanged.
  - `pnpm build` clean.

  **Backwards compat.** Existing cache files on disk remain
  parseable. The first `swt update` after upgrading to v2.3.3
  re-queries npm (because the cached `current` won't match the
  new installed `current`) and rewrites the cache with the
  current pair. No user action required.

## 2.3.2

### Patch Changes

- v2.3.2 — Docs-only catch-up so the bundled `README.md` matches
  the published version. No code changes vs v2.3.1.

  **What changed:**
  - `README.md` — Status section bumped 2.3.1 → 2.3.2 with the
    full v2.3 series story (panels + palette in 2.3.0, daemon
    double-spawn fix in 2.3.1, README catch-up in 2.3.2). The
    "Pin a specific version" example and the "Verify the install"
    output comment also bumped to 2.3.2.
  - `package.json:version` — 2.3.1 → 2.3.2.
  - `.codex-plugin/plugin.json:version` — 2.3.1 → 2.3.2 to keep
    `test/codex-plugin-manifest.test.ts > version field matches
package.json` green.

  **Why a publish (rather than docs-only push):** the npm tarball
  bundles `README.md`, so users who run `npm i -g
stop-wasting-tokens` and read the bundled docs would otherwise
  see the v2.3.0 README until the next feature release. Cutting a
  patch makes the bundled docs catch up to the published version.

  **No behavior change.** The CLI bundle, the dashboard bundle,
  and every test all match v2.3.1 — verified by `pnpm typecheck`
  - `pnpm lint` + `pnpm format:check` + `pnpm test` + `pnpm build`
    before push.

## 2.3.1

### Patch Changes

- v2.3.1 — Fix: dashboard daemon double-spawn / EADDRINUSE crash on
  fresh installs of v2.3.0.

  **Root cause.** v2.3.0's new `/api/update` route imported
  `queryLatestVersion` + `CURRENT_VERSION` from `@swt-labs/cli`,
  which caused tsup to inline the CLI's `packages/cli/src/index.ts`
  into the `dashboard-server.mjs` bundle. That file has a
  `if (isDirectInvocation()) main()` side-effect intended only for
  the CLI binary. The check compared `argv[1]` to `import.meta.url`
  via `realpathSync` — which incorrectly returned true inside the
  daemon bundle because both resolved to `dashboard-server.mjs`'s
  path. Result: when the daemon spawned, the CLI's `main()` also
  ran inside the daemon process, dispatched the no-args default
  (`dashboard` since v2.0), and tried to spawn a second daemon.
  The recursive child crashed with `EADDRINUSE: 127.0.0.1:54320`,
  taking the original listener with it. Symptoms: `swt dashboard`
  prints "Listening on …" then immediately fails to respond on
  `/api/health`; `install-smoke` CI fails on the v2.3.0 tag.

  **Fix.** Tightened `isDirectInvocation()` in
  `packages/cli/src/index.ts` to additionally check the binary's
  basename (`cli.mjs` / `cli.js` / `index.ts`). The bundled
  side-effect now only fires when the CLI binary itself is the
  invocation entry, never when the dashboard bundle inlines this
  module. One-line guard, no API change, no v2.3 feature regression.

  **Also in this patch (CI hygiene):**
  - `pnpm format` sweep across the v2.3 surface: ConfigPanel,
    DetectPhasePanel, DoctorPanel, UpdatePanel, styles.css,
    fuzzy-match.ts, config.ts, update.ts, config-route.test.ts,
    dashboard-store.test.ts, update-apply-route.test.ts, plus
    auto-gen reference docs (artifacts/cli/config mdx). Resolves
    the `pnpm format:check` step that failed on v2.3.0's CI run
    (15 files).

  **Verification:**
  - Local rebuild + `node dist/dashboard-server.mjs`: single
    "Listening" line, daemon stays alive, `/api/health`,
    `/api/config`, `/api/commands` all respond as expected.
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
    `pnpm format:check` all clean.

## 2.3.0

### Minor Changes

- v2.3.0 — Dashboard 1:1 CLI parity panels + cmd-K command palette.
  The dashboard now exposes the four read-only CLI surfaces (`config`,
  `doctor`, `detect-phase`, `update`) as live panels, lets you edit
  `.swt-planning/config.json` and apply CLI updates without dropping
  into a terminal, and adds a cmd-K palette so every dashboard-safe
  CLI verb is one keystroke away.

  **Dashboard CLI parity panels.** A new fifth column ("Tools") on the
  right edge of the dashboard renders four panels backed by the new
  HTTP routes:
  - **Config** mirrors `swt config show` — full `.swt-planning/config.json`
    tree, with the source (`file` / `default`) and `is_initialized` flag
    surfaced explicitly. Greenfield daemons render the DEFAULT_CONFIG
    preview rather than blanking out.
  - **Doctor** mirrors `swt doctor` — Node version check, Codex CLI
    detection (with a 3 s spawn cap), and `.swt-planning/` presence,
    aggregated into an `overall_status` of `pass` / `warn` / `fail`.
  - **Detect-Phase** mirrors `swt detect-phase` JSON mode — full
    `PhaseDetectResult` from `@swt-labs/methodology` with an
    `is_initialized` envelope flag for greenfield branching.
  - **Update** mirrors `swt update --json` — current vs. latest npm
    version with the existing 24 h on-disk cache. Network failures
    fold into `latest_version: null + error: <message>` instead of
    crashing.

  Layout-storage bumps to v2 (5-column main + a separate `tools`
  array). Polling lifecycle is 60 s with a `document.visibilitychange`
  pause so backgrounded tabs don't churn.

  **Mutations + cmd-K palette.** The Config and Update panels gain
  user-initiated mutations:
  - **Config edit** — Edit toggles the panel into a per-leaf form
    with type-aware inputs (booleans → checkboxes, numbers →
    number-inputs, strings → text inputs, eight enum keys
    [`effort`, `autonomy`, `verification_tier`, `model_profile`,
    `backend`, `prefer_teams`, `planning_tracking`, `auto_push`] →
    `<select>` dropdowns). Save POSTs to `/api/config`, which
    validates structurally (Zod) + semantically (`parseConfig` from
    `@swt-labs/core`) and rewrites the file atomically. A
    `state.changed` SSE event with `changed: ['config']` notifies
    every other connected panel.
  - **Update apply** — the apply button is no longer disabled. POST
    `/api/update/apply` spawns `npm install -g
stop-wasting-tokens@latest` server-side with a 60 s timeout,
    detects EACCES/EPERM elevation paths, and surfaces a copyable
    `sudo …` command (with a one-click Copy button) when the global
    npm path is root-owned.
  - **cmd-K command palette** — `cmd-K` (mac) / `ctrl-K` (linux/win)
    opens a centered modal with a search input. Hand-rolled fuzzy
    match (subsequence + consecutive bonus) ranks the full CLI verb
    registry from `/api/commands`; dashboard-safe verbs run inline
    via the existing `/api/command` route, while stubs and
    interactive verbs (`vibe`, `watch`, `dashboard`) are dimmed and
    hidden by default behind a "Show all" toggle. ↑/↓/Enter/Esc
    keyboard nav throughout.

  **What changed under the hood:**
  - `packages/dashboard-core` — seven new schemas
    (`ConfigSnapshot`, `DoctorReport`, `DetectPhaseReport`,
    `UpdateReport`, `CommandRegistry`, `ConfigUpdateBody/Response`,
    `UpdateApplyResponse`) and the `state.changed` `changed` enum
    extended with `'config'`.
  - `packages/dashboard/src/server/routes/{config,doctor,detect-phase,
update,commands}.ts` — five new GET routes plus POST
    `/api/config` and POST `/api/update/apply`.
  - `packages/dashboard/src/server/lib/{detect-codex,
command-registry-mirror}.ts` — hand-mirrored CLI helpers,
    same precedent as `lib/allowed-verbs.ts`.
  - `packages/dashboard/src/client/components/{ConfigPanel,
DoctorPanel,DetectPhasePanel,UpdatePanel,CommandPalette}.tsx` —
    five new Solid components.
  - `packages/dashboard/src/client/state/dashboard-store.ts` — new
    `tools` sub-store with five cells, `applyConfigUpdate`,
    `applyUpdate`, 60 s polling lifecycle with visibility pause,
    cmd-K `paletteOpen` wiring, and the `state.changed` `config`
    branch.
  - `packages/dashboard/src/client/lib/fuzzy-match.ts` — hand-rolled
    subsequence matcher with consecutive-character bonus.
  - `packages/dashboard/src/client/lib/layout-storage.ts` — bumped
    to v2 (5-column `main` + `tools: number[]`).
  - `packages/cli/src/index.ts` — public re-exports for
    `queryLatestVersion`, `defaultCachePath`, `CURRENT_VERSION`,
    `RegistryResult`, `RegistryStatus`, `QueryOptions` so the daemon
    can reuse the CLI's update-check primitives.
  - `packages/dashboard/tsconfig.json` — project references for
    `core`, `methodology`, `cli` alongside `dashboard-core`.
  - `packages/dashboard/package.json` — declared
    `@swt-labs/{cli,core,methodology}` as `workspace:*` deps.

  **What did NOT change:**
  - The terminal-side `swt` CLI surface for power users — every
    verb still works as documented.
  - `POST /api/init` / `POST /api/command` request and response
    shapes and validation rules.
  - Vibe + permission boundary — unchanged from v2.0.
  - Default `swt` no-args dashboard launch + `SWT_NO_DASHBOARD=1`
    escape hatch — unchanged.

  **Verification:**
  - ~65 net-new vitest cases across the dashboard package (route
    tests for all five new routes + the two new mutations, the
    fuzzy-match unit, and `tools` sub-store coverage in
    `dashboard-store.test.ts`) — all green. Repo-wide `pnpm test`
    runs `765 passed / 39 failed`; the 39 failures are the
    pre-existing jsdom-missing baseline (down from v2.2.0's 41,
    thanks to a `pnpm docs:gen` sweep here).
  - `pnpm typecheck` (`tsc --build`) clean across the workspace.
  - `pnpm build` clean (`pnpm dashboard:client:build && tsup`).
  - `pnpm lint` clean — repo-wide eslint passes after `eslint
--fix` on the v2.3 routes/tests and a one-line `tsconfig.eslint.json`
    addition (`lib: ["ES2022", "DOM", "DOM.Iterable"]`) so client
    `.ts` files like `dashboard-store.ts` get the DOM types
    typescript-eslint needs.
  - `idiot_check.py` Track A: D7-D11 added for the five new HTTP
    endpoints. Run against the published v2.3.0 binary as part of
    the post-publish verification.

  **Permission gate deviation (documented).** Phase 03's POST
  routes (`/api/config`, `/api/update/apply`) intentionally do NOT
  route through `DashboardPermissionGate`. The gate (250 LOC at
  `packages/dashboard/src/server/vibe/permission-gate.ts`) is
  session-keyed for vibe-spawned agents and emits prompts via
  `registry.emitPrompt(session_id, …)`. Direct UI button-click
  mutations have no `session_id`. The new POST routes follow the
  existing `/api/init` / `/api/command` pattern (localhost-only
  daemon + user-initiated). A future milestone wanting gated UI
  mutations should ship a separate `UiPermissionGate` class with
  its own protocol.

  **Out of scope for v2.3** (deferred to v2.4+):
  - CLI surface parity beyond the four read panels + palette
    (no `swt phase` / `swt audit` panels yet).
  - Mobile-friendly dashboard layout (desktop-only by design).
  - Multi-session concurrency UI.
  - Signed-tag verification panel.

## 2.2.0

### Minor Changes

- v2.2.0 — Dashboard 1:1 with the CLI's init mechanic (Plan A slice).
  Two changes that close the biggest first-30-seconds gap a non-
  technical user hits when they open the dashboard fresh.

  **Brownfield detection.** The daemon now notices when its cwd has
  source files but no `.swt-planning/` (i.e. you ran `swt` inside an
  existing repo). The greenfield snapshot carries a new
  `brownfield_detected: true` flag, and the InitScreen adapts
  accordingly:
  - Pure greenfield (empty dir, or only hidden / build-artifact
    entries): "Welcome to SWT" + "Name your project to scaffold a
    fresh `.swt-planning/`."
  - Brownfield (a `package.json`, `README.md`, source dirs, etc.):
    "Set up SWT around your existing project" — amber-accented copy +
    a "✓ Initialize SWT for this codebase" CTA. Step-circle palette
    flips to warm-amber so users visually distinguish "fresh project"
    from "around existing code."

  The detection rule mirrors `/vbw:init`'s heuristic: any non-hidden,
  non-ignored file or directory in cwd counts as "existing codebase."
  Hidden entries (`.git`, `.DS_Store`, `.swt-planning`) and build
  artifacts (`node_modules`, `dist`, `build`, `coverage`, `target`,
  `.next`, `.venv`, `vendor`, `__pycache__`) are excluded so a
  freshly-cloned repo without source still reads as greenfield.

  **Merged welcome + init.** The standalone `OnboardingOverlay`
  (3-step explainer card) is gone. Its content is now the left side
  of a redesigned `InitScreen` split-card; the project-name +
  description form is the right side. One first-time surface instead
  of two competing for the user's attention.

  Layout: row on wide viewports, stacks vertically at < 760px. The
  left column is bordered off from the form so the steps read as
  "what you're about to start" not "another modal."

  **What changed under the hood:**
  - `packages/dashboard-core` — `SnapshotSchema.brownfield_detected`
    (optional boolean, back-compat with v2.1.x daemons).
  - `packages/dashboard/src/server/lib/detect-brownfield.ts` (new) —
    `detectBrownfield(cwd: string): boolean` helper. Single
    `fs.readdir`, cached at route registration.
  - `packages/dashboard/src/server/snapshot/empty.ts` —
    `emptySnapshot(brownfield = false)` includes the flag in the
    synthetic greenfield response.
  - `packages/dashboard/src/server/routes/snapshot.ts` —
    `registerSnapshotRoute(app, getSnapshotter, cwd)` calls the
    detector once at registration; threads the result through.
  - `packages/dashboard/src/client/components/InitScreen.tsx` —
    rebuilt as a split card with the brownfield variant.
  - `packages/dashboard/src/client/App.tsx` — derives `isBrownfield()`
    from the snapshot, passes through to InitScreen. Drops the
    OnboardingOverlay render + visibility signal + dismiss handler.
  - **Removed:** `OnboardingOverlay.tsx`, `onboarding-storage.ts`,
    `onboarding-storage.test.ts` — all dead code now that the
    overlay is gone.

  **What did NOT change:**
  - `POST /api/init` request/response shape, validation rules, error
    envelopes — all unchanged.
  - The terminal-side `swt init` flow is unchanged for power users.
  - Default `swt` no-args dashboard launch + `SWT_NO_DASHBOARD=1`
    escape hatch unchanged.
  - Vibe + permission boundary — unchanged from v2.0.

  **Verification:**
  - 9 new Vitest cases in
    `packages/dashboard/test/detect-brownfield.test.ts` cover all
    classification branches.
  - tsc + eslint clean on all touched files. Prettier converges.
  - vitest run: 41 failed / 697 passed (= same 41 pre-existing
    failures + 9 new from Phase 1; Phase 2 deleted the 6
    onboarding-storage tests, so net deltas reconcile to zero new
    regressions).
  - `idiot_check.py` Track A 29/29 against the published v2.2.0
    binary (D2 greenfield snapshot now returns
    `brownfield_detected: false` in the test's pure tmpdir).

  **Out of scope for v2.2** (deferred to v2.3+):
  - CLI surface parity beyond init (config / doctor / detect-phase /
    update panels in the dashboard).
  - Command palette in the dashboard surfacing every CLI verb.

## 2.1.0

### Minor Changes

- v2.1.0 — Repo-wide prettier sweep so the CI `format:check` gate
  passes again. No runtime / behavior changes; published bundle
  contents are byte-identical to v2.0.2.

  **What broke:** the v2.0.2 release pipeline succeeded on the
  `Release` workflow (npm publish landed cleanly after a Sigstore
  transparency-log retry) but the parallel `CI` workflow failed at
  the `pnpm format:check` step. 22 files in the repo were not
  prettier-clean, including a stale code block in the CHANGELOG
  for v1.6.6 that prettier couldn't reach a fixed point on (the
  `'cli.mjs'` literal had backticks adjacent to text without
  spaces, oscillating prettier between two indentation states).

  **Fixes:**
  - Ran `prettier --write .` on the whole tree. 21 files reformatted
    automatically.
  - Hand-edited the v1.6.6 CHANGELOG entry's `B-04` block to use
    proper spacing around backticks so prettier converges.

  **Why a 2.1 minor bump:** the CI failure didn't affect the npm
  artifact (publish succeeded), but the `Release` + `CI` divergence
  is a project-health signal worth a minor-version notice. The bump
  also clears the way for the next batch of in-flight features
  (agent-prompt template work, daemon restart resumption) to ship
  off a green-CI baseline.

## 2.0.2

### Patch Changes

- v2.0.2 — `swt update` actually works now. Previously broken in two
  ways; fixed both.

  **Bug 1 — wrong package name (HTTP 404).** `swt update` queried
  `@swt-labs/cli` against npm. That's the internal workspace package
  name and is never published, so every check returned HTTP 404 with
  "could not check for updates." The published name is
  `stop-wasting-tokens`. Fixed.

  **Bug 2 — check-only, no auto-apply.** Even when the version check
  worked, `swt update` only PRINTED the upgrade commands and made
  the user run them by hand. Now `swt update` actually runs the
  upgrade for you.

  **New behavior:**

  ```text
  swt update
  ```

  Default flow (interactive):
  1. Query npm registry for the latest `stop-wasting-tokens` version.
  2. If you're already at latest: prints `✓ swt is up-to-date (vX.Y.Z)`
     and exits.
  3. If a newer version is available: prints the version delta, then
     spawns `npm install -g stop-wasting-tokens@latest`. Falls back
     to `pnpm` then `bun` if `npm` isn't on PATH. The package
     manager's output streams through to your terminal so you see
     progress in real time.
  4. After successful install: prints `✓ Upgraded to vX.Y.Z via npm`
     and reminds you to restart any running `swt` processes.
  5. If no package manager is installed: prints the manual commands
     and exits 1.

  **`--check` flag (preserves old behavior):**

  ```text
  swt update --check
  ```

  Just queries the registry and prints the upgrade commands. Doesn't
  run anything. Useful for CI / scripts that don't want surprise
  installs.

  **`--json` mode:**

  Implies `--check`. Never auto-applies, regardless of flags. Scripts
  consuming `swt update --json` always get a deterministic JSON
  payload (no side effects).

  **What changed under the hood:**
  - `packages/cli/src/commands/update.ts` — `PACKAGE_NAME` constant
    fixed; new `applyUpdate()` helper spawns the user's package
    manager via `node:child_process.spawnSync`. Tests inject a fake
    spawn for coverage; production uses the real one.
  - `packages/cli/src/argv.ts` — registers `--check` and
    `--no-marketplace` as known flags so strict parseArgs doesn't
    reject them.
  - 4 new Vitest cases in `packages/cli/test/commands/update.test.ts`
    cover: default auto-apply via npm; npm-missing fallback to
    pnpm; no-package-manager USAGE_ERROR; JSON mode never spawns.

## 2.0.1

### Patch Changes

- v2.0.1 — Three UX fixes for the v2.0 dashboard surfaced by first-day
  user feedback. No breaking changes; safe upgrade for everyone on
  v2.0.0.

  **Fixes:**
  - **Command bar input clipping** — when the natural-language hint
    chip ("↵ Press enter to start a vibe session") was visible, it
    competed with the input for horizontal space and clipped typed
    characters off the left edge. Restructured so the hint chip sits
    in its own absolute-positioned row below the form, never
    competing for input space. Same fix applies to the unknown-verb
    and interactive-verb hints.
  - **"phase 1 of 0" display** — the TopBar status rendered
    `phase {phase_index} of {phase_count}` even when `phase_count
=== 0` (brand-new project, no phases scoped). Now shows
    "no phases yet" when phase_count is zero; the literal phase line
    only renders when there's at least one phase scoped.
  - **Silent idle vibe sessions** — v2.0.0 default behavior was to
    create vibe sessions but stay idle indefinitely (because
    `SWT_VIBE_AGENT=codex` is opt-in and unset by default). Users
    typed prompts and saw nothing happen. Now:
    - `POST /api/vibe` response includes a new `agent_backend` field
      (`'none' | 'codex' | 'scripted'`).
    - When the daemon has no agent factory wired (default), the
      response carries `agent_backend: 'none'`.
    - The dashboard renders an amber banner above the conversation
      thread: "No agent backend configured — Sessions can be created
      but no agent will run. To enable real Codex agents, install the
      Codex CLI and restart the dashboard with
      `SWT_VIBE_AGENT=codex swt`. v2.0 ships agents as opt-in until
      the prompt templates teach Codex to emit ASK_USER markers
      reliably."
    - A stderr log line also surfaces the same hint inline.

  **Schema additions:**
  - `VibeStartResponseSchema` gains optional `agent_backend` field
    in `@swt-labs/dashboard-core`. Optional for back-compat with
    v2.0.0 daemons.

  **What did NOT change:**
  - Wire format, session lifecycle, marker protocol, permission gate
    — all unchanged.
  - `swt` no-args dashboard launch + `SWT_NO_DASHBOARD=1` escape
    hatch unchanged.
  - The opt-in production runner gate (`SWT_VIBE_AGENT=codex`) is
    unchanged. v2.0.1 just makes the default's limitation visible
    instead of silent.

## 2.0.0

### Major Changes

- v2.0 — **Natural-Language-First Dashboard.** Pivots SWT from
  "methodology in your terminal, dashboard observes" to "dashboard IS
  the methodology surface, terminal is for power users." Non-technical
  users type "build me a snake game" in the dashboard command bar; SWT
  runs the methodology loop server-side; clarifying questions surface
  as chat-style messages; user replies inline; files appear in the
  project dir.

  **The headline change:** `swt` (no args) now opens the dashboard
  daemon and auto-opens your browser. Previously it printed help.

  **Migration from 1.x:**
  - `swt` (no args) → dashboard. Set `SWT_NO_DASHBOARD=1` to restore
    the legacy "print help on empty argv" behavior. `swt --help`,
    `swt --version`, and `swt help` are unaffected.
  - The terminal-side `swt vibe` flow is unchanged for power users.
    The methodology loop, agent profiles, and existing CLI surface
    are all preserved.
  - The dashboard daemon's existing `swt dashboard` command is
    unchanged — bare `swt` is now equivalent.

  **What's new:**
  - **Server-side vibe** (Phase 2). New `POST /api/vibe` endpoint
    accepts `{prompt}`, creates a session, spawns the methodology
    loop in the daemon process. Loop events (agent.spawn,
    agent.complete, log.append) flow through the existing SSE bus.
    Disk-backed sessions in `.swt-planning/.vibe-sessions/` survive
    daemon restarts.
  - **Conversational clarification protocol** (Phase 2). New
    `agent.prompt` SSE event with subtypes `'clarification'` and
    `'permission'`. Agents emit
    `<<<ASK_USER:{json}>>>` markers on stdout; the daemon surfaces
    the question via SSE; the user replies via
    `POST /api/vibe/:session_id/reply`; the daemon writes
    `<<<USER_REPLY:{json}>>>` to the agent's stdin. 1-hour
    clarification timeout, 5-minute permission timeout. FIFO single-
    outstanding-prompt enforcement per session.
  - **Permission boundary** (Phase 3). `DashboardPermissionGate`
    classifies tool calls: file writes inside the project root and
    file reads inside `$HOME` auto-allow; shell commands, network
    requests, and writes outside the project always require an
    inline confirm in the dashboard. "Approve once" / "Approve for
    session" / "Deny" with optional note. Session-scoped allowlist
    matches the v2-permission-model.md design.
  - **Frontend natural-language UX** (Phase 4). Command bar
    classifies free-form input (3+ tokens or first token 8+ chars)
    as natural language and routes to vibe instead of the literal
    verb allowlist. Chat-style cards render `agent.prompt` events
    inline in the log panel — free-form text reply, structured
    option buttons, or amber-shield permission card depending on
    subtype. Empty state reads "Describe what you want to build ↑"
    pointing at the command bar.
  - **First-run onboarding** (Phase 4). Dismissable 3-step explainer
    overlay on first dashboard visit; persists dismiss state under
    `swt:dashboard:onboarded-v1` localStorage key.
  - **Production agent runner** (Phase 2 Plan 02-04).
    `CodexMethodologyAgent` wraps `codex exec` via streaming
    `child_process.spawn` (stdin OPEN). Wired as the production
    agentFactory when `SWT_VIBE_AGENT=codex` env var is set —
    intentionally opt-in until follow-up agent-prompt template
    updates land that teach Codex to emit ASK_USER markers
    reliably.

  **What did NOT ship in 2.0.0 (planned for follow-up):**
  - Agent-prompt template updates so real Codex emits ASK_USER
    markers without manual prompt engineering. Until this lands,
    `SWT_VIBE_AGENT=codex` runs Codex as usual but won't surface
    clarification prompts in the dashboard chat.
  - Default-on production wiring of `CodexMethodologyAgent`. v2.0.0
    keeps the env-var opt-in.
  - Daemon restart resumption from `.vibe-sessions/` JSONL events.
    Sessions persist their event log to disk but the daemon doesn't
    yet rebuild in-flight session state from those logs at startup.
  - Cost-gating with hard limits and pre-spawn confirmation dialogs
    (deferred to v2.1).
  - Mobile-friendly responsive layout (deferred to v2.1).
  - Multi-session concurrency UI / session sidebar (deferred to v2.1).

  **Verification:**
  - `tsc --build` clean.
  - `eslint` clean on all touched .ts files.
  - `vitest run`: ~107 net new passing tests across the v2.0
    milestone (Phase 1 documentation; Phase 2: 70 tests covering
    schema + session module + HTTP routes + SSE filter + methodology
    loop + markers + ScriptedAgent + CodexMethodologyAgent; Phase 3:
    19 tests covering permission classification + integration +
    e2e via ScriptedAgent; Phase 4: 19 tests covering NL routing +
    chat rendering + onboarding storage + CLI no-args). Same ~42
    pre-existing failures as v1.7.x baseline; zero new regressions.
  - `idiot_check.py` Track A: pending verification against the
    published v2.0.0 binary.

  **Architecture decisions locked in `.vbw-planning/research/`:**
  - `v2-permission-model.md` — file-write classification, inline-
    confirm UX, decision persistence, REQ-14 composition.
  - `v2-agent-prompt-protocol.md` — SSE event schema, reply endpoint,
    context injection, timeout/serialization.

  Both docs include explicit "Rejected alternatives" sections so
  future maintainers see the decision space.

## 1.7.1

### Patch Changes

- v1.7.1 — README install-instruction refresh + idiot_check.py automation
  shipped alongside the published bundle for clarity.

  No runtime code changes — the published JS bundle is byte-for-byte
  identical to v1.7.0. This patch refreshes user-facing surface only.

  **What changed:**
  - `README.md` — install section adds a version-pin example
    (`npm install -g stop-wasting-tokens@1.7.0`), an upgrade-path
    snippet, and a pointer to the in-repo Python smoke-tester
    (`a_non_production_files/idiot_check.py`) for users who want to
    verify a release end-to-end before committing to a daily-driver
    upgrade. The "Verify the install" sample updates the example
    `swt --version` output from the stale `1.5.1` to `1.7.0`. The
    "What the package contains" list now mentions the dashboard SPA
    assets (`packages/dashboard/dist/client/`).
  - `a_non_production_files/idiot_check.py` (now tracked) — Python
    stdlib-only smoke-tester that automates 18 Track A checks against
    a globally-installed `swt` binary (~30s, no Codex tokens spent):
    built-ins, help, version, doctor, detect-phase, config round-trip,
    status, update, dashboard `/api/health` + `/api/snapshot` +
    `/api/command` × 3 routing, watch, stub-verb sweep.
  - Two test-script bugs fixed inline during the v1.7.0 verification
    run (both caused by the v1.7.0 fixes themselves, not regressions):
    A9 spawns the dashboard daemon in a dedicated tmpdir so A6's
    now-working `config set` doesn't pollute the greenfield assumption;
    A11 drops `init` from the stub list (X-02 promoted it to a real
    command). Net result: 18/18 PASS against published v1.7.0
    (vs. 13/18 baseline before the v1.7.0 fixes shipped).

  **Why a release:** The README updates are user-facing — pinning the
  install pointer and refreshing the version sample are visible to
  anyone reading the npm package page or the GitHub README. Bundling
  them with the idiot_check.py addition keeps both pieces of "release
  documentation" tied to a single npm version.

## 1.7.0

### Minor Changes

- v1.7.0 — Frontend polish + dashboard-store coverage; closes the v1.6.6
  audit catalog (22 audit findings) plus the 2 new CLI bugs surfaced by
  `idiot_check.py`.

  **Milestone scope:** 4 phases / 22+1 audit findings closed. Phases 01
  (CLI surface fixes) and 02 (backend + schema hardening) shipped
  cumulatively in v1.6.8 alongside the resizable-panels feature; v1.7.0
  adds Phase 03 (frontend polish + Vitest store-action coverage).

  **What changed in v1.7.0 itself (Phase 03 — `packages/dashboard/src/client/`):**
  - Connection pill gains a `'syncing'` state for the post-snapshot,
    pre-first-onOpen window (closes F-05). Eliminates the flash of
    `DISCONNECTED` on slow networks. The pill only flips to `'error'`
    once the SSE stream has been successfully open at least once and
    then dropped — transient errors during the initial sync window
    stay in `'syncing'` and let the SSE wrapper auto-reconnect.
  - `runCommand` re-fetches the snapshot only for **mutating verbs**
    (`init`, `vibe`, `archive`, `fix`) (closes F-06). Read-only verbs
    (`status`, `help`, `doctor`, `version`, `update`, `detect-phase`)
    skip the redundant `/api/snapshot` round-trip and rely on SSE
    `state.changed` events instead. Verb match is case-insensitive on
    the first whitespace-delimited token.
  - `TopBar` status section renders project / milestone / phase as
    three independent `<Show>` blocks with per-field italic
    placeholders (`project: …`, `milestone: …`, `phase: …`) (closes
    F-10). Replaces the all-or-nothing
    `<Show when={project && milestone}>` that previously hid the phase
    index whenever either was missing.
  - New `packages/dashboard/test/dashboard-store.test.ts` — 8 cases
    covering `initProject` optimistic flip + rollback, `runCommand`
    verb-aware refresh, and the
    `connecting → syncing → connected → error` transition graph
    (closes T04). The rollback test caught a real bug in the existing
    code: `previousSnapshot` was a SolidJS store proxy reference that
    got mutated by the optimistic `setState`, so the rollback no-op'd.
    Fixed by shallow-spreading the snapshot at capture time.

  **Cumulative v1.7.0 audit closure (Phases 01–03):**

  | Phase                                     | Audit IDs closed                                                       | Where                                                                                                                            |
  | ----------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
  | 01 — CLI surface (shipped in v1.6.8)      | A5.b, A6.c, X-02, C-01, C-04                                           | `packages/cli/src/argv.ts`, `packages/cli/src/commands/{config,init,dashboard}.ts`, `packages/core/src/scaffold/init-project.ts` |
  | 02 — Backend + schema (shipped in v1.6.8) | B-08, B-09, B-10, B-11, B-12, B-13, B-14, B-15, B-16, S-01, S-02, S-04 | `packages/dashboard/src/server/**`, `packages/dashboard-core/src/schemas/**`                                                     |
  | 03 — Frontend + tests (this release)      | F-05, F-06, F-10, T04                                                  | `packages/dashboard/src/client/**`, `packages/dashboard/test/dashboard-store.test.ts`                                            |

  **What did NOT change:** server bundle and CLI bundle are byte-for-byte
  identical to v1.6.8 (Phase 03 is client-side + tests only). The npm
  tarball delta is roughly +1.2 KB (TopBar.tsx + dashboard-store.ts
  edits compiled into the SPA bundle) plus the new test file in the
  source-only tree.

  **Verification:**
  - `tsc --build` clean.
  - `eslint` clean on touched `.ts` files.
  - `vitest run`: 42 failed / 572 passed (= same 42 pre-existing
    failures as the v1.6.8 baseline + 8 net new passes from
    `dashboard-store.test.ts`; zero new regressions).
  - `idiot_check.py` Track A: pending verification against the
    published v1.7.0 binary (target: 18/18 vs 13/18 baseline before
    A5.b + A6.c + X-02 fixes shipped).

## 1.6.8

### Patch Changes

- v1.6.8 — Resizable dashboard panels.

  The 4-panel localhost dashboard grid (phase stepper / artifact tree /
  preview+log column / agents+cost column) is now drag-resizable on every
  split. Layout fractions persist to `localStorage` under the key
  `swt:dashboard:layout-v1` so a refreshed tab keeps the user's column
  widths.

  **What changed:**
  - `packages/dashboard/package.json` — adds `@corvu/resizable@^0.2.5`
    (Solid drag-handle library, MIT-licensed, ~3 KB gzipped).
  - `packages/dashboard/src/client/App.tsx` — the 4-panel `<main>` grid
    is wrapped in `<Resizable>` (horizontal) with two nested vertical
    `<Resizable>` instances for the center column (preview / log) and
    right column (agents / cost). Each `<Resizable.Handle>` carries an
    `aria-label` for keyboard / screen-reader navigation. The
    `onSizesChange` callbacks persist via `saveLayout()`.
  - `packages/dashboard/src/client/lib/layout-storage.ts` (new) —
    `loadLayout()` / `saveLayout()` with strict per-array length
    validation (4 fractions for main, 2 each for center/right) and a
    `DEFAULT_LAYOUT` fallback if `localStorage` is unavailable
    (private mode, quota exceeded, SSR / non-browser runtime). Storage
    access is gated behind a typed `getStorage()` helper that respects
    the `globalThis.localStorage` contract without leaning on full DOM
    types.
  - `packages/dashboard/src/client/components/styles.css` — new
    `.resizable-*` selectors for the horizontal/vertical handle
    containers. Handles are 8 px wide (col) / 8 px tall (row) with a
    32 px terminal-green visual indicator at hover/focus/active. The
    indicator uses `box-shadow` for the glow effect, matching the
    existing brand palette (`var(--terminal-green)`, low-opacity
    background).

  No schema changes, no API changes, no daemon-side changes. Pure
  client-side feature. Existing users on v1.6.7 dashboards will see
  the default layout on first load of v1.6.8 and any subsequent
  drag-resizes are auto-persisted.

  **Constraints:**
  - Min sizes per panel are conservative (`0.08–0.25` of parent) so
    no panel can be collapsed to zero width.
  - The handle hover / focus-visible / active states all collapse to
    the same visual treatment, so keyboard-driven layout changes
    (Tab + arrow keys per `@corvu/resizable`'s built-in semantics)
    are visible.

  This release does not modify any of the v1.6.6 audit closures or
  v1.6.7 docs work. v1.7.0 (in-progress, ~22 audit closures + new
  CLI bugs) will land on top of this 1.6.8 baseline so its Phase 03
  frontend polish can extend the resizable layout cleanly.

## 1.6.7

### Patch Changes

- v1.6.7 — Docs-only release: VBW ↔ SWT command parity audit + README
  refresh.

  No source code, schema, or runtime changes. The `## Command reference`
  section in `README.md` is rewritten as a 3-section breakdown:
  - **Working today (10)** — table of every verb that actually runs
    in the published binary, with use case per command (`swt vibe`,
    `swt status`, `swt doctor`, `swt detect-phase`, `swt config`,
    `swt update`, `swt watch`, `swt dashboard`, `swt help`, `swt
version`).
  - **Stub (22)** — table of placeholder verbs that return
    `EXIT.NOT_IMPLEMENTED` (exit code 78) with a roadmap-phase
    pointer. Each row notes the "reach today via" path — most are
    accessible as `swt vibe --flag` so users don't need to wait for
    the standalone implementation.
  - **VBW commands without an SWT equivalent** — explicit "don't
    port" decisions for `/vbw:compress`, `/vbw:rtk`, `/vbw:teach`,
    `/vbw:report` (Codex CLI handles compaction natively; RTK is
    external-only; SWT uses MEMORY.md self-healing instead of teach;
    report has no concrete use case yet) plus three folded commands
    (`/vbw:profile` → `swt config`, `/vbw:verify` → `swt vibe
--verify`, `/vbw:list-todos` → `swt todo`).
  - **Use case quick-pick** — five common user intents (fresh
    project / daily work / something broken / config tweaks /
    discoverability) mapped to the right verb so users don't grep
    the full table.

  Audit summary: all 26 VBW slash commands are accounted for in
  SWT (10 working + 22 stub + 4 explicitly not ported + 3 folded
  into another command). Full coverage.

  Also refreshes `CLAUDE.md` Active Context to point at milestone
  06 (v1.6.6 Dashboard ↔ CLI Integration Audit and Fix) — was
  previously pointing at milestone 05.

  This release exists primarily so the npm tarball includes the
  refreshed `README.md` (which the npm package page renders).
  Functional behavior is identical to v1.6.6.

## 1.6.6

### Patch Changes

- v1.6.6 — Dashboard ↔ CLI integration audit & hardening.

  Closes both originally-reported v1.6.5 user bugs ("blink, nothing happened"
  on the Init button; command bar treating natural language as literal argv)
  and 14 additional audit-surfaced findings across the dashboard server,
  client SPA, schemas, and install-smoke gates. Driven by a 36-finding audit
  catalog (`.vbw-planning/milestones/.../01-audit-and-catalog/AUDIT.md`)
  produced before any code changes — the audit + routing approach made the
  user-reported issues obvious symptoms of a deeper integration gap rather
  than two isolated bugs.

  **Backend (Plan 02-01 — `packages/dashboard/src/server/`):**
  - `B-01 (S0)`: `vibe` no longer hangs the command bar. The route used to
    spawn with `stdio: ['ignore', 'pipe', 'pipe']` (stdin closed), so any
    interactive verb blocked on its first prompt and was killed at the
    hardcoded 10s timeout. The new `classifyVerb()` helper rejects
    interactive verbs up-front with `routing_decision: 'rejected_interactive'`
    and points the user at their terminal. No spawn occurs; response returns
    in 0ms.
  - `B-02 (S1)`: Whitespace-split argv is now classified through a 6-verb
    allowlist (`help`, `version`, `status`, `doctor`, `detect-phase`,
    `update`). Allowlist match → spawn `swt <argv>` literally. Stub verbs
    (`init`, `plan`, `execute`, etc.) and natural-language input fall to
    `routing_decision: 'rejected_unknown'` with a helpful hint listing the
    allowlist.
  - `B-03 (S1)`: Hardcoded 10s timeout replaced with per-verb budgets:
    short verbs (`help`, `version`, `status`) = 5s; scan verbs
    (`doctor`, `detect-phase`) = 15s; network verbs (`update`) = 30s.
    `SWT_DASHBOARD_COMMAND_TIMEOUT_MS_DEFAULT` env var raises the floor
    for power users; per-verb caps still apply unless the env override
    exceeds them.
  - `B-04 (S1)`: Spawn target is now the daemon's adjacent `cli.mjs`
    resolved via `import.meta.url`. Both bundles ship side-by-side in
    `dist/` per `tsup.config.ts`, so
    `dirname(fileURLToPath(import.meta.url)) + '/cli.mjs'` is always
    reachable for `npm i -g` installs. Falls back to PATH `swt` only
    for in-repo dev where the daemon source runs unbundled.
  - `B-05/B-06/B-07 (S2)`: `FORBIDDEN_VERBS` denylist (which only blocked
    `dashboard` + `watch`) replaced with the inverse `ALLOWED_VERBS`
    allowlist. Eliminates the "stub verbs run and return NOT_IMPLEMENTED"
    path (`B-06`) and the "swt init shadows /api/init" contradictory
    contract (`B-07`).
  - `S-03 (S2)`: `CommandResponseSchema` extended with `routing_decision:
'literal' | 'rejected_interactive' | 'rejected_unknown'` and `verb:
string | null`. Both have schema defaults so v1.6.0–v1.6.5 clients
    aren't broken on parse.
  - `X-01 (S0)`: Real-vs-stub clarity. Of the 32 CLI verbs (10 real + 22
    stubs), only 6 are now reachable via the command bar — explicitly
    documented in `packages/dashboard/src/server/lib/allowed-verbs.ts`
    as a hand-mirror of `packages/cli/src/main.ts:buildRegistry()`.
    Mirror is intentional: the dashboard server bundle ships standalone
    per `tsup.config.ts`; a runtime import from `packages/cli` would
    couple build graphs.
  - `X-03 (S2 ½)`: `scripts/verify-install.sh` extended with three
    `/api/command` POST checks after `/api/snapshot`: allowlist verb →
    `routing_decision: 'literal'`; interactive verb → `rejected_interactive`;
    unknown verb → `rejected_unknown`. Each failure prints the offending
    `CommandResponse` JSON before exiting non-zero. CI gates the entire
    contract before npm publishes.

  17 new Vitest cases across `packages/dashboard/test/{allowed-verbs,
command-route}.test.ts` exercise the routing contract under mocked
  `child_process.spawn`.

  **Frontend (Plan 03-01 — `packages/dashboard/src/client/`):**
  - `F-01/F-02 (S1, S1)`: The user's "blink, nothing happened" complaint
    is closed by optimistic UI. `dashboard-store.ts:initProject` now
    captures the current snapshot, synthesizes an optimistic snapshot
    with `is_initialized: true`, and `setState`s it BEFORE awaiting
    `postInit`. App.tsx's `isInitialized()` createMemo flips on the same
    reactive tick — InitScreen unmounts immediately, 4-panel grid mounts.
    A `[ok] Initialized .swt-planning/ — type 'help' for available
subcommands.` line appends to the LogPanel as in-band confirmation.
    On `postInit` failure, the optimistic snapshot rolls back to the
    captured `previousSnapshot` and InitScreen reappears with a clean
    error.
  - `F-03/F-04 (S1, S1)`: Command-bar UX. Placeholder text drops `vibe`
    (rejected_interactive post-Plan 02-01) and adds `version` + `update`
    to match the actual allowlist. A new `classifyInput()` helper mirrors
    the server's `classifyVerb()`. `createMemo<VerbStatus>` derives
    `'empty' | 'literal' | 'interactive' | 'unknown'` from the input
    signal. Conditional `<Show>` renders an inline hint chip below the
    input: amber "↪ Try: status, doctor, …" for unknown verbs, cyan
    "↪ Interactive — run from your terminal" for `vibe`/`watch`/
    `dashboard`. The chip surfaces the routing contract instantly,
    before the user hits Enter.
  - `F-07 (S2)`: Empty-state prose nudges. App.tsx phase-stepper fallback
    now reads "No phases yet. Run `swt vibe` from your terminal to scope
    a milestone, or type `help` in the command bar above for available
    subcommands." `AgentTimeline.tsx` similarly: "No agent activity yet.
    Run `swt vibe` in your terminal to start the methodology loop."
    Tells the user what to do next instead of just stating a fact.
  - `F-08 (S2)`: New `readErrorMessage(res)` helper in `services/api.ts`
    parses fetch error bodies as JSON and extracts `{error, detail}`.
    `InitScreen.setError()` now displays "init_failed: permission denied"
    instead of `HTTP 500: {"error":"init_failed","detail":"permission
denied"}`. Falls back to raw text or status-only on non-JSON bodies.
  - `F-09 (S2)`: `InitScreen.tsx:submit()` adds `if (props.submitting)
return;` as the first statement. Guards against double-fire when
    the user smashes Enter while focus is in the textarea (the button
    is disabled, but the form still submits on Enter from descendants).

  **Deferred to v1.7** (S2/S3 polish, not v1.6.6 closure-blocking):
  - `B-08`/`S-01`/`S-02` — `/api/init` returning the snapshot inline +
    schema cleanup. Closed by F-02's optimistic UI on the user-reported
    failure mode; the round-trip optimization is belt-and-suspenders.
  - `B-09`/`B-10` — SSE initial-frame replay + queue cap. Defense-in-depth
    only; current behavior works under typical loads.
  - `B-11` — Snapshotter parent-dir watcher for greenfield → terminal-side
    `swt init` auto-detection. Audit-surfaced edge case, not in any user
    failure mode.
  - `B-12`/`B-13`/`B-14`/`B-15`/`B-16` — server-side hardening (changed
    array specificity, artifact allowlist, project root walk cap, health
    daemon_version, UAT placeholder cleanup). All audit-surfaced.
  - `S-04` — `HealthResponseSchema` daemon version. Cosmetic.
  - `X-02` — `swt init` real CLI command. Still a stub; `/api/init` is
    the only path. Audit-surfaced contradictory contract.
  - `F-05` (connection pill flashing), `F-06` (snapshot refetch
    efficiency), `F-10` (TopBar fallback), `C-01` (CLI debug stderr
    passthrough), `C-04` (isTTY default true). All cosmetic / debug-only
    paths.
  - Vitest store-action coverage for `initProject` / `runCommand` —
    needs Solid reactive test scaffolding not present in the current
    suite.

  Full audit catalog with severities + per-issue routing is preserved
  in the v1.6.6 milestone archive at
  `.vbw-planning/milestones/.../01-audit-and-catalog/AUDIT.md` (36
  findings; 16 closed in v1.6.6; 20 deferred to v1.7).

  **No new dependencies, no schema breaking changes, no API surface
  changes beyond `CommandResponse.routing_decision` + `verb` (both
  defaulted for back-compat).**

## 1.6.5

### Patch Changes

- v1.6.5 — Validates the hands-off Trusted Publisher OIDC release flow.

  Same product code as v1.6.4. This bump exists to confirm end-to-end
  that the npm publish path is now genuinely zero-touch:
  1. Bump `package.json:version` + `CHANGELOG.md ## X.Y.Z` entry,
  2. `git push origin main`,
  3. ~80 seconds later, `npm view stop-wasting-tokens version` returns
     the new version. No NPM_TOKEN, no OTP, no terminal-side `npm
publish` invocation, no human in the loop.

  The Release workflow now uses npm Trusted Publisher (OIDC) — the
  GitHub Actions runtime token is exchanged with the npm registry for
  an ephemeral publish authorization scoped to this exact repo +
  workflow file (`swt-labs/stop-wasting-tokens` ·
  `.github/workflows/release.yml`). On the npm side, the package is
  locked to "Require 2FA and disallow tokens (recommended)" so
  token-based publishes are rejected outright — OIDC is the only
  path. Tokens can no longer be stolen and used to publish.

  The plumbing pieces, all landed in v1.6.4's release cycle:
  - `release.yml` — `node-version: 24` (ships npm 11.x with OIDC
    publish support; Node 22's npm 10.x had only provenance signing,
    which is why every previous CI publish 404'd after sigstore
    stamping).
  - `release.yml` — drop `NPM_TOKEN` env from the changesets/action
    step so npm CLI takes the OIDC path instead of falling back to
    token auth.
  - npm package access — Trusted Publisher rule for `swt-labs/stop-
wasting-tokens` + workflow filename `release.yml` (no environment).
  - npm package access — "disallow tokens" radio set, locking out
    any future token-based publish drift.

  No source / runtime / API surface changes. If `npm view stop-wasting-
tokens version` shows `1.6.5` after this commit lands, the OIDC flow
  is verified for real users and every subsequent patch release ships
  via the same one-step push.

## 1.6.4

### Patch Changes

- v1.6.4 — `swt dashboard` finds its bundle from any directory.

  v1.6.3 published the dashboard with a `resolveDaemonEntry()` that
  looked for `dist/dashboard-server.mjs` **relative to the user's CWD**,
  with a hand-rolled "go up 4 dirs and probe" fallback that only
  worked from inside the source repo. For anyone who installed via
  `npm i -g stop-wasting-tokens` and then ran `swt dashboard` from
  any directory other than the repo root (i.e., 100% of real users),
  the daemon couldn't be located and the CLI failed with the
  misleading "Run `pnpm build` from the repo root" error.

  **Root cause.** The CLI bundle (`dist/cli.mjs`) and the daemon
  bundle (`dist/dashboard-server.mjs`) ship as siblings in the
  published tarball — both are emitted by tsup into the same
  `dist/` and both are listed under `package.json:files`. When
  Node loads `cli.mjs`, `import.meta.url` resolves to its install
  location, and the daemon is **always** at
  `join(dirname(fileURLToPath(import.meta.url)), 'dashboard-server.mjs')`
  regardless of the user's CWD. The CWD-based check shipped in
  v1.6.0 was a leftover from local-dev orchestration that never
  applied to published installs.

  **Fix** (`packages/cli/src/commands/dashboard.ts`):
  `resolveDaemonEntry()` now resolves three candidate paths in
  order, with the bundle-adjacent path first so it always wins
  for real users:
  1. **Adjacent to `cli.mjs` itself** — the path that always works
     for `npm i -g` installs and for `node ./dist/cli.mjs`
     invocations from the source repo.
  2. **Repo-relative `dist/dashboard-server.mjs`** computed via
     `realpath(...)` walk-up from `cli.mjs` — covers `pnpm tsx
packages/cli/src/index.ts` flows where the bundled daemon
     exists at the repo's root `dist/` but the unbundled cli is
     in `packages/cli/src/`.
  3. **Repo-relative source `index.ts`** — covers the in-repo
     dev case where neither bundle exists yet but the daemon
     source is reachable.
  4. **CWD-relative `dist/dashboard-server.mjs`** — last-resort
     legacy fallback for "I just ran `pnpm build` and am in the
     repo root."

  Error message rewritten to point at re-installation rather than
  `pnpm build` since the new failure mode is "your global install
  is corrupt" rather than "you forgot to run a build step."

  **Defensive: install-smoke now exercises `swt dashboard`.**
  `scripts/verify-install.sh` gains a 6th check: spawn the daemon
  in the background, `curl /api/health` and `/api/snapshot` to
  confirm both the dashboard server and the SPA fallback fix
  from v1.6.2 are still working, then kill the daemon. This
  catches:
  - "daemon bundle not found" (v1.6.4's class of regression)
  - "SPA fallback eats /api/\* paths" (v1.6.2's regression)
  - "daemon refuses to start" (any future Hono/binding issue)
    …all at the publish gate, before the bug reaches users.

  **Verified end-to-end** by simulating the full `npm i -g` flow:
  `npm pack` the local dist, `npm install --prefix /tmp/...` the
  resulting tarball, `cd /tmp/empty-dir && swt dashboard --no-open`
  → daemon boots, `/api/health`, `/api/snapshot`, and `/` all
  serve correctly with no `pnpm` anywhere in sight.

  No new dependencies, no schema changes, no API surface changes.
  Pure resolution-bug fix + smoke-test hardening.

## 1.6.3

### Patch Changes

- v1.6.3 — Greenfield init UX + inline command bar.

  v1.6.2 made the dashboard daemon serve its own SPA, but the SPA still
  showed a misleading "DISCONNECTED" indicator when run from a directory
  that didn't have `.swt-planning/` yet — and there was no path forward
  in-browser, since `swt init` is a stub in the published binary. v1.6.3
  fixes both of those and adds an inline command input next to the
  brand cursor so the dashboard mirrors the CLI surface 1:1 with visual
  feedback.

  **Greenfield init flow**
  - `packages/dashboard-core/src/schemas/snapshot.ts` — `project`,
    `milestone`, `cost_summary` are now nullable on the snapshot
    schema, plus a new `is_initialized: z.boolean().default(true)` flag.
  - `packages/dashboard/src/server/snapshot/empty.ts` — synthesizes a
    `is_initialized: false` snapshot for greenfield daemons.
  - `packages/dashboard/src/server/routes/snapshot.ts` — registers
    unconditionally with a getter so a snapshotter that lights up
    after `POST /api/init` is picked up automatically; serves the
    synth when the getter returns null.
  - `packages/dashboard/src/server/routes/init.ts` — new
    `POST /api/init { name, description? }` endpoint that scaffolds
    `.swt-planning/PROJECT.md` + `.swt-planning/STATE.md` + an empty
    `phases/` dir, then triggers a snapshotter spin-up so subsequent
    `/api/snapshot` polls + SSE `state.changed` events flow.
    `409 already_initialized` if `.swt-planning/` already exists.
  - `packages/dashboard/src/client/components/InitScreen.tsx` —
    centered onboarding card with project-name input + description
    textarea + "Initialize SWT project" button, rendered when the
    snapshot reports `is_initialized: false`.
  - `App.tsx` branches on `snapshot.is_initialized`: false → InitScreen,
    true → the existing 4-panel grid.

  **Inline command bar (CLI parity)**
  - `packages/dashboard-core/src/schemas/api.ts` — new
    `CommandBodySchema` / `CommandResponseSchema` (`{ input }` →
    `{ ok, exit_code, stdout, stderr, duration_ms }`).
  - `packages/dashboard/src/server/routes/command.ts` — new
    `POST /api/command` route. Splits the input on whitespace
    (no shell parsing — args go directly to `child_process.spawn`),
    invokes the user's installed `swt` binary in the daemon's cwd,
    captures stdout/stderr with a 10 s timeout, returns the result.
    `dashboard` and `watch` are rejected with helpful errors
    (recursive launch / Ink TUI requires an interactive terminal).
  - `packages/dashboard/src/client/components/TopBar.tsx` — new
    inline `<form>` with a `$` prompt and an input next to the
    blinking cursor. Submit on Enter routes to the new `runCommand`
    store action.
  - `dashboard-store.runCommand` appends `$ swt <input>` plus each
    stdout/stderr line into `recentLogLines` so users see the
    command echo + response in the LogPanel exactly like a terminal.
    Re-fetches the snapshot opportunistically after each command so
    state-mutating verbs (init via CLI, future archive, etc.) reflect
    immediately.

  **Bug fixes carried in this release**
  - SPA fallback at `app.get('*')` now skips `/api/*` paths so missing
    API routes return real JSON 404s instead of HTML — closes the
    masking bug introduced by v1.6.2's static-files wiring.
  - `packages/dashboard/src/server/snapshot/reducer.ts` adds
    `is_initialized: true` to the reducer's output so the live
    snapshotter's snapshot matches the schema's expected shape.

  **Verified end-to-end** (greenfield → init → connected → command):
  - `GET /` → 200 + index.html
  - `GET /api/snapshot` (greenfield) → 200 + `is_initialized: false`
  - `POST /api/init` → 200 + creates the three artifacts
  - `GET /api/snapshot` (post-init) → 200 + `is_initialized: true`
  - `POST /api/command { input: "help" }` → 200 + real swt help
  - `POST /api/command { input: "watch" }` → 200 + `ok: false`
  - typecheck + lint --max-warnings 0 + format:check all green

  No new runtime dependencies; `@hono/node-server/serve-static` was
  already pulled in by v1.6.2.

## 1.6.2

### Patch Changes

- v1.6.2 — Dashboard daemon serves the SPA.

  v1.6.1 shipped the localhost dashboard daemon and the bundled SPA
  (`packages/dashboard/dist/client/`) as separate concerns. The daemon
  registered all the API routes (`/api/snapshot`, `/api/events`,
  `/api/artifact`, `/api/uat/:phase/checkpoint`, `/api/health`,
  `/api/_debug/emit`) but never registered a static-file handler for
  `GET /`. Result: `swt dashboard` happily reported `Listening on
http://127.0.0.1:54320`, but a browser visiting that URL got
  `404 Not Found` because Hono had no route matching `/`.

  The Phase 02 UAT had verified the SPA via Vite's dev server (proxying
  `/api/*` to the daemon), and the Phase 04 `swt dashboard` smoke
  CHECKPOINT was answered PASS without an actual end-to-end
  `npm install -g + swt dashboard + open browser` run. So the gap shipped.

  **Fix.** `packages/dashboard/src/server/index.ts` now registers a
  `serveStatic` route from `@hono/node-server/serve-static` that mounts
  the bundled SPA at `/`, plus an SPA fallback for unknown GET paths so
  client-side routing (deep links, refreshes) works. The static-files
  directory is resolved at runtime via `import.meta.url` with three
  candidate paths covering: published tarball
  (`dist/dashboard-server.mjs` → `../packages/dashboard/dist/client`),
  in-repo dev (`src/server/index.ts` → `../../dist/client`), and a
  CWD-relative fallback. If none exist, the static block is skipped
  silently — API-only mode still works.

  **Verified locally.**
  - `GET /` → 200 + index.html (correct script + style tags)
  - `GET /assets/index-*.js` → 200 + ~93 KB JS bundle
  - `GET /assets/index-*.css` → 200 + CSS bundle
  - `GET /api/health` → 200 + JSON (existing API unaffected)

  No new dependencies; `@hono/node-server` was already a dashboard dep.

## 1.6.1

### Patch Changes

- v1.6.1 — Codex SDK conformance hardening, post-v1.6.0.

  Closes the three deferred findings from the v1.5.1 SDK conformance pass (F-07, F-15, F-17) and fixes a pre-existing TOML emit bug surfaced while running the new test sweep. No public-API breaking changes; all additions are optional. The Codex backend driver (`@swt-labs/codex-driver`) now exhibits 59/59 green tests against the documented Codex schema.

  **F-07 — Role aliasing**
  - `packages/core/src/abstractions/AgentSpawner.ts` adds `aliases?: readonly string[]` to `AgentSpec`. Optional; when omitted the emitted TOML is byte-identical to v1.6.0 output.
  - `packages/codex-driver/src/toml/agents.ts` — `emitAgentToml` emits `aliases = [...]` only when `spec.aliases` is non-empty, so legacy specs without the field stay on the existing emit path.
  - `packages/codex-driver/test/toml.test.ts` — 2 new cases: emit-when-present, omit-when-absent-or-empty.

  **F-15 — `AGENTS.override.md` support**
  - `packages/codex-driver/src/agents-md/writer.ts` — new helpers `composeAgentsMdBody(swtBody, overrideContent?)` and `readAgentsOverrideSync(projectRoot)`, plus the public exports `OVERRIDE_BEGIN_FENCE`, `OVERRIDE_END_FENCE`, and `AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md'`.
  - Pattern: when `AGENTS.override.md` is present at the project root, its content is folded into the SWT-managed block of `AGENTS.md` between dedicated override fences, so user-authored project-specific rules survive every `swt init` / `swt vibe` regeneration.
  - Empty / whitespace-only overrides are silently dropped — no override fence appears at all.
  - `packages/codex-driver/test/agents-md.test.ts` — 6 new cases: no-override / explicit-override / empty-override / read-when-missing / read-when-present / regenerate-round-trip.

  **F-17 — Agent prompt cache-hit measurement**
  - `packages/codex-driver/test/cache-hit.test.ts` (new file) — locks down REQ-05 (cache-aware split prompts) by asserting:
    1. Two `emitAgentToml(spec)` calls with the same spec produce byte-identical output and identical SHA-256 digests (cache key stability).
    2. Mutating the static prefix layer (`developer_instructions`) yields a different digest, so silent-prefix-drift regressions surface as test failures rather than degraded production cache hit-rate.
    3. Object key-insertion-order shuffles do not change the emitted TOML — defends against deterministic emit going wobbly if the upstream `AgentSpec` schema is ever refactored.

  **Pre-existing bug fix — `[features]` table emission**
  - `packages/codex-driver/src/toml/features.ts` — `emitFeaturesToml(flags)` was calling `emitToml({ features: entries })`, which applied the inline-table heuristic for primitive-only sub-objects and produced `features = { foo = true, bar = false }` instead of the documented Codex `[features]` table header.
  - The pre-existing test `toml.test.ts > features TOML > emits a [features] table when flags are present` was failing at HEAD as a result — caught only because the F-07 batch ran the suite end-to-end.
  - Replaced with a direct-emit implementation that always writes the `[features]` header followed by `key = value` lines. Empty input still returns an empty string so callers can no-op cleanly.

  **Quality gate trail**
  - `prettier --check .` clean.
  - `tsc --build packages/{core,codex-driver}` exit 0.
  - 59/59 codex-driver vitest cases green (was 57/59 at v1.6.0 HEAD due to the latent `[features]` bug).
  - 11 new test cases added (2 F-07 + 6 F-15 + 3 F-17).

  **Documentation**
  - `.vbw-planning/REQUIREMENTS.md` (local-only, gitignored) refreshed with shipping-evidence notes — most REQ-01..REQ-17 now `[x]` against actual code locations.
  - `a_non_production_files/issues1.md` catalogs the full audit trail: closed items, deferred items, blocked items (npm publish, plugin-marketplace submission, docs-site publish), and live-runtime verification gaps.

  **Out of scope (deferred to next milestone):** Playwright e2e suite × Linux + macOS, `axe-cli` automated CI a11y gate, published `docs.stopwastingtokens.dev` site, full Claude Code driver implementation (REQ-V2-02), full Ollama driver implementation (REQ-V2-03), real Codex `subagent`-spawn API wiring once OpenAI publishes the surface, telemetry / Vale / hook-taxonomy long-tail.

## 1.6.0

### Minor Changes

- v1.6.0 — Localhost Dashboard.

  Adds a localhost web dashboard (`swt dashboard`) that renders live SWT project state — phases, plans, summaries, agent timeline, log stream, cost rollups — with a Hono daemon, a Solid SPA, chokidar file-watching, and SSE-driven live updates. UAT CHECKPOINTs can be recorded from the browser. Defence-in-depth localhost-only binding, exponential-backoff SSE reconnect, server-side log rate limiting, client-side artifact virtualization, and bundle-size + offline guards round out the production polish. Implements `non_production_files/UI/TDD.md` end-to-end across 4 phases.

  **Phase 01 — Workspace Foundation and Schema Spike:**
  - New `packages/dashboard/` (Hono server + Solid client) and `packages/dashboard-core/` (shared Zod schemas: `Snapshot`, `SnapshotEvent`, `ApiSchemas`).
  - Vite dev-mode `/api` proxy + tsup server bundle into `dist/dashboard-server.mjs`.
  - SSE round-trip from a dummy event source proven against `EventSource('/api/events')` within 250 ms.

  **Phase 02 — MVP Read-Only Dashboard:**
  - chokidar watcher → debounced snapshot reducer → SSE incremental events.
  - Endpoints `GET /api/snapshot`, `GET /api/events`, `GET /api/artifact?path=...` with path-traversal guard restricted to `.swt-planning/**` + `dist/**` allowlist.
  - Markdown rendered server-side through unified + remark-parse + remark-gfm + remark-rehype + rehype-sanitize + `@shikijs/rehype` + rehype-stringify.
  - Components: TopBar, PhaseStepper, ArtifactTree, ArtifactPreview. CSS tokens derived from `non_production_files/UI/BRANDKIT.md` (terminal-green, deep-void, ghost-white, neon-cyan, warm-amber, danger-red, slate-muted).

  **Phase 03 — Live Event Stream and UAT:**
  - New `packages/cli/src/lifecycle/event-bus.ts` emits structured `.swt-planning/.events/<sessionId>.jsonl` records (5 typed variants: `agent.spawn`, `agent.complete`, `phase.transition`, `qa_gate`, `log.append`) with 50 ms buffered flush.
  - Daemon-side JSONL tailer (chokidar + per-file byte-offset tracking) bridges CLI events through the existing SSE channel.
  - Live UI panels: AgentTimeline (newest-first cards with role colors + tokens/cost/duration), LogPanel (200-line cap + ↓ jump-to-live pill + ANSI parser), CostPanel (three big JetBrains-Mono numbers).
  - SSE exponential-backoff reconnect: `[1000, 2000, 5000, 10000]` ms cap. On second open, fresh `GET /api/snapshot` re-fetch recovers from drift during disconnect.
  - UAT modal + `POST /api/uat/:phase/checkpoint` (Zod-validated body, 200/400/404/409 contract). Repo-level `.gitignore` extended with `.swt-planning/.events/`.

  **Phase 04 — CLI Integration and Polish:**
  - New `swt dashboard` subcommand wired into the CLI registry. Flags: `--port=N`, `--host=H`, `--unsafe-public`, `--no-open`, `--debug`. Free-port picker (54320–54420 then OS-assigned fallback).
  - **AC-14 binding guard, defence-in-depth:** both the CLI command and the server boot path refuse non-loopback bindings unless `--unsafe-public` (or `SWT_DASHBOARD_UNSAFE_PUBLIC=1`) is set. Symmetrical implementation in `packages/cli/src/lib/binding-guard.ts` + `packages/dashboard/src/server/lib/binding-guard.ts`.
  - **AC-01 browser auto-open** via the `open` package (lazy-imported), disabled automatically under `CI=1` or non-TTY.
  - **Performance polish:** server-side `log.append` rate limit at 100 lines/sec with synthetic drop-notice; client-side `ArtifactPreview` virtualization at 500 paragraphs with `Show paragraphs N+1–M of total` pill.
  - **Size + offline guards:** `scripts/check-bundle-size.mjs` enforces SPA ≤ 80 KB gzipped + daemon ≤ 200 KB raw; `scripts/check-offline.mjs` greps the SPA bundle for forbidden CDN hosts.
  - **Docs:** `docs/swt-dashboard.md` documents the full subcommand surface (flags, env overrides, AC-14 binding guard, AC-01 auto-open, AC-11 offline guarantee, AC-10 size budgets, AC-12 / AC-13 accessibility). README.md links to it.

  **Acceptance criteria addressed:** AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15.

  **Quality gate trail:**
  - 4/4 phases QA PASS (5 must-haves per phase, M1–M5).
  - 17/17 UAT CHECKPOINTs PASS across the 4 phases.
  - 94 files modified across the milestone with 0 phase-level deviations.
  - All hard archive gates passed (UAT guard + state-consistency + 7-point audit).

  **Stack additions** (locked at TDD §3, all pinned): `hono@4`, `@hono/node-server@1`, `solid-js@1`, `vite@5`, `chokidar@4`, `gray-matter@4`, unified + remark + rehype family, `@shikijs/rehype`, `open@10`. Tarball growth fits within the +150 KB ceiling (AC-10).

  **Out of scope (v1.6.1):** Playwright e2e suite (3–5 critical paths × Linux + macOS), published `docs.stopwastingtokens.dev/swt-dashboard` site, `axe-cli` automated CI a11y gate. AC-12 / AC-13 verified manually via UAT.

## 1.5.1

### Patch Changes

- cceb8ee: v1.5.1 — Codex SDK conformance pass.

  Closes 11 of 17 findings from the Codex SDK verification research at developers.openai.com/codex (Tier 1+2+3); 6 deferred to v1.6+ (Tier 4).

  **Phase 01 — SDK Critical Conformance** (F-01, F-02, F-04):
  - All 6 agent profile TOMLs use documented Codex models: `gpt-5.5` (scout/architect), `gpt-5.3-codex` (lead/dev/qa/debugger). The fictional `gpt-5-codex` identifier no longer appears in product code.
  - All 6 TOMLs declare `model_reasoning_effort` in the documented Codex enum (`minimal | low | medium | high | xhigh`) per role: scout=low, architect=high, lead/dev/qa=medium, debugger=high. SWT Effort tier values (`thorough | balanced | fast | turbo`) no longer leak into Codex schema.
  - All 6 TOMLs declare Codex-required `name` and `description` fields per the subagent schema.
  - New `CodexReasoningEffort` type in `@swt-labs/core` decouples Codex's model thinking budget from SWT's `Effort` tier (planning depth + turn budget).

  **Phase 02 — Plugin Marketplace Prep** (F-03, F-13, F-14):
  - Plugin manifest moved to `.codex-plugin/plugin.json` (repo root) per documented Codex path; old `packages/cli/codex-plugin.json` removed.
  - Manifest fields realigned to documented schema: `keywords` (was `tags`), `interface` block with `displayName`/`category`/`screenshots`, `author` as object (not bare string). Undocumented top-level `install`/`commands`/`tags`/`categories` removed.
  - Build-time drift detection asserts `.codex-plugin/plugin.json:version === package.json:version` — version sync caught at every `pnpm test`.

  **Phase 03 — Hook Integration & Drift Cleanup** (F-08, F-09, F-10, F-11):
  - New `emitCodexHooksJson(file)` in `@swt-labs/codex-driver` translates SWT's flat snake_case schema to Codex's nested PascalCase `hooks.json` shape (`hooks.{EventName}: [{matcher, hooks: [{type, command, timeout: 600}]}]`).
  - New `CODEX_HOOK_EVENT_NAMES` translation map (snake_case → PascalCase) covers the 6 v1.0 generic events; SWT's 6 v1.5 SDLC events do NOT translate (filtering implicit by construction).
  - New `emitCodexHooksFeatureFlag()` returns `[features]\ncodex_hooks = true\n` for the user's `~/.codex/config.toml`.
  - All 6 agent TOML header comments now reference `~/.codex/config.toml [mcp_servers.<name>]` (the documented Codex MCP path); old wrong-path text `~/.codex/mcp.json` removed.

  **Build pipeline (publish-blocking fixes for first npm release):**
  - `pnpm build` now produces a working ESM bundle: `dist/cli.mjs` + `dist/cli.d.ts` (paths match `package.json` exports). Previously `pnpm build` was never exercised end-to-end, so the published bundle would have failed at `npm install -g`.
  - Drops CJS output entirely — the package is `"type": "module"`, the `bin` and only realistic consumer is the `swt` CLI; bundled CJS deps with top-level `await` cannot be re-emitted as CJS, and adding a working CJS path adds no value.
  - Stubs `react-devtools-core` (ink's optional dev import) at bundle time so `node dist/cli.mjs` no longer fails with `Cannot find package 'react-devtools-core'`.
  - Adds a `createRequire(import.meta.url)` banner so bundled CJS deps (`cross-spawn` et al.) can `require('child_process')` without the `Dynamic require ... is not supported` runtime error.
  - Adds dedicated `tsconfig.build.json` (no `composite`/`incremental`/`rootDir` constraints) so `dts` build doesn't fail with `TS5074` / `TS6059` on cross-package types.
  - Fixes `packages/cli/src/index.ts` direct-invocation check to use `realpath` + `fileURLToPath` on both sides — the previous check failed on macOS `/tmp -> /private/tmp` and on `npm i -g` bin symlinks, so `swt` from PATH never actually called `main()`.

  **Quality gate trail:**
  - 13/13 user-validated UAT scenarios PASS across 3 phases
  - 11 findings closed at the contract verification + R01 reconciliation + UAT triple-gate
  - All hard archive gates (UAT guard + state-consistency + 7-point audit) passed
  - Pre-existing v1.0 DEV-1D class typecheck failures (route.ts, codex-driver/wrapper.ts:39, codex-driver/toml/emit.ts:54) are documented carryforward, unaffected by this milestone — verified via stash + baseline comparison

  **Out of scope (v1.6+):** F-05 (allowed_mcp_servers), F-06 (max_turns), F-07 (role aliasing), F-12 (HookSubBlockSchema expansion), F-15 (AGENTS.override.md), F-17 (cache-hit measurement test).

All notable changes to stop-wasting-tokens are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for next milestone

- Playwright e2e suite (3–5 critical paths × Linux + macOS) for the localhost dashboard
- `axe-cli` automated CI a11y gate (AC-12 / AC-13)
- Published `docs.stopwastingtokens.dev` site (Mintlify infra)
- Full Claude Code backend driver (12-event hook taxonomy, Agent Teams, isolation modes — REQ-V2-02)
- Full Ollama backend driver (REQ-V2-03)
- Codex Plugin Marketplace submission (REQ-19) — once OpenAI accepts third-party manifests
- Real Codex `subagent`-spawn API wiring once OpenAI publishes the surface (today's `codex exec` wrapper is functionally adequate)
- Auto-derived reference docs (CLI / config / artifacts) generated at build time
- Configurable telemetry cache TTL
- Real HTTP telemetry sender pointing at a hosted analytics endpoint
- Custom Vale rules under `docs/styles/SWT/`
- Hook event taxonomy expansion (`pre_archive`, `post_phase`, `post_uat_fail`)

## [1.0.0] — `<DATE-OF-PUBLISH>`

The first stable release. See [`RELEASE-NOTES-v1.0.md`](RELEASE-NOTES-v1.0.md) for the full launch narrative.

### Added

- **Methodology runtime** — TypeScript port of VBW's bash phase-detect, VibeRoute discriminated union with thirteen mode handlers, discussion engine, 7-point pre-archive audit, QA + UAT remediation pipelines with bounded round caps and recurrence tracking.
- **Twelve typed artifact schemas** — PLAN, SUMMARY, VERIFICATION, UAT, RESEARCH, STANDALONE-RESEARCH, REMEDIATION-{PLAN,SUMMARY,RESEARCH}, DEBUG-SESSION, CONTEXT, MILESTONE-CONTEXT, all with Zod schemas + read/write helpers + backwards-compatibility transforms accepting both VBW and SWT shapes.
- **Six-agent SDLC** — Scout, Architect, Lead, Dev, QA, Debugger; goal-backward verification; typed handoff envelopes.
- **CLI command surface** — `swt init`, `swt vibe`, `swt detect-phase`, `swt config`, `swt status`, `swt doctor`, `swt update`.
- **Mintlify documentation site** — eighteen authored pages across Getting Started / Concepts / Reference / Recipes / Migration / v1.5 Roadmap, with Vale prose linting in CI.
- **npm distribution** — seven packages publishable with provenance attestation, changesets-driven release with lockstep versioning, install smoke test workflow on a 6-cell matrix.
- **Codex Plugin Marketplace manifest** — `packages/cli/codex-plugin.json` ready for submission.
- **Opt-in telemetry** — `@swt-labs/telemetry` with privacy-by-default, anonymous UUIDv4, PII-stripping sanitize pass, five initial events.
- **Beta-feedback infrastructure** — friction issue template, GitHub Discussions templates, CODE_OF_CONDUCT.md, beta tester guide, four announcement templates.

### Compatibility

- VBW frontmatter shapes parse cleanly via Zod transforms.
- The eleven lifecycle states match VBW 1:1.
- `swt detect-phase --bash-format` produces VBW-compatible `key=value` output.
- Config keys are a strict superset of VBW's.
- Migration: `mv .vbw-planning .swt-planning`.

### Security

- Comprehensive self-audit logged in [`SECURITY-REVIEW-v1.0.md`](SECURITY-REVIEW-v1.0.md) covering input handling, filesystem access, network, child process, and secrets handling.
- All packages publish with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements).

## [0.1.0-alpha] — `2026-05-XX`

Initial public alpha. Closed beta launched. Engineering deliverables for all 13 prior phases shipped:

- Phase 1 — Repo & org setup
- Phase 2 — Foundation (TypeScript monorepo, CI matrix)
- Phase 3 — Core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore)
- Phase 4 — Codex backend driver wiring
- Phase 5 — Methodology authoring (six-agent SDLC + skill routing)
- Phase 6 — CLI commands
- Phase 7 — Artifacts engine (twelve schemas)
- Phase 8 — Verification & QA pipelines
- Phase 9 — Methodology runtime (phase-detect + VibeRoute)
- Phase 10 — Template fidelity (Zod schemas + transforms)
- Phase 11 — Documentation site (Mintlify scaffold + content + Vale)
- Phase 12 — Distribution (npm publish + provenance + `swt update` + marketplace manifest)
- Phase 13 — Beta & feedback (telemetry + friction template + CoC + beta guide + announcements)

### Compatibility

- Drop-in replacement for VBW projects via directory rename.

[Unreleased]: https://github.com/swt-labs/stop-wasting-tokens/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/swt-labs/stop-wasting-tokens/releases/tag/v1.0.0
[0.1.0-alpha]: https://github.com/swt-labs/stop-wasting-tokens/releases/tag/v0.1.0-alpha
