# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `11-best-in-class-provider-prompts-and-tools` — Both providers (Anthropic + OpenAI) now run with their best-in-class tuning (archived 2026-05-16, 4 phases, 4 plans, 22 commits). Builds on `codex_cli_fix.md` (May 13) — that doc covered the OpenAI overlay-seam baseline; this milestone closed both providers + added drift automation. **Phase 01** — 4 missing OpenAI overlays authored (`provider_overlays/{lead,scout,architect,docs}-openai.md`); all 7 SDLC roles now have OpenAI-tuning layers; coverage regression test prevents quiet gaps. **Phase 02** — `effort` + `maxTurns` declared per-role on all 7 `agents/swt-*.md` files (lead: high/50, dev: high/75, scout: medium/15, qa: high/25, architect: xhigh/30, debugger: high/80, docs: medium/20); new `readRolePromptWithMeta()` strips frontmatter from LLM-visible body + parses meta; frontmatter > opts > defaults precedence; closed pre-existing `defaultSpawnSessionFactory` silent-drop bug where `thinkingLevel` never reached Pi. **Phase 03** — Codex `apply_patch` tool wired as JSON-schema Pi extension (Pi 0.74 has no freeform variant per Scout); hand-rolled line-oriented Lark-grammar parser (~280 LOC, pure, 14 cases); `buildApplyPatchExtension` factory + `materializeExtensionsToCustomTools` adapter that translates SWT extension factories into Pi `customTools[]`; strict `provider === 'openai'` guard; **closed the M2 PR-12 deferred state** (extensions[] never passed through to real Pi sessions). **Phase 04** — Monthly CI cron (`scripts/audit-upstream-prompts.sh` + `.github/workflows/upstream-prompt-audit.yml`) audits upstream Codex CLI base prompts + Claude Agent SDK type definitions; sha256-pinned baselines in `.vbw-planning/upstream-prompt-snapshots/2026-05-16/` (narrow gitignore carve-out — only snapshots tracked, planning artifacts stay local); detection-only, posts GitHub Issue on drift. Test totals: **2088 passed / 67 skipped / 0 failed** (was 2030 pre-milestone; +58 new). The 22 commits sit on `main` UNPUSHED (origin/main is at `9498d71`); `git push` + version bump + npm publish remain user-driven. **alpha.17 was never published** (conversation pivoted mid-bump); milestone-11 goes straight to alpha.18.
**Next action:** `bash scripts/bump-version.sh 3.0.0-alpha.18` + `git push origin main` + `git tag v3.0.0-alpha.18 && git push origin v3.0.0-alpha.18` (GHA release.yml publishes to npm `next` dist-tag). Or run /vbw:vibe to start a new milestone.

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
