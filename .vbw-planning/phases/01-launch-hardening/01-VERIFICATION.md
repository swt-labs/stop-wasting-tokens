---
phase: 01
tier: standard
result: PARTIAL
passed: 19
failed: 9
total: 28
date: 2026-05-06
verified_at_commit: 84eba58f439d8383dbdd1522a1aa69908611cd1e
writer: write-verification.sh
plans_verified:
  - 01-01
  - 01-02
  - 01-03
---

## Must-Have Checks

| # | ID | Truth/Condition | Status | Evidence |
|---|-----|-----------------|--------|----------|
| 1 | MH-1A | swt init writes AGENTS.md (Codex-canonical) for the v1.0 Codex backend; CLAUDE.md generation stays available as a backwards-compat path | PASS | packages/methodology/src/vibe/handlers/bootstrap.ts now imports writeAgentsMdBlock + writeAtomically and writes to ${cwd}/AGENTS.md; writeOrUpdateClaudeMd export retained for legacy / Claude Code driver use |
| 2 | MH-1B | fresh swt init produces a project doc whose body says SWT Rules — never VBW Rules | PASS | packages/artifacts/src/bootstrap/claude.ts SWT_RULES_BLOCK heading is ## SWT Rules; claude.test.ts asserts both ## SWT Rules present and ## VBW Rules absent (4/4 tests passing) |
| 3 | MH-1C | legacy projects with ## VBW Rules headings migrate in-place on next swt init refresh | PASS | LEGACY_HEADING_MIGRATIONS = new Map([['VBW Rules', 'SWT Rules']]) applied during parseSections; new test 'migrates a legacy ## VBW Rules heading to ## SWT Rules on refresh' passes |
| 4 | MH-1D | no user-visible string in the CLI references .vbw-planning/ after this plan ships | PASS | packages/cli/src/commands/stubs.ts:20 reads .swt-planning/ROADMAP.md; grep -RIn .vbw-planning packages/cli/src/ returns no matches |
| 5 | MH-2A | no agent TOML hardcodes a fictional model identifier | PASS | all 6 agents-templates/*.toml declare model = gpt-5-codex (real OpenAI Codex coding-tuned model); grep -RIn gpt-5.5 agents-templates/ returns no matches |
| 6 | MH-2B | the Codex Plugin Marketplace manifest carries either a real schema URL or no $schema key — never a placeholder | PASS | packages/cli/codex-plugin.json $schema field removed; new test asserts no .example or example.com URL is reintroduced |
| 7 | MH-2C | allowed_mcp_servers in agent TOMLs are either real MCP server identifiers or labelled as illustrative placeholders in a comment header | PASS | each of the 6 agents-templates/*.toml carries a 4-line header comment block explaining allowed_mcp_servers are illustrative and pointing users at ~/.codex/mcp.json for real identifiers |
| 8 | MH-3A | the public README's status block links to a real, post-archive roadmap | PASS | README.md:3 reads 'See the [v1.5 roadmap](docs/roadmap/v1.5.md) for what's coming next.'; docs/roadmap/v1.5.md exists |
| 9 | MH-3B | the post-install smoke test fails loudly if swt init produces a .vbw-planning/ directory — there is no silent fallback | PASS | scripts/verify-install.sh check is [ ! -f .swt-planning/PROJECT.md ]; the .vbw-planning/ fallback is removed; bash -n scripts/verify-install.sh confirms valid syntax |
| 10 | MH-3C | M7's state-drift verifier improvement is captured as documented design intent | PASS | docs/roadmap/v1.5.md Methodology section contains a Follow-up (M7 from v1.0 audit) paragraph tying the verifier improvement to F6 / F7 work |
| 11 | DEV-1A | Plan 01-01 amended files_modified mid-execution to add packages/methodology/package.json, packages/codex-driver/package.json, packages/artifacts/src/index.ts, and docs/package.json | FAIL | type=plan-amendment; source_plan=01-01-PLAN.md; rationale: each addition was the deterministic unblock path for planned T1-T4 work, recorded in PLAN.md frontmatter at the moment of discovery |
| 12 | DEV-1B | Plan 01-01 T5 (tests) partially complete — bootstrap.test.ts has pre-existing v1.0 ZodError failures (4/5 fail pre/post Plan 01-01) | FAIL | type=process-exception; rationale: pre-existed in v1.0 (commit 0b3880f, Phase 9). RoadmapSchema declares phases: z.array(...).min(1) but bootstrap.ts:106 writes empty phases. Pre-stash baseline confirms identical 4-failure count before Plan 01-01 changes — Plan 01 introduces zero new failures |
| 13 | DEV-1C | Plan 01-01 T5 referenced packages/cli/test/commands/stubs.test.ts which does not exist in the v1.0 codebase | FAIL | type=process-exception; rationale: v1.0 codebase has no stubs.test.ts (only update.test.ts). T4's stub help-text edit is a 1-line text change; creating a unit test for it is a v1.5 follow-up, not Plan 01 scope |
| 14 | DEV-1D | Pre-existing TypeScript strict-mode failures in packages/methodology/src/vibe/route.ts (6 cases, exactOptionalPropertyTypes) | FAIL | type=process-exception; rationale: pre-existed in v1.0. Not in any file Plan 01 modified. Fix requires spread-with-conditional refactor across 6 VibeRoute kind branches — out of scope for Phase 01; tracked as v1.5 follow-up. Plan 01 files produce no new typecheck errors |
| 15 | DEV-2A | Plan 01-02 T1 chose model = gpt-5-codex over Approach A (model = default sentinel) | FAIL | type=plan-amendment; source_plan=01-02-PLAN.md; rationale: default sentinel pattern not documented in any Codex CLI surface I can verify; pinning a real model makes the template loadable today. Phase 2 (F1 wiring) is the natural place to revisit if the model identifier proves wrong at runtime |
| 16 | DEV-2B | Plan 01-02 T2 removed the $schema field rather than substituting a real URL | FAIL | type=plan-amendment; source_plan=01-02-PLAN.md; rationale: JSON Schema's $schema is metadata not a constraint; removal doesn't affect manifest validity. Real Codex Plugin Marketplace schema URL is unverified — flagged for user-side confirmation before submission |
| 17 | DEV-2C | Plan 01-02 T3 chose to label allowed_mcp_servers as illustrative rather than replace with real identifiers | FAIL | type=plan-amendment; source_plan=01-02-PLAN.md; rationale: real MCP server names depend on the user's ~/.codex/mcp.json setup. SWT cannot prescribe them. The TOML header comment makes the override path discoverable |
| 18 | DEV-3A | Plan 01-03 T3 was a no-op verification — .github/workflows/install-smoke.yml already had no in-workflow .vbw-planning/ override | FAIL | type=process-exception; rationale: T3's intent (workflow doesn't have its own fallback masking T2's strict check) was already satisfied. The file was kept in files_modified for audit-trail visibility |
| 19 | DEV-3B | Plan 01-03 amended files_modified mid-execution to add docs/roadmap/v1.5.md for T4 | FAIL | type=plan-amendment; source_plan=01-03-PLAN.md; rationale: T4 was always intended to edit docs/roadmap/v1.5.md but the planning frontmatter omitted it; corrected at the moment of discovery |

## Artifact Checks

| # | ID | Artifact | Exists | Contains | Status |
|---|-----|----------|--------|----------|--------|
| 1 | ART-1A | bootstrap handler imports the AGENTS.md fence writer | - | writeAgentsMdBlock (imported from @swt-labs/codex-driver) | PASS |
| 2 | ART-1B | claude.ts uses SWT-named constants | - | SWT_OWNED_SECTIONS (renamed const) | PASS |
| 3 | ART-1C | CLI stubs reference .swt-planning/ | - | .swt-planning/ROADMAP.md (in stub help text) | PASS |
| 4 | ART-2A | Codex Plugin Marketplace manifest is submission-ready | - | swt-labs/stop-wasting-tokens (repository field), no $schema field | PASS |
| 5 | ART-2B | agent template declares a real model identifier | - | model = (declared, set to gpt-5-codex) | PASS |
| 6 | ART-3A | README points at the canonical v1.5 engineering roadmap | - | docs/roadmap/v1.5.md (status block link) | PASS |
| 7 | ART-3B | post-install smoke test is strict on .swt-planning/ | - | .swt-planning/PROJECT.md (smoke check) | PASS |

## Key Link Checks

| # | ID | From | To | Via | Status |
|---|-----|------|-----|-----|--------|
| 1 | KL-1A | packages/methodology/src/vibe/handlers/bootstrap.ts | packages/codex-driver/src/agents-md/writer.ts | writeAgentsMdBlock import | PASS |
| 2 | KL-1B | packages/artifacts/src/bootstrap/claude.ts | packages/artifacts/src/bootstrap/index.ts | barrel re-export of buildSwtProjectDocBody | PASS |

## Summary

**Tier:** standard
**Result:** PARTIAL
**Passed:** 19/28
**Failed:** DEV-1A, DEV-1B, DEV-1C, DEV-1D, DEV-2A, DEV-2B, DEV-2C, DEV-3A, DEV-3B
