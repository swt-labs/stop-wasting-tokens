---
phase: 03
plan: 03-01
title: Tier 3 Codex hook integration — name translation + feature flag + TOML comment fix
status: complete
completed: 2026-05-07
tasks_completed: 5
tasks_total: 5
commit_hashes:
  - b942a98
  - 4fa1043
  - 915d39e
  - d40339a
deviations: []
pre_existing_issues:
  - "Pre-existing v1.0 typecheck failures (DEV-1D class) carryforward unaffected by Plan 03-01: codex-driver/spawn/wrapper.ts:39 (execa env type), codex-driver/toml/emit.ts:54 (TomlValue array branch). Plan 03-01 didn't touch either file."
  - "Pre-existing emitFeaturesToml test failure: `features = {...}` emitted as inline table instead of `[features]` table header — same root cause as the codex-driver/src/toml/emit.ts:54 typecheck issue. Carryforward, unrelated to Plan 03-01."
ac_results:
  - criterion: "the codex-driver's hooks-writer emits Codex's documented `hooks.json` schema (PascalCase event names, nested `hooks.{EventName}: [{matcher, hooks: [{type, command, timeout}]}]` shape)"
    verdict: "pass"
    evidence: "packages/codex-driver/src/hooks/codex-schema.ts:60-78 declares `buildCodexHookFile(file: HookFile): CodexHookFile` that translates SWT's flat schema to Codex's nested shape. packages/codex-driver/src/hooks/writer.ts adds `emitCodexHooksJson` that wraps `buildCodexHookFile` + JSON.stringify. New test case 'translates snake_case event keys to PascalCase' verifies the output JSON has `hooks.SessionStart`, `hooks.PreToolUse`, etc. Test case 'nests entries' verifies the inner shape (matcher + hooks array + type:command + timeout: 600). 14/14 hooks tests pass."
  - criterion: "snake_case → PascalCase translation map covers all 6 v1.0 events; SWT's 6 v1.5 SDLC events do NOT translate"
    verdict: "pass"
    evidence: "codex-schema.ts:18-25 declares CODEX_HOOK_EVENT_NAMES with all 6 mappings (session_start→SessionStart etc.). The translation iterates only the keys of CODEX_HOOK_EVENT_NAMES, so SWT's 6 v1.5 SDLC events (pre_archive, post_phase, etc.) cannot leak into Codex emit by construction. Test case asserts emit output has hooks.SessionStart etc. AND does NOT have hooks.PreArchive / hooks.PostPhase."
  - criterion: "the codex-driver exports a function that emits `[features] codex_hooks = true` for the user's `~/.codex/config.toml`"
    verdict: "pass"
    evidence: "packages/codex-driver/src/hooks/writer.ts:48-52 declares `emitCodexHooksFeatureFlag(): string` returning `'[features]\\ncodex_hooks = true\\n'`. Re-exported from packages/codex-driver/src/index.ts:12. Test case `returns the documented [features] codex_hooks = true block` asserts the exact string."
  - criterion: "the 6 agent template TOML header comments reference `~/.codex/config.toml [mcp_servers.X]` instead of the wrong `~/.codex/mcp.json`"
    verdict: "pass"
    evidence: "All 6 TOMLs (scout/architect/lead/dev/qa/debugger) were updated via Edit. `grep -l '~/.codex/mcp.json' packages/methodology/templates/agents/*.toml` returns nothing (no remaining wrong-path references). `grep -c 'config.toml' ...` returns 6 (1 per file). New test loop `agent TOML headers (F-08)` iterates AGENT_ROLES and asserts each file contains `~/.codex/config.toml` AND `[mcp_servers.<name>]` AND does NOT contain `~/.codex/mcp.json`. 6/6 pass."
  - criterion: "the existing 3 hooks.test.ts tests still pass after the schema translation is added (backward compat — SWT's flat HookFile interface is unchanged)"
    verdict: "pass"
    evidence: "The 3 original cases ('parses an empty file with all six event arrays', 'serialises a populated hook file', 'rejects malformed entries via the schema') all still pass. Confirmed by running `pnpm vitest run packages/codex-driver/test/hooks.test.ts` — 14/14 pass total (3 original + 5 new Codex schema/feature flag + 6 new agent-toml header sweep)."
  - criterion: "new tests cover the Codex schema emit: PascalCase keys, nested matcher+hooks shape, type:command default, [features] codex_hooks = true emission"
    verdict: "pass"
    evidence: "5 new vitest cases in `describe('emitCodexHooksJson ...')` + `describe('emitCodexHooksFeatureFlag')`: (1) translates snake_case→PascalCase, (2) nests entries with matcher + hooks array + type:command + default timeout, (3) maps SWT match → Codex matcher, (4) drops SWT-only fields cwd/tags, (5) feature flag returns the exact documented block. All 5 pass."
