# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `19-init-ux-live-progress-failure-and-provider-selector` — Four-phase milestone closing three compounding UX gaps on the `swt init` first-run path documented in `a_non_production_files/init_msg3.md` (801-line fully-baked proposal with 21 locked decisions, 24 ACs) (archived 2026-05-19, 4 phases, 4 plans, 9 commits, local tag `milestone/19-init-ux-live-progress-failure-and-provider-selector`). **Phase 01** (3 commits — `f1cb88d`/`9c09ac1`/`97e0481`) — Ports the alpha.23 trace-sink pattern from `spawn-orchestrator-session.ts:359-430` to `spawn-agent.ts` byte-for-byte; `SpawnAgentOptions` gains optional `traceWriter?: ((line: string) => void) \| null` (default `process.stderr.write`, respects `SWT_NO_LLM_TRACE=1`). Pipes init subprocess stdout to dashboard `log.append` SSE with `channel: 'stdout'` (init.ts:205, stdio `['ignore', 'pipe', 'pipe']`). 5 trace-sink tests + 1 stdout test + DEVN-02 prettier fix-in-milestone on CLAUDE.md. **Phase 02** (3 commits — `75d9dc9`/`2d71311`/`4b6bc75`) — `augmentSpawnError` extended with optional `AugmentSpawnErrorContext` (`{authMode, provider}`). api_key branch: Case B only (no `9d1c250a`/Provider menu/`ANTHROPIC_API_KEY`/allowlist). oauth branch: URL lead + allowlist hypothesis as secondary cause + both workarounds. no-context branch: byte-identical to today's output (AC-12). All branches headline with `Anthropic says: Add more at claude.ai/settings/usage and keep going.` `request_id` extraction. init.ts:346 + cook.ts:3401 (Option A — `await resolveSpawnCredential(fallbackResult.providerUsed, config.auth)`) thread the context. Pre-spawn OAuth advisory at init.ts:285-291 rewritten per Decision #17 (URL leads, allowlist demoted to conditional). cook-error-augmenter.test.ts: 6 → 8 tests (3 sibling describes replace the single OAuth describe). **Phase 03** (2 commits — `6bfc4f4`/`c72d118`) — `InitSessionState.lastMessage?: string` populated by `log.append` reducer at dashboard-store.ts:1506 when `status === 'detecting'`; optimistic init.start at L1993 initializes `lastMessage: undefined`. InitScreen.tsx adds exported `classifyInitLine` + inline `toolFriendlyLabel`; elapsed counter via `createSignal(tick) + setInterval(1000) + onCleanup` driven by `state.initSession.started_at`; `<Show when={isBusy()}>` gates the progress block with ARIA `role="status" + aria-live="polite"`; >120s long-running fallback swaps to "still working — large repos can take 3-5 min on first run". NEW FILE init-screen-helpers.test.ts (18 classifier cases). **Phase 04** (1 commit — `1bc3ef4`) — InitScreen.tsx exports two pure helpers (`selectInitialProvider`: config-match → first authed → first overall → null; `computeProviderStatus`: `'green'` when `configured && mode !== null`, `'red'` otherwise, `'empty'` for null). Provider dropdown + status indicator button above PROJECT NAME when `credentials.length > 0`; empty-state placeholder otherwise. Status button onClick dispatches `openProviderMenu`; `<select>` onChange dispatches `applyProviderAuthUpdate({provider, mode})` (Option A — `postProviderAuth` wrapper). Initialize button disabled when `computeProviderStatus(selected()) !== 'green'`. App.tsx threads 3 new props. **6 brief drift corrections applied** in Phase 04 (Scout flagged 3 + Lead pre-planning grep found 3): P1 schema (`configured + mode` not `status`), P2 state path (`state.tools.providerAuth.data.statuses`), P3 dispatcher (`applyProviderAuthUpdate` not `setActiveProvider`), P4 SoT field (`selected_provider` provider-only not composite), P5 CSS var (`--terminal-green` not `--success-green`), P6 wiring (App.tsx instantiation). **Test growth:** 2598 → 2639 (+41 net: 6 Phase 01 + 2 Phase 02 + 22 Phase 03 + 9 Phase 04 + edge cases). **Regression:** held at 115/27/0 throughout. **D2 invariant:** trivially preserved (no provider-prompt edits — runtime trace sink + dashboard widget + cli failure-text + dashboard provider widget). The 9 milestone-19 commits + 21 milestone-18 commits = 30 commits ahead of `origin/main` (e8c1369). **User-elected spot-check + banner closeout pattern** continued across all 4 phases (established convention from milestone 18).
**Previous milestone:** `18-runtime-preconditions-and-greenfield-routability` — Four-phase milestone enforcing Locked Decision #6 ("no silent fallbacks") uniformly across SWT's runtime path (archived 2026-05-19, 4 phases, 4 plans, 20 commits, local tag `milestone/18-runtime-preconditions-and-greenfield-routability`). Greenfield artifact route registration via getter pattern; tarball-shape regression test (`check:tarball-shape.mjs` + 10 sentinels + nested `scripts/.npmignore` per npm/cli#6221); 27 silent-fallback patterns converted to hard-error across 5 commands/*.md; Pi-extension materialization assertion in `session.ts` at the materializer return-value boundary. Test growth 2594→2598 (+4 truth-table tests).
**Next action:** **Always run `pnpm release:preflight` BEFORE `bash scripts/bump-version.sh`** — it bundles the 5 gates CI runs (typecheck + lint + format:check + test + build). Without it, lint/format errors in files outside the milestone's scope can sneak past spot-check + banner and detonate the tag-push release workflow (alpha.27 lint, alpha.28 format, alpha.30 lint — all preventable). Then: `bash scripts/bump-version.sh 3.0.0-alpha.33` (bundles 30 commits since `e8c1369`: milestone 18's 21 + milestone 19's 9) + `git push origin main` + `git tag v3.0.0-alpha.33 && git push origin v3.0.0-alpha.33` (GHA release.yml publishes to npm `next` dist-tag). Or run `pnpm dev` to do deferred visual smokes (milestone 17 dashboard render of `cook-plan-update` log entries + milestone 18 Phase 01 greenfield artifact routes returning 503 before `swt init` + milestone 19 Phase 03 live progress block ticking elapsed counter during a `swt init` + milestone 19 Phase 04 provider dropdown + status indicator above PROJECT NAME). Or run `/vbw:vibe` to scope milestone 20. Three carry-over backlog items: (1) `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13/14/15/16/17/18/19; needs a dedicated phase to revisit `Popover.tsx`'s ARIA-role typing without scope creep. (2) DEVN-PHASE-06-DRIFT-CI-DEFERRED — CI workflow step to run `pnpm gen:apply-patch-parser` + `git diff --exit-code` on the parser file would close the Lark drift loop end-to-end; tracked for follow-up patch. (3) `.vbw-planning/` migration fallback at `phase-detect.ts:189` is the lone Locked Decision #6 exception — deferred to Milestone H-02 (gate behind explicit `--from-vbw` flag or loud warning) so milestone-15→17 migration story stays intact. (4) Phase 04 Solid component test for provider-selector dropdown render + cross-surface sync — deferred during execution (pure-function tests cover the helpers); tracked for follow-up patch.

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
