---
milestone_slug: 03-sdk-critical-conformance-plugin-marketplace-prep-hook
project: stop-wasting-tokens
shipped: 2026-05-07
phase_count: 3
task_count: 13
git_tag: milestone/03-sdk-critical-conformance-plugin-marketplace-prep-hook
---

# Shipped: stop-wasting-tokens v1.5.1 — Codex SDK conformance

This milestone ships v1.5.1 — the Codex SDK conformance pass that closes 11 of 17 findings from the verification research at `developers.openai.com/codex`. SWT v1.5's product code is now structurally compatible with the documented Codex CLI schemas: agent profile TOMLs use real Codex models + reasoning_effort enum + required `name`/`description` fields; the Plugin Marketplace manifest lives at the documented `.codex-plugin/plugin.json` path with documented schema; the codex-driver's hooks-writer translates SWT's flat snake_case schema to Codex's nested PascalCase `hooks.json`.

## Phase summary

| # | Phase | Findings | UAT |
|---|-------|----------|-----|
| 01 | SDK Critical Conformance | F-01 (model identifier), F-02 (reasoning_effort enum), F-04 (name + description fields) | 5/5 PASS |
| 02 | Plugin Marketplace Prep | F-03 (manifest path), F-13 (schema restructure), F-14 (version sync) | 4/4 PASS |
| 03 | Hook Integration & Drift Cleanup | F-08 (TOML MCP path), F-09 (event filtering), F-10 (snake→Pascal translation), F-11 (codex_hooks feature flag) | 4/4 PASS |

**Total:** 3 phases / 3 plans / 13 tasks / 13 user-validated UAT scenarios.

## Quality gate trail

- Phase 01 contract QA: 12/13 PASS → R01 plan-amendment classification → UAT 5/5 PASS.
- Phase 02 contract QA: 8/9 PASS → R01 plan-amendment classification → UAT 4/4 PASS.
- Phase 03 contract QA: 10/10 PASS (zero deviations — clean direct PASS, no R01 needed) → UAT 4/4 PASS.
- All R01 `verified_at_commit` fields refreshed to `d40339a` (final product head); Phase 01 + Phase 02 chains preserved post Phase 03 changes.
- Both non-bypassable archive gates passed: `archive-uat-guard.sh` (no unresolved UAT) + `verify-state-consistency.sh --mode archive` (5/5 structural checks).

## Net deliverables

- **Agent profile TOMLs:** All 6 use documented Codex models (`gpt-5.5` for scout/architect; `gpt-5.3-codex` for lead/dev/qa/debugger), Codex reasoning_effort enum (low/medium/high per role), and Codex-required `name` + `description` fields. Header comments cite `~/.codex/config.toml [mcp_servers.X]` (the documented path).
- **Type decoupling:** `@swt-labs/core` exports `CodexReasoningEffort` (Codex enum) distinct from SWT's `Effort` tier (planning depth). The two concepts properly separated.
- **Plugin manifest:** `.codex-plugin/plugin.json` at the documented Codex path with documented schema (`name`/`version`/`description` required, `author` object, `keywords` array, `interface` block with `displayName`/`category`/`screenshots`). Version-sync drift detection asserts `.codex-plugin/plugin.json:version === package.json:version`.
- **Hooks emit:** `emitCodexHooksJson(file)` translates SWT's flat schema to Codex's nested PascalCase shape via `buildCodexHookFile`. `emitCodexHooksFeatureFlag()` returns the `[features] codex_hooks = true` block for the user's `~/.codex/config.toml`.
- **Drift detection:** new vitest suites at `test/codex-plugin-manifest.test.ts` (manifest schema + version sync — 9 cases) and `packages/codex-driver/test/hooks.test.ts` (Codex schema translation + feature flag + agent-toml header sweep — 14 cases total, 11 new).

## Tier 4 v1.6+ follow-ups (intentionally deferred)

- **F-05** (HIGH): `allowed_mcp_servers` field — drop or SWT-namespace; deferred pending decision on per-role MCP scoping abstraction.
- **F-06** (HIGH): `max_turns` field — move to ConfigSchema only or SWT-namespace in TOML.
- **F-07** (MEDIUM): `role` field — SWT-internal alias for Codex `name`; rename or drop after Phase 1 lands `name` (now done).
- **F-12** (MEDIUM): expand `HookSubBlockSchema` to mirror Codex's full nested schema (matchers, multiple hooks per event, statusMessage, timeout) — currently SWT's flat `{script_path}` schema is translated to Codex's nested shape at emit time.
- **F-15** (LOW): consider migrating SWT-managed AGENTS.md content from `<!-- SWT BEGIN/END -->` fences → `~/.codex/AGENTS.override.md` per Codex idiom.
- **F-17** (LOW): add an end-to-end `cached_tokens` measurement test for REQ-05 cache discipline.

## Known pre-existing issues (DEV-1D class — v1.0 carryforward, unaffected by v1.5.1)

- TypeScript strict-mode failures: `packages/methodology/src/vibe/route.ts` (6 cases, exactOptionalPropertyTypes), `packages/codex-driver/src/spawn/wrapper.ts:39` (execa env type), `packages/codex-driver/src/toml/emit.ts:54` (TomlValue array branch).
- `emitFeaturesToml` test failure (related to emit.ts:54).
- Bootstrap.test.ts ZodError carryforward (RoadmapSchema empty phases array).

These pre-date v1.5.1 and were verified unchanged via stash + baseline comparison at every phase.

## Install-time wiring follow-ups

- Wire `emitCodexHooksFeatureFlag()` into the codex-driver's install path (merge `[features] codex_hooks = true` into the user's `~/.codex/config.toml` at install time).
- Wire `emitCodexHooksJson` into the codex-driver's install path (write `~/.codex/hooks.json` with the Codex-translated schema).

These were intentionally scoped out of v1.5.1 per the milestone's "the function is exported and ready for the install-time call" decision.
