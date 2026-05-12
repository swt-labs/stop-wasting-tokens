# SWT v3.0.0 — Release Notes

**Released:** 2026-05-12 (structural close; npm publish pending user-driven release operations)

The v3.0 line is the runtime-layer rewrite of `stop-wasting-tokens`. The methodology you already use — six-agent SDLC, plan-then-execute phases, `.swt-planning/` artefacts, must-haves, goal-backward QA — is **preserved verbatim**. What changes is the engine underneath: how the harness talks to models, how it dispatches parallel tasks, how it caches prompts, how it bills you.

If you're already on v2.3.x, the v2 → v3 migration is mostly mechanical. Run `swt migrate --to=v3` (PR-49) and follow [`docs/operations/migrating-from-v2.md`](docs/operations/migrating-from-v2.md).

## What's new

### Vendor-neutral by construction

The three legacy drivers (`@swt-labs/codex-driver`, `@swt-labs/claude-code-driver`, `@swt-labs/ollama-driver`) are deleted wholesale per ADR-005. v3 ships a single Pi-native runtime adapter that speaks to **25+ providers** via [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) — Anthropic, OpenAI, OpenRouter, Google, Bedrock, Ollama, and more.

Only `packages/runtime/` imports `@earendil-works/*`. The rest of the codebase (orchestration, methodology, dashboard, CLI) speaks Pi through the vendor-neutral runtime adapter. A future v4 swap-out of the runtime substrate requires changes only inside `packages/runtime/`.

### Parallel task dispatching with worktrees

The M3 worktree dispatcher (per ADR-008) gives each parallel Dev task its own git worktree under `.swt-planning/parallel/wt-<taskId>/`. The 8-state FSM (`created → claimed → dispatched → agent_running → agent_complete → harvested → removed`, plus `failed` from any non-terminal state) journals every transition for crash recovery.

`swt cleanup` (PR-29) is the operator-facing escape hatch for stuck worktrees + stale lock files. The chaos suite (PR-28) injects SIGKILL between every legal transition and asserts journal-based recovery reaches a clean terminal state.

### Anthropic prompt caching

The deterministic `buildPrompt()` (PR-31) emits a fixed-order block sequence:

1. role system prompt
2. PROJECT.md
3. REQUIREMENTS.md
4. STATE.md
5. phase context
6. **`cacheBreakpointIndex`** ← `cache_control: {type: 'ephemeral'}` inserted here per ADR-006
7. task brief
8. must-haves

Anthropic's prompt-caching feature reuses the stable prefix across turns. The M4 EXIT GATE target is **≥70% cache-hit ratio**; the dashboard's `CacheHitPanel` (PR-33) renders the live ratio with red/amber/green colour-coding by threshold.

OpenAI auto-caches the prefix server-side (PR-34) — no explicit `cache_control` marker required. The observation path captures `prompt_tokens_details.cached_tokens` automatically.

### Budget Gate

The M4 Budget Gate (PR-35 per ADR-007) is the automated guardrail between a runaway agent loop and your monthly LLM bill. Two thresholds:

- **70%** of ceiling reached → `budget.warning` fires; methodology downgrades subsequent dispatches one tier (`quality → balanced`, `balanced → cheap-fast`).
- **95%** of ceiling reached → `budget.pause` fires; milestone halts; dashboard surfaces a "Bump ceiling" form.

The dashboard's `BudgetPanel` shows spend / ceiling / pressure bar in real time. Resume is bump-driven — there's no "wait it out" because the meter is monotonic.

### Multi-provider routing

Four router strategies (PR-41) pick a provider per (task, tier):

- **pinned** — always one provider
- **round-robin** — cycle through ordered list (deterministic counter for tests)
- **tier-routed** — per-tier preference map + fallback for unmapped tiers
- **cost-optimized** — cheapest from candidate list per price table

The fallback chain (PR-42) wraps the router with retry-on-503/429/500. Each transition emits `provider.fallback_fired` telemetry; `FallbackChainExhaustedError` throws when `retryBudget` runs out.