---

Tier 3 Codex hook integration ships. F-08, F-09, F-10, F-11 from the v1.5.1 milestone scope are closed. The codex-driver's emit path now produces Codex-schema-conformant `hooks.json` and exports the `[features] codex_hooks = true` flag the user's `~/.codex/config.toml` needs to enable hooks.

## What Was Built

- **`packages/codex-driver/src/hooks/codex-schema.ts`** (new — 79 lines) — `CODEX_HOOK_EVENT_NAMES` translation map (snake_case → PascalCase), `CodexHookCommand`/`CodexHookEntry`/`CodexHookFile` interfaces matching Codex's documented `hooks.json` schema, and `buildCodexHookFile(file: HookFile): CodexHookFile` which translates SWT's flat schema to Codex's nested shape (matcher rename + nested hooks array + type:command + default timeout 600). SWT's 6 v1.5 SDLC events do NOT translate by construction (the iteration only covers the 6 v1.0 keys in CODEX_HOOK_EVENT_NAMES).
- **`packages/codex-driver/src/hooks/writer.ts`** — adds `emitCodexHooksJson(file)` (Codex-schema output) and `emitCodexHooksFeatureFlag()` (returns `[features]\ncodex_hooks = true\n`). The existing `emitHooksJson` is unchanged for backward compat.
- **`packages/codex-driver/src/index.ts`** — re-exports `./hooks/codex-schema.js`.
- **6 agent template TOMLs** (`scout`, `architect`, `lead`, `dev`, `qa`, `debugger`) — header comment now references `~/.codex/config.toml [mcp_servers.<name>]` (the documented Codex MCP config path) instead of the wrong `~/.codex/mcp.json`. F-08 closed.
- **`packages/codex-driver/test/hooks.test.ts`** — 11 new vitest cases on top of the existing 3 (5 for Codex schema translation + 1 for feature flag + 6 for agent-toml header sweep iterating AGENT_ROLES). 14/14 pass.

## Files Modified

- `packages/codex-driver/src/hooks/codex-schema.ts` (new)
- `packages/codex-driver/src/hooks/writer.ts` (added 2 functions, kept existing 1)
- `packages/codex-driver/src/index.ts` (1-line barrel re-export)
- `packages/methodology/templates/agents/scout.toml` (header comment)
- `packages/methodology/templates/agents/architect.toml` (header comment)
- `packages/methodology/templates/agents/lead.toml` (header comment)
- `packages/methodology/templates/agents/dev.toml` (header comment)
- `packages/methodology/templates/agents/qa.toml` (header comment)
- `packages/methodology/templates/agents/debugger.toml` (header comment)
- `packages/codex-driver/test/hooks.test.ts` (11 new test cases)

## Deviations

None. Plan 03-01's task list, file paths, and acceptance criteria were correct on first writing — no plan-amendments needed during execution. The PreToolUse Edit hook required reading the test file via the Read tool before editing it (tool friction, not a plan defect).

## Verification

1. ✅ `pnpm vitest run packages/codex-driver/test/hooks.test.ts` — 14/14 pass
2. ✅ `pnpm vitest run packages/codex-driver` — 47/48 pass (1 fail is pre-existing emitFeaturesToml carryforward, unrelated to Plan 03-01)
3. ✅ All 6 TOMLs grep-confirmed: contain `~/.codex/config.toml`, contain `[mcp_servers.<name>]`, do NOT contain `~/.codex/mcp.json`
4. ✅ Pre-existing v1.0 typecheck failures (DEV-1D class) remain at the same baseline — Plan 03-01 didn't touch any of those files

## Next

Phase 03 has 1 plan and it is now complete. Routing should advance to QA + UAT + milestone archive. With Phases 01-03 closed, the v1.5.1 milestone is at the archive-ready threshold.
