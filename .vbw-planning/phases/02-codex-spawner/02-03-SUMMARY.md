---
phase: 02
plan: 02-03
title: Wire CLI execute → CodexAgentSpawner with model resolution
status: complete
completed: 2026-05-07
tasks_completed: 4
tasks_total: 4
commit_hashes:
  - 5fe5438
  - b003e56
  - 7751bb8
  - acb12a7
deviations:
  - "Plan claimed `config.model_overrides` and `config.mcp_overrides` 'already exist (v1.0 ship)' but ConfigSchema only had `agent_max_turns`. Extended ConfigSchema with `model_overrides` and `mcp_overrides` records (both `record(AgentRoleEnum, ...)` with sensible empty defaults) so the resolver's documented precedence is real and testable. Plan-amendment: amended files_modified to include `packages/core/src/config/Config.ts` before editing."
  - "Plan paths used `packages/methodology/src/orchestration/...` but the actual orchestration directory is `packages/methodology/src/vibe/orchestration/`. Same path issue Plan 02-02 hit with the codex-driver test layout. Process-exception: no code change needed beyond amending files_modified to the real paths."
  - "Plan asked for `LazyInstallSpawner` implicitly via the architectural decision but listed no file for it. Plan-amendment: added `packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts` and a matching test file. The wrapper holds a base AgentSpawner + a `resolveSpec(role)` callback, deduplicates concurrent first-spawns via an inflight map, and exposes `cleanup()` for the CLI's finally block."
  - "Plan referenced T4 test path `packages/cli/test/commands/vibe.test.ts` but the directory only contained `update.test.ts`. Created the new file (matches existing CLI command-test convention)."
  - "@iarna/toml dep was added to `packages/methodology/package.json` per the architectural decision. zod was also added — pre-existing v1.0 bug where scope.ts imports zod but the manifest never declared it (same class as Phase 01's codex-driver fix). Process-exception: zod fix is necessary v1.0 hygiene that surfaced because the new resolver tests pulled methodology source through vitest's resolver, exposing the missing dep."
  - "Added `packages/methodology/src/state/load-config.ts` exporting `loadSwtConfig` so the CLI can share methodology's config-loading semantics (the in-place `loadConfig` inside phase-detect.ts is private). Plan-amendment: extended files_modified to include the new state helper."
  - "T4 was originally specified to use `vi.doMock('execa', ...)` to fake Codex output. In trial runs, `vi.doMock` did not intercept the bare `'execa'` specifier when methodology / codex-driver source files were imported through the workspace-linked CLI test (likely a pnpm strict-isolation interaction with vitest's module-resolution). Switched to a node-script `codex` stub on `$PATH` instead — the test still proves the wiring runs end-to-end through real execa, just without depending on vitest's mock to thread across pnpm package boundaries."
pre_existing_issues:
  - test: "packages/methodology/test/vibe/handlers/bootstrap.test.ts (4 cases)"
    file: "RoadmapSchema rejects empty phases array"
    error: "ZodError: phases array must contain at least 1 element"
  - test: "packages/methodology/test/vibe/handlers/qa.test.ts (1 case)"
    file: "qa-remediation NotImplementedError"
    error: "Mode 'qa-remediation' is not yet implemented"
  - test: "packages/methodology/test/vibe/handlers/execute.test.ts (1 case)"
    file: "Pre-existing v1.0 baseline"
    error: "Identical fail count pre/post — not a regression"
  - test: "packages/methodology/test/vibe/handlers/plan.test.ts (1 case)"
    file: "Pre-existing v1.0 baseline (LICENSE present in plan output)"
    error: "Plan body lacks 'LICENSE present' must_have"
  - test: "packages/codex-driver/test/toml.test.ts (1 case)"
    file: "Pre-existing v1.0 baseline"
    error: "TOML emit array branch (DEV-1D carryforward)"
  - test: "packages/methodology/test/vibe/dispatch.test.ts (2 cases)"
    file: "Pre-existing v1.0 baseline"
    error: "Identical fail count pre/post — not a regression"
  - test: "packages/cli/test/help.test.ts"
    file: "Pre-existing v1.0 baseline (CommandRegistry duplicate)"
    error: "Test collection error — buildRegistry duplicate"
