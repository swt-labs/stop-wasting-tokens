---
phase: 02
round: 01
plan: R01
title: Phase 02 deviation reconciliation (plan-amendments + process-exceptions)
type: remediation
autonomous: true
effort_override: thorough
skills_used: []
files_modified:
  - .vbw-planning/phases/02-codex-spawner/02-01-PLAN.md
  - .vbw-planning/phases/02-codex-spawner/02-02-PLAN.md
  - .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md
forbidden_commands: []
fail_classifications:
  - {id: "DEV-1A", type: "process-exception", rationale: "Pre-existing TypeScript strict-mode failures in packages/codex-driver/src/spawn/wrapper.ts (line ~42, exactOptionalPropertyTypes mismatch on execa env option) and packages/codex-driver/src/toml/emit.ts:54 (TomlValue[] assignability). Both files date back to v1.0 — Plan 02-01 did not modify them. Pre-stash baseline confirms identical typecheck failure count before Plan 02-01. Net new typecheck errors introduced by Plan 02-01: 0. Same DEV-1D class as Phase 01's route.ts carryforward — tracked as a v1.5 follow-up, out of Phase 02 scope to fix (each requires its own focused refactor)."}
  - {id: "DEV-1B", type: "process-exception", rationale: "Pre-existing test failure in packages/codex-driver/test/toml.test.ts (`emits a [features] table when flags are present`) caused by the toml/emit.ts:54 type error above. Pre-stash baseline confirms identical 1-failure count before Plan 02-01. Net new test failures introduced by Plan 02-01: 0. The new codex-agent-spawner.test.ts file (5 cases) is 5/5 passing. Tracked as the same v1.5 follow-up as DEV-1A — fixing emit.ts:54 will resolve both."}
  - {id: "DEV-2A", type: "process-exception", rationale: "The NDJSON usage-chunk fixture at packages/codex-driver/test/fixtures/codex-stream-with-usage.ndjson is hand-crafted to match the documented OpenAI Codex CLI September 2025 schema (`{type:'usage', usage:{input_tokens, output_tokens}}`). It cannot be captured from a live `codex exec --json` run because no Codex CLI install is available in this environment. The schema matches AgentSpawner.SpawnResult.usage 1:1, so if the real Codex schema differs, parser.ts UsageChunkSchema is a one-line update — wrapper aggregation logic and test coverage stay correct. Tracked as a v1.5 follow-up: validate against real Codex CLI output once available locally."}
  - {id: "DEV-2B", type: "plan-amendment", rationale: "Plan 02-02 originally listed test paths as packages/codex-driver/test/spawn/{parser,wrapper}.test.ts (assumed nested layout), but the actual codex-driver test directory is flat. The plan's files_modified array was amended at execution time to packages/codex-driver/test/{parser,wrapper}.test.ts (same source files in spawn/ subpath; flat test dir). This is the same pattern as Phase 01 DEV-1A — the original plan IS the artifact that was updated.", source_plan: "02-02-PLAN.md"}
  - {id: "DEV-3A", type: "plan-amendment", rationale: "Plan 02-03 claimed `config.model_overrides` and `config.mcp_overrides` 'already exist (v1.0 ship)' but ConfigSchema only declared `agent_max_turns`. The plan's files_modified array was amended at execution time to include packages/core/src/config/Config.ts (extending ConfigSchema with model_overrides + mcp_overrides records). Without this amendment the documented precedence (config override > template field > sentinel) would be unverifiable. Same audit-trail-preserving pattern as DEV-2B.", source_plan: "02-03-PLAN.md"}
  - {id: "DEV-3B", type: "plan-amendment", rationale: "Plan 02-03 originally referenced `packages/methodology/src/orchestration/...` paths for the resolver and barrel, but the actual orchestration directory is `packages/methodology/src/vibe/orchestration/`. The plan's files_modified array was amended at execution time to use the correct paths (same source files at the correct subpath; nested vibe/ wrapper). Same pattern as Plan 02-02's DEV-2B path correction.", source_plan: "02-03-PLAN.md"}
  - {id: "DEV-3C", type: "plan-amendment", rationale: "Plan 02-03's must_have for lazy install timing required a wrapper class but the original files_modified did not list one. The plan was amended at execution time to add packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts plus matching test file. The architectural decision (lazy-install-on-first-spawn-per-role) was resolved with the user via AskUserQuestion immediately before execution; the wrapper class is the implementation of that decision.", source_plan: "02-03-PLAN.md"}
  - {id: "DEV-3D", type: "process-exception", rationale: "Plan 02-03 T4 referenced packages/cli/test/commands/vibe.test.ts as a new file. The directory packages/cli/test/commands/ existed but only contained update.test.ts. Creating the new file matches the plan's specification — there was no actual amendment needed because the file path was always correctly listed in files_modified. The SUMMARY recorded this as a deviation only because the directory state at execution time was sparser than the plan's working assumption. No source-plan change required."}
  - {id: "DEV-3E", type: "process-exception", rationale: "Plan 02-03 added zod to packages/methodology/package.json dependencies. zod was already imported by methodology/src/vibe/handlers/scope.ts but the manifest never declared it — a pre-existing v1.0 hygiene bug that surfaced when the new agent-spec-resolver test pulled methodology source through vitest's resolver. Same class as Phase 01 Plan 01-01's codex-driver missing-zod fix. The fix is necessary v1.0 hygiene that landed because the new test path exposed it; not a Plan 02-03 scope addition."}
  - {id: "DEV-3F", type: "plan-amendment", rationale: "Plan 02-03 needed to share methodology's config-loading semantics with the CLI, but methodology's existing loadConfig (inside phase-detect.ts) was private. The plan was amended at execution time to add packages/methodology/src/state/load-config.ts (public loadSwtConfig) and update the state barrel. The private loader stays in place inside phase-detect.ts; the new module is the public surface for shared use.", source_plan: "02-03-PLAN.md"}
  - {id: "DEV-3G", type: "process-exception", rationale: "Plan 02-03 T4 originally specified `vi.doMock('execa', ...)` to fake Codex output for the CLI integration test. In trial runs, vi.doMock did not intercept the bare 'execa' specifier when methodology / codex-driver source files were imported through the workspace-linked CLI test (likely a pnpm strict-isolation interaction with vitest's module-resolution). The test was switched to a node-script `codex` stub on $PATH, which proves the wiring runs end-to-end through real execa with no mock-threading dependency. The vitest+pnpm interaction is environmental, not a Plan 02-03 implementation choice. Tracked as a v1.5 follow-up: investigate vitest module-resolution semantics under pnpm strict mode if/when more CLI integration tests need cross-package mocks."}
