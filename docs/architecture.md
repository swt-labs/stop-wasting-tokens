# SWT v3 architecture

Vendor-agnostic by construction. Per TDD2 §4.3.

> **Audience:** contributors + operators who want to understand how SWT v3 is structured.
> **Canonical reference:** [`TDD2.md` §4.3](../TDD2.md) for layer boundaries; this document is the operator-facing summary.
> **Status (M6 PR-47, 2026-05-12):** v3 STRUCTURALLY COMPLETE. Awaits user-driven release operations (public benchmark recording, npm publish).

## The 6-layer stack

SWT v3 is organized into 6 packages with a strict one-way dependency graph. Each layer below imports only from the layers above; no upward imports, no sideways imports.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 6 — Surfaces                                                   │
│ • @swt-labs/cli       — terminal verbs (swt vibe / bench / cleanup) │
│ • @swt-labs/dashboard — Hono daemon + SolidJS panel SPA              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 5 — Methodology                                                │
│ • @swt-labs/methodology — six-agent SDLC, vibe handlers, runVibe()   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 4 — Orchestration                                              │
│ • @swt-labs/orchestration                                            │
│   - createDispatcher, WorktreeManager, ClaimRegistry, resolveDag    │
│   - prompt-builder (deterministic), TPAC aggregator, lock-files     │
│   - provider-router, provider-fallback                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 3 — Runtime                                                    │
│ • @swt-labs/runtime — THE ONLY LAYER THAT IMPORTS @earendil-works/* │
│   - createSession, createBudgetGate, createTokenMeter               │
│   - per-provider extractors (Anthropic, OpenAI, generic)            │
│   - cache_control wiring, cache-hit + cost aggregators              │
│   - Gemini ToS warning, provider quirks JSON                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 2 — Core abstractions                                          │
│ • @swt-labs/core — SpawnerEnvironment, MemoryStore, AgentSpawner    │
│   - vendor-neutral interfaces; no Pi imports                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1 — Shared types + schemas                                     │
│ • @swt-labs/shared                                                   │
│   - Zod schemas (snapshot, events, task-result, plan, claim,        │
│     budget, tpac-report, worktree-state, lock-file)                 │
│   - TS types (TaskBrief, MeterRecord, BackendSchema = z.enum(['pi']))│
└─────────────────────────────────────────────────────────────────────┘
```

## Principle 1: only the runtime layer imports `@earendil-works/*`

Per ADR-001 + ADR-004 + ADR-005, **only `packages/runtime/`** value-imports the Pi SDK. Everything above the runtime layer speaks Pi through:

- `createSession(opts)` — returns an `SwtSession` (vendor-neutral handle)
- `mapPiEvent(piEvent)` — converts Pi-native events into `SwtEvent` envelopes
- per-provider extractors that produce `TaskTokenUsage` rows in the meter

The orchestration + methodology + dashboard + cli layers never see Pi types directly. A future v4 swap-out of the runtime substrate (e.g., from Pi to a different agentic SDK) requires changes only inside `packages/runtime/`.

**Validated by** `packages/core/test/eslint-boundary.test.ts` (Plan 01-03 PR-10) — an ESLint rule blocks `import { ... } from '@earendil-works/...'` outside `packages/runtime/src/`.

## Principle 2: methodology is preserved verbatim

The six-agent SDLC (Scout / Architect / Lead / Dev / QA / Debugger), the `.swt-planning/` artefact pipeline, plan-then-execute phases, must-haves, goal-backward QA — **none of these changed between v2 and v3**. The methodology lives in `packages/methodology/` and consumes:

- `@swt-labs/orchestration` for the dispatcher
- `@swt-labs/runtime` (transitively via orchestration) for the actual Pi calls
- `@swt-labs/shared` for the vendor-neutral type surface

The v2 → v3 transformation replaced the engine underneath the methodology. The methodology itself is the same code paths that shipped in v2.3.5.

## Principle 3: artefacts are the source of truth

`.swt-planning/` is the durable substrate. Plans, summaries, milestones, state — everything material — lives on disk. The harness is a fancy router on top of a filesystem. Crash recovery, resume, fork are all rooted in re-reading the artefacts.

Per ADR-008 (worktree-per-task) + ADR-009 (POSIX-style paths + 200-char cap + LF line endings): the artefact format is portable across Linux / macOS / Windows. The chaos suite (M3 PR-28) asserts the FSM is fully recoverable from journals + lock files alone.

## Principle 4: telemetry is aggregate-only

Per ADR-007 + the meter records' shape (`MeterRecord.input/output/cacheRead/cacheWrite/cost_usd`), telemetry NEVER carries prompt content. The dashboard's panels (CostPanel, CacheHitPanel, BudgetPanel, TpacPanel, ProviderCostPanel) render counts. The cassette format (`packages/test-utils/cassettes/`) is the only place full request/response bodies live, and even those redact cwd + secrets per ADR-011.

## What v3 ships in the box

| Capability                              | Package                     | Reference                      |
| --------------------------------------- | --------------------------- | ------------------------------ |
| Pi SDK adapter                          | `runtime`                   | ADR-001                        |
| Per-provider usage extraction           | `runtime`                   | ADR-003 (provider quirks JSON) |
| `cache_control` wiring                  | `runtime`                   | ADR-006                        |
| Budget Gate                             | `runtime`                   | ADR-007                        |
| Worktree-per-task FSM                   | `orchestration`             | ADR-008                        |
| Claim registry + DAG resolver           | `orchestration`             | TDD2 §9.2 + §9.3               |
| Provider router strategies              | `orchestration`             | TDD2 §7.3                      |
| Fallback chain + retry budget           | `orchestration`             | TDD2 §7.3 + ADR-011            |
| TPAC aggregator                         | `orchestration`             | TDD2 §8.1                      |
| `swt_report_result` extension           | `runtime` + `orchestration` | ADR-002                        |
| Cassette-only provider matrix tests     | `test-utils`                | ADR-011                        |
| Dashboard panels                        | `dashboard`                 | TDD2 §12.3                     |
| Operator verbs (`swt vibe / bench / …`) | `cli`                       | TDD2 §3.2                      |

## ADR matrix at v3.0

11 Accepted ADRs at v3.0 ship:

- **ADR-001** Pi SDK adoption
- **ADR-002** Extension result protocol via `swt_report_result`
- **ADR-003** Provider quirks live in `quirks.json`
- **ADR-004** `cache_control` at provider shim layer
- **ADR-005** Delete legacy drivers wholesale
- **ADR-006** Cache-control breakpoint placement
- **ADR-007** Budget Gate semantics (70% warn / 95% pause)
- **ADR-008** Worktree-per-task
- **ADR-009** POSIX paths + 200-char cap + LF line endings
- **ADR-010** Reproducible builds
- **ADR-011** Provider matrix via cassettes (no real API keys in CI)

Plus 1 Deferred and 1 Superseded:

- **ADR-013** No hosted docs site at v3.0 — in-tree `docs/` is sufficient (revisit at v3.1)
- **ADR-012** Six-month LTS for v2.3.x — promoted Accepted at M6 PR-53 and retracted same-day; v2.3.x is unsupported post-v3.0.

## See also

- [`TDD2.md`](../TDD2.md) — full design document (single source of truth)
- [`docs/decisions/README.md`](decisions/README.md) — ADR index
- [`docs/operations/`](operations/) — operator-facing runbooks
- [`docs/cli/verbs/`](cli/verbs/) — CLI verb reference
- [`docs/operations/migrating-from-v2.md`](operations/migrating-from-v2.md) — v2 → v3 migration guide
