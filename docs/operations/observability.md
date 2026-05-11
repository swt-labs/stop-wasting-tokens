# Operations — Observability

> **Status:** stub — expanded as telemetry rolls out per milestone.
>
> **Canonical reference:** [`TDD2.md` §16](../../TDD2.md).
> **Implementing package:** [`packages/telemetry/`](../../packages/telemetry/).

SWT's telemetry is **opt-in, aggregate-only** (per Principle 4 — never carries prompt content or raw model output). Operators enable it via `.swt-planning/config.json` `telemetry.enabled = true` + their anonymous ID. The telemetry package maintains a strict event registry; events not in the registry are rejected at emit time.

## M1 event registry (PR-07)

| Event | Payload keys (aggregate dimensions only) | Source |
| :--- | :--- | :--- |
| `swt.m1.meter.updated` | milestone, phase, role, provider, input_total, output_total, cache_read_total, cache_write_total, cost_usd_total | `createTokenMeter` snapshot rollup |
| `swt.m1.cassette.replay_started` | cassette_id | cassette replayer hook |
| `swt.m1.cassette.replay_complete` | cassette_id, delta_tokens, passed | cassette replayer post-assertion |
| `swt.m1.task_result.parsed` | task_id, ok | `harvestTaskResult` post-validation |

## Carriers + sinks

| Layer | What it does |
| :--- | :--- |
| `runtime/src/meter/` | Records `MeterRecord` rows; emits `METER_UPDATED` to subscribers. |
| `runtime/src/extensions/journal.ts` | Mirrors `SwtEvent`s into `<cwd>/.swt-planning/journal/<UTC-day>.jsonl` (M3 crash recovery). |
| `telemetry/src/sender.ts` | Buffers + ships aggregate events to the operator-configured endpoint (opt-in). |
| `telemetry/src/sanitize.ts` | Strips any field not in the event's `ALLOWED_KEYS` (defence-in-depth — payloads can't accidentally carry sensitive data). |

This page expands as M2 (agent timeline events), M3 (worktree + chaos events), and M4 (cache + budget events) ship.
