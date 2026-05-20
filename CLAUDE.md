# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `23-init-wizard-v2-synchronous-scaffold-mapping-deferred` — Four-phase milestone replacing the dashboard's `Initialize SWT project` Lead-subprocess flow with a synchronous wizard + optional post-init codebase mapping affordance. Trigger: user one-liner referencing `a_non_production_files/init_wizard.md` (758-line fully-baked proposal with 17 locked decisions + 35 acceptance criteria). Archived 2026-05-20, 4 phases, 4 plans, 10 atomic commits + 1 user-authored out-of-band ("halindrome" theme rename), local tag `milestone/23-init-wizard-v2-synchronous-scaffold-mapping-deferred` on commit `bc604ed`. **Phase 01 — Server scaffold complete** (1 plan / 3 commits — `ad1ade4`/`8626c47`/`69d38ea`): `initProject()` at L1 writes all 6 planning files + config.json from defaults + auto `git init` + brownfield detect + `detect-stack.sh` for stack.json + bootstrap-claude.sh + hooks install + `.gitignore` sync; new `/api/init-precheck` route; `/api/init` Zod body extended with `planning_tracking` + `auto_push` (`.strict()` rejects unknown fields); **Lead subprocess spawn REMOVED** from `/api/init` (245+ LOC delete verified). **Phase 02 — Wizard UI refactor** (1 plan / 3 commits — `64fa833`/`5334be2`/`6bd5d1b` + 1 user-authored `3f85e3e` "halindrome" theme rename between T01 and T02): `InitScreen.tsx` multi-step state machine, provider-gate logic deleted (Locked Decision #10 vendor-agnostic init), pure-function helpers (`isStep1Complete`, `buildInitBody`, `describeGitState`, `describePrecheckMode`, `classifyInitError`, `summarizeInitResponse`), `fetchInitPrecheck()` client helper, response-driven Step 4 (NOT SSE) + 409 recovery affordance. **Phase 03 — Codebase mapping affordance** (1 plan / 2 commits — `6e9d3f2`/`2f125b5`): snapshot schema gains `brownfield` + `codebase_mapped` (NEW additive fields, NOT renames per Scout Drift 2 — `brownfield_detected` stays); `POST /api/map` shells out to `swt map` CLI (4-Scout fan-out per Scout Drift 1, NOT Lead subagent); snapshotter `WATCH_GLOBS` adds `.swt-planning/codebase/` (Scout Drift 4); `CodebaseMapPrompt.tsx` persistent banner with `shouldShowMapPrompt`/`describeMapState` helpers; PA-1 hoist of `mapClicked` → `dashboard-store` as `isMappingCodebase` + `actions.startCodebaseMap()`. **Phase 04 — Polish + e2e integration** (1 plan / 2 commits — `f5c648f`/`bc604ed`): NEW `packages/dashboard/test/e2e-init-wizard-integration.test.ts` with Pattern B template (mock api.ts + sse.js, exercise createDashboardStore directly, NO Solid render), 6 it-cases covering AC 25 greenfield + AC 26 brownfield lifecycle + idempotency + AC 27 409 store-level + AC 31 vendor-agnostic runtime + in-parent-repo edge; Drift 1 fix (postMap mock gap in greenfield smoke test); AC 32-35 structural confirmations (all 4 greps empty for GSD/`.claude/settings.json`/LSP/CLI init changes). **Test growth:** 2718 → 2845 (+127 net workspace-wide). **Final preflight:** 2845 passed / 67 skipped / 0 failed across 307 test files, Gate A+B green at HEAD `bc604ed`. **21 plan amendments absorbed upfront** across phases (PA-1-8 Phase 01, PA-1-5 Phase 02, PA-1-8 Phase 03 [5 Lead + 3 Dev], PA-1-5 Phase 04) — zero remediation cycles needed. **Locked Decisions enforced + runtime-asserted:** #3 + #17 (mapping decoupled from init), #10 (vendor-agnostic — AC 31 runtime test), #16 (Lead spawn removed). **DEVN-05 carry-over:** now 11-milestone exception (13-23). **`derive-milestone-slug.sh` bug** recurs for 7th consecutive milestone — today's output: `22-a-fresh-user-clicks-initialize-1-second-later-they-have-a` (off-by-one + word-salad); workaround via ROADMAP `**Milestone slug:**` grep. **Shipped to NPM as `v3.0.0-alpha.46`** on 2026-05-20 (alpha.44 + alpha.45 burned at the tag-push CI Test step due to missing VBW-vendored scripts; alpha.46 added 11 carve-outs across 2 hotfix rounds + introduced clean-worktree sandbox preflight as the structural fix for this failure class). npm `next` dist-tag at `3.0.0-alpha.46`; 172 files in tarball with Sigstore provenance.
**Previous milestone:** `22-settings-dropdown-v2-flat-table-profile-presets` — Three-phase milestone replacing the dashboard's `Options ▼` dropdown with flat `Settings ▼` table + 4-preset Profile dropdown. 3 phases, 6 plans, 9 commits (8 milestone-22 + 1 bonus Themes Dropdown). Archived 2026-05-19.
**Next action:** **alpha.46 SHIPPED 2026-05-20.** Future releases: ALWAYS run `pnpm release:preflight` AND validate in a clean-worktree sandbox (`git worktree add /tmp/preflight-sandbox HEAD && cd $_ && pnpm install --frozen-lockfile && pnpm release:preflight`) BEFORE `bash scripts/bump-version.sh` + `git tag` + `git push origin <tag>`. The sandbox preflight catches local-environment leakage (untracked-but-locally-present files that pass local preflight but fail CI). Two new carry-over items added to the backlog: (a) invert `.gitignore`'s `scripts/*` rule to track-by-default (130 untracked-but-present scripts indicate the current allowlist is fragile); (b) automate `pnpm release:preflight:sandbox` so the sandbox step is a single command. Run `pnpm dev` to do deferred visual smokes (greenfield init wizard 4 steps, brownfield CodebaseMapPrompt banner click → /api/map dispatch, 409 already-initialized recovery, vendor-agnostic empty-providerAuth boot). Or run `/vbw:vibe` to scope milestone 24 (good candidates: `Popover.tsx:138` TS2322 dedicated remediation phase, `derive-milestone-slug.sh` plugin fix, per-item Github dropdown wiring from milestone 20, or pick up `statusline_v2.md` / `agent_card.md` / `intro_suggestion1.md` / `vibes-fix2.md` from `a_non_production_files/`). Carry-over backlog: (1) `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across 11 milestones (13-23); needs a dedicated phase. (2) DEVN-PHASE-06-DRIFT-CI-DEFERRED — Lark generator drift CI step. (3) `.vbw-planning/` migration fallback at `phase-detect.ts:189`. (4) Milestone 19 Phase 04 Solid component test for provider-selector dropdown. (5) ~~`derive-milestone-slug.sh` plugin fix~~ — **FIXED 2026-05-20** in local plugin cache (`~/.claude/plugins/cache/vbw-marketplace/vbw/1.37.1/`). New Try 0 reads `**Milestone slug:**` line verbatim from ROADMAP.md (bypasses off-by-one number computation); Try 3 awk regex tightened to require `Phase N:` prefix (closes word-salad bullet bug). 16/16 smoke tests + all 7 historical milestone fixtures (17-23) resolve correctly. Local cache patch only — survives until next plugin update; for permanent fix across updates, PR to vbw-marketplace upstream. (6) Per-item Github dropdown wiring (4 priority tiers from milestone 20). (7) `originator` param override for `loginOpenAICodex` (milestone 21 deferred). (8) `TopBar.tsx:426` + `TopBar.tsx:448` TS2322 setter return-type drift — pre-existing in dashboard-client typecheck across milestones 22-23. (9) **NEW (milestone 23 carry-over):** CLI `swt init` wizard parity (proposal Future Work); "Reinitialize" command; provider auth flow embedded in wizard; project template seeding; brownfield Lead-driven inference UI; wizard cancellation cleanup; per-project provider pinning; auto-run codebase mapping on idle — all explicitly deferred per `a_non_production_files/init_wizard.md` Future Work.

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
