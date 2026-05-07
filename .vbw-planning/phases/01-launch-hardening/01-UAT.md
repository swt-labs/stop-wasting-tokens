---
phase: 01
plan_count: 3
status: complete
started: 2026-05-07
completed: 2026-05-07
total_tests: 7
passed: 7
skipped: 0
issues: 0
---

User-validated all 9 audit-finding closures across the 3 Phase 01 plans (C1-C5, M1, M3, M6, M7). 7/7 UAT scenarios PASS via inspection of the modified files. No issues found, no skips.

## Tests

### P01-T1: AGENTS.md bootstrap path (C1)

- **Plan:** 01-01 — Bootstrap → AGENTS.md + SWT naming
- **Scenario:** Open `packages/methodology/src/vibe/handlers/bootstrap.ts` and search for `writeAgentsMdBlock`. Confirm import from `@swt-labs/codex-driver` and that the handler emits `AGENTS.md` (not `CLAUDE.md`).
- **Expected:** Import statement present; `agentsMdPath = join(io.cwd, 'AGENTS.md')`; CLAUDE.md no longer the default emit path.
- **Result:** pass
- **Notes:** User confirmed: imports + writes AGENTS.md as the canonical path for the v1.0 Codex backend. CLAUDE.md generation stays available via the retained `writeOrUpdateClaudeMd` export for legacy / future Claude Code driver use.

### P01-T2: SWT Rules naming + legacy migration (C2)

- **Plan:** 01-01 — Bootstrap → AGENTS.md + SWT naming
- **Scenario:** Open `packages/artifacts/src/bootstrap/claude.ts`. Confirm heading reads `## SWT Rules`, constants are `SWT_OWNED_SECTIONS` / `SWT_RULES_BLOCK`, and `LEGACY_HEADING_MIGRATIONS = new Map([['VBW Rules', 'SWT Rules']])` exists in parseSections.
- **Expected:** All three identifiers/headings renamed; legacy migration map present; new test in claude.test.ts asserts a legacy `## VBW Rules` heading is rewritten on refresh.
- **Result:** pass
- **Notes:** User confirmed all three checks. Fresh `swt init` produces `## SWT Rules`; legacy projects with `## VBW Rules` migrate cleanly without losing user-authored prose outside the SWT-owned sections.

### P01-T3: Agent TOML model + MCP labels (C3 + M6)

- **Plan:** 01-02 — Codex marketplace + agent template polish
- **Scenario:** Open `agents-templates/scout.toml`. Confirm: 4-line header comment about overriding model + illustrative MCP nature; `model = "gpt-5-codex"` (not `gpt-5.5-pro`); same shape across the other 5 templates (architect/lead/dev/qa/debugger).
- **Expected:** Real OpenAI Codex coding-tuned model identifier in all 6 templates; comment block makes overrides discoverable.
- **Result:** pass
- **Notes:** User confirmed model + comment present and consistent across all 6 agent profile templates. `grep -RIn 'gpt-5\.5' agents-templates/` returns no matches.

### P01-T4: Codex Plugin Marketplace manifest (C4)

- **Plan:** 01-02 — Codex marketplace + agent template polish
- **Scenario:** Open `packages/cli/codex-plugin.json`. Confirm the placeholder `$schema: https://docs.codex.example/plugin-manifest.schema.json` is gone and the JSON parses cleanly.
- **Expected:** No `$schema` field; manifest opens with `name: "stop-wasting-tokens"`; `node -e "JSON.parse(...)"` exits 0.
- **Result:** pass
- **Notes:** User confirmed `$schema` removed, JSON valid. The new `packages/cli/test/codex-plugin-manifest.test.ts` asserts no future regression to `.example`/`example.com` URLs.

### P01-T5: CLI stub + README link (C5 + M1)

- **Plan:** 01-01 (stubs.ts) + 01-03 (README.md)
- **Scenario:** Open `packages/cli/src/commands/stubs.ts:20` (expect `.swt-planning/ROADMAP.md`) AND `README.md:3` (expect link to `docs/roadmap/v1.5.md`). Confirm both paths are corrected.
- **Expected:** No `.vbw-planning/` reference in either user-facing surface.
- **Result:** pass
- **Notes:** User confirmed both references updated. `grep -RIn '\.vbw-planning/' README.md packages/cli/src/` returns no matches.

### P01-T6: Strict install smoke test (M3)

- **Plan:** 01-03 — Documentation + scripts cleanup
- **Scenario:** Open `scripts/verify-install.sh`. Confirm the swt-init scaffold check is `[ ! -f .swt-planning/PROJECT.md ]` only — no `.vbw-planning/` fallback. Error message should reference `.swt-planning/` explicitly.
- **Expected:** Script fails loudly if `swt init` ever emits to `.vbw-planning/`. No fallback masks a regression of the C1 fix.
- **Result:** pass
- **Notes:** User confirmed the strict check + explicit error message. `bash -n scripts/verify-install.sh` exits 0 (syntax valid).

### P01-T7: M7 follow-up annotation (M7)

- **Plan:** 01-03 — Documentation + scripts cleanup
- **Scenario:** Open `docs/roadmap/v1.5.md` Methodology section. Confirm a `**Follow-up (M7 from v1.0 audit).**` paragraph exists in the F7 (Hook event taxonomy) section, tying the state-drift verifier improvement to F6/F7 work.
- **Expected:** M7's deferral is documented as a v1.5 follow-up tied to existing Fn features rather than as a new Fn item, since `verify-state-consistency.sh` is a VBW-plugin helper not SWT product code.
- **Result:** pass
- **Notes:** User confirmed the follow-up paragraph is present in the right section. M7 has explicit, traceable v1.5 disposition.

## Summary

- Passed: 7
- Skipped: 0
- Issues: 0
- Total: 7

All 9 audit-finding closures (C1, C2, C3, C4, C5, M1, M3, M6, M7) validated via UAT inspection. Phase 01 closes with full QA + UAT alignment: contract verification PASS (R01-VERIFICATION 15/15), deviation reconciliation Round 01 PASS (5 plan-amendments + 4 process-exceptions documented), and user-validated UAT 7/7 PASS.
