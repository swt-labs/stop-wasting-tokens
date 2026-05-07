---
phase: 02
plan: 02-01
title: CodexAgentSpawner class implementing AgentSpawner contract
status: complete
completed: 2026-05-07
tasks_completed: 3
tasks_total: 3
commit_hashes: []
deviations:
  - "Pre-existing v1.0 strict-typecheck failures in packages/codex-driver/src/spawn/wrapper.ts (line ~42, exactOptionalPropertyTypes mismatch on execa env option) and packages/codex-driver/src/toml/emit.ts (line 54, TomlValue[] assignability). Plan 02-01 code is typecheck-clean; these failures pre-existed and surfaced after fresh node_modules install (same pattern as Phase 01 DEV-1D for route.ts). Tracked alongside the existing v1.5 follow-ups for codex-driver strict-mode cleanup."
  - "1 pre-existing test failure in packages/codex-driver/test/toml.test.ts (`emits a [features] table when flags are present`) — caused by the toml/emit.ts type error above. Plan 02-01's new test file (codex-agent-spawner.test.ts) is 5/5 passing. Net new test failures introduced by Plan 02-01: 0."
pre_existing_issues:
  - test: "exactOptionalPropertyTypes failures in codex-driver/src/spawn/wrapper.ts"
    file: "packages/codex-driver/src/spawn/wrapper.ts"
    error: "execa Options.env is `Readonly<Partial<Record<string, string>>>` but flags.env is `NodeJS.ProcessEnv | undefined`; conditional spread or omit-when-undefined refactor needed"
  - test: "TomlValue array assignability in codex-driver/src/toml/emit.ts:54"
    file: "packages/codex-driver/src/toml/emit.ts"
    error: "emitScalar(value) called with `string | number | boolean | readonly TomlValue[]` but parameter expects `string | number | boolean`; missing array branch in the call site"
ac_results:
  - criterion: "@swt-labs/codex-driver exports a CodexAgentSpawner class implementing the AgentSpawner contract from @swt-labs/core"
    verdict: "pass"
    evidence: "packages/codex-driver/src/spawner/codex-agent-spawner.ts declares `class CodexAgentSpawner implements AgentSpawner`; barrel re-export from packages/codex-driver/src/index.ts; consumers can `import { CodexAgentSpawner } from '@swt-labs/codex-driver'`"
  - criterion: "installAgent(spec) writes a deterministic TOML profile to ${codex_home}/agents/${role}.toml using emitAgentToml; idempotent on re-install"
    verdict: "pass"
    evidence: "vitest case `writes the TOML profile to {codex_home}/agents/{role}.toml` passes against tmp codex_home; case `is idempotent on re-install (final TOML reflects the latest spec)` confirms tmp+rename atomicity preserves overwrite semantics"
  - criterion: "spawn(request) delegates to the existing spawnCodex low-level function with no semantic changes"
    verdict: "pass"
    evidence: "vitest case `delegates to spawnCodex via the configured bin` uses `vi.doMock('execa')` to assert execa is called with `'codex' | bin override` plus `['exec', '--json', '--cd', ...]` args, exactly the spawnCodex contract"
  - criterion: "removeAgent(role) unlinks the TOML profile file; idempotent (no-op if missing)"
    verdict: "pass"
    evidence: "vitest cases `unlinks the TOML profile` (after install) + `is a no-op when the profile is missing` (catches ENOENT)"
  - criterion: "the class is constructable without arguments and uses sensible defaults for codex_home + bin path"
    verdict: "pass"
    evidence: "constructor signature `(opts: CodexAgentSpawnerOptions = {})` defaults: codex_home = process.env.CODEX_HOME ?? join(homedir(), '.codex'); bin = 'codex'; env stays undefined unless caller supplies one. Tests construct with explicit codex_home (tmp dir) but parameter-free instantiation is supported by signature."
---

Wrapped the existing emitAgentToml + spawnCodex helpers behind the AgentSpawner interface so methodology can construct + inject a real spawner without reaching into codex-driver subpaths.

## What Was Built

- `CodexAgentSpawner` class in `packages/codex-driver/src/spawner/codex-agent-spawner.ts` implementing the `AgentSpawner` contract from `@swt-labs/core`
- `installAgent(spec)` writes `${codex_home}/agents/${role}.toml` via `emitAgentToml`, using `mkdir -p` + atomic tmp+rename so parallel installs don't tear
- `spawn(request)` delegates to the existing `spawnCodex` low-level function with the configured `bin` and (optional) `env`
- `removeAgent(role)` unlinks the TOML; ENOENT is a no-op (idempotent)
- Constructor defaults: `codex_home = process.env.CODEX_HOME ?? ~/.codex`, `bin = 'codex'`. Tests inject a tmp `codex_home` to keep the user's real Codex install untouched
- New barrel at `packages/codex-driver/src/spawner/index.ts`; re-exported through `packages/codex-driver/src/index.ts`
- 5 vitest cases in `packages/codex-driver/test/spawner/codex-agent-spawner.test.ts` — all pass

## Files Modified

- `packages/codex-driver/src/spawner/codex-agent-spawner.ts` — new class
- `packages/codex-driver/src/spawner/index.ts` — new barrel
- `packages/codex-driver/src/index.ts` — append `export * from './spawner/index.js'`
- `packages/codex-driver/test/spawner/codex-agent-spawner.test.ts` — new test file (5 cases)

## Deviations

See frontmatter `deviations:`. Both items are pre-existing v1.0 strict-typecheck failures (same pattern as Phase 01 DEV-1D):

1. `spawn/wrapper.ts` env type mismatch with execa `Options`
2. `toml/emit.ts:54` `emitScalar` call site missing the array branch

Plan 02-01 introduced 0 new typecheck or test failures. The pre-existing failures are tracked as v1.5 codex-driver strict-mode cleanup follow-ups.

## Verification

1. ✅ `pnpm --filter @swt-labs/codex-driver test packages/codex-driver/test/spawner/` exits 0 — 5/5 new tests pass
2. ✅ Manual import smoke: `import { CodexAgentSpawner } from '@swt-labs/codex-driver'` resolves through the package barrel
3. ⚠ `pnpm --filter @swt-labs/codex-driver typecheck` fails on 2 pre-existing v1.0 errors in spawn/wrapper.ts and toml/emit.ts; Plan 02-01 files produce no new typecheck errors
4. ✅ The class satisfies AgentSpawner structurally (no `as` casts in implementation)

## Next

Plan 02-02 (Token usage extraction from Codex NDJSON) — currently blocked on Codex CLI availability (Plan T1 captures real NDJSON schema). Plan 02-03 (CLI wiring + model resolution) can start in parallel since it's independent of T1.

Recommend resuming Plan 02-02 + 02-03 in a follow-up session with `codex` CLI installed locally so the NDJSON fixture is real rather than guessed.
