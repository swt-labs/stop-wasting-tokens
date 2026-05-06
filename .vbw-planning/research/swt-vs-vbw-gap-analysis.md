# SWT ↔ VBW Gap Analysis

**Date:** 2026-05-06
**Source:** `vibe-better-with-claude-code-vbw-main/` (Claude Code plugin) treated as the authoritative spec.
**Target:** `swt-labs/stop-wasting-tokens` (Codex CLI) — phases 1–8 already shipped (8 commits).
**Scope:** Verify every VBW component has a corresponding SWT artefact (or an explicit deferral / "doesn't apply on Codex").

## TL;DR

VBW's surface area is large: **26 commands, 7 agents, 11 hook events, ~20 hook scripts, 154 utility scripts, 16 references, 16 templates, 8 config files**. SWT phases 1–8 stood up the **skeleton** — workspace, types/abstractions, Codex driver primitives, methodology authoring, CLI surface, artefacts engine, verification helpers — but the **methodology runtime** (the part that actually orchestrates Scout → Lead → Dev → QA → UAT) is mostly **stubbed**, not implemented. That is the biggest gap.

Roughly:

- **Strong coverage (≥ 80%):** types, handoff schemas (envelope-shape only), abstraction interfaces, CLI argv/router, TOML emitters, hooks.json emitter, AGENTS.md writer, basic schemas, atomic writes, milestone archive, basic check/guard helpers.
- **Partial coverage (30–60%):** templates (4 of 16), config keys (~13 of ~44), agents (6 of 7), commands (5 real + 24 stubs of 26 — but stubs are placeholders, not behaviour), profile resolvers (effort/autonomy/verification but not the per-agent model matrix or token budgets).
- **Missing (≤ 20%):** the orchestration loop itself (execute-protocol, verification-protocol, discussion-engine, phase-detect routing), UAT remediation pipeline, QA result gate, known-issues lifecycle, skill auto-invocation, context compilation, token budgets, stack mappings, the 7th `docs` agent, six commands (compress/profile/report/rtk/teach/list-todos), and ~20 hook scripts.

## Coverage matrix

### Commands — 26 in VBW

| VBW command | SWT status | Notes |
|---|---|---|
| `vibe` | **stub** | The single most important command. Stub returns NOT_IMPLEMENTED. The whole orchestration loop lives behind this. |
| `init` | **stub** | Phase-1 work was authored manually because `Agent` is denied; no `init` runtime yet. |
| `plan` | **stub** | Spawns Scout + Lead in VBW. Methodology runtime not built. |
| `execute` | **stub** | Wave-orchestrated Dev fan-out + QA chain in VBW. Not built. |
| `qa` | **stub** | `runQa()` data-runner exists in `@swt-labs/verification`, but no command driver. |
| `verify` | **stub** | UAT inline checkpoint loop in VBW. Not ported (depends on `AskUserQuestion`-equivalent in Codex). |
| `discuss` | **stub** | Discussion-engine protocol not ported. |
| `map` | **stub** | Codebase mapping not built. |
| `debug` | **stub** | Debugger session lifecycle (`DEBUG-SESSION.md`, hypothesis-driven flow) not built. |
| `fix` | **stub** | Quick-fix turbo path not built. |
| `archive` | **stub** | Milestone archive primitive *is* in `@swt-labs/artifacts`, but no command wrapper. UAT/audit gate also not wired. |
| `release` | **stub** | Wired through `release.yml` GHA already (Phase 2). No `swt release` command yet. |
| `resume` | **stub** | Snapshot-resume not built. |
| `pause` | **stub** | Snapshot save not built. |
| `audit` | **stub** | Pre-archive 7-point audit matrix not built. |
| `assumptions` | **stub** | Discussion-engine assumptions mode not built. |
| `research` | **stub** | Standalone research command not built. |
| `phase` | **stub** | Add/insert/remove primitives *are* in `@swt-labs/artifacts/roadmap/editor`, but no command wrapper. |
| `todo` | **stub** | Todo lifecycle (capture, list, claim) not built. |
| `skills` | **stub** | Skill registry/install not built. |
| `whats-new` | **stub** | Release-notes display not built. |
| `update` | **stub** | `npm i -g` self-update not built. |
| `uninstall` | **stub** | Self-removal not built. |
| `worktree` | **stub** (SWT-added; VBW exposes via scripts only) | Worktree primitives not ported. |
| `lease` | **stub** (SWT-added; VBW exposes via scripts only) | Lease-lock not ported. |
| `help` | **real** | ✓ |
| `version` (SWT) / `--version` (VBW) | **real** | ✓ |
| `status` | **real** | ✓ Reads STATE.md. VBW's adds metrics + verbose modes — we have the basic shape only. |
| `config` | **real** | ✓ get/set/show against `.swt-planning/config.json`. VBW also drives a `profile` subsystem; we don't have it yet. |
| `doctor` | **real** | ✓ Node + codex + planning-dir. VBW also checks dependencies, hooks installed, plugin freshness — we don't. |
| **`compress`** | **MISSING** | Not even stubbed. Manual context compaction trigger. |
| **`profile`** | **MISSING** | Not even stubbed. Manage effort/model profiles + custom profiles. |
| **`report`** | **MISSING** | Not even stubbed. Metrics report. |
| **`rtk`** | **MISSING** | Not even stubbed. "Return to kanban" — todo workflow management. |
| **`teach`** | **MISSING** | Not even stubbed. Teach SWT a convention/preference. |
| **`list-todos`** | **MISSING** | Not even stubbed. SWT has `todo` stub but not `list-todos`. |

