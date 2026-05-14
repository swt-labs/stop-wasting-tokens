# Rate-Card Refresh (developer-local)

Phase 2 / G-R3. The rate card at `packages/runtime/src/budget/rate-card.embedded.json` backs the upcoming `cost-optimized-rate-card` provider-router strategy (plan 02-02). It ships in the npm tarball as a snapshot — vendors revise prices periodically, so the snapshot needs occasional refresh.

The flow mirrors `docs/operations/cassette-recording.md` (the cassette-recording authoring loop). Refresh is intentionally developer-local: there is no scheduled CI job and no live network fetch at spawn time. Staleness is surfaced via telemetry (`rate_card_age_ms`, plan 02-04) so operators see when a refresh is overdue without blocking selection.

## When to run

- Quarterly maintenance.
- When a vendor announces a public pricing change (`anthropic.com/pricing`, `openai.com/pricing`, `cloud.google.com/vertex-ai/pricing`, `openrouter.ai/models`).
- Before assembling release notes that quote per-model costs.

## Prerequisites

- Node.js ≥ 18 (the script uses global `fetch`).
- No API key required — OpenRouter's `/api/v1/models` endpoint is public.
- For non-OpenRouter slices: open each provider's pricing page in a browser tab so you can paste current per-1k values when the script prompts.

## Run

Interactive (default — prompts for anthropic / openai / google entries):

```bash
node scripts/refresh-rate-card.mjs
```

Non-interactive (OpenRouter only; manual-paste slices stay unchanged):

```bash
node scripts/refresh-rate-card.mjs --non-interactive
```

## Verify the diff

```bash
git diff packages/runtime/src/budget/rate-card.embedded.json
```

Spot-check the changes:

- `generated_at` updated to the current timestamp.
- Touched entries' `updated_at` advanced to now.
- Per-1k values in the right ballpark — e.g., Anthropic Claude Opus ≈ `$0.015` input / `$0.075` output as of 2026-05-14; OpenRouter pricing matches the upstream model card.
- Optional cache fields (`cache_read_per_1k`, `cache_write_per_1k`) preserved for Anthropic entries; absent for the rest.

## Maintenance cadence

| Provider | Programmatic source | Cadence |
| --- | --- | --- |
| openrouter | Yes — `openrouter.ai/api/v1/models` | Each script run |
| anthropic | No (manual paste) | Quarterly or on announcement |
| openai | No (manual paste) | Quarterly or on announcement |
| google | No (manual paste) | Quarterly or on announcement |
| bedrock | Not yet supported (deferred to G-T1) | — |

## Cross-references

- Schema: `packages/shared/src/types/rate-card.ts` — `RateCardSchema` + per-entry `RateCardEntrySchema`.
- Loader: `packages/runtime/src/budget/rate-card-source.ts` — `createRateCardSource` (resolution order: explicit `opts.path` > `<cwd>/.swt-planning/rate-card.json` > embedded snapshot).
- Tests: `packages/runtime/test/budget/rate-card-source.test.ts`.
- Phase research: `.vbw-planning/phases/02-provider-router-strategy-extensions/02-RESEARCH.md` §2.
- Architect decisions: R1 (refresh strategy) — embedded + developer-local script accepted; live fetch deferred. Recorded in `.vbw-planning/phases/02-provider-router-strategy-extensions/02-OVERVIEW.md`.
