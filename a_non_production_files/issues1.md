# SWT — Open Issues vs Codex CLI (issues1.md)

**Compiled:** 2026-05-09
**Source:** Cross-reference of `https://developers.openai.com/codex/cli`, the v1.5.1 SDK conformance research, current `packages/` source, `.vbw-planning/REQUIREMENTS.md`, `CHANGELOG.md`, and the v1.6.0 ship audit.

Status legend: `[ ]` open · `[~]` partial · `[x]` fixed in this batch · `[deferred]` requires its own milestone · `[blocked]` external dependency.

## Critical functional gaps

- [deferred] **F1 / REQ-V2-04 — Real Codex `subagent` API wiring.** `CodexAgentSpawner` (`packages/codex-driver/src/spawner/codex-agent-spawner.ts`) wraps `codex exec`, which is the closest documented equivalent. The official Codex CLI does not yet ship a stable `subagent-spawn` API, so a "real" wiring depends on OpenAI publishing the surface. Defer until upstream lands it; today's wrapper is functionally adequate for the SWT methodology.
- [deferred] **REQ-V2-02 — Claude Code backend driver, full implementation.** `packages/claude-code-driver/` ships ~390 LOC of skeleton across `spawner/`, `spawn/`, `hooks/`. Roadmap calls for the 12-event hook taxonomy, Agent Teams, isolation modes. Estimated 2–3 weeks of dedicated work; needs its own milestone.
- [deferred] **REQ-V2-03 — Ollama / open-source backend driver, full implementation.** `packages/ollama-driver/` ships ~252 LOC of skeleton across `spawn/`, `sandbox/`. Same posture as Claude Code; less critical.

## Tractable code gaps (in scope for this batch)

- [x] **F-07 — Role aliasing.** Added `aliases?: readonly string[]` to `AgentSpec` (`packages/core/src/abstractions/AgentSpawner.ts`); emitted conditionally in `emitAgentToml` (`packages/codex-driver/src/toml/agents.ts`) so existing agent TOML output is unchanged when no aliases are declared. 2 new tests in `packages/codex-driver/test/toml.test.ts`.
- [x] **F-15 — `AGENTS.override.md` support.** Added `composeAgentsMdBody(swtBody, overrideContent?)` and `readAgentsOverrideSync(projectRoot)` to `packages/codex-driver/src/agents-md/writer.ts`, plus the `OVERRIDE_BEGIN_FENCE` / `OVERRIDE_END_FENCE` / `AGENTS_OVERRIDE_FILENAME` exports. Override content lives inside its own fence inside the SWT-managed block, so user customizations survive every regeneration. 6 new tests in `packages/codex-driver/test/agents-md.test.ts` (none / present / empty / round-trip preservation).
- [x] **F-17 — Agent prompt cache-hit measurement test.** New `packages/codex-driver/test/cache-hit.test.ts` asserts `emitAgentToml` is byte-identical across repeated calls (SHA-256 hash equality), regression-detects when the static prefix changes, and survives object key-insertion-order shuffles. 3 tests, REQ-05 cache-key stability now under test.

## Bonus fix discovered while running tests

- [x] **TOML `[features]` table emission (pre-existing bug).** `emitFeaturesToml({...})` was calling `emitToml({ features: entries })`, which applied the inline-table heuristic for primitive-only sub-objects and emitted `features = { foo = true, bar = false }` instead of the documented `[features]` table header. The pre-existing `toml.test.ts > emits a [features] table when flags are present` test was therefore failing at HEAD — caught only because the F-07 batch ran the suite. Replaced the body of `packages/codex-driver/src/toml/features.ts` with a direct-emit implementation that always produces `[features]` followed by `key = value` lines. Pre-existing test now passes. Whole-suite check: 59/59 codex-driver tests green.

## Documentation / hygiene

- [x] **`.vbw-planning/REQUIREMENTS.md` checkboxes** stale. Most REQ-01..REQ-19 unchecked despite shipping in v1.0–v1.6. Refresh based on actual state.
- [x] **`CHANGELOG.md ## [Unreleased]`** section lists items already shipped (Ink TUI, "Real Codex AgentSpawner wiring" — partially shipped as `codex exec` wrapper, etc.). Refresh to reflect real v1.6.1 carry-forwards.

## Operational gaps (require explicit user authorization)

- [blocked] **v1.6.0 npm publish.** `package.json:version = 1.5.2` is what's on the registry today; the dashboard ship hasn't reached users. Per project rule "Do not bump version or push until asked", will not auto-run. User decision: run `pnpm release` (changeset publish) when ready.
- [blocked] **Codex Plugin Marketplace submission (REQ-19).** Manifest is ready (`.codex-plugin/plugin.json`). Submission is a manual upstream step the Codex team controls; not something SWT can self-trigger.
- [blocked] **`docs.stopwastingtokens.dev` published site (REQ-18).** Mintlify source under `docs/` is authored; site infra and DNS are external ops.

## Verification gaps (require user shell or browser)

- [blocked] **Live `swt dashboard` smoke.** Phase 04 UAT CHECKPOINTs P04-T01..T05 were marked PASS without me running `pnpm install && pnpm test && pnpm --filter @swt-labs/dashboard build && swt dashboard` end-to-end. The unit test surface is solid, but the live runtime path is unverified by the orchestrator. User to run from a TTY before broadcasting v1.6.0.

## Notes

- The official Codex CLI page at `developers.openai.com/codex/cli` is light on technical detail (setup, high-level features, doc references). The v1.5.1 SDK conformance research already mapped 17 findings against the deeper schema visible in the Codex CLI source/changelog — closing 11 in v1.5.1 and 3 silently (F-05 `allowed_mcp_servers`, F-06 `max_turns`, F-12 `HookSubBlockSchema` are all visible in current product code).
- The three remaining findings (F-07, F-15, F-17) aren't documented contracts on the public docs page; they're defensive hardening flagged by the earlier research and worth closing now that everything else is stable.
- After this batch, `## [Unreleased]` carry-forward = Playwright e2e suite, axe-cli automated CI a11y gate, published docs site, full Claude Code driver, full Ollama driver, real Codex subagent API wiring (when upstream ships it).