### Agents — 7 in VBW

| Agent | SWT TOML | Gap |
|---|---|---|
| Scout | `agents-templates/scout.toml` | ✓ |
| Architect | `agents-templates/architect.toml` | ✓ |
| Lead | `agents-templates/lead.toml` | ✓ |
| Dev | `agents-templates/dev.toml` | ✓ |
| QA | `agents-templates/qa.toml` | ✓ |
| Debugger | `agents-templates/debugger.toml` | ✓ |
| **Docs** | **MISSING** | VBW's 7th agent — documentation specialist. Not in SWT's 6-template set. |

Additionally:
- VBW's agent frontmatter declares `tools`, `disallowedTools`, `permissionMode`, `memory` (project|local). SWT TOMLs don't have direct equivalents for `memory` (project vs local) — Codex's `[agents]` block has `model` + `model_reasoning_effort` + `sandbox_mode` + `allowed_mcp_servers` but no first-class `memory` switch. **Gap:** no SWT-side mapping for `memory: project` vs `memory: local` semantics.
- VBW's `vbw-lead` has `Task(vbw-dev)` in its tool list — Lead spawns Dev via Task. Codex's TOML model doesn't declare child-spawn permissions the same way. **Gap:** no SWT-side analogue for the parent→child agent permission contract.

### Hook events — 11 in VBW

The 6 events Codex supports are bolded; the others don't have direct Codex equivalents and would have to be synthesised.

| Hook event | VBW scripts fired | SWT helpers ported | Wired into a real Codex `hooks.json`? |
|---|---|---|---|
| **PostToolUse** | validate-summary, validate-frontmatter, validate-commit, skill-hook-dispatch, state-updater | summary-frontmatter, plan-frontmatter, commit-message (3/5) | **No** — `@swt-labs/codex-driver` writes a hooks.json shape but no glue script consumes the helpers. |
| **PreToolUse** | bash-guard, agent-spawn-guard, skill-decision-logger×2, security-filter, lsp-nudge, skill-hook-dispatch, file-guard | bash-guard, file-guard, secret-scanner (3/8) | **No** |
| **SessionStart** | session-start, map-staleness, post-compact | none | **No** — entire session lifecycle not built. |
| **PreCompact** | compaction-instructions | circuit breaker (concept-adjacent) | **No** |
| **Stop** | session-stop, agent-health | none | **No** |
| **UserPromptSubmit** | prompt-preflight | none | **No** |
| Notification | notification-log | none | **No** (Codex-rare event) |
| SubagentStart | agent-start, agent-health | none | N/A — Codex doesn't fire this event |
| SubagentStop | validate-summary, agent-stop, agent-health | none | N/A |
| TeammateIdle | qa-gate, agent-health | none | N/A |
| TaskCompleted | task-verify, blocker-notify | none | N/A |

Critical missing wiring: **no script exists that, given an SWT install, generates and writes a populated `hooks.json` referencing the verification helpers.** The hooks-emit primitive exists; the runtime that uses it does not.

### Templates — 16 in VBW

