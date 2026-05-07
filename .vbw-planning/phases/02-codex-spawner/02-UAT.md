---
phase: 02
plan_count: 3
status: complete
started: 2026-05-07
completed: 2026-05-07
total_tests: 7
passed: 7
skipped: 0
issues: 0
---

User-validated all Phase 02 must_haves across the 3 plans + R01 reconciliation: CodexAgentSpawner contract (Plan 02-01), token usage NDJSON parsing (Plan 02-02), CLI wiring + LazyInstallSpawner + agent-spec-resolver + bundled templates (Plan 02-03). 7/7 UAT scenarios PASS via inspection. No issues found, no skips.

## Tests

### P02-T1: CodexAgentSpawner class implements AgentSpawner contract

- **Plan:** 02-01 — CodexAgentSpawner class
- **Scenario:** Open `packages/codex-driver/src/spawner/codex-agent-spawner.ts`. Confirm line 38 declares `export class CodexAgentSpawner implements AgentSpawner`, AgentSpawner imported from `@swt-labs/core` (line 6-12), `installAgent` writes via emitAgentToml (lines 50-57 — atomic tmp+rename), `spawn` delegates to spawnCodex (lines 59-64), `removeAgent` unlinks with ENOENT-tolerant catch (lines 66-79).
- **Expected:** All five contract methods + class shape verified.
- **Result:** pass
- **Notes:** User confirmed the AgentSpawner contract is implemented end-to-end with proper atomic install, delegation, and idempotent removal semantics.

### P02-T2: CodexAgentSpawner test suite

- **Plan:** 02-01 — CodexAgentSpawner class
- **Scenario:** `pnpm vitest run packages/codex-driver/test/spawner/codex-agent-spawner.test.ts` covers installAgent / spawn / removeAgent against tmp `$CODEX_HOME` + mocked execa. Five cases asserted in Plan 02-01 SUMMARY.
- **Expected:** 5/5 codex-agent-spawner tests green.
- **Result:** pass
- **Notes:** User confirmed the test file is 5/5 passing per Plan 02-01 SUMMARY's verification block. Net new test failures introduced by Plan 02-01: 0.

### P02-T3: Token usage NDJSON parser + last-write-wins aggregation

- **Plan:** 02-02 — Token usage extraction from Codex NDJSON
- **Scenario:** Open `packages/codex-driver/src/spawn/parser.ts`. Confirm `UsageChunkSchema` (Zod) for `{type:'usage', usage:{input_tokens, output_tokens}}`, `ParsedLine.usage?` field, and parseLine usage-recognition branch between handoff and text. Open `packages/codex-driver/src/spawn/wrapper.ts` lines 49-58 for last-write-wins aggregation in spawn loop.
- **Expected:** Schema + ParsedLine.usage + wrapper aggregation all present.
- **Result:** pass
- **Notes:** User confirmed the additive token-usage path is correctly wired. Existing text + handoff parsing stays unchanged. The NDJSON fixture schema is hand-crafted (DEV-2A process-exception); verification against real `codex exec --json` output is a v1.5 follow-up.

### P02-T4: agent-spec-resolver model precedence

- **Plan:** 02-03 — CLI wiring + agent-spec-resolver
- **Scenario:** Open `packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts`. Confirm precedence chain `config.model_overrides[role] ?? toml.model ?? 'default'`, `config.agent_max_turns[role] ?? toml.max_turns`, `config.mcp_overrides[role] ?? toml.allowed_mcp_servers`. Check `packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts` reports 7/7 cases.
- **Expected:** Three-tier precedence verified across model + max_turns + mcp_servers; 7/7 test cases cover all branches.
- **Result:** pass
- **Notes:** User confirmed precedence chain matches plan's documented order. Plan 02-03 amended ConfigSchema (DEV-3A plan-amendment) to add `model_overrides` and `mcp_overrides` records — the precedence is now real and testable.

### P02-T5: Bundled agent templates location

- **Plan:** 02-03 — CLI wiring + agent-spec-resolver
- **Scenario:** `ls packages/methodology/templates/agents/` returns the six TOML profiles (architect/debugger/dev/lead/qa/scout). Then open `packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts` and confirm `getBundledAgentTemplatesDir()` resolves via `new URL('../../../templates/agents/', import.meta.url)`.
- **Expected:** Six TOMLs in the methodology package; import.meta.url resolution makes them reachable in monorepo + once published. No remaining files at monorepo-root `agents-templates/`.
- **Result:** pass
- **Notes:** User confirmed the move. The architectural decision was resolved with the user via AskUserQuestion at execute time: TOMLs ship with `@swt-labs/methodology`, not the consumer's repo.

### P02-T6: CLI vibeHandler wires CodexAgentSpawner end-to-end

- **Plan:** 02-03 — CLI wiring + agent-spec-resolver
- **Scenario:** Open `packages/cli/src/commands/vibe.ts`. Confirm imports for `CodexAgentSpawner` (codex-driver) + `LazyInstallSpawner` + `resolveAgentSpec` + `loadSwtConfig` (methodology). Confirm construction (`new CodexAgentSpawner()` wrapped in `new LazyInstallSpawner(...)`) before dispatch, eager `devSpec` resolution, and `spawner.cleanup()` in dispatch `finally`. Check `packages/cli/test/commands/vibe.test.ts` reports 2/2 cases.
- **Expected:** end-to-end wiring through to executeHandler without NotImplementedError; integration test exercises real execa via $PATH-mounted stub Codex binary.
- **Result:** pass
- **Notes:** User confirmed the live `swt vibe --execute` path. The `vi.doMock('execa')` approach didn't propagate across pnpm-isolated workspace packages (DEV-3G process-exception); the stub-on-PATH replacement proves the wiring through real execa end-to-end.

### P02-T7: LazyInstallSpawner lazy install + best-effort cleanup

- **Plan:** 02-03 — CLI wiring + agent-spec-resolver (DEV-3C plan-amendment)
- **Scenario:** Open `packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts`. Confirm `installed: Set<AgentRole>` + `inflight: Map<AgentRole, Promise>`, lazy `installAgent` via `ensureInstalled` on first spawn, concurrent dedup via inflight map, `cleanup()` via `Promise.allSettled` (never throws). Check `packages/methodology/test/vibe/orchestration/lazy-install-spawner.test.ts` reports 5/5 cases.
- **Expected:** Lazy install + concurrent dedup + idempotent cleanup all verified.
- **Result:** pass
- **Notes:** User confirmed the wrapper. The lazy-install architectural decision was resolved via AskUserQuestion at execute time. The wrapper is the implementation of that decision.

## Summary

- Passed: 7
- Skipped: 0
- Issues: 0
- Total: 7

All Phase 02 must_haves validated via UAT inspection. Phase 02 closes with full QA + UAT alignment: contract verification PARTIAL (27 PASS / 11 FAIL — 11 deviations classified) → Round 01 deviation reconciliation PASS (5 plan-amendments + 6 process-exceptions documented) → user-validated UAT 7/7 PASS. Net Phase 02 deliverable: live `swt vibe --execute` runs the executeHandler through CodexAgentSpawner + LazyInstallSpawner with bundled agent templates, model resolution precedence, and best-effort cleanup.
