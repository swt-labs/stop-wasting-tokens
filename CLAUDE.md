# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `15-command-alias-foundation-todo-workflow` — Two-thrust milestone closing 9 of VBW's 17 stub gaps (archived 2026-05-17, 4 phases, 4 plans, 20 product commits). **Phase 01** (`0a02283`..`719adfa`) — `packages/cli/src/lib/alias-to-cook.ts` (`aliasToCook`, `aliasToCookPlan`, `phaseAlias`); 7 stub verbs graduated (`plan`/`execute`/`discuss`/`assumptions`/`archive`/`phase`/`audit` → cook aliases); dashboard CORE_ENTRIES + `ALLOWED_NON_INTERACTIVE_VERBS` updated; 14 byte-identical regression tests. R01 + R02 QA remediation rounds resolved 4 declared deviations + 5 known-issue text variants as accepted-process-exception. **Phase 02** (`44a2199`..`0354048`) — `packages/shared/src/schemas/todo.ts` (`TodoDetailSchema`, `TodoDetailsFileSchema`, `TODO_PRIORITY_VALUES`, `TODO_LINE_PREFIX`); `packages/cli/src/lib/todo-state.ts` (`computeTodoHash`, `appendTodoToState`, `todoExistsInState`, `readTodoDetails`, `writeTodoDetail`); `todoHandler` graduated; new `--detail/--phase/--files/--priority/--assignee` flags; 18 cases. 9 SUMMARY deviations pre-registered as accepted-process-exception via `accepted-deviations.json`. **Phase 03** (`e710979`..`a894cc2`) — `TodoEntry`/`ListTodosSnapshot`/`ListTodosJsonOutput` schemas; `parseTodosFromState` + `STATE_TODOS_LINE_REGEX`; `STATUS_ICONS` (○ ◆ ✗ ✓), `filterTodos`, `renderTodoList`, `writeListTodosSnapshot` (atomic temp+rename); `listTodosHandler` + `--filter` repeatable string + `--json` flag; 29 cases. 2 declared deviations (T4 `ParsedArgv.flags` type cascade, T5 `cli.mdx` regen) pre-registered. **Phase 04** (`fdb2623`..`f350aa0`) — `LIST_TODOS_SNAPSHOT_TTL_MS = 10 * 60 * 1000`; `readSnapshotForPickup` + `loadTodoDetailForRef`; `resolveTodoNumber` rewritten async; `--todo N` escape-hatch flag with mutual-exclusion; `extended_context:` trailer via `appendModeOptions` injects todo-details.json detail into Dev prompt for `(ref:HASH)` invocations; 33 cases. Zero deviations. Test totals: **2498 passed / 67 skipped / 0 failed** (was 2469 mid-milestone-14; +96 new across 4 phases). **End-to-end flow works:** `swt todo "X" --detail "Y" --priority high` → `swt list-todos` → `swt cook 1` resolves to todo #1, runs cook with description + ref-tag detail injected into Dev prompt; `swt cook --todo 1` is the always-pickup escape hatch. **QA result:** PASS across all 4 phases at HEAD `f350aa0`. Phase 01 needed R02 remediation; phases 02-04 cleared the gate one-shot via pre-registered accepted-deviations. The 20 milestone-15 commits + ~75 prior unpushed commits sit on `main` UNPUSHED since `9498d71`. Builds on milestone 14's `14-options-menu-consolidation` (archived 2026-05-17).
**Previous milestone:** `14-options-menu-consolidation` — Dashboard `ConfigPanel` (Config card) deleted; all editable config settings consolidated into the `Options` dropdown with curated 10-knob row (including `backend`) + Advanced nested-tree section + sticky `[Discard] [Save (N changes)]` action bar; Settings flipped from immediate-apply to batched-staged-edit; section collapse `<details>` wrappers stripped (archived 2026-05-17, 1 phase, 3 plans, 8 product commits). Plans `01-01`/`01-02`/`01-03`; `ConfigPanel.tsx` deleted (345 LOC); `lib/layout-storage.ts` `STORAGE_KEY` bumped v8→v9 with once-only `migrateToolsArray` shim. 75 new tests across 3 files. **QA result:** PASS via R01 remediation (9 declared deviations classified as process-exception; 4 known issues all Popover.tsx TS2322 carry-overs accepted-process-exception). UAT skipped at user request.
**Next action:** `bash scripts/bump-version.sh 3.0.0-alpha.30` + `git push origin main` + `git tag v3.0.0-alpha.30 && git push origin v3.0.0-alpha.30` (GHA release.yml publishes to npm `next` dist-tag). Or run `/vbw:vibe` to scope a new milestone. Single carry-over backlog item: `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13, 14, 15; needs a dedicated phase to revisit `Popover.tsx`'s ARIA-role typing without scope creep.

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
