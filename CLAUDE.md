# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `21-openai-codex-oauth-chatgpt-subscription-auth` — Two-phase milestone closing the OpenAI Codex OAuth feature-parity gap with Anthropic OAuth. Trigger: user one-liner citing https://developers.openai.com/codex/cli — "OpenAI explicitly says OAuth is a valid way to auth into Codex for ChatGPT users, so please apply." (archived 2026-05-19, 2 phases, 2 plans, 5 commits, local tag `milestone/21-openai-codex-oauth-chatgpt-subscription-auth`). **Phase 01** (2 commits — `228571f`/`cfff42c`): Pi-ai 0.74.0 OAuth audit (Finding A — native support in `openai-codex.{js,d.ts}`) + SWT↔pi-ai ID mapping at the route boundary. **DRIFT-1 (CRITICAL):** pi-ai registers OpenAI under `id: "openai-codex"`, SWT speaks `"openai"` — `getOAuthProvider("openai") === undefined` would 400 every OAuth start. Resolution: NEW `packages/runtime/src/credentials/oauth/provider-id-map.ts` (51 LOC) with table-driven `mapToOAuthProviderId(swtProviderId): string`, single-case `{ openai → openai-codex }` + identity fallback. Dashboard route at `provider-auth-oauth.ts:214` maps once; `getOAuthProvider(mappedProvider)` at L221 + `runOAuthLoginFlow({ provider: mappedProvider, ... })` at L241 use the mapped id — every other use (events, credentialRef `swt:openai:oauth`, `auth.openai` config, response body) keeps the SWT canonical id. **Phase 02** (3 commits — `d56ff01`/`6b39737`/`b755214`): Provider menu OAuth radio + InitScreen advisory + augmentSpawnError parity. **Phase 02 DRIFT-1 (CRITICAL):** `ProviderAuthPanel.tsx:173` `OAUTH_PROVIDERS` array contained pi-ai's `'openai-codex'` instead of SWT's `'openai'` — `isOAuthProvider('openai') === false` would have disabled the OAuth radio for OpenAI users (same root cause as Phase 01's drift, leaked into UI). Single-token array-literal edit fixes it, locked by regression test. InitScreen advisory sibling at `init.ts:301-309` points users at `https://platform.openai.com/account/billing/overview`. `augmentSpawnError` gains an OpenAI branch at `cook.ts:1225-1281`: pattern `/rate_limit_exceeded|quota.*exceed|insufficient_quota|billing/i` AND `context?.provider === 'openai'` (disjoint from Anthropic's `/out of extra usage/i`); three sub-branches (oauth / api_key / no-context-backwards-compat); headline `OpenAI says: Check your usage at platform.openai.com/account/billing/overview and keep going.`. Reuses `extractRequestId` from cook.ts:1113. **Test growth:** 2659 → 2681 (+22 net: 12 mapping + route smoke in Phase 01 + 10 UI lock + augmenter sibling describes + disjointness pair in Phase 02). **Regression:** held at 115/27/0 throughout. **D2 invariant:** preserved (Anthropic OAuth advisory + augmenter branch + headline byte-identical to milestone 19). **DEVN-05 carry-over:** now 9-milestone exception (13-21). **Pre-plan orchestrator-research pattern** (deterministic research via grep + node-eval against installed packages) caught both phases' critical drifts before Scout/Lead spawn — now stable across 4 consecutive milestones (17/19/20/21). **5 milestone-21 commits** + 5 prior session commits (Github dropdown move, chat-user green-on-black, Tutorials chip, FirstRunHint removal, augmenter prior tweak) + Phase 02 style commit + milestone-21 archive docs = **12 commits ahead of `origin/main` (`57250ee`)**, all UNPUSHED. Awaits alpha.34 release authorization.
**Previous milestone:** `20-github-dropdown-ui-scaffolding-placeholder` — Single-phase placeholder UI milestone adding `Github ▼` dropdown to the dashboard chrome row. 8 items in 3 sections, every click is `console.debug` no-op. Per-item wiring deferred across 4 priority tiers. 7 brief drift corrections applied. 3 commits, archived 2026-05-19. Already part of alpha.33's published payload.
**Next action:** **Always run `pnpm release:preflight` BEFORE `bash scripts/bump-version.sh`** — bundles the 5 gates CI runs (typecheck + lint + format:check + test + build). Without it, lint/format errors in out-of-scope files can sneak past spot-check + banner and detonate the tag-push release workflow (alpha.27 lint, alpha.28 format, alpha.30 lint — all preventable). Then: `bash scripts/bump-version.sh 3.0.0-alpha.34` (bundles 12 commits since alpha.33 release `57250ee`: 5 milestone-21 commits + post-alpha.33 polish from this session + milestone-21 archive docs) + `git push origin main` + `git tag v3.0.0-alpha.34 && git push origin v3.0.0-alpha.34` (GHA release.yml publishes to npm `next` dist-tag). Or run `pnpm dev` to do deferred visual smokes (milestone 21 Provider menu OAuth radio enabling for openai; flow start → auth_url; spawn-failure augmenter copy showing the platform.openai.com URL when ChatGPT-subscription quota exhausts). Or run `/vbw:vibe` to scope milestone 22. Carry-over backlog items: (1) `Popover.tsx:138` TS2322 ARIA-role-union error (DEVN-05) — accepted-process-exception across milestones 13/14/15/16/17/18/19/20/21 (9 milestones); needs a dedicated phase. (2) DEVN-PHASE-06-DRIFT-CI-DEFERRED — Lark generator drift CI step. (3) `.vbw-planning/` migration fallback at `phase-detect.ts:189` — lone Locked Decision #6 exception. (4) Milestone 19 Phase 04 Solid component test for provider-selector dropdown — still deferred. (5) **`derive-milestone-slug.sh` plugin fix — recurring across 5 consecutive milestones now (17/18/19/20/21)**; script returns word-salad gibberish from CONTEXT.md/ROADMAP prose (today's output: `20-auditing-earendil-workspi-ais-openai-oauth-support` — wrong milestone number + nonsense slug); workaround is the ROADMAP `**Milestone slug:**` value via grep. Escalation candidate at this point. (6) Per-item Github dropdown wiring (4 priority tiers from milestone 20). (7) `originator` param override for `loginOpenAICodex` (milestone 21 Phase 01 DRIFT-2 deferred) — set to `"swt"` for distinct OpenAI telemetry attribution.

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
