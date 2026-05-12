# Operations — Observability

> **Status:** stub — expanded as telemetry rolls out per milestone.
>
> **Canonical reference:** [`TDD2.md` §16](../../TDD2.md).
> **Implementing package:** [`packages/telemetry/`](../../packages/telemetry/).

SWT's telemetry is **opt-in, aggregate-only** (per Principle 4 — never carries prompt content or raw model output). Operators enable it via `.swt-planning/config.json` `telemetry.enabled = true` + their anonymous ID. The telemetry package maintains a strict event registry; events not in the registry are rejected at emit time.

## M1 event registry (PR-07)

| Event                             | Payload keys (aggregate dimensions only)                                                                         | Source                              |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :---------------------------------- |
| `swt.m1.meter.updated`            | milestone, phase, role, provider, input_total, output_total, cache_read_total, cache_write_total, cost_usd_total | `createTokenMeter` snapshot rollup  |
| `swt.m1.cassette.replay_started`  | cassette_id                                                                                                      | cassette replayer hook              |
| `swt.m1.cassette.replay_complete` | cassette_id, delta_tokens, passed                                                                                | cassette replayer post-assertion    |
| `swt.m1.task_result.parsed`       | task_id, ok                                                                                                      | `harvestTaskResult` post-validation |

## Carriers + sinks

| Layer                               | What it does                                                                                                              |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `runtime/src/meter/`                | Records `MeterRecord` rows; emits `METER_UPDATED` to subscribers.                                                         |
| `runtime/src/extensions/journal.ts` | Mirrors `SwtEvent`s into `<cwd>/.swt-planning/journal/<UTC-day>.jsonl` (M3 crash recovery).                               |
| `telemetry/src/sender.ts`           | Buffers + ships aggregate events to the operator-configured endpoint (opt-in).                                            |
| `telemetry/src/sanitize.ts`         | Strips any field not in the event's `ALLOWED_KEYS` (defence-in-depth — payloads can't accidentally carry sensitive data). |

This page expands as M2 (agent timeline events), M3 (worktree + chaos events), and M4 (cache + budget events) ship.

## TPAC measurement (M2 PR-19)

**TPAC** = **Tokens Per Acceptance Criterion**. The headline cost-efficiency metric per TDD2 §8.1. Computed at the close of a milestone run against a frozen reference fixture:

```
tpac_input         = sum(record.input)  for records in milestone
tpac_output        = sum(record.output) for records in milestone
tpac_total         = tpac_input + tpac_output
tokens_per_criterion = tpac_total / criteria_satisfied
```

Where `criteria_satisfied` is the count of P0 must-haves that QA verified as `passed` for that milestone.

### Architecture

The runtime layer's [`createTokenMeter`](../../packages/runtime/src/meter/token-meter.ts) records per-turn `MeterRecord` rows (one per `TASK_TOKEN_USAGE` Pi event) carrying the milestone / phase / role / tier / provider / model dimensions. The orchestration layer's [`computeTpac`](../../packages/orchestration/src/tpac-meter.ts) reduces a `MeterSnapshot` into a milestone-scoped `TpacReport` (Zod schema: [`TpacReportSchema`](../../packages/shared/src/schemas/tpac-report.ts)).

```
runtime/meter (record rows)
    ↓
MeterSnapshot
    ↓
orchestration/tpac-meter.computeTpac(snapshot, opts)
    ↓
TpacReport (validated)
    ↓ ↓ ↓
swt bench print     |     dashboard Milestones panel     |     M4 PR-32 −40% gate check
```

The aggregator is a **pure deterministic function** — no filesystem reads, no network calls. Tests use synthetic `MeterSnapshot` fixtures to exercise the math; production wiring runs after `runMilestone` (M2 PR-18) completes a cassette-driven milestone.

### M2 baseline (DEFERRED — pending recordings)

The M2 baseline measurement runs against `packages/test-utils/golden/ref-fastapi/` and requires:

1. **Recorded Anthropic cassettes** at `ref-fastapi/cassettes/*.jsonl` (M2 PR-18 deferred — user-driven recording session, Anthropic API key required).
2. **Live `session.prompt()` wiring** in the runtime — currently a no-op until **M3 PR-22** wires real Pi prompting.

