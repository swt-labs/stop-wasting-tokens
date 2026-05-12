# Changelog

## 3.0.0-alpha.1 — IN DEVELOPMENT (not yet published)

_The v3 redesign is being built directly on `main`. The currently-published binary on npm remains v2.3.5; v3.0 cuts from `main` at the M6 release gate. This entry tracks what has shipped so far: **M1 Foundation closed 2026-05-12**, **M2 Single-agent path closed 2026-05-12 (all 10 PRs landed; live TPAC baseline pending user cassette recording)**, **M3 Worktree dispatcher Plan 03-01 closed 2026-05-12**, and **session-wiring follow-up (PR-S) shipped 2026-05-12** — real Pi `createSession` + `swt rpc` live._

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