| Template | SWT representation | Gap |
|---|---|---|
| `PROJECT.md` | schema + bootstrap script | Schema is permissive passthrough — VBW template structure (Validated/Active/Out-of-scope, Constraints, Key Decisions table) not fully formalised. |
| `REQUIREMENTS.md` | schema (loose) | VBW's REQ-IDs structure + tier classification (Table-stakes/Differentiators/Anti-features) not modelled. |
| `ROADMAP.md` | schema + editor + bootstrap | ✓ for shape; VBW's "Phase Details" body sections are not formally generated. |
| `STATE.md` | schema + updater | ✓ |
| `CONTEXT.md` (per-phase) | **MISSING** | Discussion output not modelled. |
| `MILESTONE-CONTEXT.md` | **MISSING** | Scope-level decisions not modelled. |
| `PLAN.md` | **PARTIAL** | VBW's PLAN frontmatter has `truths`, `artifacts`, `key_links`, `cross_phase_deps`, `autonomous`, `effort_override`, `skills_used`, `forbidden_commands`, `files_modified` — SWT's `LeadPlanPayloadSchema` has `tasks`, `must_haves`, `requirements` only. **Major shape gap.** |
| `SUMMARY.md` | **PARTIAL** | VBW's SUMMARY has rich `ac_results: [{criterion, verdict, evidence}]`, `pre_existing_issues`. SWT's `DevSummaryPayloadSchema` has `status`, `tasks_completed`, `commit_hashes`, `deviations` only. |
| `VERIFICATION.md` | **PARTIAL** | VBW's VERIFICATION has `tier`, `result: PASS/FAIL/PARTIAL`, `passed/failed/total`, `plans_verified`, plus tabular Must-Have / Artifact / Key-Link / Anti-pattern / Requirement-mapping / Convention sections. SWT's `QaVerificationPayloadSchema` has `result`, `checks`, `pre_existing_issues` — no tier, no tables, no anti-pattern scan. |
| `UAT.md` | **MISSING** | Not modelled. Contains test scenarios + checkpoint results. |
| `DEBUG-SESSION.md` | **MISSING** | Debugger persistent state not modelled. |
| `RESEARCH.md` | **MISSING** | Scout output template not modelled. |
| `STANDALONE-RESEARCH.md` | **MISSING** | `swt research` output template not modelled. |
| `REMEDIATION-PLAN.md` | **MISSING** | UAT remediation plan template not modelled. |
| `REMEDIATION-RESEARCH.md` | **MISSING** | Remediation research template not modelled. |
| `REMEDIATION-SUMMARY.md` | **MISSING** | Remediation summary template not modelled. |

### References (protocols) — 16 in VBW

| Reference | SWT port |
|---|---|
| `ask-user-question.md` | **MISSING** — interaction contract not adapted to Codex's prompt model. |
| `discussion-engine.md` | **MISSING** — calibration / gray-area / capture protocol not built. |
| `execute-protocol.md` | **MISSING** — the orchestration loop. Largest single gap. |
| `verification-protocol.md` | **PARTIAL** — three-tier concept reflected in `VerificationProfile` but the tabular VERIFICATION.md output (Must-Have / Artifact / Anti-pattern / Convention / Requirement Map) is not generated. Known-issues lifecycle is **MISSING**. |
| `phase-detection.md` | **MISSING** — see scripts section (`phase-detect.sh` is 1604 lines). |
| `handoff-schemas.md` | **PARTIAL** — SWT has `HandoffEnvelopeSchema` but the envelope shape differs from VBW's: VBW's includes `id` (UUID), `type` (literal union), `phase`, `task`, `author_role`, `timestamp`, `schema_version`, `payload`, `confidence`. SWT's has `from`, `to`, `kind`, `payload`, `metadata`. Different vocabularies; the message-types union is also different. Round-trip is not interoperable today. |
| `model-profiles.md` | **PARTIAL** — SWT's `Config.model_profile` enum exists (`quality | balanced | cost`) but the per-agent matrix (lead=opus, dev=opus, qa=sonnet, etc.) is not loaded from `config/model-profiles.json`. The Codex driver's `AgentSpec.model` is a free string. |
| `effort-profile-{thorough,balanced,fast,turbo}.md` | **PARTIAL** — `EFFORT_PROFILES` resolver covers `include_scout/include_architect/include_qa/max_tasks_per_plan/turn_scalar` but VBW's profiles also list per-agent verbosity, allowed tool overrides, and verification-tier coupling. |
| `lsp-first-policy.md` | **MISSING** — no SWT analogue. (Codex side has separate LSP plumbing.) |
| `vbw-brand-essentials.md` | **MISSING** — banner / Phase Banner output formatting rules. |
| `caveman-{commit,language,review}.md` | **MISSING** — alternative tone profiles. |