ac_results:
  - criterion: "the swt CLI's vibe execute command constructs a CodexAgentSpawner, resolves a per-role AgentSpec from agents-templates + config.json model_overrides, and injects both into executeHandler"
    verdict: "pass"
    evidence: "packages/cli/src/commands/vibe.ts now reads config via loadSwtConfig, resolves devSpec eagerly via resolveAgentSpec({role: 'dev', config, templates_dir: getBundledAgentTemplatesDir()}), constructs CodexAgentSpawner wrapped in LazyInstallSpawner, and passes both into executeHandler({spawner, devSpec}). The vibe.test.ts execute case asserts the wiring end-to-end."
  - criterion: "executeHandler no longer throws NotImplementedError when invoked through the CLI; the live path runs"
    verdict: "pass"
    evidence: "vibe.test.ts execute case asserts `err.text() not toContain 'Not yet implemented'` and `out.text() toContain 'Route: execute'`. The handler runs to completion writing 01-01-SUMMARY.md from the parsed Dev handoff."
  - criterion: "model resolution honors precedence: model_overrides[role] > agents-templates/{role}.toml model field > backend default"
    verdict: "pass"
    evidence: "agent-spec-resolver.test.ts cases `resolves model from agents-templates when no override` (TOML wins), `resolves model from config.model_overrides[role] when set` (override wins), and `falls back to 'default' model when neither override nor TOML model exists` (sentinel) cover all three branches."
  - criterion: "agents-templates/{role}.toml is read from the shipped package (not the user's filesystem) — the templates are static fixtures, not configuration"
    verdict: "pass"
    evidence: "Six TOML files moved from monorepo-root agents-templates/ to packages/methodology/templates/agents/. getBundledAgentTemplatesDir() resolves them via `new URL('../../../templates/agents/', import.meta.url)` — works in monorepo + once published. No runtime dependency on user's repo layout."
  - criterion: "CodexAgentSpawner.installAgent is called for each role before the first spawn; removeAgent is called on session shutdown"
    verdict: "pass"
    evidence: "LazyInstallSpawner is the install/cleanup gate. lazy-install-spawner.test.ts case `installs the role on first spawn and reuses the install on subsequent spawns` asserts installAgent fires exactly once per role on first spawn. CLI vibe.ts calls `spawner.cleanup()` in the dispatch finally, which removes every role installed via the wrapper. lazy-install-spawner.test.ts case `cleanup removes every installed role and never throws even when removeAgent rejects` asserts both removal AND best-effort behavior on backend failure."
---

Closes the door on `NotImplementedError` from the live `swt vibe --execute` path. The CLI now constructs a real `CodexAgentSpawner`, wraps it in a `LazyInstallSpawner` that installs each role on first spawn, resolves the Dev `AgentSpec` from the bundled `agents-templates/dev.toml`, and tears down installed profiles in `finally`.

## What Was Built

- **`packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts`** — `resolveAgentSpec({role, config, templates_dir})` reads `${role}.toml` via `@iarna/toml`, validates the role matches, and merges with `config.model_overrides` / `config.agent_max_turns` / `config.mcp_overrides`. Exports `getBundledAgentTemplatesDir()` for callers that want the monorepo-and-published-friendly location.
- **`packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts`** — `LazyInstallSpawner` wraps any `AgentSpawner`, holds an `installed: Set<AgentRole>`, and on `spawn(request)` calls `base.installAgent(spec)` once per role before delegating. Concurrent first-spawns for the same role share a single inflight install. `cleanup()` is best-effort and idempotent.
- **`packages/methodology/src/state/load-config.ts`** — public `loadSwtConfig(planningDir)` (the existing private `loadConfig` in phase-detect.ts stays in place). Returns `DEFAULT_CONFIG` on missing/malformed config.json; `parseConfig` validation errors propagate.
- **`packages/core/src/config/Config.ts`** — `ConfigSchema` extended with `model_overrides: record(AgentRole, string).default({})` and `mcp_overrides: record(AgentRole, array(string)).default({})`. `agent_max_turns` schema refactored onto a shared `AgentRoleEnum` so all three role-keyed records share the same validation.
- **`packages/cli/src/commands/vibe.ts`** — wires the spawner pipeline (`CodexAgentSpawner` → `LazyInstallSpawner`), eagerly resolves `devSpec`, passes both into `executeHandler({spawner, devSpec})`. Adds a `finally { await spawner.cleanup(); }` around the registry dispatch.
- **`agents-templates/` → `packages/methodology/templates/agents/`** — the six TOML fixtures travel with the methodology package now. `import.meta.url`-relative resolution makes them reachable in dev (monorepo) and once published.

