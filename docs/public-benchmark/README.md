# SWT v3 public benchmark

The canonical TPAC measurement against the reference scenario, per TDD2 §3.2 + §14.9.

> **Status (M6 PR-48, 2026-05-12):** structural scaffolding shipped. Real benchmark recording is user-driven (cassette recording + cross-provider runs + npm publish gate the benchmark numbers landing on the project homepage).

## What this benchmarks

The public benchmark answers one question: **how many tokens does SWT v3 spend per passing acceptance criterion?**

| Dimension          | Reference value                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Fixture            | `ref-fastapi-empty` — a frozen 3-milestone FastAPI greenfield project (see `packages/test-utils/golden/`)   |
| Providers          | At minimum 3 of {Anthropic, OpenAI, OpenRouter, Google, Bedrock, Ollama} per ADR-011                        |
| Methodology        | v3 default (6 SDLC roles, plan-then-execute, goal-backward QA)                                              |
| Metric             | TPAC (Tokens Per Acceptance Criterion) — total input + output tokens divided by must-haves verified passing |
| Cache target       | ≥70% cache-hit ratio on Anthropic runs per M4 EXIT GATE (TDD2 §13.4.2)                                      |
| Cost target        | −50% vs M2 baseline per TDD2 §1.2 (M4 EXIT GATE)                                                            |
| Improvement target | −40% TPAC vs M2 baseline per TDD2 §1.2 (M4 EXIT GATE / PR-36 hard gate)                                     |

## How the run works

1. **Record cassettes** per provider following [`docs/operations/cassette-recording.md`](../operations/cassette-recording.md). One run per provider against the `ref-fastapi-empty` fixture; output goes to `packages/test-utils/cassettes/`.
2. **Run `swt bench --provider <p> --output .swt-planning/.tpac/<provider>.json`** for each provider. The verb replays the cassette deterministically via the cassette infrastructure (M1 PR-06) + emits a validated `TpacReport`.
3. **Run the public-benchmark script** (`pnpm public-benchmark`) to aggregate the per-provider reports into a markdown table for the homepage.
4. **Inspect the dashboard** (`swt dashboard`) — the TpacPanel renders the latest report's delta-vs-baseline badge with the green/cyan/amber/red colour-coding per M4 EXIT GATE thresholds.

## Reading the output

The script's emitted markdown table is the format that lands on the project homepage. Per ADR-011 (provider matrix on cassettes only), every number is reproducible from the committed cassettes — no per-PR CI hits real APIs.

A representative output (synthetic numbers; real recording lands at user-driven release time):

```markdown
## SWT v3 TPAC public benchmark — 2026-05-12

| Provider                          | TPAC (tokens/criterion) | Cache hit | Cost / criterion | vs M2 baseline |
| --------------------------------- | ----------------------: | --------: | ---------------: | -------------- |
| Anthropic (claude-sonnet-4-6)     |                  14,400 |       72% |           $0.087 | **−40.0%**     |
| OpenAI (gpt-5)                    |                  16,800 |       83% |           $0.124 | **−30.0%**     |
| OpenRouter (deepseek/deepseek-v3) |                  18,200 |       n/a |           $0.041 | **−24.2%**     |

Baseline: M2 (Anthropic, claude-sonnet-4-5) = 24,000 tokens/criterion, $0.145 / criterion.
```

## Recording checklist

Before publishing benchmark numbers on the homepage:

- [ ] M2 baseline cassette recorded (Anthropic, claude-sonnet-4-5)
- [ ] M2 baseline `swt bench` output committed under `.swt-planning/.tpac/m2-baseline.json`
- [ ] M4 measurement cassettes recorded for ≥3 providers
- [ ] M4 measurement `swt bench` outputs committed under `.swt-planning/.tpac/`
- [ ] `pnpm public-benchmark` runs clean + emits the aggregate markdown table
- [ ] M4 PR-36 (TPAC −40% target check) regression test activates + passes
- [ ] Homepage updated with the benchmark numbers

The full recording session is ~30-45 min per provider + ~$0.50-$1.00 per provider in API spend. Across 6 providers, budget ~3-5 hours of developer time + ~$5-$10 total.

## See also

- [TDD2 §3.2](../../TDD2.md) — `swt bench` verb specification
- [TDD2 §8.1](../../TDD2.md) — TPAC formula + `MeterRecord` shape
- [TDD2 §14.9](../../TDD2.md) — TPAC measurement protocol
- [ADR-011](../decisions/ADR-011-provider-matrix-cassettes-only.md) — cassette-only convention
- [`docs/operations/cassette-recording.md`](../operations/cassette-recording.md) — recording workflow
- [`docs/cli/verbs/bench.md`](../cli/verbs/bench.md) — `swt bench` reference
- [`scripts/public-benchmark.mjs`](../../scripts/public-benchmark.mjs) — the aggregator script
