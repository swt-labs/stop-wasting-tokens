# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `14-options-menu-consolidation` — Dashboard `ConfigPanel` (Config card) deleted; all editable config settings consolidated into the `Options` dropdown with curated 10-knob row (now including `backend`) + Advanced nested-tree section + sticky `[Discard] [Save (N changes)]` action bar; Settings flipped from immediate-apply to batched-staged-edit; section collapse `<details>` wrappers stripped so Commands+Settings+Advanced+action bar all render inline immediately when the popover opens (archived 2026-05-17, 1 phase, 3 plans, 8 product commits). **Plan 01-01** (`c8b6e15`, `31e6c30`) — `AdvancedConfigSection.tsx` controlled recursive editor (port of `ConfigPanel`'s `ConfigEditTree`); `backend` added to `SETTINGS_FIELD_ORDER`. **Plan 01-02** (`166b74e`, `a068597`, `1d91f3a`) — `SettingsSection` flipped controlled-staged (`onApply` → `onStage`+`onDiscardKey`+`pendingEdits`); `OptionsMenu` collapse stripped, body restructured Commands→Settings→Advanced→action bar; Save handler wired with `mergeStagedConfig` + `actions.applyConfigUpdate` (one POST per save); `buildConfigPatch` kept as back-compat alias spanning the 01-02→01-03 boundary. **Plan 01-03** (`af30307`, `492b7d9`, `1e77b20`) — `ConfigPanel.tsx` deleted (345 LOC); App.tsx `Resizable.Panel` slot removed; `lib/layout-storage.ts` `STORAGE_KEY` bumped v8→v9 with once-only `migrateToolsArray` shim (slices over-length persisted arrays + `console.debug` latch); CSS migration (~150 LOC pruned, `.advanced-config-*` + `.options-menu-action-bar` families added); full test suite rewrite (`settings-section.test.ts` rewritten for staged-edit, `options-menu.test.ts` extended with action-bar + inline-section cases, new `advanced-config-section.test.ts`). 75 new tests across 3 files; **844 passed / 1 skipped** (was 769 pre-milestone). **QA result:** PASS via R01 remediation (9 declared deviations classified as process-exception with credible rationale; 4 known issues — all Popover.tsx TS2322 carry-overs — accepted-process-exception; known-issues.json cleared). UAT skipped at user request. The 8 product commits sit on `main` UNPUSHED. Builds on milestone 13's `13-unified-panel-and-cook-interview-bridge` (archived 2026-05-17) — that one wired dashboard cook to VBW interview engine end-to-end without forking the cook protocol.
**Previous milestone:** `13-unified-panel-and-cook-interview-bridge` — Dashboard cook is now the dashboard-native VBW-vibe interview (archived 2026-05-17, 4 phases, 4 plans, 13 commits). The interview engine already existed in SWT (`packages/methodology/src/discussion/` + `packages/runtime/src/ask-user/`); milestone 13 wired the existing primitive end-to-end without forking the cook protocol or breaking `swt-ask-user-tool.ts`'s ORCHESTRATOR-ONLY invariant. **Phase 01** — `LogEntrySchema` discriminated union in `@swt-labs/shared` (9 variants: init/cook-status/cook-agent/cook-tool/cook-ask-user/chat-user/chat-assistant/chat-error/system); `state.unifiedLog` reducer with `chat_session_id` hoisted to top-level (continuous chat thread invariant); `UnifiedLogPanel.tsx` replaces the dual `LogPanel` + `ChatPanel` (both deleted, plus `chat-panel-helpers.ts` + `chat-panel.test.ts`). **Phase 02** — Scout proved transport already existed (`POST /api/prompts/publish` → SSE `prompt.request` → `POST /api/prompts/:id/respond` → SSE `prompt.response`); phase collapsed from "build transport" to "store wiring + route alias + Zod schema". Added `cook.ask_user_timeout` variant; `POST /api/cook/respond` cook-aware wrapper with 4-step validation; `state.cookAwaitingUser` single-slot. **Phase 03** — `AskUserCard` Solid component with three render modes (pending/answered/expired); 4 pure helpers in `askuser-card-helpers.ts`; TopBar answer-mode banner; mode precedence `cook-ask-user > chat > vibe > command` (load-bearing); `respondToCookAskUser` action with optimistic mark + revert on POST failure. **Phase 04** — README "Chat vs Cook" rewrite with VBW lineage citation (`references/discussion-engine.md` + `references/ask-user-question.md`); `swt init` + `FirstRunHint.tsx` copy refresh. **Inline fix** (`d0a4e4a`, declared DEVN-04-A) closed a Phase 03 regression where `CookAskUserEntrySchema` was missing `allowFreeform` — Phase 03 QA passed because workspace-root `tsc --build` does not catch dashboard-client errors. Test totals: **2317 passed / 67 skipped / 0 failed** (was 2214 pre-milestone; +103 new). The 13 milestone-13 commits + the ~75 prior unpushed commits sit on `main` UNPUSHED since `9498d71`; alpha.18 through alpha.25 were never user-published (alpha.25 release commits are local).
**Next action:** `bash scripts/bump-version.sh 3.0.0-alpha.27` + `git push origin main` + `git tag v3.0.0-alpha.27 && git push origin v3.0.0-alpha.27` (GHA release.yml publishes to npm `next` dist-tag). Or run /vbw:vibe to start a new milestone. Single carry-over backlog item: Popover.tsx:138 TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13 and 14; needs a dedicated phase to revisit `Popover.tsx`'s ARIA-role typing without scope creep.

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
