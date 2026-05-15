# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `08-init-and-cook-text-parity` — Init + Cook text parity (archived 2026-05-15, 3 phases, 3 plans, 12 commits incl. 1 QA remediation audit-trail). Closed both remaining surfaces of the "UI promises, backend drops" anti-pattern that the 07-milestone audit (`.vbw-planning/research/swt-v2-source/a_non_production_files/audit.md`) flagged. **Phase 01** — CLI `swt cook "<idea>"` now writes free-form positionals to `.swt-planning/.pending-scope-idea.txt` when routing resolves to Scope mode (newer-wins overwrite + stderr notice); `writeFileSyncImpl` injected as test seam; 7 regression cases. **Phase 02** — `POST /api/init` now spawns `swt init <name>` as a subprocess after scaffolding, emits `init.start` / `init.complete` / `init.error` events via the existing SSE bus; mirrors alpha.10 cook-bar architecture; `resolveSwtCommand` shared with `cook-start.ts`; HTTP response stays non-blocking; Pattern A regression test. **Phase 03** — Dashboard client-side surfacing: `state.initSession` slot (parallel to `vibeSession`), `handleInitEvent` dispatch, InitScreen "Detecting stack…" overlay, error rollback through existing error paragraph, e2e-greenfield-init-smoke Pattern B test (7 cases). Optimistic `is_initialized = true` flip removed — `is_initialized` now gates on `init.complete`. Test totals: **675 passed / 1 skipped / 0 failed** (was 668 pre-milestone). The 12 commits sit on `main` UNPUSHED (origin/main is at `886a6a4`); `git push` + version bump + npm publish remain user-driven.
**Next action:** `bash scripts/bump-version.sh 3.0.0-alpha.14` + `git push origin main` + `git tag v3.0.0-alpha.14 && git push origin v3.0.0-alpha.14` (GHA release.yml publishes to npm `next` dist-tag). Or run /vbw:vibe to start a new milestone.

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
