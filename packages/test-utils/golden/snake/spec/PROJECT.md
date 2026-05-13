# Snake (Python terminal game)

A minimal playable Snake game runnable as `python -m snake` (or via a venv
script). A reference fixture for the v3 "user types 'build me a snake game'
in the dashboard command bar" canary per TDD3 §22.

## Core value

The simplest end-to-end "Dev writes real source code that runs"
demonstration. This fixture exists to catch the regression which broke the
prior v3 alpha — the alpha emitted `PLAN.md` with zero tasks, and Dev wrote
no source code (REQ-12 anti-empty-`PLAN.md` canary).

## Surface area

- `snake/__main__.py` — game loop (curses-based)
- `snake/game.py` — Snake/board/food state machine (curses-free, pure
  functions)
- `tests/test_game.py` — pytest coverage of state-machine logic
- `pyproject.toml` — package metadata + pytest config

## Out of scope

- Network play, persistence, AI players, GUI frameworks, sound,
  multi-player.

## How this fixture is run

`swt cook` against this spec produces a full `.swt-planning/` tree + the
source code listed above. The canary at
`test/regression/snake-canary.test.ts` replays the recorded cassette and
asserts both the planning tree shape AND that `pytest tests/` passes
against the produced code.

## Stability

This spec is **frozen** as of the Phase 5 plan 05-03 cutoff. Any change
requires an ADR per `docs/operations/cassette-recording.md` and a fresh
cassette recording session.
