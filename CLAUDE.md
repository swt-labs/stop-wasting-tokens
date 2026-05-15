# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `09-dashboard-statusline-and-card-cleanup` — Dashboard statusline + card cleanup (archived 2026-05-15, 3 phases, 3 plans, 10 commits). Replaced four scattered right-column cards (COST/BUDGET/CACHE HITS/TPAC) with a single full-width viewport-fixed bottom statusline rendering `anthropic ● ctx —/— $X.XX (NK↛NK) 7d:$X.XX 30d:$X.XX` unconditionally (even over the greenfield InitScreen). **Phase 01** — New local `UsageAggregator` service subscribing to `cook.agent_result` EventBus events, rolling 7d/30d windows from `Date.now()` (UTC epoch ms math), 31-day in-memory prune, sub-ms recompute, `GET /api/usage-rollup` route, new `usage_rollup` field on `SnapshotSchema` surfaced via existing `state.changed` SSE. **Phase 02** — `<DashboardStatusline>` SolidJS component with 5 exported pure formatter helpers (`formatStatuslineProvider`, `connectionDotState`, `formatStatuslineSessionCost`, `formatStatuslineTokens`, `formatStatuslineRollup`); viewport-fixed CSS (position:fixed, bottom:0, z-index:10, height:24px); `.app-shell` padding-bottom widened 24→48px to clear the fixed bar; aggregator + route also mounted at server entrypoint here (Phase 01 deferred T1). Format dropped `{model}` and renders `ctx —/—` as static placeholder — Pi 0.74 exposes neither model-id nor context-window data. **Phase 03** — Deleted 4 obsolete components (CostPanel/BudgetPanel/CacheHitPanel/TpacPanel) + `cost-panel-helpers.test.ts`; layout-storage key rotation v6→v7 (no fraction surgery — Scout proved the cards lived as siblings inside a single Resizable.Panel). Server routes `/api/cost`, `/api/budget`, `/api/cache-hits`, `/api/tpac` PRESERVED for external tooling. Test totals: **709 passed / 1 skipped / 0 failed** (was 676 pre-milestone; +33 new cases). The 10 commits sit on `main` UNPUSHED (origin/main is at `f61ca7b`); `git push` + version bump + npm publish remain user-driven. Deferred ideas: model-name cell, context-window cell, per-provider rollup, historical chart, `swt usage` CLI verb.
**Next action:** `bash scripts/bump-version.sh 3.0.0-alpha.16` + `git push origin main` + `git tag v3.0.0-alpha.16 && git push origin v3.0.0-alpha.16` (GHA release.yml publishes to npm `next` dist-tag). Or run /vbw:vibe to start a new milestone.

## Commands

- `pnpm typecheck` — `tsc --build` across the workspace. Run after every code change; fix errors before moving on.
- `pnpm test` — full vitest suite. `pnpm test:watch` for a single package while iterating.
- `pnpm test:regression` — the gated regression suite (`vitest.regression.config.ts`): cassette replay, agent-parity, migration boot-clean, snake canary.
- `pnpm lint` / `pnpm format` — eslint / prettier.
- `pnpm build` — dashboard client bundle + `tsup`. `pnpm check:bundle-size`, `pnpm check:offline` are release gates.
- **Contract tests** (`testing/verify-*.sh`, registered in `testing/list-contract-tests.sh`) — shell scripts, not `.bats`. When re-running the suite, the pipe-to-`while` runner drops `PATH`: invoke `/bin/bash` by absolute path and re-export `PATH` inside the loop (or use a here-string, not a pipe).

## Architecture

11-package pnpm workspace. Dependency layers (a package may only import from lower layers — **introducing an upward import is a build error**):

- **L0** `shared` — types, Zod schemas, event definitions. No internal deps.
- **L1** `core` — abstractions (AgentSpawner, MemoryStore, SpawnerEnvironment).
- **L2** `runtime` (Pi session lifecycle, hooks, askUser, budget gate, cost projector, rate-card), `artifacts`, `telemetry`, `verification`.
- **L3** `orchestration` — `spawnAgent`, `spawnOrchestratorSession`, provider router/fallback. **Cannot import `runtime`'s consumers** — e.g. cost-projector lives in `runtime`, not here, to avoid a cycle.
- **L4** `methodology` — `runVibe`, phase detection, meters, the cook bridge.
- **L5** `test-utils` — cassettes, `runAgentParity`, golden fixtures, `diffArtefacts`.
- **L6** `cli` — `swt` verbs; `commands/cook.ts` is the orchestrator entry (11-priority routing table).
- **L7** `dashboard` — Hono + Solid + SSE; standalone-bundleable (mirrors small CLI slices rather than hard-depending where the tarball ships separately).

Role prompts live in `agents/swt-{role}.md`; per-provider overlays in `provider_overlays/{role}-{provider}.md` (appended after the role prompt at spawn time).

## Platform Constraints (Pi 0.74)

- **No `systemPrompt` option on `createAgentSession`.** Per-role prompts are prepended to the first `session.prompt()` call.
- **No consumer-facing PreToolUse intercept.** `swt:fireHook` PreToolUse is advisory-only (log + would-be-block, no real gating). Real gating requires wrapping at the `customTools` factory.
- **No mid-turn pause.** Crash recovery + cook control gate at commit boundaries, not mid-LLM-turn.

## Conventions

- **Commit format:** `{type}({scope}): {description}` — types: feat, fix, test, refactor, perf, docs, style, chore. One atomic commit per task.
- **`.vbw-planning/` is fully gitignored** — plans, SUMMARYs, ROADMAP, PARITY-REPORTs are local-only and will not appear in `git status`. `scripts/*` is gitignored with explicit per-file carve-outs (SWT-owned scripts are tracked; VBW-vendored ones are not — the porter regenerates them).
- **Never commit secrets** (.env, .pem, .key, credentials, tokens) or `.claude/` session state.
- **Do not bump version or `git push`** unless explicitly asked, or `.vbw-planning/config.json` sets `auto_push` to `always`/`after_phase`.
- **Code intelligence:** prefer LSP (`goToDefinition`, `findReferences`, `workspaceSymbol`, `hover`) over Grep/Read for semantic navigation; `findReferences` before any rename or signature change. Grep/Glob for literal strings, config values, non-code assets.

## Development Process

SWT is _built using_ the VBW methodology plugin (`/vbw:vibe`) — distinct from the SWT product itself. Use VBW commands for all lifecycle actions (scope → discuss → plan → execute → verify → archive); plans are the source of truth. Do not hand-edit files in `.vbw-planning/`. Do not fabricate content in project-defining flows — use only what the user explicitly states.