### Config — 8 files in VBW

| Config | SWT port |
|---|---|
| `defaults.json` (~44 keys) | **PARTIAL** — `@swt-labs/core/Config` validates 9 keys (`effort`, `autonomy`, `verification_tier`, `model_profile`, `prefer_teams`, `agent_max_turns`, `auto_uat`, `planning_tracking`, `auto_push`). **~30 keys missing**: `auto_install_skills`, `discovery_questions`, `discussion_mode`, `context_compiler`, `two_phase_completion`, `metrics`, `smart_routing`, `snapshot_resume`, `lease_locks`, `event_recovery`, `monorepo_routing`, `rolling_summary`, `require_phase_discussion`, `max_uat_remediation_rounds`, `validation_gates`, `token_budgets`, `worktree_isolation`, `auto_commit`, `visual_format`, `active_profile`, `custom_profiles`, `model_overrides`, `qa_skip_agents`, `max_tasks_per_plan`, `skill_suggestions`, `branch_per_milestone`, `plain_summary`, `caveman_*`, `statusline_*`, `debug_logging`. Most are toggles, but several gate substantial features. |
| `model-profiles.json` | **PARTIAL** — enum exposed in `Config`, but the actual per-agent assignment matrix is **not loaded** anywhere in SWT. |
| `token-budgets.json` | **MISSING** — no per-agent character budgets. SWT has a `token_budgets: true` flag but no enforcement. |
| `stack-mappings.json` | **MISSING** — skill recommendations from detected stack not built. |
| `lsp-mappings.json` | **MISSING** — language → LSP server mapping not built. |
| `destructive-commands.txt` | **APPROXIMATED** — SWT's `bash-guard` has its own embedded denylist; doesn't read this file. |
| `rollout-stages.json` | **MISSING** — graduated feature rollout not built. |
| `schemas/message-schemas.json` | **PARTIAL** — see `handoff-schemas` row above; shape differs. |

### Scripts — 154 in VBW

Bucketed by purpose. SWT coverage in parens.