Until both land, the M2 baseline row in [`.vbw-planning/v3-tracking.md`](../../.vbw-planning/v3-tracking.md)'s Metrics table is marked `DEFERRED` with a pointer to this section. The infrastructure (schema + aggregator + tests) ships at PR-19 so the measurement is a single command away once the deferrals clear.

### Methodology

Per the plan, the M2 baseline is recorded **once** against the frozen `ref-fastapi-empty` fixture. Subsequent milestones (M3 chaos, M4 cache-control, M5 multi-provider) re-measure against the SAME fixture so the deltas are apples-to-apples:

- **M2** establishes the baseline number (e.g., `M2 TPAC = 8000 tokens/criterion`).
- **M4 PR-32** wires `cache_control: ephemeral` per ADR-006 and **must demonstrate ≥ 40% reduction** vs M2. Computed as `1 - (M4_tpac / M2_tpac)`.
- **M5 PR-44** records per-provider TPAC across the 6-provider matrix. The Anthropic number must stay within ±10% of the M2 baseline (regression guard); other providers establish their own per-vendor baselines.

The `TpacReport` Zod schema is **frozen at `schema_version: 1`** for the v3.0 release window — any field-level change requires an ADR.

### Reading a TpacReport

```jsonc
{
  "schema_version": 1,
  "milestone": "M2",
  "fixture": "ref-fastapi-empty",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "tpac_input": 5500,
  "tpac_output": 3800,
  "tpac_total": 9300,
  "criteria_satisfied": 5,
  "tokens_per_criterion": 1860,
  "recorded_at": "2026-05-12T12:00:00.000Z",
}
```

- `tpac_input` + `tpac_output` are the raw sums; `tpac_total` is materialised so consumers don't re-add.
- `tokens_per_criterion` is rounded to 2 decimal places.
- `cost_usd` is OPTIONAL — M2 baseline runs ship token counts only; M4 PR-33 adds cost calculation once the per-provider rate card is wired.
- `recorded_at` is the timestamp of the report, NOT of the underlying run (the run timestamp lives in the constituent `MeterRecord` rows).

## Cache hit ratio (M4 PR-33 — preview)

> The cache hit ratio is a **secondary** efficiency metric — TPAC is the headline. Cache hits land at M4 PR-33; the M2 baseline (M2 PR-19) carries `cacheRead: 0` because `cache_control: ephemeral` is unwired until M4 PR-32.

When M4 ships, this section gains:

```
cache_hit_ratio = sum(record.cacheRead) / (sum(record.cacheRead) + sum(record.input))
```

The M4 acceptance criterion per TDD2 §13.4.3 is `cache_hit_ratio ≥ 0.70` on the Anthropic cassette replay of `ref-fastapi-empty`. The implementation lives in `runtime/src/extensions/cache-control.ts` (M4 PR-32) — a Pi Extension that injects `cache_control: ephemeral` markers at the `cacheBreakpointIndex` recorded by the M2 PR-12 [`prompt-builder`](../../packages/orchestration/src/prompt-builder.ts).

### Why the breakpoint matters

`buildPrompt` (M2 PR-12) emits 8 ordered blocks per TDD2 §8.3:

```
1. role system prompt (cacheable)
2. PROJECT.md            (cacheable)
3. REQUIREMENTS.md       (cacheable)
4. STATE.md              (cacheable)
5. phase-context         (cacheable)
6. ─── cacheBreakpointIndex ───
7. task brief            (variable per task)
8. must-haves            (variable per task)
```

Blocks 1-5 are the **stable prefix** — same content across many turns of the same milestone, eligible for Anthropic's prompt cache. Blocks 7-8 are the **variable suffix** — never cached.

The M4 PR-32 Extension hits the `cacheBreakpointIndex` (already recorded in the v3 prompt-builder at M2) with the Anthropic `cache_control: { type: 'ephemeral' }` marker. The expected impact:

| Per-turn cost          | Without cache | With cache (M4)            |
| ---------------------- | ------------- | -------------------------- |
| Stable prefix tokens   | Charged       | Charged once per ~5min TTL |
| Variable suffix tokens | Charged       | Charged                    |
| Total per turn         | ~10000        | ~3000 (after warm-up)      |

The M4 target is `tpac ≤ 0.6 × M2 tpac`, which `cache_control: ephemeral` achieves on `ref-fastapi-empty` based on the cache-hit-ratio math above.
