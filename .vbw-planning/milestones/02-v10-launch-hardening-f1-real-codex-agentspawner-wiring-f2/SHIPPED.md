---
milestone_slug: 02-v10-launch-hardening-f1-real-codex-agentspawner-wiring-f2
project: stop-wasting-tokens
shipped: 2026-05-07
phase_count: 5
task_count: 63
commit_count: 69
git_tag: milestone/02-v10-launch-hardening-f1-real-codex-agentspawner-wiring-f2
---

# Shipped: stop-wasting-tokens v1.5

This milestone ships v1.5 of the Codex-first methodology runtime, expanding from the v1.0 launch baseline through five focused phases: launch hardening, real Codex AgentSpawner wiring, multi-backend drivers (Claude Code + Ollama), user-facing surfaces (`swt watch`, `swt update` marketplace path, telemetry HttpSender), and methodology infrastructure (auto-derived docs + 12-event hook taxonomy).

## Phase summary

| # | Phase | Goal | Plans | UAT |
|---|-------|------|-------|-----|
| 01 | Launch Hardening | v1.0 launch hardening (AGENTS.md migration + SWT naming + Codex marketplace polish + docs cleanup) | 3 | 7/7 PASS |
| 02 | Codex Spawner | F1 — real Codex AgentSpawner wiring + agent-spec-resolver + LazyInstallSpawner + CLI dispatch | 3 | 7/7 PASS |
| 03 | Multi Backend Drivers | F2 + F3 — Claude Code shell-out + Ollama HTTP driver + sandbox preambles + hook host | 5 | 7/7 PASS |
| 04 | User Surfaces | F4 + F5 + F8 — Ink TUI watch + marketplace-aware update + HttpSender for telemetry | 3 | 7/7 PASS |
| 05 | Methodology Infra | F6 + F7 — codegen for cli/config/artifacts MDX + drift check + 12-event hook taxonomy | 3 | 7/7 PASS |

**Total:** 5 phases / 17 plans / 63 tasks / 69 commits / 35 user-validated UAT scenarios.

## Quality gate trail

- Phase-level contract QA on each phase (5 PARTIAL results, 26 deviations recorded across phase SUMMARYs).
- Round 01 deviation reconciliation per phase: 5 R01-VERIFICATION = PASS (15 + 17 + 13 + 10 + 15 = 70 R01 PASS claims).
- All 5 R01 `verified_at_commit` fields refreshed to `23cec4b` (final product head); HTML annotations document each phase's compatibility check post-milestone.
- Two non-bypassable archive gates passed: `archive-uat-guard.sh` (no unresolved UAT) + `verify-state-consistency.sh --mode archive` (5/5 structural checks).

## Net deliverables

- **CLI surface:** `swt init` → AGENTS.md (v1.0); `swt vibe`/`watch`/`update` real handlers; `swt --backend codex|claude-code|ollama` driver dispatch.
- **Drivers:** `@swt-labs/codex-driver` (production), `@swt-labs/claude-code-driver` (claude --print stream-json), `@swt-labs/ollama-driver` (fetch /api/chat NDJSON streaming).
- **Telemetry:** `HttpSender` class implementing the Sender contract with retry-once + 5s AbortSignal timeout + privacy-preserving headers.
- **Docs:** `pnpm docs:gen` regenerates `docs/reference/{cli,config,artifacts}.mdx` from canonical sources; `pnpm test` catches docs drift.
- **Hooks:** `HookEvent` taxonomy expanded to 12 (6 v1.0 generic + 6 v1.5 SDLC lifecycle); 12 narrowing helpers + 6 sample shell scripts under `templates/hooks/`.

## Known v1.5 follow-ups (tracked, not blocking)

- CLI startup HttpSender wiring (DEV-4-03-B) — construct HttpSender vs NoopSender at startup based on config.telemetry.
- Methodology-side hook event dispatchers — fire pre_archive / post_phase / pre_phase / post_uat_fail / pre_qa / post_qa from each command surface.
- DEV-1D class pre-existing strict-typecheck failures (route.ts, codex-driver/wrapper.ts, methodology/scope.ts) — carryforward from v1.0.
- NDJSON fixture verification against live Codex + Ollama CLIs (Plans 02-02 / 03-03 hand-crafted fixtures).
