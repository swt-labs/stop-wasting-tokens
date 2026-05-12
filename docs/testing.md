# SWT v3 — Testing Posture

> **One-page consolidation of the test surface defined across TDD2 §14, §15, and the three M1 plans.** This document is for the engineer who wants to answer "what testing is in place before SWT v3 reaches beta?" without reading 261 KB of design docs.
>
> **Authoritative source:** `TDD2.md` at the repo root. This page references it; on any conflict, TDD2 wins.

---

## TL;DR

v3 has **12 distinct test categories** plus **2 hard merge gates that mathematically cannot be bypassed**. The plans schedule the test infrastructure to land before the feature work that needs it — by the time M4 closes (TPAC −40% gate), every test category below is live. Beta starts only after **M6's full test suite passes** (unit + integration + provider-matrix + regression + chaos + e2e + reproducible-build).

```
┌────────────────────────────────────────────────────────────────────┐
│  HARD MERGE GATES (delta-0 / target-must-hit, not "informational") │
├────────────────────────────────────────────────────────────────────┤
│  M1 PR-07 — Token meter delta = 0 tokens on cassette replay        │
│             ↳ If any non-determinism in event mapping or           │
│               aggregation, CI fails. No PR can merge with drift.   │
│                                                                    │
│  M4 PR-36 — TPAC −40% vs M2 baseline on ref-fastapi scenario       │
│             ↳ If the optimization doesn't materialize, the M4-     │
│               finish PR cannot merge. No "we'll fix it later."     │
└────────────────────────────────────────────────────────────────────┘
```

---

## The 12 Test Categories

### 1. Unit tests (TDD2 §14.2)

**What.** Standard `vitest` unit tests, co-located with source in `packages/<name>/test/*.test.ts`.

**Where they land.** Every PR. Coverage gates per package (lines / branches / functions):

| Package              | Lines | Branches | Functions |
| -------------------- | ----- | -------- | --------- |
| `core/methodology/`  | 90%   | 85%      | 90%       |
| `core/artefacts/`    | 95%   | 90%      | 95%       |
| `core/verification/` | 90%   | 85%      | 90%       |
| `core/telemetry/`    | 80%   | 75%      | 80%       |
| `runtime/`           | 85%   | 80%      | 85%       |
| `orchestration/`     | 90%   | 85%      | 90%       |
| `dashboard/server/`  | 75%   | 70%      | 75%       |
| `cli/`               | 70%   | 65%      | 70%       |
| `shared/`            | 95%   | 90%      | 95%       |

**Time budget:** < 30s total. **Discipline:** PRs that drop coverage > 0.5pp fail CI.

### 2. Integration tests (TDD2 §14.3)

**What.** Tests that cross layers (e.g., orchestration → runtime → mocked Pi) but stay in-monorepo. No network.

**Where they land.** Every Layer N ↔ N+1 seam has at least one — five seams total per TDD2 §4.3. Filename convention: `*.int.test.ts`.

**First lands:** M1 PR-09 — the end-to-end Scout-task integration (dispatcher → mocked Pi → parsed `TaskResult`).

**Time budget:** < 3 min total.

### 3. End-to-end tests (TDD2 §14.4)

**What.** Spawn the full `swt` binary as a subprocess; commands run against real `.swt-planning/` fixtures; Pi is mocked at the runtime adapter (no real LLM calls). Catches bundling regressions and matches user reality.

**Where they land.** `test/e2e/*.e2e.test.ts` at repo root.

**First lands:** M2 — covers `swt vibe` end-to-end against a mocked Pi.

**Time budget:** < 10 min total. Hard ceiling.

### 4. Cassette infrastructure (TDD2 §14.7)

**What.** Recorded LLM-response replay for deterministic testing. JSONL format with header + interactions; bodies hashed for matching.

**Where it lands.** **M1 PR-06** — `packages/test-utils/` private workspace + recorder/replayer + first cassette (`scout-read-readme.jsonl`).