| Bucket | Coverage | Key items missing |
|---|---|---|
| **Phase / state engine** | ~25% | `phase-detect.sh` (1604 lines — the single largest VBW script — drives `/vbw:vibe` routing). `phase-state-utils.sh`, `recover-state.sh`, `reconcile-state-md.sh`, `migrate-orphaned-state.sh`, `update-phase-total.sh`, `update-state.sh`, `state-updater.sh`, `persist-state-after-ship.sh`, `artifact-registry.sh`, `resolve-artifact-path.sh`, `normalize-plan-filenames.sh`. |
| **UAT remediation** | 0% | `uat-remediation-state.sh`, `uat-utils.sh`, `prepare-reverification.sh`, `extract-uat-issues.sh`, `extract-uat-resume.sh`, `finalize-uat-status.sh`, `parse-uat-issues.awk`, `write-verification.sh`, `validate-uat-remediation-artifact.sh`, `track-known-issues.sh`, `qa-remediation-state.sh`, `qa-result-gate.sh`, `qa-gate.sh`, `archive-uat-guard.sh`, `create-remediation-phase.sh`, `mark-milestone-remediated.sh`, `resolve-uat-remediation-round-limit.sh`, `extract-round-issue-ids.awk`. |
| **Methodology runtime** | 0% | `compile-{context,debug-session-context,fix-commit-context,research-context,rolling-summary,verify-context,verify-context-for-uat}.sh` — the context-compilation pipeline. `delegated-workflow.sh`, `smart-route.sh`, `route-monorepo.sh`, `resolve-execute-delegation-mode.sh`, `prompt-preflight.sh`, `post-compact.sh`, `compaction-instructions.sh`, `session-{start,stop}.sh`, `two-phase-complete.sh`, `skill-hook-dispatch.sh`, `skill-decision-logger.sh`, `debug-skill-enrichment.sh`, `extract-skill-follow-up-files.sh`. |
| **Validation** | ~30% | `validate-summary` ≈ `summary-frontmatter` ✓; `validate-frontmatter` ≈ `plan-frontmatter` ✓; `validate-commit` ≈ `commit-message` ✓. **Missing:** `validate-message`, `validate-schema`, `validate-contract`, `verify-vibe`, `verify-init-todo`, `verify-claude-bootstrap`, `verify-state-consistency`, `verify-qa-active-removal`, `verification-freshness`, `task-verify`, `validate-uat-remediation-artifact`. |
| **Hooks (PreTool / PostTool)** | ~30% | `bash-guard` ≈ `bash-guard.ts` ✓; `file-guard` ≈ `file-guard.ts` ✓; `security-filter` ≈ `secret-scanner.ts` ✓. **Missing:** `agent-spawn-guard`, `skill-decision-logger`, `lsp-nudge`, `map-staleness`, `blocker-notify`, `prompt-preflight`, `notification-log`, `skill-hook-dispatch` (PreTool variant). |
| **Worktree / lease** | 0% | `worktree-{create,merge,cleanup,status,target,agent-map}.sh`, `lease-lock.sh`. Codex's parallelism story is different (`agents.max_threads`), so worktree isolation may not need a 1:1 port — but file leases do matter for any concurrent dev fan-out. |
| **Reporting / metrics** | 0% | `collect-{diagnostics,metrics}.sh`, `metrics-report.sh`, `generate-incidents.sh`, `log-event.sh`, `generate-contract.sh`, `validate-contract.sh`, `contract-revision.sh`, `token-baseline.sh`, `token-budget.sh`. |
| **Bootstrap / init** | ~40% | Phase 1 was authored manually. VBW has `bootstrap/*` scaffolding scripts, `generate-gsd-index.sh`, `infer-gsd-summary.sh`, `infer-project-context.sh`, `migrate-config.sh`, `detect-stack.sh`, `verify-init-todo.sh`. SWT has none of these. |
| **Resolution helpers** | ~25% | `resolve-agent-{max-turns,model,settings}.sh` partial via `EFFORT_PROFILES`; **missing:** `resolve-claude-dir`, `resolve-debug-target`, `resolve-gate-policy`, `resolve-lsp`, `resolve-todo-item`, `resolve-verification-path`. |
| **Todo subsystem** | 0% | `todo-lifecycle.sh`, `todo-details.sh`, `list-todos.sh`, `resolve-todo-item.sh`. |
| **Misc operational** | 0% | `vbw-statusline.sh`, `tmux-watchdog.sh`, `pre-push-hook.sh` (we *did* install our own pre-push hook in Phase 1), `agent-{health,pid-tracker,start,stop}.sh`, `clean-stale-teams.sh`, `auto-repair.sh`, `derive-milestone-slug.sh`, `unarchive-milestone.sh`, `post-archive-hook.sh`, `planning-git.sh`, `bump-version.sh`, `rollout-stage.sh`, `control-plane.sh`, `rtk-manager.sh`, `snapshot-resume.sh`, `cache-{context,nuke}.sh`, `delta-files.sh`, `summary-utils.sh`, `suggest-{compact,next}.sh`, `notification-log.sh`, `help-output.sh`, `hard-gate.sh`, `doctor-cleanup.sh`, `adopt-contributor-pr.sh`, `dev-{launch,setup}.sh`, `post-discord-release.sh`, `rename-default-milestone.sh`, `refresh-claude-md-vbw-sections.sh`, `check-claude-md-staleness.sh`, `verify-claude-bootstrap.sh`, `write-{debug-session,fix-marker}.sh`, `worktree-agent-map.sh`, `map-verify-response.sh`, `extract-verified-items.sh`, `research-{warn,session-state}.sh`, `assess-plan-risk.sh`, `normalize-prefer-teams.sh`. |

## Critical gaps blocking v1 (in priority order)

1. **`phase-detect.sh` equivalent** — the `/vbw:vibe` router needs a deterministic state-detection function. VBW has 1604 lines of bash; SWT has nothing. Without this, every other state-driven feature (resume, skip-to-correct-mode, milestone UAT recovery, QA freshness) can't work.

