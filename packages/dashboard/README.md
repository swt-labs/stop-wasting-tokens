# @swt-labs/dashboard

The SWT dashboard is the primary user surface for v3 (TDD3 §15). Every project lifecycle action — start a cook run, watch agents live, respond to confirmation prompts, walk a UAT checkpoint loop, drill into a phase artifact, inspect cost and token telemetry — is reachable here without touching a terminal.

## First-run flow

Type `swt` in a project directory:

1. The dashboard auto-launches at <http://127.0.0.1:54321/> and opens your browser. Bare `swt` is an alias for `swt dashboard`; CLI verbs (`swt cook`, `swt qa`, `swt status`, ...) remain available for power users and scripts but are not the default invocation.
2. If the project has not been initialised yet, the dashboard's `InitScreen` guides you through `swt init` interactively. A terminal-side `swt init` is also detected automatically (greenfield watcher on `cwd/.swt-planning/`).
3. Once initialised, you see five panes laid out in a 5-column grid:
   - **Project state** (col 5, top) — milestone progress, todos, blockers, active profile.
   - **Phases** (col 1) — every phase with status icons; click a phase to drill into its plans and artifacts.
   - **Active agents** (col 4, top) — live table of running agents, current tool call, tokens consumed, cost so far. Includes per-agent **Pause / Resume / Cancel** buttons (action lands at the next inter-agent boundary; mid-Pi-turn pause is Phase 6 scope).
   - **Cost + tokens** (col 4, bottom) — per-session, per-phase, per-milestone cost; cache hit ratio; per-provider breakdown.
   - **Artifact viewer** (col 3) — markdown preview with a **History** tab and per-commit diff sub-pane.
4. Click **Start Cook** (in the Active Agents pane) to begin a new orchestrator run. The dashboard spawns `swt cook` as a detached subprocess and streams its events live. The same handler answers `POST /api/cook/start` so scripts can drive the same flow from outside the browser.
5. When the orchestrator needs your decision — a confirmation prompt, a UAT checkpoint, an architect risk requiring ratification — a card appears in the prompts panel. Respond inline; the result flows back to the orchestrator via the askUser IPC contract (Phase 1 01-05).
6. Run `swt verify` from the command bar (⌘K) to walk a phase's `*-UAT.md` checkpoints with inline UAT cards. Each PASS/FAIL appends a `### P{NN}-T{NN}` block to the phase's UAT.md.

## Architecture quick-reference

- **Event channel** (file-tail): `.swt-planning/.events/*.jsonl` (R1). The dashboard uses a file-tail event channel rather than a Unix-domain socket — the `events-tailer.ts` chokidar watch was already shipping for Phase 1 prompt events, so the cook IPC reuses the same plumbing. The cook orchestrator appends one JSON line per event (priority decisions, agent spawn, agent result, tool calls, askUser bridges, log lines, completion); the dashboard's `events-tailer.ts` watches the directory via chokidar and republishes each event on the in-process EventBus that `/api/events` SSE clients subscribe to.
- **Control channel:** REST + signal files. `POST /api/cook/:sessionId/control { action: "pause" | "resume" | "cancel" }` writes `.swt-planning/.cook-controls/{sessionId}.pending` with literal action text; cook polls the file at each agent boundary, consumes the signal (read-then-unlink), and dispatches the next mode accordingly.
- **askUser channel:** `POST /api/prompts/publish` (orchestrator → dashboard) + `POST /api/prompts/:id/respond` (dashboard → orchestrator). Both publish onto the EventBus so SSE listeners see the round-trip. `GET /api/prompts/pending` lets a reconnecting dashboard redraw unresolved cards.
- **Cost telemetry:** `token-meter` writes `.swt-planning/.metrics/{session,phase}-*.json` after each agent result; the reducer reads on snapshot rebuild; the statusline reads the same files for L3.
- **Pause semantics:** Pause and resume defer to the next inter-agent boundary (R2; Pi 0.74 lacks mid-turn pause). Cancel propagates as SIGTERM at the next boundary.
- **Snapshot rebuild:** `chokidar` watches `.swt-planning/` (phases, state, metrics, sessions); each change rebuilds the snapshot and publishes a `snapshot.changed` event. SSE clients receive an initial `snapshot.replace` frame on connect for state hydration.

## Routes inventory

API routes registered by the daemon:

| Route                               | Purpose                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/health`                   | Liveness ping with started-at timestamp                                                       |
| `GET /api/events`                   | SSE stream (snapshot deltas + cook events + prompt events)                                    |
| `GET /api/snapshot`                 | Current snapshot (used on initial mount + reconnect)                                          |
| `POST /api/init`                    | Run `swt init` from the InitScreen flow                                                       |
| `POST /api/command`                 | Execute an allowed `swt <verb>` from the TopBar command bar                                   |
| `GET /api/commands`                 | List of allowed verbs                                                                         |
| `POST /api/cook/start`              | Spawn a new `swt cook` session (detached)                                                     |
| `POST /api/cook/:sessionId/control` | Write a pending signal (pause/resume/cancel)                                                  |
| `POST /api/prompts/publish`         | Orchestrator publishes a `prompt.request`                                                     |
| `POST /api/prompts/:id/respond`     | SPA submits a `prompt.response`                                                               |
| `GET /api/prompts/pending`          | Replay unresolved prompts on reconnect                                                        |
| `POST /api/uat/:phase/checkpoint`   | Append a `### P{NN}-T{NN}` block to the phase's UAT.md                                        |
| `GET /api/artifact`                 | Render a `.swt-planning/` markdown artifact (HTML or raw)                                     |
| `GET /api/artifact-history`         | Git history for an artifact path                                                              |
| `GET /api/artifact-diff`            | Diff an artifact against a specific commit                                                    |
| `GET /api/budget/sse`               | Budget gate SSE stream (Phase 5 wires the live meter)                                         |
| `GET /api/cache-hits/sse`           | Anthropic cache-hit ratio from `.metrics/`                                                    |
| `GET /api/provider-cost/sse`        | Per-provider cost panel (Phase 5 wires the live meter)                                        |
| `GET /api/tpac`                     | TPAC report history (Phase 5)                                                                 |
| `GET /api/worktrees/sse`            | Parallel-task worktree status                                                                 |
| `GET /api/doctor`                   | Prereq + version checks                                                                       |
| `GET /api/detect-phase`             | Phase auto-detection JSON                                                                     |
| `GET /api/config`                   | Read/write `config.json`                                                                      |
| `GET /api/update`                   | npm-registry version check                                                                    |
| `POST /api/vibe`                    | **LEGACY shim** — re-dispatches to `/api/cook/start` for v2-client compat. Removed in v3.1.0. |

## Limitations (Phase 4 scope)

- The dashboard binds `127.0.0.1` only — there is no token auth. Run on a single-user machine. Multi-user-laptop and cross-network access are Phase 6 hardening scope (R4 deferred).
- Cost-per-spawn requires Pi's `usage.cost_usd` field; when absent, the dashboard shows `$0.00` until Phase 5 plumbs model-profile rate cards from `config/model-profiles.json`.
- `POST /api/vibe` exists as a legacy shim onto `POST /api/cook/start`. New clients should use `/api/cook/start` directly. The shim ships for one release cycle (v3.0.0-alpha.x) and is removed in v3.1.0 per the Phase 6 hand-off in `.vbw-planning/phases/04-dashboard-statusline/PARITY-REPORT.md`.
- Mid-Pi-turn pause is unsupported; pause/cancel ship at next-boundary granularity (R2). True checkpoint-resume requires Phase 6 REQ-11 crash-recovery primitives.

## Developer notes

Dev server:

```bash
# In one terminal — Vite dev server for the Solid SPA at http://127.0.0.1:5173
pnpm --filter @swt-labs/dashboard dev
```

Build:

```bash
# Build SPA assets into packages/dashboard/dist/client + the daemon bundle into dist/
pnpm build
```

Tests:

```bash
# Workspace-wide vitest run (the dashboard's tests live in packages/dashboard/test/)
pnpm test
# Or a targeted subset
npx vitest run packages/dashboard/test/e2e-cook-smoke.test.ts
```

Hermeticity: e2e smoke tests use per-test temp `.swt-planning/` directories, fake spawn for cook subprocesses (the cook CLI binary is not a hard test prereq), real EventBus, real chokidar tailer, real signal-file protocol. See `packages/dashboard/test/e2e-{cook,askuser,uat}-smoke.test.ts`.

## See also

- TDD3 §15 (dashboard as primary surface), §16 (statusline 4-line layout), §24 (UAT checkpoint design)
- `packages/cli/src/commands/cook.ts` — orchestrator entry point that emits the `cook.*` event stream
- `packages/methodology/src/state/cook-events-publisher.sh` — file-tail wire format
- `packages/methodology/src/state/cook-controls.ts` — signal-file protocol
- `packages/methodology/src/state/token-meter.ts` — `.metrics/` aggregator