**Recording cost discipline:** First cassette is ≤ $0.01 to record on Anthropic; fallback paths via OpenRouter free-tier or local Ollama for developers without Anthropic credit.

**Determinism guarantees:**

- Cassette recorder normalizes `cache_control` markers BEFORE computing body hash (so re-records don't drift)
- Replayer fails the test if a request doesn't match — non-determinism is a bug, not a flag
- Cassettes are version-controlled (committed to repo)

### 5. Token-meter regression test (TDD2 §14.7 + §8.1) — **HARD MERGE GATE**

**What.** Integration test asserts that cassette-replayed token counts equal the recorded counts byte-for-byte (`delta = 0`).

**Where it lands.** **M1 PR-07** — `packages/runtime/test/meter/cassette-replay.int.test.ts`. **Hard merge gate.** If `delta ≠ 0`, PR-07 cannot merge.

**Why this matters before beta.** Token-counting non-determinism would silently invalidate the TPAC metric (the entire north-star measurement). Catching it at PR-07 prevents the entire v3 measurement chain from being unreliable.

### 6. Regression tests vs v2 (TDD2 §14.6)

**What.** v2.3.5's reference fixtures (e.g., `ref-fastapi` greenfield project) were run end-to-end with v2; resulting `.swt-planning/` directories live in `packages/test-utils/golden/<fixture>/v2-baseline/`. v3 runs the same fixtures and the test compares against the golden, with allowed-drift (timestamps, session IDs, worktree paths).

**Where it lands.** M2 PR-18 — Scout/Architect/Dev/QA cassettes recorded + `runMilestone` test that asserts byte-identical artefacts (modulo drift).

**Why this matters before beta.** If v3 silently changes methodology behavior, regression fails. This is the safety net for the "methodology layer is preserved" claim (TDD2 §11).

### 7. Provider matrix tests (TDD2 §14.5)

**What.** Same scenario replayed against each provider's cassette: `{anthropic, openai, openrouter:deepseek, openrouter:kimi, google, bedrock}` × `{scout-task, dev-task, qa-task}` = 18 tests.

**Where it lands.** M5 PR-44. CI workflow `provider-matrix.yml` exists as a stub from M1 PR-11; M5 fills in the actual tests.

**Time budget:** < 25 min (parallelized across 6 jobs, one per provider).

**No real API keys in CI.** All cassette-based. Per ADR-011.

### 8. Golden artefact bundles (TDD2 §14.8)

**What.** Self-contained scenario directories in `packages/test-utils/golden/<fixture>/`. Each bundle has `v2-baseline/` (recorded v2.3.5 milestone state), `v3-expected/` (target state, initially empty), `cassettes/` (LLM recordings), `inputs/` (user-input transcripts).

**Where it lands.** First bundle (`ref-fastapi`) materializes at M2 (regression + TPAC baseline). Pattern is reusable for future scenarios.

### 9. Performance / TPAC measurement (TDD2 §14.9 + §8.1) — **HARD MERGE GATE**

**What.** TPAC = total_tokens / acceptance_criteria_count. Measured on `ref-fastapi` scenario via cassette replay (deterministic, no real API cost in CI).

**Where it lands.** M2 PR-19 (baseline) + **M4 PR-36 (−40% gate)** — `test/perf/tpac-baseline.perf.test.ts`. **Hard merge gate at M4.** If TPAC drift is < 40% improvement vs M2 baseline, PR-36 cannot merge.

**Contingency.** If physics says −40% is unreachable on this benchmark, TDD2 §13.4.3 R-03 specifies the path: cassette-replay diagnostic attribution + propose a refined target with documented evidence. Not "skip the gate."

**User-facing wrap:** `swt bench --fixture=ref-fastapi-empty` runs this for any user.

### 10. Chaos / crash-recovery tests (TDD2 §14.10)

**What.** Spawn the orchestrator as a subprocess; killer coroutine sends SIGKILL at every FSM transition; verify clean resume from disk state. Tests crash-safety as a real property.

**Where it lands.** M3 PR-28. Workflow `chaos.yml` stubbed in M1 PR-11; real tests in M3.

**CI gating.** Opt-in via PR label `run:chaos` (saves CI minutes by default). Nightly schedule runs them across Linux + macOS + Windows for guaranteed coverage.

**Time budget:** < 20 min total.

### 11. Static-check ladder (TDD2 §14.11 + §6 Principle 6) — **NON-CONFIGURABLE**

**What.** Zero-token checks run BEFORE any LLM-based QA in the methodology's verification pipeline. Fixed order:

1. `tsc --build` (typecheck per workspace)
2. `eslint .` (lint)
3. `prettier --check .` (format)
4. `vitest run` (unit + integration)
5. `pnpm test:provider-matrix` (provider matrix)
6. `pnpm test:regression` (regression)
7. `pnpm test:chaos` (chaos)
8. `pnpm test:e2e` (e2e)
9. LLM-based QA (only if steps 1–8 are clean)

**Why this matters.** Static checks are free; LLM calls cost money + time. Doing them in the wrong order is wasteful AND lets regressions hide. Constitutional Principle 6.

**Where it lands.** `packages/core/verification/runner.ts` — already in v2; v3 preserves and canonicalizes (no skip flags).

### 12. Test isolation rules (TDD2 §14.12)

**What.** Enforced by ESLint + a CI step that runs `vitest --shuffle`:

- No test creates files outside its temp dir
- No test reaches the network (undici fetch interceptor is global; asserts no unintercepted requests fire)
- No test depends on another test's order
- Test fixtures are read-only (copy first if mutation needed)
- Mocks reset between tests

**Where it lands.** ESLint rules + CI shuffled-run step in M1 PR-11.

---

## CI Pipeline + Hard Gates (TDD2 §15)

```
                          PR opened / push to a branch
                                       │
                                       ▼
        ┌──────────────────────────────────────────────────────────┐
        │  ci.yml — matrix: {ubuntu, macos, windows} × {Node 20, 22} │
        │                                                          │
        │   1. pnpm install --frozen-lockfile                      │
        │   2. pnpm typecheck                  REQUIRED            │
        │   3. pnpm lint                       REQUIRED            │
        │   4. pnpm format:check               REQUIRED            │
        │   5. pnpm test                       REQUIRED (M1 PR-11+)│  ← was advisory in v2
        │   6. pnpm test:regression            REQUIRED            │
        │   7. pnpm build                      REQUIRED            │
        │   8. node scripts/check-bundle-size  REQUIRED            │
        │   9. node scripts/check-offline      REQUIRED            │
        └──────────────────────────────────────────────────────────┘
                                       │
                       ┌───────────────┼───────────────┐
                       ▼               ▼               ▼
            ┌──────────────────┐ ┌──────────────┐ ┌─────────────────┐
            │ chaos (opt-in)   │ │ e2e          │ │ provider-matrix │
            │ kill-9 injection │ │ swt binary   │ │ 6 × 3 = 18      │
            │ + nightly        │ │ subprocess   │ │ cassette-based  │
            └──────────────────┘ └──────────────┘ └─────────────────┘
                                       │
                                       ▼ (push to main only)
                            ┌──────────────────────────┐
                            │ reproducible-build       │
                            │ pnpm build twice;        │
                            │ diff dist-first dist     │
                            │ Any drift = FAIL         │
                            └──────────────────────────┘
                                       │
                                       ▼ (when changesets present)
                            ┌──────────────────────────┐
                            │ release.yml              │
                            │ - GPG-sign tag           │
                            │ - npm publish --provenance│
                            │ - install-smoke matrix   │
                            └──────────────────────────┘
```

### Workflow files

| Workflow              | Status as of M1 PR-11    | Activation                             |
| --------------------- | ------------------------ | -------------------------------------- |
| `ci.yml`              | Active, gating           | Push to main + all PR branches         |
| `codeql.yml`          | Active, security scan    | Push, PR, weekly schedule              |
| `install-smoke.yml`   | Active                   | After release tag pushed (`v*`)        |
| `release.yml`         | Active                   | Push to main (when changesets present) |
| `vale.yml`            | Active, docs style       | PRs with docs/\*\* changes             |
| `regression.yml`      | **Stub, lands M2 PR-18** | PRs touching test paths                |
| `chaos.yml`           | **Stub, lands M3 PR-28** | Opt-in label + nightly                 |
| `provider-matrix.yml` | **Stub, lands M5 PR-44** | Opt-in label + nightly                 |

Stubs return exit 0 in M1; real test runners replace them at each milestone. This lets workflows be in place from M1 without false failures.

---

## Two Things That CANNOT Bypass the Tests

### 1. ESLint `import/no-restricted-paths` (TDD2 §4.3)

Enforced at lint time. Forbidden imports:

- `packages/core/` cannot import `@earendil-works/*` (any Pi package)
- `packages/core/` cannot import `packages/runtime/`, `orchestration/`, `dashboard/`, `cli/`
- `packages/runtime/` cannot import `packages/core/`
- `packages/orchestration/` cannot import `packages/dashboard/` or `packages/cli/`
- `packages/shared/` cannot import anything except std/zod/typebox/tsc-types

PRs that disable the rule fail CI.

### 2. Provider matrix tests run on cassettes only (TDD2 §15.5 + ADR-011)

**No real LLM API keys in CI.** Tests are deterministic, fast, free. When intentional re-recording is needed (cassette refresh PR), the developer uses their own credentials locally.

---

## Pre-beta gate

**Beta cannot begin** until **all of M6's exit-gate items pass** (TDD2 §13.6.2):

- All Codex-era code paths removed (`grep` clean)
- `commands/stubs.ts` deleted (no v3 verb returns `EXIT.NOT_IMPLEMENTED`)
- Public benchmark scenario published demonstrating TPAC −40% / cache hit ≥70% / cost −50%
- `swt migrate --to=v3` upgrades v2.x `.swt-planning/` successfully on 3 fixtures
- All P0 dashboard panels green
- All test suites pass: unit, integration, provider-matrix, regression, e2e, chaos
- `v3.0.0` published to npm with provenance + signed tag verified

When all gates green, v3.0.0-rc.1 cuts; **7-day RC soak** with self-selected beta users; if no critical defects, promotion to stable.

---

## What this means for "trust the code works before beta"

You're not trusting the code — you're trusting **a layered gate system** where:

- Determinism is asserted at byte level (M1 PR-07's delta=0 token meter)
- Per-package coverage thresholds catch sneaks at unit level (CI gating)
- Cross-layer interactions are integration-tested with mocked Pi (M1 PR-09)
- Cross-provider behavior is matrix-tested with 6 providers (M5 PR-44)
- v2 regression-byte-compared against v3 (M2 PR-18)
- Crash recovery proved across Linux/macOS/Windows (M3 PR-28)
- TPAC −40% measured and merge-gated (M4 PR-36)
- Reproducible builds asserted at every push to main (M1 PR-11)
- Public benchmark published before ship (M6 PR-48)

Beta sees code that has crossed **all of those gates**. If beta finds a bug, that's a hole in the gate system — captured in TDD2 §17.5 (rollback plan: `npm unpublish` within 24h, `npm deprecate` after, forward-fix patch). No bug from beta is allowed to ship into a `v3.0.x` patch without a corresponding new test that would have caught it.

---

## See also

- `TDD2.md` §14 — full Test Strategy (longest section in TDD2)
- `TDD2.md` §15 — full CI/CD pipeline spec
- `.vbw-planning/phases/01-m1-foundation/01-02-PLAN.md` — PR-06 cassette infra + PR-07 token meter test
- `.vbw-planning/phases/01-m1-foundation/01-03-PLAN.md` — PR-11 CI test required + reproducible-build job