## Files Modified

- `packages/methodology/templates/agents/{architect,debugger,dev,lead,qa,scout}.toml` (moved from monorepo-root `agents-templates/`)
- `packages/methodology/package.json` (added `@iarna/toml` + `zod` deps)
- `packages/core/src/config/Config.ts` (added `model_overrides` + `mcp_overrides` to `ConfigSchema`)
- `packages/methodology/src/state/load-config.ts` (new)
- `packages/methodology/src/state/index.ts` (export load-config)
- `packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts` (new)
- `packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts` (new)
- `packages/methodology/src/vibe/orchestration/index.ts` (export new modules)
- `packages/cli/src/commands/vibe.ts` (wire spawner pipeline)
- `packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts` (new — 7 cases)
- `packages/methodology/test/vibe/orchestration/lazy-install-spawner.test.ts` (new — 5 cases)
- `packages/cli/test/commands/vibe.test.ts` (new — 2 cases)

## Deviations

See frontmatter `deviations:`. Seven, all classified as `plan-amendment` or `process-exception` per the v1.0 deviation policy:

1. **Schema gap (plan-amendment)** — `model_overrides` / `mcp_overrides` weren't in v1.0 `ConfigSchema`; added them so the documented precedence is testable.
2. **Path layout (process-exception)** — orchestration lives under `vibe/`, not `src/orchestration/`. Same flavor as Plan 02-02's nested-vs-flat test layout deviation.
3. **LazyInstallSpawner addition (plan-amendment)** — implementation of the lazy-install architectural decision; needed a real wrapper class.
4. **CLI test directory (plan-amendment)** — `packages/cli/test/commands/` only had `update.test.ts`; created `vibe.test.ts`.
5. **zod dep (process-exception)** — same v1.0 bug class as Phase 01's codex-driver fix; pre-existing missing dep surfaced by the new test path.
6. **loadSwtConfig (plan-amendment)** — added a public state helper; the private `loadConfig` inside phase-detect.ts stayed in place.
7. **execa stub vs vi.doMock (process-exception)** — `vi.doMock` did not intercept across pnpm-isolated workspace packages; switched to `$PATH`-overriding stub binary, which proves the live path runs through real execa end-to-end.

## Verification

1. ✅ `pnpm vitest run packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts` — 7/7 pass
2. ✅ `pnpm vitest run packages/methodology/test/vibe/orchestration/lazy-install-spawner.test.ts` — 5/5 pass
3. ✅ `pnpm vitest run packages/cli/test/commands/vibe.test.ts` — 2/2 pass
4. ✅ Workspace test suite: 421 passed / 15 failed (vs baseline 415 / 21) — net +6 passing, zero new failures. Remaining 15 failures are pre-existing v1.0 baseline carryforward (DEV-1B, DEV-1D, qa-remediation NotImplementedError).
5. ⚠ `pnpm typecheck` — pre-existing v1.0 strict-typecheck failures remain (codex-driver wrapper.ts env type, codex-driver toml/emit.ts:54 array branch, methodology route.ts exactOptionalPropertyTypes, methodology scope.ts unrelated zod-import nominal type, methodology bootstrap.ts unused-imports). My new files have zero typecheck errors.

## Next

Phase 02 closes with all three plans done (02-01 spawner class + 02-02 token usage NDJSON + 02-03 CLI wiring). Routing should now go to Phase 02 verify (QA + UAT) on next `/vbw:vibe`. Phases 03-05 (multi-backend drivers, user surfaces, methodology infra) remain scoped but not planned.
