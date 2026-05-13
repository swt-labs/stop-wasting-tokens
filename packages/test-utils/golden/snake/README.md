# `golden/snake` — Snake-game canary fixture

The reference fixture for the **REQ-12 "anti-empty-`PLAN.md`" canary**
(TDD3 §22). It catches the regression which broke the prior v3 alpha — the
alpha emitted `PLAN.md` with zero tasks and Dev wrote no source code.

## Layout

```
golden/snake/
├── README.md            ← this file
├── spec/                ← FROZEN input (do not edit)
│   ├── PROJECT.md       ← "Build a playable terminal snake game in Python"
│   └── REQUIREMENTS.md  ← 5 P0 must-haves driving Lead's PLAN + QA's VERIFICATION
└── cassettes/           ← Anthropic cassettes for the full milestone
    └── milestone.jsonl  ← Recorded one-time; ~$2-$5 + 30-60 min
```

## Recording recipe

```bash
export ANTHROPIC_API_KEY=sk-ant-...
pnpm record -- --scenario=snake-milestone \
  --provider=anthropic --model=claude-sonnet-4-5
```

Expected cost: $2-$5. Expected duration: 30-60 minutes. The recorded
cassette covers all LLM round-trips for the full milestone (scope →
discuss → plan → execute → verify → archive).

Per Phase 5 plan 05-01 DEVN-02, the cassette committed at the time of
Phase 5 plan 05-03 cutoff is **synthetic** (recorded against a local
Anthropic-shaped SSE fixture, not the real API) — it MUST be re-recorded
against the real Anthropic API before Phase 5 closes. See the scenario
module docstring at
`scripts/record-cassette-scenarios/snake-milestone.mjs` and
`docs/operations/cassette-recording.md` for the re-record procedure.

## FROZEN invariant

The `spec/` tree is **frozen**. Re-recording the cassette requires an ADR
per `docs/operations/cassette-recording.md` — the canary's value comes
from its deterministic input → output contract; spec drift breaks that
contract.

## What the canary asserts

See `test/regression/snake-canary.test.ts` for the full assertion list.
Headline:

- `PLAN.md` exists with `must_haves.truths.length >= 3` AND ≥3 `<task>`
  blocks (anti-empty-`PLAN.md` per REQ-12).
- Each task has populated `<files>`, `<action>`, `<verify>` blocks.
- Lead's `PLAN.md` declares `skills_used: [python-testing-patterns]`.
- Dev wrote `snake/__main__.py` + `snake/game.py` + `tests/test_game.py`.
- `from snake.game import Game` resolves AND `Game.step` is callable
  (REQ-04 — curses-free state machine).
- `pytest tests/` exits 0 (REQ-05 — ≥4 passing tests).

## Cost discipline

Per `docs/operations/cassette-recording.md:97-99` — ≤$1 per cassette. The
snake milestone fits within ~5 small cassettes (one per role × ~$0.10-
$0.30), well under the $5 ceiling.
