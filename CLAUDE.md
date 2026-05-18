# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `16-monospace-chat-log-consistency` — Single-phase visual-consistency milestone restoring monospace-timestamped uniformity in the dashboard's `UnifiedLogPanel.tsx` (archived 2026-05-18, 1 phase, 1 plan, 2 product commits). **Phase 01** (`27a3a09`..`f13c264`) — `packages/dashboard/src/client/components/unified-log-helpers.ts` (extended `entryToLine` chat-assistant case: `tools_called` → `[tool: NAME, tool: NAME]`, `usage` → ` ↑in ↓out`; JSDoc updated to mark helper as total over `LogEntry` AND load-bearing for chat rendering); `packages/dashboard/src/client/components/UnifiedLogPanel.tsx` (deleted 3 bubble `<Show>` blocks; merged chat-user/chat-assistant/chat-error into the monospace `<Show>` group; split ANSI branch on `e.kind === 'system' && e.channel !== 'internal'` so ANSI path keeps `innerHTML={ansiToHtml(...)}` and everything else uses children rendering + `<span class="unified-log__cursor">▌</span>` sibling while streaming; extended `extraClass` for `--streaming` and `--error`; deleted dead `escapeHtml` helper); `packages/dashboard/src/client/styles.css` (added `.unified-log__line--streaming` + `@keyframes unifiedLogStreamingPulse`, `.unified-log__line--error`, `.unified-log__cursor` + `@keyframes unifiedLogCursorBlink`; deleted 6 dead bubble selectors + `@keyframes unifiedLogPulse`); +3 new helper test cases (tools-only, usage-only, both folded). Test totals: **2534 passed / 67 skipped / 0 failed** (+3 new from milestone-15's 2531 baseline). Net diff: +179 / −161 across 4 files. **QA result:** PASS one-shot at HEAD `f13c264`, 12/12 ACs (AC-03/04/05/07/09/10 marked PASS-with-deferred-visual-confirmation — `pnpm dev` browser smoke deferred to user). No deviations, no remediation rounds. Schema (`@swt-labs/shared/src/types/log-entry.ts`) untouched; `state.unifiedLog` reducer untouched. The 2 milestone-16 commits + 20 milestone-15 commits + ~75 prior unpushed commits sit on `main` UNPUSHED since `9498d71`. Builds on milestone 15's `15-command-alias-foundation-todo-workflow` (archived 2026-05-17).
**Previous milestone:** `15-command-alias-foundation-todo-workflow` — Two-thrust milestone closing 9 of VBW's 17 stub gaps: 7 verb aliases (`plan`/`execute`/`discuss`/`assumptions`/`archive`/`phase`/`audit` → cook aliases) + todo workflow (`swt todo`/`swt list-todos`/bare-integer pickup/`(ref:HASH)` extended_context injection) (archived 2026-05-17, 4 phases, 4 plans, 20 product commits). Phase 01 needed R02 QA remediation; phases 02-04 cleared the gate one-shot via pre-registered accepted-deviations. End-to-end flow: `swt todo "X" --detail "Y"` → `swt list-todos` → `swt cook 1` resolves to todo #1 with ref-tag detail injected into Dev prompt.
**Next action:** **Always run `pnpm release:preflight` BEFORE `bash scripts/bump-version.sh`** — it bundles the 5 gates CI runs (typecheck + lint + format:check + test + build). Without it, lint/format errors in files outside the milestone's scope can sneak past QA (which only checks modified files) and detonate the tag-push release workflow (alpha.27 lint, alpha.28 format, alpha.30 lint — all preventable). Then: `bash scripts/bump-version.sh 3.0.0-alpha.32` + `git push origin main` + `git tag v3.0.0-alpha.32 && git push origin v3.0.0-alpha.32` (GHA release.yml publishes to npm `next` dist-tag). Or run `pnpm dev` to do the deferred visual smoke for milestone 16 (chat with streaming response, tool-call response, forced auth error — verify monospace consistency + cursor blink + danger-red error styling). Or run `/vbw:vibe` to scope a new milestone. Single carry-over backlog item: `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13/14/15/16; needs a dedicated phase to revisit `Popover.tsx`'s ARIA-role typing without scope creep.

## Commands

- `pnpm typecheck` — `tsc --build` across the workspace. Run after every code change; fix errors before moving on.
- `pnpm test` — full vitest suite. `pnpm test:watch` for a single package while iterating.
- `pnpm test:regression` — the gated regression suite (`vitest.regression.config.ts`): cassette replay, agent-parity, migration boot-clean, snake canary.
- `pnpm lint` / `pnpm format` — eslint / prettier.
- `pnpm build` — dashboard client bundle + `tsup`. `pnpm check:bundle-size`, `pnpm check:offline` are release gates.
- `pnpm release:preflight` — **MANDATORY before any `bash scripts/bump-version.sh`**. Bundles the 5 gates the GHA release.yml runs (`typecheck && lint && format:check && test && build`). Catches lint/format/typecheck failures locally before they detonate the tag-push release workflow. Required by Release Discipline (below).
- **Contract tests** (`testing/verify-*.sh`, registered in `testing/list-contract-tests.sh`) — shell scripts, not `.bats`. When re-running the suite, the pipe-to-`while` runner drops `PATH`: invoke `/bin/bash` by absolute path and re-export `PATH` inside the loop (or use a here-string, not a pipe).

## Release Discipline

Three alpha releases (alpha.27, alpha.28, alpha.30) detonated at the tag-push CI step because QA's lint/format gates were scoped to _files modified by the milestone_ while CI runs `pnpm lint` and `pnpm format:check` workspace-wide. Errors that creep into files outside a milestone's scope were invisible to QA but fatal at release. Two complementary gates prevent the recurrence:

### Gate A — `pnpm release:preflight` (mandatory pre-release check)

`pnpm release:preflight` runs the _exact_ 5 gates the GHA release.yml runs (`typecheck`, `lint`, `format:check`, `test`, `build`). **Always run it before `bash scripts/bump-version.sh`.** Workflow:

```
$ pnpm release:preflight                         # ← MUST pass
$ bash scripts/bump-version.sh 3.0.0-alpha.NN
$ git add -A && git commit -m 'chore(release): v3.0.0-alpha.NN'
$ git tag v3.0.0-alpha.NN
$ git push origin main && git push origin v3.0.0-alpha.NN
```

If preflight fails, fix the failures _first_ — no version bump while preflight is red. Workspace lint warnings (`import/no-restricted-paths`, `import/order` rule demoted to warn) are non-fatal; only the `error`-severity rules and other gate failures block.

### Gate B — Workspace-wide lint as a hard QA gate

When QA verifies a phase, the `pnpm lint` and `pnpm format:check` checks **MUST run workspace-wide, not scoped to files modified by the milestone**. Workspace lint errors are NOT eligible for `accepted-process-exception` classification — they must either be:

- Fixed in the same milestone (preferred), or
- Pre-registered in `accepted-deviations.json` with an explicit narrative explaining why this specific error cannot be fixed this milestone (e.g. blocked by an external dependency upgrade)

Carry-forward known issues like `Popover.tsx:138` TS2322 (DEVN-05) remain eligible for `accepted-process-exception` because they fail typecheck, not lint, and have a known root cause tracked across milestones. **Workspace-wide format drift is never eligible** — `pnpm format` auto-fixes it, so accepting it is just deferring a one-command fix.

Practically: QA agents verifying a phase should run `pnpm release:preflight` as their lint/format/typecheck/test/build gate, not the scoped equivalents. The same command gates Gate A and Gate B — one rule, one command, no scope mismatch.

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
