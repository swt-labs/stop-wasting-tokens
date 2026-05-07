---
"stop-wasting-tokens": patch
---

v1.5.1 — Codex SDK conformance pass.

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
