# Snake — Requirements

| ID | Requirement | Priority | Acceptance gate |
|---|---|---|---|
| REQ-01 | `python -m snake` starts a curses screen and renders a board with one snake (single-segment) + one food | P0 | `python -m snake` runs without raising on import; curses init succeeds in a TTY environment |
| REQ-02 | Arrow keys move the snake one cell per keypress; eating food grows the snake by 1 segment | P0 | `Game.step('UP')` from a state with snake at `(5,5)` and food at `(4,5)` returns a `GameState` with snake length 2 + food respawned |
| REQ-03 | Collision with wall or with own body ends the game and prints the final score | P0 | `Game.step('DOWN')` from state with snake at bottom wall returns `GameState(game_over=True, score=N)` |
| REQ-04 | `snake/game.py` exposes a pure (no-curses) state machine: `Game.step(direction: str) -> GameState` | P0 | `from snake.game import Game; g = Game(); s = g.step('UP'); assert isinstance(s, GameState)` succeeds without importing curses |
| REQ-05 | pytest covers spawn + move + grow + collision (≥4 tests, all passing) | P0 | `pytest tests/` from project root exits 0 with at least 4 `PASSED` lines (or `passed` in summary) |

## Out of scope

- Persistence, network play, AI players, GUI frameworks, sound,
  multi-player.

## Definition of done

The milestone is DONE when:

- All 5 REQs above pass their acceptance gates.
- `snake/game.py` imports cleanly without curses (REQ-04 — curses lives in
  `__main__.py` only).
- `pytest tests/` exits 0 with ≥4 tests passing (REQ-05).
- Lead's `PLAN.md` (in `.swt-planning/phases/01-*/01-01-PLAN.md`) has
  `must_haves.truths` with ≥3 entries AND ≥3 `<task>` blocks, each task
  having `<files>` + `<action>` + `<verify>` populated (REQ-12
  anti-empty-`PLAN.md`).