must_haves:
  truths:
    - "every plan-amendment FAIL has its source_plan's files_modified array reflecting the actual landed scope of Plan 02-* execution"
    - "every process-exception FAIL has documented rationale explaining why it is non-fixable within Phase 02 scope"
    - "no actual code or config files need to change as part of Round 01 — all 11 FAILs are bookkeeping reconciliation, not defects"
  artifacts:
    - path: ".vbw-planning/phases/02-codex-spawner/02-01-PLAN.md"
      provides: "Plan 02-01 (already accurate — no amendment needed; included for audit completeness)"
      contains: "packages/codex-driver/src/spawner/codex-agent-spawner.ts"
    - path: ".vbw-planning/phases/02-codex-spawner/02-02-PLAN.md"
      provides: "amended files_modified reflecting flat test dir (test/parser.test.ts + test/wrapper.test.ts)"
      contains: "packages/codex-driver/test/parser.test.ts"
    - path: ".vbw-planning/phases/02-codex-spawner/02-03-PLAN.md"
      provides: "amended files_modified reflecting Config.ts + vibe/orchestration paths + LazyInstallSpawner + load-config additions"
      contains: "packages/methodology/src/vibe/orchestration/agent-spec-resolver.ts"
  key_links: []
---
<objective>
Reconcile the 11 FAIL deviation rows from 02-VERIFICATION.md by classifying each as either a plan-amendment (the original plan was updated mid-execution to reflect actual landed scope) or a process-exception (genuinely non-fixable within Phase 02 scope, with documented rationale). No code changes — this round is pure bookkeeping reconciliation, identical pattern to Phase 01 Round 01.
</objective>
<context>
Phase 01's Round 01 closed 9 deviations through 5 plan-amendments + 4 process-exceptions. Phase 02's Round 01 closes 11 deviations through 5 plan-amendments + 6 process-exceptions. The split is similar in shape because Phase 02's most-amended plan (02-03) had unresolved architectural decisions resolved via AskUserQuestion at execute time, generating multiple files_modified amendments at the moment of discovery.

The honest classification:
- 5 plan-amendments — the source plan's `files_modified` was edited at the moment of discovery (DEV-2B, DEV-3A, DEV-3B, DEV-3C, DEV-3F). Each amendment is already in place; this round confirms it.
- 6 process-exceptions — pre-existing v1.0 tech debt (DEV-1A, DEV-1B, DEV-3E), environmental constraints (DEV-2A, DEV-3G), or directory-state observations that didn't actually require a plan change (DEV-3D).

Round 01 produces no code commits. The `files_modified` array above lists the original PLAN.md files because those are where the amendments live (already applied at Phase 02 execution time, validated here for source-plan coverage).
</context>
<tasks>
<task type="auto">
  <name>T1: Confirm plan-amendment source_plan coverage</name>
  <files>
    .vbw-planning/phases/02-codex-spawner/02-02-PLAN.md
    .vbw-planning/phases/02-codex-spawner/02-03-PLAN.md
  </files>
  <action>
For each plan-amendment FAIL (DEV-2B, DEV-3A, DEV-3B, DEV-3C, DEV-3F), confirm the source_plan's `files_modified` array reflects the actual scope. Specifically:

