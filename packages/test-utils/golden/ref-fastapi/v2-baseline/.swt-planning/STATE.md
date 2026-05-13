# STATE.md — v2.3.5 baseline placeholder

**This is a DEVN-03 placeholder.** The v2.3.5 reference run against
`../spec/` is NOT yet recorded — see the sibling `../README.md` for the
recording recipe and the FROZEN invariant.

## Provenance

- Binary: `stop-wasting-tokens@2.3.5` (intended; not yet executed)
- Recording date: PENDING
- Recording duration: PENDING
- Recording cost: PENDING

## Current Phase

`PENDING` — Phase Status pending re-record per `docs/operations/cassette-recording.md:128-144`.

## Phase Status

| Phase | Status | Notes |
|-------|--------|-------|
| 01    | PENDING | Replace with actual v2.3.5 phase data after recording |

## Activity log

PENDING

## DEVN-03 — deferred recording

Phase 5 plan 05-04 T3 committed this placeholder so the regression
test gating logic (`describe.skipIf(!existsSync(BASELINE))`) has a
stable path to probe, and so the FROZEN invariant + recording
procedure are documented in the sibling `README.md`. The actual
recording is a developer-local task that requires (a) the
`stop-wasting-tokens@2.3.5` npm package, (b) `ANTHROPIC_API_KEY`, and
(c) ~30-45 minutes of binary runtime + ~$1-$3 of Anthropic API cost.

When recording lands, this file is replaced by the v2.3.5 binary's
real `STATE.md` output (which the v2 cli wrote on every cook cycle).
The replacement is the contract; this placeholder is a sentinel only.