The dashboard's `ProviderCostPanel` (PR-43) renders per-provider cost attribution as horizontal bars with share-of-total percentages.

### Per-task TPAC measurement

`swt bench --provider <p> --output <file>` (PR-21 + PR-T) emits a validated `TpacReport` JSON (per `TpacReportSchema`). Park reports under `.swt-planning/.tpac/*.json` and `pnpm public-benchmark` (PR-48) aggregates them into a markdown table for the project homepage.

The dashboard's `TpacPanel` (PR-37) renders the latest report's `tokens_per_criterion` with a delta-vs-baseline badge colour-coded by M4 EXIT GATE thresholds: **green at ≤ −40%** (target hit), cyan improving, slate flat, red regression.

The full TPAC −40% target check (PR-36) is the hard merge gate; activation awaits user-driven cassette recording for the M2 baseline + an M4 reference measurement.

### `swt migrate --to=v3`

Out-of-place + idempotent v2 → v3 migration (PR-49). Walks `.swt-planning/`, rewrites the two field families that changed:

- `backend: 'codex' | 'claude-code' | 'ollama'` → `backend: 'pi'`
- `agent_backend: 'codex' | 'scripted'` → `agent_backend: 'pi'`
- Markdown frontmatter `reasoning_effort: <X>` → `thinking_level: <X>`

The input directory is never touched. Already-v3 input results in zero rewrites. Plan + summary + milestone artefacts pass through verbatim — the methodology layer is unchanged between v2 and v3.

## What's removed

- **`@swt-labs/codex-driver`, `@swt-labs/claude-code-driver`, `@swt-labs/ollama-driver`** — deleted wholesale at M1 PR-05 per ADR-005. Migration: `swt migrate --to=v3` flips `backend` to `'pi'`; the Pi runtime adapter speaks to the same providers.
- **`.codex-plugin/`** — removed alongside the drivers. Pi extensions live in `packages/runtime/src/extensions/`.
- **`backend: 'codex' | 'claude-code' | 'ollama'`** enum values — replaced with `backend: 'pi'` at M6 PR-45. The `BackendSchema` enum + `agent_backend` + `Config.ts` all flipped.
- **`agentBackendTag: 'codex' | 'scripted'`** — replaced with `'none' | 'pi'`.
- **`CodexMethodologyAgent`** (dashboard server) — deleted at M6 PR-45. The closing bookend on ADR-005.
- **`SWT_VIBE_AGENT=codex` env var shortcut** — retired with the driver deletion.

## Architecture

v3 ships 6 packages with a strict one-way dependency graph:

```
Layer 1: shared              (Zod schemas + types)
Layer 2: core                (vendor-neutral interfaces)
Layer 3: runtime             (ONLY layer importing @earendil-works/*)
Layer 4: orchestration       (dispatcher + worktrees + router + meter aggregators)
Layer 5: methodology         (six SDLC roles + vibe handlers + runVibe)
Layer 6: cli + dashboard     (operator surfaces)
```

Full architecture reference: [`docs/architecture.md`](docs/architecture.md).

## Migration

```bash
# Out-of-place migration. Input is never mutated.
swt migrate --to=v3 \
  --input .swt-planning \
  --output .swt-planning-v3

# Inspect the migration report; verify field counts match expectations.

# Replace the original directory.
mv .swt-planning .swt-planning-v2-backup
mv .swt-planning-v3 .swt-planning

# Verify v3 reads it cleanly.
swt status
```

Full workflow + scope table: [`docs/cli/verbs/migrate.md`](docs/cli/verbs/migrate.md).

## v2.3.x LTS policy

Per ADR-012, v2.3.x receives **6 months** of security + critical-bug patches post-v3.0:

- Security patches: backported within 7 days of public disclosure
- Critical bug fixes (data-loss, install-breaking): backported within 14 days
- No new features
- EOL date is published on the README on `main`

After 6 months, v2.x is archived. Users are expected to have migrated or pinned to a specific v2.3.x patch.

## ADR matrix at v3.0

11 Accepted ADRs at v3.0 ship:

| ADR     | Title                                                             | Phase    |
| ------- | ----------------------------------------------------------------- | -------- |
| ADR-001 | Pi SDK adoption                                                   | M1 PR-02 |
| ADR-002 | Extension result protocol via `swt_report_result`                 | M1 PR-09 |
| ADR-003 | Provider quirks live in `quirks.json`                             | M1 PR-08 |
| ADR-004 | `cache_control` at provider shim layer                            | M1 PR-02 |
| ADR-005 | Delete legacy drivers wholesale                                   | M1 PR-05 |
| ADR-006 | Cache-control breakpoint placement (after artefacts, before task) | M4 PR-38 |
| ADR-007 | Budget Gate semantics (70% warn / 95% pause)                      | M4 PR-38 |
| ADR-008 | Worktree-per-task                                                 | M3 PR-22 |
| ADR-009 | POSIX paths + 200-char cap + LF line endings                      | M3 PR-30 |
| ADR-010 | Reproducible builds                                               | M1       |
| ADR-011 | Provider matrix via cassettes (no real API keys in CI)            | M5 PR-44 |

Plus 1 Deferred:

- **ADR-013** No hosted docs site at v3.0 — in-tree `docs/` is sufficient (revisit at v3.1)

ADR-012 (LTS policy) promotes to Accepted at PR-53 alongside the v2-archive branch cut.

## Test posture at v3.0

- **1158 tests** pass / 46 skipped / 0 failed
- `pnpm typecheck` clean across the workspace
- `pnpm lint` 0 errors
- `pnpm format:check` clean
- `pnpm test:chaos` green on host platform (Linux / macOS); Windows CI matrix activation is user-driven
- `pnpm test:provider-matrix` green (synthetic + cassette-driven; ADR-011 invariant)

The 46 skipped tests are cassette-recording-deferred — they activate automatically when users record the Anthropic + multi-provider cassettes for the M2 baseline + M5 provider matrix.

## What's still pending

These activate after release operations (cassette recording + npm publish):

- **M2 baseline TPAC measurement** — gates M4 PR-36's −40% target check
- **6-provider cassette suite** — gates the full M5 EXIT GATE + the public benchmark
- **Live-meter wire-up to dashboard** — the cache-hits + budget + provider-cost routes register with `() => null` placeholders today
- **Windows CI matrix activation** — chaos suite + regression suite on a Windows runner
- **Pi extension-loader integration for `swt_report_result`** — Pi's `customTools` accepts `ToolDefinition[]`, not extension-factory functions; the flag-based contract from PR-26 stays locked
- **Full FSM `runVibe`** — only Execute mode runs today; bootstrap + scope + plan + UAT + archive require non-interactive auto-passing paths
- **Real QA-verified `criteriaSatisfied`** — today's heuristic counts declared `must_haves` from PLAN.md frontmatter

## Release operations checklist

For the operator running the npm publish:

- [ ] Record Anthropic + OpenAI + OpenRouter cassettes against `ref-fastapi-empty` fixture
- [ ] Run `swt bench --provider <p> --output .swt-planning/.tpac/<provider>.json` for each
- [ ] Run `pnpm public-benchmark` + paste table into homepage
- [ ] PR-36 regression test flips from `skipIf(!HAS_BASELINE)` to active
- [ ] `pnpm test` + `pnpm test:chaos` + `pnpm test:provider-matrix` all green
- [ ] Cut `v2-archive` branch at the last v2.3.x commit
- [ ] `pnpm release` (npm publish with provenance + signed tag)
- [ ] GitHub release with these notes attached
- [ ] Homepage updated with public benchmark numbers

## See also

- [`CHANGELOG.md`](CHANGELOG.md) — per-PR change log across M1..M6
- [`docs/architecture.md`](docs/architecture.md) — 6-layer architecture reference
- [`docs/operations/migrating-from-v2.md`](docs/operations/migrating-from-v2.md) — full migration guide
- [`TDD2.md`](TDD2.md) — authoritative design document
- [`.vbw-planning/v3-tracking.md`](.vbw-planning/v3-tracking.md) — cross-milestone PR + ADR tracking
