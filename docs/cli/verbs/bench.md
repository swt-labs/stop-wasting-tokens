# `swt bench`

Replay the TPAC reference scenario against recorded cassettes and emit a validated `TpacReport` per TDD2 §3.2 + §14.9.

> **Status (M3 PR-T, 2026-05-12):** live emit ready. The CLI surface, flag set, dependency chain (`@swt-labs/test-utils` → `@swt-labs/orchestration` → `@swt-labs/shared`), JSON emit path, and the real `runMilestone` → `runVibe` → `MeterSnapshot` + `criteriaSatisfied` harvest are all in place. The remaining gates are (a) user-driven Anthropic cassette recording at `packages/test-utils/cassettes/*.jsonl` and (b) pre-populating `ref-fastapi-empty` with a `ROADMAP.md` + at least one `phases/<NN>/<NN>-<MM>-PLAN.md` so `runVibe` has an executable phase. When both land, the verb emits a validated TpacReport with no further code change.

## Synopsis

```bash
swt bench [--fixture=<name>] [--provider=<name>] [--cassettes=<path>] [--output=<file>] [--milestone=<id>]
```

| Flag          | Default                      | Purpose                                                                                                   |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--fixture`   | `ref-fastapi-empty`          | Conceptual fixture name; mapped to `packages/test-utils/golden/<dir>/` via the alias table in `bench.ts`. |
| `--provider`  | `anthropic`                  | Provider label recorded in the emitted `TpacReport.provider` field.                                       |
| `--cassettes` | _(derived from `--fixture`)_ | Override the cassette directory (e.g. when comparing against a different recording).                      |
| `--output`    | _(stdout)_                   | Write the JSON `TpacReport` to a file instead of stdout. Machine-readable by default.                     |
| `--milestone` | `M2`                         | Milestone identifier recorded in `TpacReport.milestone`. Bump to `M4`, `M5`, etc. for re-measurements.    |

## What it does

`swt bench` is the user-facing wrapper on the same machinery the regression test (`test/regression/ref-fastapi.regression.test.ts`) consumes:

1. **`runMilestone`** (`@swt-labs/test-utils`) installs the cassette replay against the frozen fixture spec, copies the spec into a tmpdir, and invokes `runVibe` (from `@swt-labs/methodology`) to drive the Execute pass through the dispatcher → `runtime/createSession` → Pi loop. Returns `{ meterSnapshot, criteriaSatisfied, artefactsPath, finalState }`.
2. **`computeTpac`** (`@swt-labs/orchestration`) reduces the resulting `MeterSnapshot` + `criteriaSatisfied` into a milestone-scoped `TpacReport` (input/output tokens, criteria satisfied, `tokens_per_criterion`).
3. **`TpacReportSchema`** (`@swt-labs/shared`) validates the report at the emit boundary — same Zod contract M4 PR-32's `−40% vs M2` target check consumes.

The output JSON is `schema_version: 1` and frozen. Any field change requires a new schema version + an ADR.

## Sample output (post-activation)

```json
{
  "schema_version": 1,
  "milestone": "M2",
  "fixture": "ref-fastapi-empty",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5-20250929",
  "tpac_input": 123456,
  "tpac_output": 23456,
  "tpac_total": 146912,
  "criteria_satisfied": 8,
  "tokens_per_criterion": 18364,
  "recorded_at": "2026-05-12T19:00:00.000Z"
}
```

## Exit codes

| Code | Meaning                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| 0    | TpacReport emitted + validated (reachable from PR-T once cassettes + fixture are populated).                   |
| 1    | `EXIT.USAGE_ERROR` — `parseSwtArgv` rejected an unknown/missing flag value.                                    |
| 2    | `EXIT.NOT_IMPLEMENTED` — fixture-prep error caught (`CassetteNotRecordedError` or `NoSatisfiedCriteriaError`). |
| 3    | `EXIT.RUNTIME_ERROR` — unexpected error from the runtime/test-utils/orchestration layers.                      |

## Activation path

The handler is wired end-to-end at PR-T. Remaining gates are fixture prep, not code:

1. **User-driven cassette recording** per [`docs/operations/cassette-recording.md`](../../operations/cassette-recording.md#recording-the-ref-fastapi-empty-cassettes-for-the-m2-regression-baseline). One cassette per role dispatched during the milestone (Scout, Architect, Lead, Dev × N, QA). Requires an Anthropic API key and ~30–45 min of developer-local time.
2. **Fixture spec population.** `packages/test-utils/golden/ref-fastapi/spec/` needs a `ROADMAP.md` + at least one `phases/<NN>-{slug}/<NN>-<MM>-PLAN.md` so `runVibe` finds an executable phase to drive. `runMilestone` copies the spec into a tmpdir + drives `runVibe` against it; today the spec is empty and `runVibe` exits with no progress, producing `NoSatisfiedCriteriaError`.

The locked imports (`runMilestone`, `disposeRun`, `CassetteNotRecordedError`, `computeTpac`, `NoSatisfiedCriteriaError`, `TpacReportSchema`) at the top of `bench.ts` are the regression guards — a future change to those symbols breaks the build here, not at runtime.

## Reproducibility

The `swt bench` invocation is the canonical way to reproduce the M2 baseline numbers recorded in [`.vbw-planning/v3-tracking.md`](../../../.vbw-planning/v3-tracking.md)'s Metrics table:

```bash
# Once cassettes are recorded + the fixture spec is populated:
swt bench --fixture=ref-fastapi-empty --provider=anthropic --output=tpac-m2-baseline.json
```

The output should byte-match (modulo `recorded_at`) the JSON committed to `v3-tracking.md`. If it diverges, either the methodology drifted or the cassettes need re-recording.

## Principle 1 invariant

Per [TDD2 §4.3](../../../TDD2.md):

> Only `packages/runtime/` imports `@earendil-works/*`. The rest of the codebase consumes Pi through the runtime adapter layer.

`swt bench`'s handler imports `runMilestone` from `@swt-labs/test-utils`, which in turn imports the cassette replayer from its own module — NOT from `@earendil-works/pi-coding-agent`. A guard test in `packages/core/test/eslint-boundary.test.ts` (Plan 01-03 PR-10) enforces this at lint time.

## See also

- **TDD2 §3.2** — verb surface ownership.
- **TDD2 §8.1** — TPAC formula + `MeterRecord` shape.
- **TDD2 §14.9** — TPAC measurement protocol.
- **[`packages/cli/src/commands/bench.ts`](../../../packages/cli/src/commands/bench.ts)** — the CLI handler.
- **[`packages/orchestration/src/tpac-meter.ts`](../../../packages/orchestration/src/tpac-meter.ts)** — the milestone-scoped aggregator.
- **[`packages/shared/src/schemas/tpac-report.ts`](../../../packages/shared/src/schemas/tpac-report.ts)** — the frozen Zod schema.
- **[`docs/operations/cassette-recording.md`](../../operations/cassette-recording.md)** — cassette recording workflow.
- **[`swt rpc`](./rpc.md)** — sibling verb that uses the same runtime adapter layer.
- **Dashboard TPAC panel** (M4 PR-37) — renders the same `TpacReport` shape `swt bench --output` writes. Park reports under `<projectRoot>/.swt-planning/.tpac/*.json`; the panel reads them on connect, sorts by `recorded_at`, and renders the latest with a delta-vs-baseline badge (green at ≤ −40% = M4 EXIT GATE target hit).
