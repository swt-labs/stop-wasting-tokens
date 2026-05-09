# Changelog

## 1.6.4

### Patch Changes

- v1.6.4 — `swt dashboard` finds its bundle from any directory.

  v1.6.3 published the dashboard with a `resolveDaemonEntry()` that
  looked for `dist/dashboard-server.mjs` **relative to the user's CWD**,
  with a hand-rolled "go up 4 dirs and probe" fallback that only
  worked from inside the source repo. For anyone who installed via
  `npm i -g stop-wasting-tokens` and then ran `swt dashboard` from
  any directory other than the repo root (i.e., 100% of real users),
  the daemon couldn't be located and the CLI failed with the
  misleading "Run `pnpm build` from the repo root" error.

  **Root cause.** The CLI bundle (`dist/cli.mjs`) and the daemon
  bundle (`dist/dashboard-server.mjs`) ship as siblings in the
  published tarball — both are emitted by tsup into the same
  `dist/` and both are listed under `package.json:files`. When
  Node loads `cli.mjs`, `import.meta.url` resolves to its install
  location, and the daemon is **always** at
  `join(dirname(fileURLToPath(import.meta.url)), 'dashboard-server.mjs')`
  regardless of the user's CWD. The CWD-based check shipped in
  v1.6.0 was a leftover from local-dev orchestration that never
  applied to published installs.

  **Fix** (`packages/cli/src/commands/dashboard.ts`):
  `resolveDaemonEntry()` now resolves three candidate paths in
  order, with the bundle-adjacent path first so it always wins
  for real users:
  1. **Adjacent to `cli.mjs` itself** — the path that always works
     for `npm i -g` installs and for `node ./dist/cli.mjs`
     invocations from the source repo.
  2. **Repo-relative `dist/dashboard-server.mjs`** computed via
     `realpath(...)` walk-up from `cli.mjs` — covers `pnpm tsx
packages/cli/src/index.ts` flows where the bundled daemon
     exists at the repo's root `dist/` but the unbundled cli is
     in `packages/cli/src/`.
  3. **Repo-relative source `index.ts`** — covers the in-repo
     dev case where neither bundle exists yet but the daemon
     source is reachable.
  4. **CWD-relative `dist/dashboard-server.mjs`** — last-resort
     legacy fallback for "I just ran `pnpm build` and am in the
     repo root."

  Error message rewritten to point at re-installation rather than
  `pnpm build` since the new failure mode is "your global install
  is corrupt" rather than "you forgot to run a build step."

  **Defensive: install-smoke now exercises `swt dashboard`.**
  `scripts/verify-install.sh` gains a 6th check: spawn the daemon
  in the background, `curl /api/health` and `/api/snapshot` to
  confirm both the dashboard server and the SPA fallback fix
  from v1.6.2 are still working, then kill the daemon. This
  catches:
  - "daemon bundle not found" (v1.6.4's class of regression)
  - "SPA fallback eats /api/\* paths" (v1.6.2's regression)
  - "daemon refuses to start" (any future Hono/binding issue)
    …all at the publish gate, before the bug reaches users.

  **Verified end-to-end** by simulating the full `npm i -g` flow:
  `npm pack` the local dist, `npm install --prefix /tmp/...` the
  resulting tarball, `cd /tmp/empty-dir && swt dashboard --no-open`
  → daemon boots, `/api/health`, `/api/snapshot`, and `/` all
  serve correctly with no `pnpm` anywhere in sight.

  No new dependencies, no schema changes, no API surface changes.
  Pure resolution-bug fix + smoke-test hardening.

## 1.6.3

### Patch Changes

- v1.6.3 — Greenfield init UX + inline command bar.

  v1.6.2 made the dashboard daemon serve its own SPA, but the SPA still
  showed a misleading "DISCONNECTED" indicator when run from a directory
  that didn't have `.swt-planning/` yet — and there was no path forward
  in-browser, since `swt init` is a stub in the published binary. v1.6.3
  fixes both of those and adds an inline command input next to the
  brand cursor so the dashboard mirrors the CLI surface 1:1 with visual
  feedback.

  **Greenfield init flow**
  - `packages/dashboard-core/src/schemas/snapshot.ts` — `project`,
    `milestone`, `cost_summary` are now nullable on the snapshot
    schema, plus a new `is_initialized: z.boolean().default(true)` flag.
  - `packages/dashboard/src/server/snapshot/empty.ts` — synthesizes a
    `is_initialized: false` snapshot for greenfield daemons.
  - `packages/dashboard/src/server/routes/snapshot.ts` — registers
    unconditionally with a getter so a snapshotter that lights up
    after `POST /api/init` is picked up automatically; serves the
    synth when the getter returns null.
  - `packages/dashboard/src/server/routes/init.ts` — new
    `POST /api/init { name, description? }` endpoint that scaffolds
    `.swt-planning/PROJECT.md` + `.swt-planning/STATE.md` + an empty
    `phases/` dir, then triggers a snapshotter spin-up so subsequent
    `/api/snapshot` polls + SSE `state.changed` events flow.
    `409 already_initialized` if `.swt-planning/` already exists.
  - `packages/dashboard/src/client/components/InitScreen.tsx` —
    centered onboarding card with project-name input + description
    textarea + "Initialize SWT project" button, rendered when the
    snapshot reports `is_initialized: false`.
  - `App.tsx` branches on `snapshot.is_initialized`: false → InitScreen,
    true → the existing 4-panel grid.

  **Inline command bar (CLI parity)**
  - `packages/dashboard-core/src/schemas/api.ts` — new
    `CommandBodySchema` / `CommandResponseSchema` (`{ input }` →
    `{ ok, exit_code, stdout, stderr, duration_ms }`).
  - `packages/dashboard/src/server/routes/command.ts` — new
    `POST /api/command` route. Splits the input on whitespace
    (no shell parsing — args go directly to `child_process.spawn`),
    invokes the user's installed `swt` binary in the daemon's cwd,
    captures stdout/stderr with a 10 s timeout, returns the result.
    `dashboard` and `watch` are rejected with helpful errors
    (recursive launch / Ink TUI requires an interactive terminal).
  - `packages/dashboard/src/client/components/TopBar.tsx` — new
    inline `<form>` with a `$` prompt and an input next to the
    blinking cursor. Submit on Enter routes to the new `runCommand`
    store action.
  - `dashboard-store.runCommand` appends `$ swt <input>` plus each
    stdout/stderr line into `recentLogLines` so users see the
    command echo + response in the LogPanel exactly like a terminal.
    Re-fetches the snapshot opportunistically after each command so
    state-mutating verbs (init via CLI, future archive, etc.) reflect
    immediately.

  **Bug fixes carried in this release**
  - SPA fallback at `app.get('*')` now skips `/api/*` paths so missing
    API routes return real JSON 404s instead of HTML — closes the
    masking bug introduced by v1.6.2's static-files wiring.
  - `packages/dashboard/src/server/snapshot/reducer.ts` adds
    `is_initialized: true` to the reducer's output so the live
    snapshotter's snapshot matches the schema's expected shape.

  **Verified end-to-end** (greenfield → init → connected → command):
  - `GET /` → 200 + index.html
  - `GET /api/snapshot` (greenfield) → 200 + `is_initialized: false`
  - `POST /api/init` → 200 + creates the three artifacts
  - `GET /api/snapshot` (post-init) → 200 + `is_initialized: true`
  - `POST /api/command { input: "help" }` → 200 + real swt help
  - `POST /api/command { input: "watch" }` → 200 + `ok: false`
  - typecheck + lint --max-warnings 0 + format:check all green

  No new runtime dependencies; `@hono/node-server/serve-static` was
  already pulled in by v1.6.2.

## 1.6.2

### Patch Changes

- v1.6.2 — Dashboard daemon serves the SPA.

  v1.6.1 shipped the localhost dashboard daemon and the bundled SPA
  (`packages/dashboard/dist/client/`) as separate concerns. The daemon
  registered all the API routes (`/api/snapshot`, `/api/events`,
  `/api/artifact`, `/api/uat/:phase/checkpoint`, `/api/health`,
  `/api/_debug/emit`) but never registered a static-file handler for
  `GET /`. Result: `swt dashboard` happily reported `Listening on
http://127.0.0.1:54320`, but a browser visiting that URL got
  `404 Not Found` because Hono had no route matching `/`.

  The Phase 02 UAT had verified the SPA via Vite's dev server (proxying
  `/api/*` to the daemon), and the Phase 04 `swt dashboard` smoke
  CHECKPOINT was answered PASS without an actual end-to-end
  `npm install -g + swt dashboard + open browser` run. So the gap shipped.

  **Fix.** `packages/dashboard/src/server/index.ts` now registers a
  `serveStatic` route from `@hono/node-server/serve-static` that mounts
  the bundled SPA at `/`, plus an SPA fallback for unknown GET paths so
  client-side routing (deep links, refreshes) works. The static-files
  directory is resolved at runtime via `import.meta.url` with three
  candidate paths covering: published tarball
  (`dist/dashboard-server.mjs` → `../packages/dashboard/dist/client`),
  in-repo dev (`src/server/index.ts` → `../../dist/client`), and a
  CWD-relative fallback. If none exist, the static block is skipped
  silently — API-only mode still works.

  **Verified locally.**
  - `GET /` → 200 + index.html (correct script + style tags)
  - `GET /assets/index-*.js` → 200 + ~93 KB JS bundle
  - `GET /assets/index-*.css` → 200 + CSS bundle
  - `GET /api/health` → 200 + JSON (existing API unaffected)

  No new dependencies; `@hono/node-server` was already a dashboard dep.

## 1.6.1

### Patch Changes

- v1.6.1 — Codex SDK conformance hardening, post-v1.6.0.

  Closes the three deferred findings from the v1.5.1 SDK conformance pass (F-07, F-15, F-17) and fixes a pre-existing TOML emit bug surfaced while running the new test sweep. No public-API breaking changes; all additions are optional. The Codex backend driver (`@swt-labs/codex-driver`) now exhibits 59/59 green tests against the documented Codex schema.

  **F-07 — Role aliasing**
  - `packages/core/src/abstractions/AgentSpawner.ts` adds `aliases?: readonly string[]` to `AgentSpec`. Optional; when omitted the emitted TOML is byte-identical to v1.6.0 output.
  - `packages/codex-driver/src/toml/agents.ts` — `emitAgentToml` emits `aliases = [...]` only when `spec.aliases` is non-empty, so legacy specs without the field stay on the existing emit path.
  - `packages/codex-driver/test/toml.test.ts` — 2 new cases: emit-when-present, omit-when-absent-or-empty.

  **F-15 — `AGENTS.override.md` support**
  - `packages/codex-driver/src/agents-md/writer.ts` — new helpers `composeAgentsMdBody(swtBody, overrideContent?)` and `readAgentsOverrideSync(projectRoot)`, plus the public exports `OVERRIDE_BEGIN_FENCE`, `OVERRIDE_END_FENCE`, and `AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md'`.
  - Pattern: when `AGENTS.override.md` is present at the project root, its content is folded into the SWT-managed block of `AGENTS.md` between dedicated override fences, so user-authored project-specific rules survive every `swt init` / `swt vibe` regeneration.
  - Empty / whitespace-only overrides are silently dropped — no override fence appears at all.
  - `packages/codex-driver/test/agents-md.test.ts` — 6 new cases: no-override / explicit-override / empty-override / read-when-missing / read-when-present / regenerate-round-trip.

  **F-17 — Agent prompt cache-hit measurement**
  - `packages/codex-driver/test/cache-hit.test.ts` (new file) — locks down REQ-05 (cache-aware split prompts) by asserting:
    1. Two `emitAgentToml(spec)` calls with the same spec produce byte-identical output and identical SHA-256 digests (cache key stability).
    2. Mutating the static prefix layer (`developer_instructions`) yields a different digest, so silent-prefix-drift regressions surface as test failures rather than degraded production cache hit-rate.
    3. Object key-insertion-order shuffles do not change the emitted TOML — defends against deterministic emit going wobbly if the upstream `AgentSpec` schema is ever refactored.

  **Pre-existing bug fix — `[features]` table emission**
  - `packages/codex-driver/src/toml/features.ts` — `emitFeaturesToml(flags)` was calling `emitToml({ features: entries })`, which applied the inline-table heuristic for primitive-only sub-objects and produced `features = { foo = true, bar = false }` instead of the documented Codex `[features]` table header.
  - The pre-existing test `toml.test.ts > features TOML > emits a [features] table when flags are present` was failing at HEAD as a result — caught only because the F-07 batch ran the suite end-to-end.
  - Replaced with a direct-emit implementation that always writes the `[features]` header followed by `key = value` lines. Empty input still returns an empty string so callers can no-op cleanly.

  **Quality gate trail**
  - `prettier --check .` clean.
  - `tsc --build packages/{core,codex-driver}` exit 0.
  - 59/59 codex-driver vitest cases green (was 57/59 at v1.6.0 HEAD due to the latent `[features]` bug).
  - 11 new test cases added (2 F-07 + 6 F-15 + 3 F-17).

  **Documentation**
  - `.vbw-planning/REQUIREMENTS.md` (local-only, gitignored) refreshed with shipping-evidence notes — most REQ-01..REQ-17 now `[x]` against actual code locations.
  - `a_non_production_files/issues1.md` catalogs the full audit trail: closed items, deferred items, blocked items (npm publish, plugin-marketplace submission, docs-site publish), and live-runtime verification gaps.

  **Out of scope (deferred to next milestone):** Playwright e2e suite × Linux + macOS, `axe-cli` automated CI a11y gate, published `docs.stopwastingtokens.dev` site, full Claude Code driver implementation (REQ-V2-02), full Ollama driver implementation (REQ-V2-03), real Codex `subagent`-spawn API wiring once OpenAI publishes the surface, telemetry / Vale / hook-taxonomy long-tail.

## 1.6.0

### Minor Changes

- v1.6.0 — Localhost Dashboard.

  Adds a localhost web dashboard (`swt dashboard`) that renders live SWT project state — phases, plans, summaries, agent timeline, log stream, cost rollups — with a Hono daemon, a Solid SPA, chokidar file-watching, and SSE-driven live updates. UAT CHECKPOINTs can be recorded from the browser. Defence-in-depth localhost-only binding, exponential-backoff SSE reconnect, server-side log rate limiting, client-side artifact virtualization, and bundle-size + offline guards round out the production polish. Implements `non_production_files/UI/TDD.md` end-to-end across 4 phases.

  **Phase 01 — Workspace Foundation and Schema Spike:**
  - New `packages/dashboard/` (Hono server + Solid client) and `packages/dashboard-core/` (shared Zod schemas: `Snapshot`, `SnapshotEvent`, `ApiSchemas`).
  - Vite dev-mode `/api` proxy + tsup server bundle into `dist/dashboard-server.mjs`.
  - SSE round-trip from a dummy event source proven against `EventSource('/api/events')` within 250 ms.

  **Phase 02 — MVP Read-Only Dashboard:**
  - chokidar watcher → debounced snapshot reducer → SSE incremental events.
  - Endpoints `GET /api/snapshot`, `GET /api/events`, `GET /api/artifact?path=...` with path-traversal guard restricted to `.swt-planning/**` + `dist/**` allowlist.
  - Markdown rendered server-side through unified + remark-parse + remark-gfm + remark-rehype + rehype-sanitize + `@shikijs/rehype` + rehype-stringify.
  - Components: TopBar, PhaseStepper, ArtifactTree, ArtifactPreview. CSS tokens derived from `non_production_files/UI/BRANDKIT.md` (terminal-green, deep-void, ghost-white, neon-cyan, warm-amber, danger-red, slate-muted).

  **Phase 03 — Live Event Stream and UAT:**
  - New `packages/cli/src/lifecycle/event-bus.ts` emits structured `.swt-planning/.events/<sessionId>.jsonl` records (5 typed variants: `agent.spawn`, `agent.complete`, `phase.transition`, `qa_gate`, `log.append`) with 50 ms buffered flush.
  - Daemon-side JSONL tailer (chokidar + per-file byte-offset tracking) bridges CLI events through the existing SSE channel.
  - Live UI panels: AgentTimeline (newest-first cards with role colors + tokens/cost/duration), LogPanel (200-line cap + ↓ jump-to-live pill + ANSI parser), CostPanel (three big JetBrains-Mono numbers).
  - SSE exponential-backoff reconnect: `[1000, 2000, 5000, 10000]` ms cap. On second open, fresh `GET /api/snapshot` re-fetch recovers from drift during disconnect.
  - UAT modal + `POST /api/uat/:phase/checkpoint` (Zod-validated body, 200/400/404/409 contract). Repo-level `.gitignore` extended with `.swt-planning/.events/`.

  **Phase 04 — CLI Integration and Polish:**
  - New `swt dashboard` subcommand wired into the CLI registry. Flags: `--port=N`, `--host=H`, `--unsafe-public`, `--no-open`, `--debug`. Free-port picker (54320–54420 then OS-assigned fallback).
  - **AC-14 binding guard, defence-in-depth:** both the CLI command and the server boot path refuse non-loopback bindings unless `--unsafe-public` (or `SWT_DASHBOARD_UNSAFE_PUBLIC=1`) is set. Symmetrical implementation in `packages/cli/src/lib/binding-guard.ts` + `packages/dashboard/src/server/lib/binding-guard.ts`.
  - **AC-01 browser auto-open** via the `open` package (lazy-imported), disabled automatically under `CI=1` or non-TTY.
  - **Performance polish:** server-side `log.append` rate limit at 100 lines/sec with synthetic drop-notice; client-side `ArtifactPreview` virtualization at 500 paragraphs with `Show paragraphs N+1–M of total` pill.
  - **Size + offline guards:** `scripts/check-bundle-size.mjs` enforces SPA ≤ 80 KB gzipped + daemon ≤ 200 KB raw; `scripts/check-offline.mjs` greps the SPA bundle for forbidden CDN hosts.
  - **Docs:** `docs/swt-dashboard.md` documents the full subcommand surface (flags, env overrides, AC-14 binding guard, AC-01 auto-open, AC-11 offline guarantee, AC-10 size budgets, AC-12 / AC-13 accessibility). README.md links to it.

  **Acceptance criteria addressed:** AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15.

  **Quality gate trail:**
  - 4/4 phases QA PASS (5 must-haves per phase, M1–M5).
  - 17/17 UAT CHECKPOINTs PASS across the 4 phases.
  - 94 files modified across the milestone with 0 phase-level deviations.
  - All hard archive gates passed (UAT guard + state-consistency + 7-point audit).

  **Stack additions** (locked at TDD §3, all pinned): `hono@4`, `@hono/node-server@1`, `solid-js@1`, `vite@5`, `chokidar@4`, `gray-matter@4`, unified + remark + rehype family, `@shikijs/rehype`, `open@10`. Tarball growth fits within the +150 KB ceiling (AC-10).

  **Out of scope (v1.6.1):** Playwright e2e suite (3–5 critical paths × Linux + macOS), published `docs.stopwastingtokens.dev/swt-dashboard` site, `axe-cli` automated CI a11y gate. AC-12 / AC-13 verified manually via UAT.

## 1.5.1

### Patch Changes

- cceb8ee: v1.5.1 — Codex SDK conformance pass.

  Closes 11 of 17 findings from the Codex SDK verification research at developers.openai.com/codex (Tier 1+2+3); 6 deferred to v1.6+ (Tier 4).

  **Phase 01 — SDK Critical Conformance** (F-01, F-02, F-04):
  - All 6 agent profile TOMLs use documented Codex models: `gpt-5.5` (scout/architect), `gpt-5.3-codex` (lead/dev/qa/debugger). The fictional `gpt-5-codex` identifier no longer appears in product code.
  - All 6 TOMLs declare `model_reasoning_effort` in the documented Codex enum (`minimal | low | medium | high | xhigh`) per role: scout=low, architect=high, lead/dev/qa=medium, debugger=high. SWT Effort tier values (`thorough | balanced | fast | turbo`) no longer leak into Codex schema.
  - All 6 TOMLs declare Codex-required `name` and `description` fields per the subagent schema.
  - New `CodexReasoningEffort` type in `@swt-labs/core` decouples Codex's model thinking budget from SWT's `Effort` tier (planning depth + turn budget).

  **Phase 02 — Plugin Marketplace Prep** (F-03, F-13, F-14):
  - Plugin manifest moved to `.codex-plugin/plugin.json` (repo root) per documented Codex path; old `packages/cli/codex-plugin.json` removed.
  - Manifest fields realigned to documented schema: `keywords` (was `tags`), `interface` block with `displayName`/`category`/`screenshots`, `author` as object (not bare string). Undocumented top-level `install`/`commands`/`tags`/`categories` removed.
  - Build-time drift detection asserts `.codex-plugin/plugin.json:version === package.json:version` — version sync caught at every `pnpm test`.

  **Phase 03 — Hook Integration & Drift Cleanup** (F-08, F-09, F-10, F-11):
  - New `emitCodexHooksJson(file)` in `@swt-labs/codex-driver` translates SWT's flat snake_case schema to Codex's nested PascalCase `hooks.json` shape (`hooks.{EventName}: [{matcher, hooks: [{type, command, timeout: 600}]}]`).
  - New `CODEX_HOOK_EVENT_NAMES` translation map (snake_case → PascalCase) covers the 6 v1.0 generic events; SWT's 6 v1.5 SDLC events do NOT translate (filtering implicit by construction).
  - New `emitCodexHooksFeatureFlag()` returns `[features]\ncodex_hooks = true\n` for the user's `~/.codex/config.toml`.
  - All 6 agent TOML header comments now reference `~/.codex/config.toml [mcp_servers.<name>]` (the documented Codex MCP path); old wrong-path text `~/.codex/mcp.json` removed.

  **Build pipeline (publish-blocking fixes for first npm release):**
  - `pnpm build` now produces a working ESM bundle: `dist/cli.mjs` + `dist/cli.d.ts` (paths match `package.json` exports). Previously `pnpm build` was never exercised end-to-end, so the published bundle would have failed at `npm install -g`.
  - Drops CJS output entirely — the package is `"type": "module"`, the `bin` and only realistic consumer is the `swt` CLI; bundled CJS deps with top-level `await` cannot be re-emitted as CJS, and adding a working CJS path adds no value.
  - Stubs `react-devtools-core` (ink's optional dev import) at bundle time so `node dist/cli.mjs` no longer fails with `Cannot find package 'react-devtools-core'`.
  - Adds a `createRequire(import.meta.url)` banner so bundled CJS deps (`cross-spawn` et al.) can `require('child_process')` without the `Dynamic require ... is not supported` runtime error.
  - Adds dedicated `tsconfig.build.json` (no `composite`/`incremental`/`rootDir` constraints) so `dts` build doesn't fail with `TS5074` / `TS6059` on cross-package types.
  - Fixes `packages/cli/src/index.ts` direct-invocation check to use `realpath` + `fileURLToPath` on both sides — the previous check failed on macOS `/tmp -> /private/tmp` and on `npm i -g` bin symlinks, so `swt` from PATH never actually called `main()`.

  **Quality gate trail:**
  - 13/13 user-validated UAT scenarios PASS across 3 phases
  - 11 findings closed at the contract verification + R01 reconciliation + UAT triple-gate
  - All hard archive gates (UAT guard + state-consistency + 7-point audit) passed
  - Pre-existing v1.0 DEV-1D class typecheck failures (route.ts, codex-driver/wrapper.ts:39, codex-driver/toml/emit.ts:54) are documented carryforward, unaffected by this milestone — verified via stash + baseline comparison

  **Out of scope (v1.6+):** F-05 (allowed_mcp_servers), F-06 (max_turns), F-07 (role aliasing), F-12 (HookSubBlockSchema expansion), F-15 (AGENTS.override.md), F-17 (cache-hit measurement test).

All notable changes to stop-wasting-tokens are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for next milestone

- Playwright e2e suite (3–5 critical paths × Linux + macOS) for the localhost dashboard
- `axe-cli` automated CI a11y gate (AC-12 / AC-13)
- Published `docs.stopwastingtokens.dev` site (Mintlify infra)
- Full Claude Code backend driver (12-event hook taxonomy, Agent Teams, isolation modes — REQ-V2-02)
- Full Ollama backend driver (REQ-V2-03)
- Codex Plugin Marketplace submission (REQ-19) — once OpenAI accepts third-party manifests
- Real Codex `subagent`-spawn API wiring once OpenAI publishes the surface (today's `codex exec` wrapper is functionally adequate)
- Auto-derived reference docs (CLI / config / artifacts) generated at build time
- Configurable telemetry cache TTL
- Real HTTP telemetry sender pointing at a hosted analytics endpoint
- Custom Vale rules under `docs/styles/SWT/`
- Hook event taxonomy expansion (`pre_archive`, `post_phase`, `post_uat_fail`)

## [1.0.0] — `<DATE-OF-PUBLISH>`

The first stable release. See [`RELEASE-NOTES-v1.0.md`](RELEASE-NOTES-v1.0.md) for the full launch narrative.

### Added

- **Methodology runtime** — TypeScript port of VBW's bash phase-detect, VibeRoute discriminated union with thirteen mode handlers, discussion engine, 7-point pre-archive audit, QA + UAT remediation pipelines with bounded round caps and recurrence tracking.
- **Twelve typed artifact schemas** — PLAN, SUMMARY, VERIFICATION, UAT, RESEARCH, STANDALONE-RESEARCH, REMEDIATION-{PLAN,SUMMARY,RESEARCH}, DEBUG-SESSION, CONTEXT, MILESTONE-CONTEXT, all with Zod schemas + read/write helpers + backwards-compatibility transforms accepting both VBW and SWT shapes.
- **Six-agent SDLC** — Scout, Architect, Lead, Dev, QA, Debugger; goal-backward verification; typed handoff envelopes.
- **CLI command surface** — `swt init`, `swt vibe`, `swt detect-phase`, `swt config`, `swt status`, `swt doctor`, `swt update`.
- **Mintlify documentation site** — eighteen authored pages across Getting Started / Concepts / Reference / Recipes / Migration / v1.5 Roadmap, with Vale prose linting in CI.
- **npm distribution** — seven packages publishable with provenance attestation, changesets-driven release with lockstep versioning, install smoke test workflow on a 6-cell matrix.
- **Codex Plugin Marketplace manifest** — `packages/cli/codex-plugin.json` ready for submission.
- **Opt-in telemetry** — `@swt-labs/telemetry` with privacy-by-default, anonymous UUIDv4, PII-stripping sanitize pass, five initial events.
- **Beta-feedback infrastructure** — friction issue template, GitHub Discussions templates, CODE_OF_CONDUCT.md, beta tester guide, four announcement templates.

### Compatibility

- VBW frontmatter shapes parse cleanly via Zod transforms.
- The eleven lifecycle states match VBW 1:1.
- `swt detect-phase --bash-format` produces VBW-compatible `key=value` output.
- Config keys are a strict superset of VBW's.
- Migration: `mv .vbw-planning .swt-planning`.

### Security

- Comprehensive self-audit logged in [`SECURITY-REVIEW-v1.0.md`](SECURITY-REVIEW-v1.0.md) covering input handling, filesystem access, network, child process, and secrets handling.
- All packages publish with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements).

## [0.1.0-alpha] — `2026-05-XX`

Initial public alpha. Closed beta launched. Engineering deliverables for all 13 prior phases shipped:

- Phase 1 — Repo & org setup
- Phase 2 — Foundation (TypeScript monorepo, CI matrix)
- Phase 3 — Core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore)
- Phase 4 — Codex backend driver wiring
- Phase 5 — Methodology authoring (six-agent SDLC + skill routing)
- Phase 6 — CLI commands
- Phase 7 — Artifacts engine (twelve schemas)
- Phase 8 — Verification & QA pipelines
- Phase 9 — Methodology runtime (phase-detect + VibeRoute)
- Phase 10 — Template fidelity (Zod schemas + transforms)
- Phase 11 — Documentation site (Mintlify scaffold + content + Vale)
- Phase 12 — Distribution (npm publish + provenance + `swt update` + marketplace manifest)
- Phase 13 — Beta & feedback (telemetry + friction template + CoC + beta guide + announcements)

### Compatibility

- Drop-in replacement for VBW projects via directory rename.

[Unreleased]: https://github.com/swt-labs/stop-wasting-tokens/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/swt-labs/stop-wasting-tokens/releases/tag/v1.0.0
[0.1.0-alpha]: https://github.com/swt-labs/stop-wasting-tokens/releases/tag/v0.1.0-alpha