- **02-02-PLAN.md** files_modified — DEV-2B reconciliation
  - Should contain `packages/codex-driver/test/parser.test.ts` (flat test layout, not test/spawn/parser.test.ts).
  - Should contain `packages/codex-driver/test/wrapper.test.ts` (flat test layout).

- **02-03-PLAN.md** files_modified — DEV-3A, DEV-3B, DEV-3C, DEV-3F reconciliation
  - Should contain `packages/core/src/config/Config.ts` (DEV-3A — schema gap fix).
  - Should reference `packages/methodology/src/vibe/orchestration/...` paths, NOT `packages/methodology/src/orchestration/...` (DEV-3B — path correction).
  - Should contain `packages/methodology/src/vibe/orchestration/lazy-install-spawner.ts` and matching test file (DEV-3C — wrapper class addition).
  - Should contain `packages/methodology/src/state/load-config.ts` and `packages/methodology/src/state/index.ts` (DEV-3F — public config-loader addition).

- **02-01-PLAN.md** — already accurate; included in artifact-checks for audit completeness only (no plan-amendments classify against it).

No code changes; this is verification-by-inspection of the already-applied amendments.
  </action>
  <verify>
Each plan-amendment FAIL's `source_plan` value points to a real PLAN.md file in this phase, and `grep` confirms the amended file paths are present.
  </verify>
  <done>
All 5 plan-amendment FAILs have their source_plan's `files_modified` array confirmed as reflecting the actual landed scope.
  </done>
</task>
<task type="auto">
  <name>T2: Document process-exception evidence</name>
  <files>
    .vbw-planning/phases/02-codex-spawner/remediation/qa/round-01/R01-SUMMARY.md
  </files>
  <action>
For each process-exception FAIL (DEV-1A, DEV-1B, DEV-2A, DEV-3D, DEV-3E, DEV-3G), record the non-fixability rationale + evidence in R01-SUMMARY.md. The rationale lives in `fail_classifications` above; the SUMMARY captures the verification evidence (commit refs, baseline test counts, file/grep checks).

- **DEV-1A** (codex-driver typecheck failures): commit ref of wrapper.ts and emit.ts (both pre-date Phase 02 by months); baseline pnpm typecheck output before Plan 02-01 stash showing identical failure count.
- **DEV-1B** (toml.test.ts failure): baseline `pnpm vitest run packages/codex-driver/test/toml.test.ts` output before Plan 02-01 stash showing identical 1-failure count.
- **DEV-2A** (hand-crafted NDJSON fixture): documented schema source (OpenAI Codex CLI Sept 2025 release docs); contract type alignment with AgentSpawner.SpawnResult.usage; one-line fix path if real schema differs.
- **DEV-3D** (CLI test directory observation): `ls packages/cli/test/commands/` confirming only update.test.ts existed prior; no source-plan change.
- **DEV-3E** (zod missing in methodology manifest): pre-existing v1.0 import in scope.ts:14 (commit reference); same hygiene class as Phase 01's codex-driver fix.
- **DEV-3G** (vi.doMock vs stub): test failure mode documented in 02-03-SUMMARY.md (`Failed to load url zod` + execa not intercepted across pnpm-isolated workspace packages); stub-on-PATH approach proves end-to-end wiring through real execa.

No code changes; this is documentation of the non-fixability rationale already captured in fail_classifications.
  </action>
  <verify>
Each process-exception FAIL has a corresponding evidence block in R01-SUMMARY.md.
  </verify>
  <done>
All 6 process-exception FAILs have documented non-fixability evidence.
  </done>
</task>
</tasks>
<verification>
1. R01-PLAN.md `fail_classifications` array has 11 entries (one per FAIL row in 02-VERIFICATION.md).
2. Every `type: "plan-amendment"` entry has a `source_plan` field pointing at a real PLAN.md in this phase.
3. Every `type: "process-exception"` entry has rationale text in this PLAN that justifies non-fixability.
4. R01-SUMMARY.md frontmatter `commit_hashes: []` — no code changes; this is bookkeeping reconciliation only.
5. R01-VERIFICATION.md result is PASS with each original FAIL re-verified through its classification path.
</verification>
<success_criteria>
- 11 FAIL rows from 02-VERIFICATION.md formally classified.
- 5 plan-amendments confirm their source_plan coverage (already-applied amendments visible in 02-02-PLAN.md + 02-03-PLAN.md).
- 6 process-exceptions document non-fixability with concrete evidence.
- Round 01 introduces zero new code changes — pure bookkeeping reconciliation, identical pattern to Phase 01 Round 01.
- qa-result-gate routes PROCEED_TO_UAT after R01-VERIFICATION lands.
</success_criteria>
<output>
.vbw-planning/phases/02-codex-spawner/remediation/qa/round-01/R01-SUMMARY.md
</output>
