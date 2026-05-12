# ref-fastapi-empty

A minimal FastAPI service used as the **frozen reference fixture** for
the SWT v2 → v3 regression baseline (TDD2 §13.2.2 + §14.6).

## Core value

Demonstrates the SWT methodology end-to-end on a small Python service
that any reviewer can read in 5 minutes: requirements → roadmap →
plans → execution → QA → archive. The methodology output is the
artefact under test; the FastAPI code itself is not.

## Surface area

Two HTTP endpoints:

- `GET /health` — returns `{"status": "ok"}` for orchestration health
  checks.
- `POST /echo` — accepts `{"message": str}`, returns the same message
  back wrapped in a response envelope.

Plus:

- pytest test suite covering both endpoints (happy path + one error
  case each).
- A Dockerfile to package the service.

## Out of scope

- Persistence (no database).
- AuthN / AuthZ (the service is read-only on `/health` and idempotent
  on `/echo`).
- Multi-service deployments.
- Anything not listed in `REQUIREMENTS.md`.

## Why "empty"

The fixture name carries `-empty` because `phases/` ships as an empty
directory — the methodology populates it from `REQUIREMENTS.md`. The
"input" surface is intentionally tiny so the regression diff focuses
on methodology output (plans, summaries, QA), not on whether the
methodology can handle a complex codebase.

## Stability

This spec is **frozen** as of the M2 PR-18 baseline cutoff. Any change
requires an ADR and a baseline re-recording. See `README.md` in the
parent directory.
