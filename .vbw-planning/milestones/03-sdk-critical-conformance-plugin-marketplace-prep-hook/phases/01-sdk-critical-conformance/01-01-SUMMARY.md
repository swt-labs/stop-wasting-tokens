---
phase: 01
plan: 01-01
title: Tier 1 Codex SDK conformance — model + reasoning_effort + required subagent fields
status: complete
completed: 2026-05-07
tasks_completed: 5
tasks_total: 5
commit_hashes:
  - 2935710
  - 4ca4690
  - 8c986bf
  - 70ebd91
deviations:
  - "Plan 01-01 originally listed `packages/codex-driver/test/toml/agents.test.ts` as the test file, but that path doesn't exist — the codex-driver TOML tests live at `packages/codex-driver/test/toml.test.ts` (flat, no `toml/` subdir). Plan-amendment: updated `files_modified` mid-execution (T4) to use the correct path before the Edit hook would have blocked the change."
pre_existing_issues:
  - "9 pre-existing v1.0 test failures (DEV-1D class) carryforward unaffected by Plan 01-01: 4 in packages/methodology/test/vibe/handlers/bootstrap.test.ts (ZodError on RoadmapSchema empty phases array), 2 in packages/methodology/test/vibe/dispatch.test.ts (qa-remediation NotImplementedError ordering), 1 each in packages/methodology/test/vibe/handlers/{execute,plan,qa}.test.ts. Verified by stash + baseline comparison: identical 9-failure count pre/post Plan 01-01."
  - "Pre-existing typecheck failures unaffected: packages/methodology/src/vibe/route.ts (6 cases, exactOptionalPropertyTypes), packages/codex-driver/src/toml/emit.ts:54 (TomlValue array branch). Tracked as v1.6+ DEV-1D follow-up."
  - "Pre-existing emitFeaturesToml test failure: `features = {...}` emitted as inline table instead of `[features]` table header. Same root cause as the codex-driver/src/toml/emit.ts:54 typecheck issue. Carryforward."
ac_results:
  - criterion: "all 6 agent template TOMLs declare `model` ∈ Codex documented catalog"
    verdict: "pass"
    evidence: "scout=gpt-5.5, architect=gpt-5.5, lead=gpt-5.3-codex, dev=gpt-5.3-codex, qa=gpt-5.3-codex, debugger=gpt-5.3-codex. All 6 values are in the documented catalog per developers.openai.com/codex/models. The new bundled-templates conformance test (agent-spec-resolver.test.ts) iterates ROLES and asserts spec.model ∈ CODEX_MODELS for each."
  - criterion: "all 6 agent template TOMLs declare `model_reasoning_effort` ∈ Codex documented enum"
    verdict: "pass"
    evidence: "scout=low, architect=high, lead=medium, dev=medium, qa=medium, debugger=high. All values ∈ {minimal, low, medium, high, xhigh}. The bundled-templates test asserts spec.reasoning_effort ∈ CODEX_REASONING_EFFORTS for each role. New negative test asserts ConfigError fires when a SWT Effort value (`balanced`) is supplied."
  - criterion: "all 6 agent template TOMLs declare a Codex-required `name` and `description` field"
    verdict: "pass"
    evidence: "Each TOML's `name` field matches the role name (e.g. `name = \"scout\"`); each `description` is a one-sentence human-facing guidance per the Codex subagent schema. RawTemplate interface in agent-spec-resolver.ts now declares `name?: unknown` and `description?: unknown` so the resolver gracefully tolerates the new fields."
  - criterion: "@swt-labs/core exports a CodexReasoningEffort type/enum distinct from the existing Effort tier"
    verdict: "pass"
    evidence: "packages/core/src/types/codex-reasoning-effort.ts exports the type, CODEX_REASONING_EFFORTS const, and isCodexReasoningEffort guard. Re-exported from packages/core/src/types/index.ts. AgentSpec.reasoning_effort field is typed as CodexReasoningEffort (not Effort). pnpm --filter @swt-labs/core typecheck exits 0."
  - criterion: "agent-spec-resolver validates parsed `model_reasoning_effort` against the Codex enum"
    verdict: "pass"
    evidence: "resolveReasoningEffort in agent-spec-resolver.ts now imports CODEX_REASONING_EFFORTS and validates against it. Default value changed from 'balanced' (SWT Effort) to 'medium' (Codex enum). Error message lists the Codex enum values verbatim. Negative test asserts ConfigError on SWT Effort value with the new message."
  - criterion: "codex-driver's emitAgentToml round-trips the validated Codex reasoning_effort value verbatim"
    verdict: "pass"
    evidence: "emitAgentToml in packages/codex-driver/src/toml/agents.ts:24 emits `model_reasoning_effort: spec.reasoning_effort` directly. Updated test in packages/codex-driver/test/toml.test.ts:33-48 asserts `model_reasoning_effort = \"medium\"` round-trips when reasoning_effort: 'medium' is supplied. 7/8 codex-driver toml tests pass; the 1 failure is pre-existing emitFeaturesToml carryforward unrelated to Plan 01-01."
  - criterion: "an agent-spec-resolver test asserts each of the 6 templates parses cleanly with valid Codex enum values"
    verdict: "pass"
    evidence: "New describe block 'bundled agent templates Codex schema conformance' in agent-spec-resolver.test.ts iterates the 6 ROLES and asserts spec.model ∈ CODEX_MODELS, spec.reasoning_effort ∈ CODEX_REASONING_EFFORTS, and developer_instructions is non-empty for each role. 15/15 agent-spec-resolver tests pass."
