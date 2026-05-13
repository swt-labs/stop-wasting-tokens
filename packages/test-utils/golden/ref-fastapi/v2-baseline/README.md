# v2-baseline — v2.3.5 reference planning tree

This directory contains the **FROZEN** v2.3.5 reference run against
`../spec/`. It is the ground truth for the Phase 5 full-milestone
parity diff (`test/regression/ref-fastapi-milestone.test.ts`) and the
Phase G public-benchmark anchor.

## Status (Phase 5 plan 05-04 T3)

**DEVN-03 — recording deferred.** The `.swt-planning/STATE.md`
sentinel in this directory is a placeholder; the full v2.3.5 binary
output is NOT yet captured. Per plan 05-04 T3 fallback (b)
(`docs/operations/cassette-recording.md:128-144` recipe + plan
05-04 fallback policy): the regression test gates behind
`!existsSync(BASELINE)` and SKIPs cleanly until the recording lands.
Plan 05-05's PARITY-REPORT.md surfaces this as Phase G work.

## Provenance (target — fill in when recording lands)

- Binary: `stop-wasting-tokens@2.3.5` (via `npm install -g stop-wasting-tokens@2.3.5`)
- Recorded against: `packages/test-utils/golden/ref-fastapi/spec/` (FROZEN)
- Recording date: PENDING
- Recording duration: ~30-45 min (target)
- Recording cost: ~$1-$3 (target — v2.3.5 had no Anthropic prompt caching)
- Recorder: PENDING (git commit sha of the recording commit)

## FROZEN invariant

Re-recording requires an ADR per `docs/operations/cassette-recording.md`.
The v2-baseline tree IS the contract for "v3 produces methodology-
equivalent artefacts to v2"; spec changes that change the produced tree
are an intentional baseline update + ADR-worthy.

## Allowed v3 drift (vs this baseline)

Per the per-role classifier calibration in
`packages/test-utils/src/diff-artefacts.ts` `DEFAULT_CLASSIFIERS`
(Phase 5 plan 05-02):

- `STATE.md` — Levenshtein ≤100 on `## Current Phase` / `## Phase Status`
  block; ISO timestamps + activity-log dates pre-stripped.
- `phases/{NN}-*/{NN}-{MM}-PLAN.md` — task-ID-stripped fingerprint match.
- `phases/{NN}-*/{NN}-VERIFICATION.md` — EXACT match on `passed:` /
  `failed:` / `total:`.
- `phases/{NN}-*/CONCERNS.md` / `PATTERNS.md` / `CONTEXT.md` — semantic
  fingerprint (headings + URLs).
- `phases/{NN}-*/{NN}-{MM}-SUMMARY.md` — byte-exact.
- `scout-briefs/*.md` + `debug-reports/*.md` — semantic fingerprint.
- All other `.md` — byte-exact.

**Drift the v3 plan EXPLICITLY accepts:**

- Token counts + costs WILL differ between v2.3.5 and v3 (v3 has Anthropic
  prompt caching; v2.3.5 did not). The diff comparator does NOT assert
  on token counts — TPAC report comparison happens via
  `.vbw-planning/v3-tracking.md` Metrics table, not this baseline.
- Commit SHAs WILL differ. The comparator uses `git log --format=%s`
  (commit message prefix) + file-list match, NOT line-by-line diff of
  source code.

## How to record (REQUIRES the recording recipe + an ADR if updating)

```bash
# 1. Install the v2.3.5 binary globally:
npm install -g stop-wasting-tokens@2.3.5

# 2. Copy the FROZEN spec into a temp working dir:
WORK=$(mktemp -d -t ref-fastapi-v2)
cp -r packages/test-utils/golden/ref-fastapi/spec/* "$WORK/"
cd "$WORK"

# 3. Drive v2.3.5 end-to-end (30-45 min, ~$1-$3 in Anthropic cost):
export ANTHROPIC_API_KEY=sk-ant-...
swt vibe   # the v2 binary's milestone-driver verb

# 4. Copy the produced .swt-planning/ into the baseline location,
#    replacing the DEVN-03 STATE.md sentinel:
cp -r .swt-planning <REPO_ROOT>/packages/test-utils/golden/ref-fastapi/v2-baseline/

# 5. Commit (recording-only commit; do NOT bundle source changes):
cd <REPO_ROOT>
git add packages/test-utils/golden/ref-fastapi/v2-baseline/
git commit -m "chore(test-utils/golden): record v2.3.5 baseline for ref-fastapi"
```

## Codex CLI baseline — DEFERRED to Phase G

Per ROADMAP Phase 5 success criterion (line 123) and TDD3 §18 Phase G
(line 634-636): the Codex CLI baseline is NOT recorded in Phase 5. The
≥40% TPAC improvement target is REFRAMED in this plan to anchor against
THIS v2.3.5 baseline; Codex comparison is Phase G's public-benchmark
work. R5 decision is logged in `.vbw-planning/phases/05-agent-tuning-parity-testing/05-04-PLAN.md`
`<success_criteria> ## Decisions captured` and forwarded to plan 05-05's
PARITY-REPORT.md.

## v3 cassette (for the regression test) — separate artefact

The Phase 5 regression test (`test/regression/ref-fastapi-milestone.test.ts`)
needs TWO recordings to be fully operational:

1. **This v2-baseline tree** (the `.swt-planning/` produced by v2.3.5).
2. **A v3 full-milestone cassette** (`../cassettes/full-milestone.jsonl`)
   replaying the Anthropic interactions the v3 cook spawns during its
   end-to-end milestone drive.

Both are developer-local one-time recordings. Plan 05-04 T3 bundles the
recording recipe for #2 here so a single developer session captures
both. The regression test `describe.skipIf(...)` gate flips only when
BOTH artefacts are present.
