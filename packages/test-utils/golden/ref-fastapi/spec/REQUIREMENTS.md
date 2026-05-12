# ref-fastapi-empty — Requirements

| ID     | Requirement                                                                                                            | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| REQ-01 | The service exposes `GET /health` returning HTTP 200 with `{"status": "ok"}`.                                          | P0       |
| REQ-02 | The service exposes `POST /echo` accepting `{"message": str}` and returning `{"echoed": str, "received_at": iso8601}`. | P0       |
| REQ-03 | `POST /echo` rejects requests without a `message` field with HTTP 400 + `{"error": "missing message"}`.                | P0       |
| REQ-04 | pytest suite covers both endpoints, with at least one happy-path test and one error-case test per endpoint.            | P0       |
| REQ-05 | The service is packaged via a Dockerfile that exposes port 8000 and runs with `uvicorn`.                               | P0       |
| REQ-06 | Code uses Python type hints throughout; mypy strict-mode passes.                                                       | P1       |
| REQ-07 | Endpoints log structured JSON to stdout on every request.                                                              | P1       |
| REQ-08 | Service starts within 2 seconds (warm) on a typical developer laptop.                                                  | P2       |

## Out of scope

- Persistence layer (in-memory only).
- Authentication / authorization.
- Rate limiting.
- Multi-tenant support.
- WebSocket / streaming endpoints.

## Acceptance

A successful milestone for this fixture means:

1. All P0 requirements have a passing test in the pytest suite.
2. The Dockerfile builds and the container starts.
3. The QA verification artefact (`{NN}-VERIFICATION.md`) reports
   `result: PASS` with `passed: N / total: N` matching the count of
   P0 requirements verified.
4. The methodology artefacts (PROJECT.md, REQUIREMENTS.md, ROADMAP.md,
   STATE.md, phase plans, summaries) match the v2.3.5 baseline byte-
   for-byte modulo the documented drift in
   `packages/test-utils/src/diff-artefacts.ts`.