---

Tier 1 Codex SDK conformance ships. F-01, F-02, F-04 from the v1.5.1 milestone scope are closed. Pre-existing v1.0 carryforward (DEV-1D class) remains documented under `pre_existing_issues` and is unaffected by this plan.

## What Was Built

- **`packages/core/src/types/codex-reasoning-effort.ts`** (new) — `CodexReasoningEffort` type (`minimal | low | medium | high | xhigh`), runtime const `CODEX_REASONING_EFFORTS`, and `isCodexReasoningEffort` guard. Doc comment cites `developers.openai.com/codex/config-reference` and explicitly contrasts with the existing SWT `Effort` tier.
- **`packages/core/src/abstractions/AgentSpawner.ts`** — `AgentSpec.reasoning_effort` field type changed from `Effort` to `CodexReasoningEffort`.
- **`packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts`** — `resolveReasoningEffort` validates against `CODEX_REASONING_EFFORTS` (was `EFFORTS`); default value changed from `'balanced'` (SWT) to `'medium'` (Codex). RawTemplate gained `name?: unknown` and `description?: unknown` fields so the resolver tolerates the new TOML fields.
- **6 agent template TOMLs** (`packages/methodology/templates/agents/{scout,architect,lead,dev,qa,debugger}.toml`) — all rewritten with:
  - New required Codex fields: `name` (role identifier) and `description` (human-facing guidance, one sentence).
  - Codex-valid `model`: `gpt-5.5` (scout, architect — frontier model for general roles), `gpt-5.3-codex` (lead, dev, qa, debugger — coding-tuned).
  - Codex-valid `model_reasoning_effort`: per the per-role gradient (scout=low, architect=high, lead/dev/qa=medium, debugger=high).
  - Updated header comment block to reference both `model` and `model_reasoning_effort` Codex enum constraints (the `~/.codex/mcp.json` correction is deferred to Phase 03 / F-08).
  - All other fields preserved verbatim: `role` (SWT-internal), `sandbox_mode`, `allowed_mcp_servers`, `max_turns`, `developer_instructions`.
- **`packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts`** — updated test fixtures (Codex enum values), new negative test for SWT Effort leak, new `describe` block iterating all 6 bundled templates and asserting Codex enum compliance.
- **`packages/codex-driver/test/toml.test.ts`** — agent-toml round-trip test updated to use Codex-valid `model = "gpt-5.3-codex"` + `reasoning_effort: 'medium'`. The test now serves as a guardrail against future regressions to invalid enum values.

## Files Modified

- `packages/core/src/types/codex-reasoning-effort.ts` (new)
- `packages/core/src/types/index.ts` (1-line barrel re-export)
- `packages/core/src/abstractions/AgentSpawner.ts` (type change in AgentSpec.reasoning_effort)
- `packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts` (validation + default + RawTemplate extension)
- `packages/methodology/templates/agents/scout.toml` (rewritten)
- `packages/methodology/templates/agents/architect.toml` (rewritten)
- `packages/methodology/templates/agents/lead.toml` (rewritten)
- `packages/methodology/templates/agents/dev.toml` (rewritten)
- `packages/methodology/templates/agents/qa.toml` (rewritten)
- `packages/methodology/templates/agents/debugger.toml` (rewritten)
- `packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts` (fixture refresh + new conformance suite)
- `packages/codex-driver/test/toml.test.ts` (agent-toml test updated to Codex-valid values; deviation #1 plan-amendment)

## Deviations

See frontmatter `deviations:`. One:

1. **codex-driver test path correction (plan-amendment)** — Plan 01-01 originally listed `packages/codex-driver/test/toml/agents.test.ts` (with a `toml/` subdir) but the actual path is `packages/codex-driver/test/toml.test.ts` (flat). The PreToolUse Edit hook initially blocked the edit; amended `files_modified` mid-execution to the correct path. Same audit-trail pattern as the v1.5 milestone's other path-amendment deviations.

## Verification

1. ✅ `pnpm --filter @swt-labs/core typecheck` — exit 0
2. ✅ `pnpm vitest run packages/methodology/test/vibe/orchestration/agent-spec-resolver.test.ts` — 15/15 pass (was 7/7 pre-Plan 01-01 + 8 new bundled-templates tests)
3. ✅ `pnpm vitest run packages/codex-driver/test/toml.test.ts` — 7/8 pass (1 fail is pre-existing emitFeaturesToml carryforward, baseline-confirmed)
4. ✅ `pnpm vitest run packages/core packages/methodology` — 198/207 pass; the 9 failures match the pre-stash baseline exactly (verified via `git stash push + run + stash pop`). Plan 01-01 introduces zero new test failures.
5. ✅ All 6 TOMLs spot-checked — Codex-conformant `name`, `description`, `model` ∈ catalog, `model_reasoning_effort` ∈ enum.

## Next

Phase 01 has 1 plan and it is now complete. Routing should advance to QA + UAT + Phase 02 + Phase 03. The v1.5.1 milestone next phase is `02-plugin-marketplace-prep` (manifest path move + schema realignment + version sync).