2. **Methodology runtime in `@swt-labs/methodology`** — Lead reads RESEARCH.md, Dev fan-out by waves, QA receives Dev SUMMARY, sequence and chaining. Today every `swt vibe/plan/execute/qa` is a stub.

3. **Plan / Summary / Verification template fidelity** — VBW's must-haves (`truths` + `artifacts` + `key_links`) and SUMMARY's `ac_results` reconciliation are the contract that QA verifies against. SWT's loose `must_haves: string[]` + `tasks_completed` won't survive contact with VBW-grade verification.

4. **UAT remediation pipeline** — entirely absent. The `qa-result-gate.sh` deterministic gate, known-issues lifecycle, round-N remediation directories, `R{RR}-PLAN.md` / `R{RR}-VERIFICATION.md` shape — none of it ported.

5. **Discussion engine** — `references/discussion-engine.md` is the gateway to bootstrap, scope, plan-level discussion, and assumptions. Without a port, none of those modes work.

6. **Per-agent model + token-budget enforcement** — `config/model-profiles.json` and `config/token-budgets.json` aren't loaded anywhere in SWT. Cost discipline (the brand promise) is unverifiable today.

7. **Hooks file emitter that actually populates from helpers** — primitive exists, the wiring that produces a real `~/.codex/hooks.json` referencing SWT's check/guard helpers does not.

8. **Missing 7th agent** — `vbw-docs` template absent.

9. **Missing 6 commands** — `compress`, `profile`, `report`, `rtk`, `teach`, `list-todos`.

## Lower-priority gaps (post-v1)

- Worktree subsystem (Codex `agents.max_threads` is different from Claude Code's worktree isolation; needs design).
- Caveman tone profiles.
- `swt update` / `swt uninstall`.
- Discord release announcement, Mintlify-specific bits.
- `tmux-watchdog`, `agent-health` pid trackers (operational tooling).
- `rollout-stages.json` graduated rollout.
- Statusline (currently the VBW statusline is referenced from your `~/.claude/settings.json` — SWT will need its own statusline binary at some point, not v1-blocking).

## Genuinely "doesn't apply on Codex"

These do not need a SWT port; they're Claude-Code-specific or VBW-internal-tooling:

- `hook-wrapper.sh`, `ensure-plugin-root-link.sh`, `install-hooks.sh` (Claude plugin infra)
- `agent-pid-tracker.sh`, `agent-spawn-guard.sh`, `clean-stale-teams.sh` (Claude subagent lifecycle — Codex's `[agents]` block handles this differently)
- Hook events: `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCompleted` (Codex doesn't fire these)
- `pre-push-hook.sh` (we installed our own VBW pre-push hook on the SWT repo in Phase 1; the script logic is reused unchanged)
- `bump-version.sh`, `dev-{launch,setup}.sh`, `adopt-contributor-pr.sh` (VBW-internal release ops)

## Recommended next steps

The roadmap currently lists Phases 9 (Docs), 10 (Distribution), 11 (Beta), 12 (v1.0 launch), 13 (v1.5 prep). Based on the gap analysis, those phases under-scope what's actually needed for a *working* v1. Concrete proposal:

1. **Insert a new Phase 8.5 "Methodology runtime"** — port `phase-detect`, the execute-protocol loop, the verification-protocol output, the discussion-engine, the UAT remediation pipeline. This is the single biggest piece of work and gates everything else.
2. **Insert a new Phase 8.6 "Template fidelity"** — bring SWT's PLAN / SUMMARY / VERIFICATION schemas up to VBW shape (truths/artifacts/key_links/ac_results/tier/tabular sections).
3. **Extend Phase 5 retrofit** — add the 7th `docs` agent template; add `model-profiles.json` and `token-budgets.json` loading to `@swt-labs/methodology/profiles`.
4. **Extend Phase 6 retrofit** — stub or implement the 6 missing commands (`compress`, `profile`, `report`, `rtk`, `teach`, `list-todos`).
5. **Extend Phase 8 retrofit** — port the missing PostTool checks (`skill-hook-dispatch`, `state-updater`), missing PreTool guards (`agent-spawn-guard`, `skill-decision-logger`, `lsp-nudge`), and add a `swt hooks generate` command that emits a real `hooks.json` populated with these helpers.

That re-shape adds roughly two phases of work but is the path to feature parity with VBW. Without it, SWT v1 will boot and respond to `swt help`, but `swt vibe` won't do anything yet.
