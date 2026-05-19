# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `20-github-dropdown-ui-scaffolding-placeholder` — Single-phase milestone adding `Github ▼` dropdown to the dashboard chrome row LEFT of where `Theme ▼` will land (per `themes.md`). Strict placeholder UI: 8 menu items in 3 sections, every click is `console.debug` no-op. Brief: `a_non_production_files/git_dropdown.md` (569 lines, fully baked, 12 locked decisions, 14 ACs) (archived 2026-05-19, 1 phase, 1 plan, 3 commits, local tag `milestone/20-github-dropdown-ui-scaffolding-placeholder`). **Phase 01** (3 commits — `338f61c`/`1a232e4`/`b174a15`): Commit 1 — `GithubDropdown.tsx` (NEW, 113 LOC) wraps shared `<Popover>` primitive; parent (App.tsx) owns `createSignal<boolean>(false)` for `githubMenuOpen` (mirrors `paletteOpen` App.tsx:43); `github-dropdown-helpers.ts` (NEW, 111 LOC) exports `GITHUB_MENU_ITEMS`, `hasGithubRemote()` (default `false`, `?fake_remote=true` URL param toggle), `getDisabledTooltip()`, `groupItemsBySection()`. New CSS in `components/styles.css` (NOT root `client/styles.css`). 2 test files `.ts` (NOT `.tsx`): pure-helper + smoke pattern matching `options-menu.test.ts`. Commit 2 — `App.tsx` mount: `<header class="chrome-row">` above `<TopBar>` (NOT inside TopBar); `.chrome-row` CSS created from scratch since `themes.md` hasn't shipped. Commit 3 — `style(workspace):` separate atomic prettier fix for pre-existing CHANGELOG + CLAUDE drift per CLAUDE.md Release Discipline Gate B (precedent alpha.28). **7 brief drift corrections applied** (Scout 3 + Lead pre-planning grep 4): DRIFT-1 (CRITICAL) shell pattern is `<Popover>` controlled by parent (NOT `<details>`/`<summary>`) — AC-10 revised to "click-outside + Escape + trigger-click via shared `<Popover>` primitive"; DRIFT-2 no `no-console` ESLint rule (omit brief's `eslint-disable-next-line`); DRIFT-3 `.ts` test files (NOT `.tsx`); DRIFT-4 selectors in `components/styles.css` (NOT root `client/styles.css`); DRIFT-5 helpers in `lib/` (NOT `state/dashboard-store.ts`); DRIFT-6 item IDs verified vs brief lines 100-130; DRIFT-7 App.tsx mount above TopBar in chrome-row sibling. **Test growth:** 2639 → 2659 (+20 net: 10 component-data integrity + 10 pure-helper unit tests). Test files 291 → 293 (+2). **Regression:** held at 115/27/0 throughout. **D2 invariant:** trivially preserved (dashboard L7 only — no provider-prompt edits). **No item wiring** ships in this milestone — per-item wiring is explicit Future Work across 4 priority tiers (Tier 1 issue templates with privacy concerns, Tier 2 `git remote -v` discovery + URL builders, Tier 3 hardcoded SWT URLs, Tier 4 not-in-scope). User-elected spot-check + banner closeout continued (now memorialized across 3 milestones: 18 + 19 + 20). The 3 milestone-20 commits + 9 milestone-19 commits + 21 milestone-18 commits + 3 archive/changelog docs commits = 36 commits ahead of `origin/main` (e8c1369).
**Previous milestone:** `19-init-ux-live-progress-failure-and-provider-selector` — Four-phase milestone closing three compounding UX gaps on `swt init` first-run path documented in `a_non_production_files/init_msg3.md` (801-line fully-baked proposal, 21 locked decisions, 24 ACs) (archived 2026-05-19, 4 phases, 4 plans, 9 commits, local tag `milestone/19-init-ux-live-progress-failure-and-provider-selector`). Trace-sink port to `spawn-agent.ts` byte-for-byte; init subprocess stdout pipe to dashboard `log.append` SSE; `augmentSpawnError` extended with `AugmentSpawnErrorContext` ({authMode, provider}); `InitSessionState.lastMessage` + live progress block + elapsed counter; provider selector dropdown above PROJECT NAME. 6 brief drift corrections applied in Phase 04. Test growth 2598→2639 (+41 net).
**Next action:** **Always run `pnpm release:preflight` BEFORE `bash scripts/bump-version.sh`** — bundles the 5 gates CI runs (typecheck + lint + format:check + test + build). Without it, lint/format errors in out-of-scope files can sneak past spot-check + banner and detonate the tag-push release workflow (alpha.27 lint, alpha.28 format, alpha.30 lint — all preventable). Then: `bash scripts/bump-version.sh 3.0.0-alpha.33` (bundles 36 commits since `e8c1369`: milestone 18's 21 + milestone 19's 9 + milestone 20's 3 + 3 archive/changelog docs) + `git push origin main` + `git tag v3.0.0-alpha.33 && git push origin v3.0.0-alpha.33` (GHA release.yml publishes to npm `next` dist-tag). Or run `pnpm dev` to do deferred visual smokes (milestone 17 dashboard render of `cook-plan-update` log entries + milestone 18 Phase 01 greenfield artifact routes returning 503 before `swt init` + milestone 19 Phase 03 live progress block ticking elapsed counter during `swt init` + milestone 19 Phase 04 provider selector + status indicator above PROJECT NAME + milestone 20 Github dropdown rendering LEFT of where Theme will sit, ?fake_remote=true flipping disabled→enabled). Or run `/vbw:vibe` to scope milestone 21 (likely first Github dropdown wiring tier 1/2, OR sibling `Theme ▼` per `themes.md`). Carry-over backlog items: (1) `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13/14/15/16/17/18/19/20 (8 milestones); needs a dedicated phase to revisit ARIA-role typing without scope creep. Milestone 20 USED Popover.tsx but did not touch the broken typing. (2) DEVN-PHASE-06-DRIFT-CI-DEFERRED — CI workflow step to run `pnpm gen:apply-patch-parser` + `git diff --exit-code` on the parser file would close the Lark drift loop end-to-end; tracked for follow-up patch. (3) `.vbw-planning/` migration fallback at `phase-detect.ts:189` is the lone Locked Decision #6 exception — deferred to Milestone H-02. (4) Milestone 19 Phase 04 Solid component test for provider-selector dropdown render + cross-surface sync — deferred during execution (pure-function tests cover the helpers). (5) `derive-milestone-slug.sh` plugin fix — recurring across 4 consecutive milestones now (17/18/19/20); script returns garbage like `19-featdashboard-github-dropdown-component-menu-items-stub` (appears to parse commit subjects rather than ROADMAP slug); workaround is ROADMAP-declared `**Milestone slug:**` value via grep. (6) Per-item Github dropdown wiring (4 priority tiers) — explicit Future Work from milestone 20.

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
