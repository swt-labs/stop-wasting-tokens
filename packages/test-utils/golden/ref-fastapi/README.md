# `ref-fastapi-empty` — M2 regression baseline

This directory holds the **frozen reference fixture** used by the
v2 → v3 byte-identical regression test (`test/regression/ref-fastapi.regression.test.ts`)
per TDD2 §14.6 + §13.2.2.

Three subdirectories:

```
spec/         ← the frozen input — PROJECT.md + REQUIREMENTS.md + empty phases/
v2-baseline/  ← the v2.3.5 recorded .swt-planning/ tree (one-time recording)
cassettes/    ← the recorded Anthropic interactions (one per role dispatched)
```

## Why this exists

The methodology-preservation claim in TDD2 §11 ("the six-agent SDLC,
.swt-planning/ artefact schemas, phase lifecycle, must-haves,
goal-backward QA — all unchanged from v2") needs a deterministic test
to back it up. The regression suite replays a v2-recorded scenario on
the v3 runtime + dispatcher and asserts the artefacts match the v2
output byte-for-byte, modulo the small set of drift documented in
[`packages/test-utils/src/diff-artefacts.ts`](../../src/diff-artefacts.ts).

If the comparator reports zero violations on v3-foundation, the
methodology is preserved. If it reports violations, the v3 work has
drifted from the v2 contract — and the violations + the test diff are
the evidence to triage.

## The spec is FROZEN

Any change to `spec/` breaks the regression chain. The v2 baseline was
recorded against the spec as it existed at recording time; changing
the spec invalidates the baseline (and every cassette generated from
it). A spec change therefore requires:

1. An ADR documenting WHY the spec needs to change (real bug, scope
   correction, vendor API change, etc.).
2. A fresh v2.3.5 run against the updated spec to regenerate
   `v2-baseline/`.
3. A fresh cassette recording session (Anthropic API key required).
4. A note in `.vbw-planning/v3-tracking.md` recording the spec
   revision + the new baseline cutoff date.

In practice: don't touch `spec/` lightly.

## Recording the cassettes (one-time, developer-local)

See [`docs/operations/cassette-recording.md`](../../../../docs/operations/cassette-recording.md)
section "**Recording the ref-fastapi-empty cassettes for the M2
regression baseline**" for the full walkthrough.

Quick reference:

```bash
# 1. Record v2.3.5 baseline against spec/ (one-time)
npm install -g stop-wasting-tokens@2.3.5
mkdir /tmp/ref-fastapi-v2 && cp -r spec/* /tmp/ref-fastapi-v2/
cd /tmp/ref-fastapi-v2 && swt vibe   # run the full milestone end-to-end
cp -r .swt-planning packages/test-utils/golden/ref-fastapi/v2-baseline/

# 2. Record cassettes against spec/ via the v3 recorder
export ANTHROPIC_API_KEY=...
pnpm --filter @swt-labs/test-utils run record \
  --fixture packages/test-utils/golden/ref-fastapi/spec \
  --output packages/test-utils/golden/ref-fastapi/cassettes
```

Once both recordings land, `ref-fastapi.regression.test.ts` activates
automatically (its `skipIf(!HAS_CASSETTE && !HAS_BASELINE)` flips).

## Spec contents

The frozen `spec/` directory is the minimal "ref-fastapi-empty"
fixture per TDD2 §13.2.2:

- A FastAPI service with 1 health endpoint + 1 echo endpoint
- pytest tests for both endpoints
- A Dockerfile

The fixture is **input only** — no `phases/` content. The methodology
synthesises the phase plan from `REQUIREMENTS.md`; the baseline records
what v2.3.5 produces.

## Relationship to other cassettes

This cassette set is **separate** from the two cassettes deferred at
Plan 01-02 PR-06 / PR-09:

- `packages/test-utils/cassettes/scout-read-readme.jsonl` —
  small-scenario byte-identical token-count test (Plan 01-02 PR-07).
- `packages/test-utils/cassettes/scout-search-codebase.jsonl` —
  small-scenario dispatcher integration test (Plan 01-02 PR-09).

The `ref-fastapi/cassettes/` set covers a **full milestone** (Scout →
Architect → Lead → Dev × N → QA), which is a much larger recording.
