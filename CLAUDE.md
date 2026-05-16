# SWT v3 — Pi-Native Coding Harness

**Core value:** Token-efficient, methodology-driven coding harness — vendor-agnostic by construction. A TypeScript monorepo CLI that runs the VBW methodology on the `@earendil-works/pi-coding-agent` substrate.

## Active Context

**Work:** No active milestone
**Last shipped:** `12-free-talk-mode-dashboard-chat` — Dashboard cook bar now has a free-talk default mode that bypasses the orchestrator entirely (archived 2026-05-16, 4 phases, 7 plans, 30 commits). **Phase 01** — `POST /api/chat` SSE route that spawns an ephemeral `SwtSession` and streams `chat.*` events (chat.start / message_delta / tool_call / message_end / token_usage / error / complete); `ChatSessionRegistry` with TTL sweep manages handle lifetime; `resolveSpawnCredential` + `readProjectAuthConfig` extracted from `cook.ts` to `@swt-labs/runtime` (L2) so the L7 dashboard imports them without a layer violation; 22 new tests across runtime + dashboard. **Phase 02** — TopBar `verb()` widened to `string | null` default `null`; `.topbar-cmd-neutral` slate-muted modifier; `onChat?: (text) => Promise<unknown>` prop; × clear button returns to neutral; 10 null-branch tests. **Phase 03** — `ChatSession` + `ChatMessage` types; `startChat` + `clearChat` actions with optimistic chat_session_id adoption via `chat.start` reducer; `ChatPanel.tsx` Solid component with `<For>` over messages; pure helpers (`chat-panel-helpers.ts`); App.tsx mode-switch `<Show when={state.chatSession} fallback={<LogPanel/>}>`; 22 new tests (15 store + 7 helpers). **Phase 04** — README "Chat vs Cook" subsection inside Quick start; `swt init` stdout note advertising chat mode; `FirstRunHint.tsx` banner with project-scoped localStorage dismissal (createEffect watches both chat and vibe session signals for first-submit auto-persist); one-line copy in `ProviderAuthPanel.tsx` noting cook/qa/init share the credential; 12 new tests. Test totals: **2214 passed / 67 skipped / 0 failed** (was 2156 pre-milestone; +58 new). Milestone 11 (`11-best-in-class-provider-prompts-and-tools`) was archived 2026-05-16 but its 22 commits still sit unpushed on `main`; alpha.18 was never published. Including milestone-12 archive fixup commits + one orthogonal README banner commit, **52 commits ahead of origin/main UNPUSHED** since `9498d71`. `git push` + version bump + npm publish are this session's next steps.
**Next action:** `bash scripts/bump-version.sh 3.0.0-alpha.24` + `git push origin main` + `git tag v3.0.0-alpha.24 && git push origin v3.0.0-alpha.24` (GHA release.yml publishes to npm `next` dist-tag). The single backlog item is the pre-existing Popover.tsx:138 TS2322 ARIA-role-union error — tracked in STATE.md Todos.

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
