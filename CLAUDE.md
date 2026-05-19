# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `18-runtime-preconditions-and-greenfield-routability` — Four-phase milestone enforcing Locked Decision #6 ("no silent fallbacks") uniformly across SWT's runtime path, triggered by two 2026-05-18 user-reported alpha.31 incidents (dashboard 404 on greenfield + tarball ships 3/166 scripts) (archived 2026-05-19, 4 phases, 4 plans, 20 commits, local tag `milestone/18-runtime-preconditions-and-greenfield-routability`). **Phase 01** (G-01, 7 commits) — Dropped `if (projectRoot)` gate at `packages/dashboard/src/server/index.ts:238`; 4 artifact routes (`/api/artifact`, `/api/artifact-history`, `/api/artifact-diff`, `/api/uat-checkpoint`) now register unconditionally with `() => projectRoot` getter (mirrors snapshot-route pattern at L219); routes return `503` with `dashboard not yet initialized — run swt init then retry` when null; `jsonRequest` `readErrorMessage` helper in `api.ts`; selectArtifact 404 reconcile via fetchSnapshot at `dashboard-store.ts:1815`. **Phase 02** (G-02, 6 commits) — `package.json` `files[]` extended (16→13 entries, 7 superseded scripts removed, 4 dirs added); `scripts/.npmignore` placed NESTED (DEVN-02: npm 11 root `.npmignore` does NOT override `files[]` per npm/cli#6221, #4069 — only nested works); new `scripts/check-tarball-shape.mjs` Node ESM (`npm pack --dry-run --json` + 10-sentinel hard-error assertions); `pnpm release:preflight` extended with `check:tarball-shape` step. **Phase 03** (G-03, 5 commits) — 27 silent-fallback patterns converted to hard-error across 5 commands/\*.md (Pattern A: 5 NORM_SCRIPT, Pattern B: 22 PG_SCRIPT); `packages/cli/src/commands/verify.ts:457` `const installRoot = resolveInstallRoot()` (was `?? io.cwd` bug). **Phase 04** (G-04, 2 commits) — `packages/runtime/src/session.ts` (+29/-2): hoisted dual `materializeExtensionsToCustomTools` calls (lines 198/236) to single shared site at L165; 13-line guard throws canonical error when `opts.extensionFactories?.length > 0 && customTools.length === 0` (catches incomplete-install at the assertable boundary — Pi 0.74 has no registered-tools query API); `session.test.ts` (+154/-1): 4 new `vi.doMock` truth-table tests with `vi.resetModules()` at start of `loadCreateSessionWithMock` helper (defeats top-of-file static import caching of Pi module graph). **Test growth:** 2594 → 2598 (+4 Phase 04 truth-table tests). **Regression:** held at 115/27/0 throughout. **D2 invariant:** trivially preserved (runtime-precondition + infrastructure changes only — no provider-prompt edits). The 21 milestone-18 commits sit on `main` UNPUSHED (20 milestone + 1 archive-docs commit; milestone 17 was pushed to `e8c1369` after its archive). **User-elected spot-check + banner closeout pattern** used across all 4 phases (lighter than full QA agent — preflight + working-tree + out-of-scope guards + smoke test PASS per phase).
**Previous milestone:** `17-codex-cli-parity-via-provider-tuning-pack` — Six-phase milestone closing the gap between SWT-on-Codex sessions and standalone Codex CLI via the `ProviderTuningPack` abstraction (archived 2026-05-18, 6 phases, 6 plans, 43 commits, local tag `milestone/17-codex-cli-parity-via-provider-tuning-pack`). 7-field `ProviderTuningPack` interface + 2 packs (`AnthropicViaPiPack`, `CodexViaOverlayPack`) + canonical `gpt-5.2-codex_instructions_template.md` + AGENTS.md hierarchical loader + Pi `resourceLoader` bridge + `update_plan` customTool + `swt provider-tuning-sources` CLI verb + drift-detection refactor + Lark→TS apply-patch parser generator. D2 invariant preserved (Anthropic + OpenAI spawn-snapshots byte-identical from Phase 04 close). Test growth 2543→2581 (+38 net).
**Next action:** **Always run `pnpm release:preflight` BEFORE `bash scripts/bump-version.sh`** — it bundles the 5 gates CI runs (typecheck + lint + format:check + test + build). Without it, lint/format errors in files outside the milestone's scope can sneak past spot-check + banner (or scoped QA) and detonate the tag-push release workflow (alpha.27 lint, alpha.28 format, alpha.30 lint — all preventable). Then: `bash scripts/bump-version.sh 3.0.0-alpha.33` (bundles 21 milestone-18 commits since `e8c1369`) + `git push origin main` + `git tag v3.0.0-alpha.33 && git push origin v3.0.0-alpha.33` (GHA release.yml publishes to npm `next` dist-tag). Or run `pnpm dev` to do deferred visual smokes (milestone 16 monospace consistency + milestone 17 dashboard render of `cook-plan-update` log entries with `[x]/[~]/[ ]` indicators + milestone 18 Phase 01 greenfield artifact routes returning 503 before `swt init`). Or run `/vbw:vibe` to scope milestone 19. Three carry-over backlog items: (1) `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13/14/15/16/17/18; needs a dedicated phase to revisit `Popover.tsx`'s ARIA-role typing without scope creep. (2) DEVN-PHASE-06-DRIFT-CI-DEFERRED — CI workflow step to run `pnpm gen:apply-patch-parser` + `git diff --exit-code` on the parser file would close the Lark drift loop end-to-end; tracked for follow-up patch. (3) `.vbw-planning/` migration fallback at `phase-detect.ts:189` is the lone Locked Decision #6 exception — deferred to Milestone H-02 (gate behind explicit `--from-vbw` flag or loud warning) so milestone-15→17 migration story stays intact.

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
