# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `22-settings-dropdown-v2-flat-table-profile-presets` — Three-phase milestone replacing the dashboard's milestone-14 `Options ▼` dropdown (curated 10-knob block + Advanced recursive tree) with a flat 24-row `Settings ▼` table + 4-preset Profile dropdown. Trigger: user one-liner referencing `a_non_production_files/Option2.md` (863-line fully-baked proposal). Archived 2026-05-19, 3 phases, 6 plans, 9 commits (8 milestone-22 + 1 bonus bundled user-authored Themes Dropdown feature), local tag `milestone/22-settings-dropdown-v2-flat-table-profile-presets` on commit `17aed91`. **Phase 01** (1 plan / 3 commits — `2413e1a`/`3636333`/`3292de0`): SwtConfig schema extension. 15 new fields + `custom_profiles` + `CustomProfileSchema` added to `packages/core/src/config/Config.ts` (16 net new). Drift-locks: `active_profile: z.string()` open-string (NOT enum), Turbo `prefer_teams: 'never'` (brief typo fixed), backwards-compat via Zod `.default()`. +13 new test cases. **Phase 02** (3 plans / 4 commits — `47f1738`/`275cc25`/`089f944`/`5b28bcd`): Standalone components. L1 profiles module at `packages/core/src/config/profiles.ts` (L0→L1 fix — shared cannot import core), SettingsTable + SettingsValueControl + setting-descriptions + ProfileDropdown. Wave-2 ran as real team `vbw-phase-02` (Agent + team_name = real concurrent execution). +45 new tests. Drift-locks: profiles module location, settings-section.test.ts:226 expansion, `.test.ts` convention, CSS-ownership Plan 02-02. **Phase 03** (2 plans / 2 commits — `5885ac4`/`17aed91`): Integration & retirement. Net -970 LOC (rename OptionsMenu.tsx → SettingsMenu.tsx + DELETE SettingsSection.tsx + AdvancedConfigSection.tsx + their tests = ~-1107 LOC + new integration tests). **DEVN-04 bundled commit:** `5885ac4` contains both user-authored Themes Dropdown feature (8 user-selectable color schemes wired through THEMES const + `<html data-theme>` + 8 `:root[data-theme]` CSS blocks) AND Plan 03-01 deltas — per `[feedback_pragmatic_over_protocol]` user intent honored. Drift-locks 6/7/8: `mergeStagedConfig` re-homing (CRITICAL — copy before delete or handleSave breaks typecheck), `handleStage` signature widening to `(key, value: unknown)`, `data-section="advanced"` assertion removal + 11 stagePathEdit test deletions. **Test growth:** 2675 → 2718 (+43 net workspace-wide). **Final preflight:** 2718 passed / 67 skipped / 0 failed across 307 test files, Gate A+B green. **8 drift-locks held** (5-milestone pre-plan-research pattern continues — now 6-milestone consecutive with milestone 22). **DEVN-05 carry-over:** now 10-milestone exception (13-22). **`derive-milestone-slug.sh` bug** recurs for 6th consecutive milestone — today's output: `21-25-rows-in-a-3-column-layout-setting-value-description` (off-by-one + word-salad); workaround via ROADMAP `**Milestone slug:**` grep. **Bonus:** user-authored Themes Dropdown ships 8 palettes (Default/Dark/Light/Solarized/Dracula/Nord/Monokai/Gruvbox) — `a_non_production_files/themes.md` scope effectively shipped as side-feature. **23 commits ahead of `origin/main` (`57250ee` = alpha.33)** UNPUSHED. Awaits alpha.34 release authorization.
**Previous milestone:** `21-openai-codex-oauth-chatgpt-subscription-auth` — Two-phase OpenAI Codex OAuth feature-parity milestone with Anthropic OAuth. 2 phases, 2 plans, 5 commits. Drift-locks: `mapToOAuthProviderId` at route boundary (SWT `openai` → pi-ai `openai-codex`), `OAUTH_PROVIDERS` UI array fix, augmentSpawnError 3-arm OpenAI branch. Archived 2026-05-19.
**Next action:** **Always run `pnpm release:preflight` BEFORE `bash scripts/bump-version.sh`** — bundles the 5 gates CI runs (typecheck + lint + format:check + test + build). Without it, lint/format errors in out-of-scope files can sneak past spot-check + banner and detonate the tag-push release workflow (alpha.27 lint, alpha.28 format, alpha.30 lint — all preventable). Then: `bash scripts/bump-version.sh 3.0.0-alpha.34` (bundles 23 commits since alpha.33 release `57250ee`: 9 milestone-22 commits + 8 milestone-21 commits + earlier session polish + archive-docs commit) + `git push origin main` + `git tag v3.0.0-alpha.34 && git push origin v3.0.0-alpha.34` (GHA release.yml publishes to npm `next` dist-tag). Or run `pnpm dev` to do deferred visual smokes (Settings ▾ dropdown table renders 24 rows; ProfileDropdown 4 presets stage values; Save persists active_profile + reload shows selection; bonus Themes ▾ dropdown 8 palettes switch via `data-theme`). Or run `/vbw:vibe` to scope milestone 23 (good candidates: dispose of out-of-band model-helpers + DashboardStatusline work in the working tree, or pick up `statusline_v2.md` / `init_wizard.md` / `agent_card.md` / `intro_suggestion1.md` / `vibes-fix2.md` from `a_non_production_files/`). Carry-over backlog: (1) `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across 10 milestones (13-22); needs a dedicated phase. (2) DEVN-PHASE-06-DRIFT-CI-DEFERRED — Lark generator drift CI step. (3) `.vbw-planning/` migration fallback at `phase-detect.ts:189`. (4) Milestone 19 Phase 04 Solid component test for provider-selector dropdown. (5) **`derive-milestone-slug.sh` plugin fix — recurring across 6 consecutive milestones now (17/18/19/20/21/22)**; workaround via ROADMAP `**Milestone slug:**` grep. ESCALATION CANDIDATE. (6) Per-item Github dropdown wiring (4 priority tiers from milestone 20). (7) `originator` param override for `loginOpenAICodex` (milestone 21 deferred). (8) **NEW:** `TopBar.tsx:426` + `TopBar.tsx:448` TS2322 setter return-type drift (Github dropdown + user-Themes dropdown — both pre-existing in dashboard-client typecheck, not workspace typecheck). (9) **NEW:** Out-of-band uncommitted work in working tree: `M DashboardStatusline.tsx`, `?? model-helpers.{ts,test.ts}` — user-authored, awaiting disposition.

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

## Diagnostic Ladders

**Credential persistence ("SWT doesn't remember my auth"):** the alpha.35–.43 arc taught us this bug class has three layers (OS keychain ↔ `config.json` ↔ snapshot resolver). Ask the user to run **`swt doctor --auth`** in the affected project dir; the output shows all three layers + the round-trip resolution in one pass. If `Status: HEALTHY`, the bug is downstream (UI / chat-route caching); if `MISMATCH`, the output tells you which layer broke. Structural protections (`updateConfigFile` helper + invariant test) mean the alpha.38 strip-on-write bug class cannot recur silently — if a future config-writing route forgets the discipline, `packages/dashboard/test/update-config-file.test.ts` fails loudly.

## Development Process

SWT is _built using_ the VBW methodology plugin (`/vbw:vibe`) — distinct from the SWT product itself. Use VBW commands for all lifecycle actions (scope → discuss → plan → execute → verify → archive); plans are the source of truth. Do not hand-edit files in `.vbw-planning/`. Do not fabricate content in project-defining flows — use only what the user explicitly states.
