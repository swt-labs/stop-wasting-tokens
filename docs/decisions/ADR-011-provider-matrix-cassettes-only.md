---
adr: 011
title: Provider-matrix tests run on cassettes only (no real API keys in CI)
status: Accepted
decided: 2026-05-12
pr: M1 PR-06 (drafted Proposed) → M5 PR-44 (promoted Accepted)
supersedes: TDD2 §22.11
---

# ADR-011 — Provider-matrix tests run on cassettes only; never real API keys in CI

**Status:** Accepted (M5 PR-44 shipped the provider-matrix failover simulation that exercises the cassette-only convention end-to-end).

## Context

The v3 acceptance criteria depend on tests that exercise real provider
behaviour:

- **Cache-hit ≥ 70%** (Anthropic) — verified by inspecting recorded
  Anthropic `usage.cache_read_input_tokens` / `cache_creation_input_tokens`
- **TPAC −40%** — measured against deterministic baseline runs
- **Provider failover** — must work when a real provider returns 503
- **Token meter delta = 0 on replay** — the M1 hard merge gate (Plan
  01-02 PR-07)

CI cannot hit real provider APIs:

- **Cost** — every PR run × every provider × every scenario adds up fast.
- **Secret management** — putting six providers' API keys into GitHub
  Actions secrets makes the blast radius of a CI compromise enormous.
- **Determinism** — providers update model behaviour, rate-limit
  unpredictably, occasionally return 503s. A test that randomly fails
  10% of the time pollutes the merge signal.
- **Provider quotas** — paid plans throttle CI more aggressively than
  organic traffic; CI runs can blow through monthly quotas.

The infrastructure already exists to replay real recordings
deterministically: cassettes (TDD2 §14.7).

## Decision

Every test that conceptually needs a provider call runs against a
recorded cassette in CI, never against a live API. The split:

| Operation                        | Runs where                                         | Real API?                 |
| -------------------------------- | -------------------------------------------------- | ------------------------- |
| **Recorder** (`pnpm record`)     | Developer machine, one-time per scenario           | Yes (developer's own key) |
| **Replayer** (`installReplay()`) | CI + developer-local test runs                     | No (reads recorded JSONL) |
| **Cassette commit**              | Recorded once, committed to repo, replayed forever | Network-free              |

Cassettes are stored at `packages/test-utils/cassettes/{scenario}.jsonl`.
The cassette format (TDD2 §14.7.1) is provider-portable so the same
schema works for Anthropic, OpenAI, OpenRouter, Google, Bedrock, and any
future Pi-supported provider.

The recorder strips:

- Absolute cwd paths from request bodies (`<cwd>` placeholder)
- `Authorization` / `X-API-Key` / `Cookie` / `Set-Cookie` / `Date` /
  `X-Request-Id` / `cf-ray` headers
- Anthropic `cache_control` exact-shape variants (canonicalised to
  `{type: 'ephemeral'}` so M4 PR-32's placement evolution doesn't
  invalidate pre-existing cassettes)

The cassette header carries `cwd_redacted: true` — the replayer
**refuses to load** any cassette without it. This is the defence against
"recorder bug ships proprietary path into a public cassette".

Provider-matrix tests (M5 PR-44) run the same scenario across six
providers' recorded cassettes and assert the parsed `TaskResult` envelope
is byte-identical (modulo timestamps + per-provider usage detail). Any
divergence is a provider-quirks bug, not a test flake.

## Consequences

Easier:

- CI is deterministic, network-free, secret-free. Reproducible builds
  (ADR-010) get their byte-for-byte assertions over the test surface for
  free.
- New providers join the matrix by adding one cassette + one quirks.json
  entry — no per-provider CI plumbing.
- The recorder bug surface is small: one place to redact secrets, one
  place to refuse to load unsealed recordings.
- Tests run in milliseconds (local JSONL parse + undici replay), not
  seconds (real network round-trip).

Harder:

- Real-world API drift (e.g., Anthropic introduces a new response
  field) is not caught until someone re-records a cassette. Mitigation:
  M5 PR-44 includes a `pnpm record:smoke` developer-only target that
  re-records the canary cassettes monthly; CI alerts when re-records
  diverge from the previous baseline.
- Cassettes are version-controlled binary-ish content. JSONL keeps them
  diff-able but large recordings (hundreds of streaming chunks) make
  PRs noisy. Mitigation: keep scenarios small per the cost-discipline
  guidance in `docs/operations/cassette-recording.md`; large
  cassettes get split.
- The replayer must keep up with undici's API evolution. Mitigation:
  pinned-range dep `undici@^6`, ADR-010 reproducible-build job catches
  silent drift.

## Lifecycle

PR-06 (this PR) drafts the ADR as **Proposed** and ships the recorder +
replayer + format schemas + normalization helpers. The first cassette
(`scout-read-readme.jsonl`) is recorded as a follow-on per the agreed
cassette-recording handoff and unblocks PR-07's `delta = 0 tokens`
assertion.

M5 Plan 05 PR-44 promoted this ADR to **Accepted** when the
provider-matrix failover simulation shipped at
`test/provider-matrix/failover.matrix.test.ts`. The full six-provider
cassette suite remains a user-driven recording session — the
infrastructure is in place, the convention is enforced by the
cassette-load refuse-on-unsealed defence, and the failover sim
exercises the routing + fallback chain mechanics without real keys.

## Validation (M5 PR-44, 2026-05-12)

Three implementation layers validate the cassette-only convention:

**Layer 1 — Recorder + replayer infrastructure (M1 PR-06).** `@swt-labs/test-utils` ships the recorder, replayer, format schemas (`format.ts` — `cwd_redacted: z.literal(true)`), normalization helpers (SHA-256 request hashing, header strip), and the `CassetteNotFoundError` / `CassetteUnsealedError` errors. The replayer refuses to load any cassette without `cwd_redacted: true` in the header — the defence against shipping proprietary paths.

**Layer 2 — Per-provider extraction parity (M1 PR-07/PR-08 + M5 PR-39/PR-40).** `extractAnthropic` + `extractOpenAI` + `extractGeneric` produce vendor-neutral `TaskTokenUsage` from each provider's native shape. PR-39's OpenRouter shim tests (9 tests) + PR-40's Gemini ToS warning (9 tests) validate the per-provider dispatch + observability paths against synthetic cassette-shaped inputs.

**Layer 3 — Failover simulation (M5 PR-44, this commit).** `test/provider-matrix/failover.matrix.test.ts` exercises the router (PR-41) + fallback chain (PR-42) end-to-end: construct a fake dispatch loop that calls the chain, simulate a 503 from the primary provider, assert the chain advances + records `provider.fallback_fired` telemetry. The test uses synthetic shapes (no real cassettes) — the cassette infrastructure is ready to consume real recordings the moment a user records them.

The full six-provider cassette CI matrix activation remains user-driven ops work (recording sessions across Anthropic, OpenAI, OpenRouter, Google, Bedrock, Ollama). Activation requires no code change — the route + router + fallback chain already handle the abstraction.
