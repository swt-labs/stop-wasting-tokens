---
phase: 03
plan: 03-05
title: Driver dispatch — backend config key + CLI vibeHandler dispatch
status: complete
completed: 2026-05-07
tasks_completed: 5
tasks_total: 5
commit_hashes:
  - d83ace5
  - 510d7fb
deviations: []
pre_existing_issues: []
ac_results:
  - criterion: "ConfigSchema in @swt-labs/core has a `backend: 'codex' | 'claude-code' | 'ollama'` enum with default 'codex'"
    verdict: "pass"
    evidence: "packages/core/src/config/Config.ts line 26 declares `backend: z.enum(['codex', 'claude-code', 'ollama']).default('codex')`. parseConfig({backend: 'ollama'}) succeeds; parseConfig({backend: 'gpt'}) throws ZodError via the enum constraint."
  - criterion: "the swt CLI's vibe handler reads config.backend and constructs the matching AgentSpawner: 'codex' → CodexAgentSpawner, 'claude-code' → ClaudeCodeAgentSpawner, 'ollama' → OllamaAgentSpawner"
    verdict: "pass"
    evidence: "packages/cli/src/commands/vibe.ts lines 96-110: switch (backend) covers all three cases, instantiating the right concrete AgentSpawner. Plan 03-05 T4's three integration tests (codex via stub binary, claude-code via stub binary, ollama via stub HTTP server) all assert the dispatch banner line `◆ Backend: <name>` is emitted for the right backend."
  - criterion: "the active backend wraps in LazyInstallSpawner so per-role install timing stays consistent across all three backends"
    verdict: "pass"
    evidence: "packages/cli/src/commands/vibe.ts line 113-115: the backend-specific baseSpawner is wrapped in `new LazyInstallSpawner(baseSpawner, ...)` regardless of which case fired. Phase 02's lazy-install behavior carries over identically to the new backends."
  - criterion: "agent-spec-resolver still resolves devSpec from the bundled agents-templates regardless of active backend"
    verdict: "pass"
    evidence: "vibe.ts line 117-121 calls resolveAgentSpec({role: 'dev', config, templates_dir}) unchanged from Phase 02. The cross-backend model gap is documented in agent-spec-resolver.ts JSDoc + reinforced by the new test case `cross-backend override path: model_overrides wins over Codex-specific TOML model regardless of which backend will consume it`."
  - criterion: "a CLI flag --backend=<value> overrides config.backend for one-off invocations"
    verdict: "pass"
    evidence: "vibe.ts resolveBackend() helper accepts the flag value and validates against the three-value enum; falls back to config.backend when flag is absent or invalid. Helper signature: `resolveBackend(flag: string | boolean | undefined, configBackend: Backend): Backend`."
  - criterion: "the existing Phase 02 / Plan 02-03 wiring continues to work for backend='codex' (zero regression on the default path)"
    verdict: "pass"
    evidence: "vibe.test.ts case `execute path runs end-to-end without NotImplementedError when spawner is wired` (Plan 02-03's original case, untouched except for adding `expect(out.text()).toContain('Backend: codex')`) still passes. The codex case in the dispatch switch instantiates the same `new CodexAgentSpawner()` Phase 02 used."
---

Driver dispatch lands. F2's "Same `swt vibe` workflow runs against Claude Code as against Codex" + F3's "wraps a local Ollama instance; `swt vibe --execute` against a local model completes the lifecycle" success criteria are met for the dispatch layer. Phase 03 closes Wave 3.

## What Was Built

- **`packages/core/src/config/Config.ts`** — `backend: z.enum(['codex', 'claude-code', 'ollama']).default('codex')` added to `ConfigSchema`. The default keeps Phase 02's Codex path unchanged on no-backend-config invocations.
- **`packages/cli/package.json`** — adds `@swt-labs/claude-code-driver` + `@swt-labs/ollama-driver` workspace deps. The CLI now imports concrete spawners from all three driver packages.
- **`packages/cli/src/commands/vibe.ts`**:
  - imports `ClaudeCodeAgentSpawner` (claude-code-driver), `OllamaAgentSpawner` (ollama-driver), `AgentSpawner` type (core)
  - new `resolveBackend(flag, configBackend)` helper: prefers `--backend=<value>` flag when valid; falls back to `config.backend`
  - dispatch switch on the resolved backend constructs the right concrete spawner (`CodexAgentSpawner` / `ClaudeCodeAgentSpawner` / `OllamaAgentSpawner`)
  - emits a `◆ Backend: <name>` banner line so users see which backend is active
  - LazyInstallSpawner + cleanup() finally block unchanged from Phase 02 — backend-agnostic by contract
- **`packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts`** — JSDoc above `resolveAgentSpec` documents the cross-backend model resolution gap: bundled agents-templates declare Codex-specific identifiers, so users on non-Codex backends MUST set `config.model_overrides[role]` (Claude alias for `claude-code`; local Ollama model name for `ollama`). Cross-backend automatic resolution is a v2 concern.
- **`packages/cli/test/commands/vibe.test.ts`** — adds 2 cross-backend integration tests:
  - `claude-code dispatch`: stages `config.backend='claude-code'`, stubs `claude` binary on $PATH, asserts banner + SUMMARY.md materializes
  - `ollama dispatch`: stages `config.backend='ollama'`, spins up a stub HTTP server on a random localhost port, points `OLLAMA_HOST` at it, asserts banner + SUMMARY.md materializes
- **`packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts`** — adds 1 reinforcement test on the cross-backend override path (model_overrides wins regardless of backend).

## Files Modified

- `packages/core/src/config/Config.ts` (added backend enum)
- `packages/cli/package.json` (workspace deps for the two new drivers)
- `packages/cli/src/commands/vibe.ts` (dispatch switch + resolveBackend helper)
- `packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts` (cross-backend gap JSDoc)
- `packages/cli/test/commands/vibe.test.ts` (existing 2 cases + 2 new — total 4)
- `packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts` (existing 7 + 1 new — total 8)

## Deviations

None. The plan was specific enough that all 5 tasks landed cleanly without amendments. The cross-backend model gap was already documented as part of the plan's context block — the JSDoc + the new resolver test are the in-code reinforcements.

## Verification

1. ✅ `pnpm --filter @swt-labs/cli --filter @swt-labs/core --filter @swt-labs/methodology typecheck` — vibe.ts + Config.ts + agent-spec-resolver.ts are typecheck-clean (pre-existing v1.0 errors in unrelated CLI files remain — DEV-1D class)
2. ✅ Cross-backend integration tests: 4/4 vibe.test.ts cases pass (codex + claude-code + ollama dispatch + init-redirect)
3. ✅ Resolver tests: 8/8 agent-spec-resolver.test.ts cases pass
4. ✅ Plan 03-01..03-04 test surfaces (claude-code + ollama drivers): 38/38 pass — zero regression
5. ✅ Backend banner emits `◆ Backend: codex` (default) / `◆ Backend: claude-code` / `◆ Backend: ollama` ahead of the route banner

## Next

Phase 03 is fully built. Routing should advance to needs_verification for QA → UAT (same flow as Phase 01 + Phase 02). Phase 04 (F4 + F5 + F8 — User-facing surfaces) and Phase 05 (F6 + F7 — Methodology infrastructure) remain scoped but unplanned.
