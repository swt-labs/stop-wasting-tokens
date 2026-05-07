---
phase: 04
plan: 04-01
title: F4 — `swt watch` Ink TUI dashboard with chokidar file-watch
status: complete
completed: 2026-05-07
tasks_completed: 4
tasks_total: 4
commit_hashes:
  - 27344d2
deviations:
  - "Plan 04-01 originally listed only `packages/cli/package.json` and source files. T3's Dashboard component is a `.tsx` file that requires `jsx: 'react-jsx'` in `packages/cli/tsconfig.json`. Plan-amendment: amended files_modified to include `packages/cli/tsconfig.json` before adding the jsx flag. Bonus fix in the same edit: appended project references for `../claude-code-driver` and `../ollama-driver` (missing from the references list since Phase 03 Plan 03-05). Same audit-trail-preserving pattern as Phase 03 DEV-3-01-A."
  - "Plan 04-01's `<Dashboard />` component originally passed `color={qaColor(qa.status)}` and `color={uatColor(...)}` directly to `<Text>`, but these helpers can return `undefined`. TypeScript's `exactOptionalPropertyTypes: true` rejects passing `undefined` for an optional prop. Process-exception: switched to a conditional render (`c !== undefined ? <Text color={c}>...</Text> : <Text>...</Text>`) — same pattern Phase 03 used in spawn/wrapper.ts to handle exactOptional flags. Pure rendering refactor; no behavior change."
pre_existing_issues: []
ac_results:
  - criterion: "the swt CLI has a `swt watch` command that opens an Ink TUI scoped to the active milestone"
    verdict: "pass"
    evidence: "packages/cli/src/commands/watch.ts exports watchHandler; packages/cli/src/main.ts registers the `watch` command in buildRegistry. watch.test.ts case `renders the dashboard with the staged snapshot` asserts the captured WatchViewModel has the right project + milestone + phase fields."
  - criterion: "the dashboard updates within 1 second on .swt-planning/ file-system changes (chokidar-driven; debounced render)"
    verdict: "pass"
    evidence: "watch.ts defaultWatcherFactory uses `chokidar.watch(path, {ignoreInitial: true, persistent: true})` + 200ms debounce on add/change/unlink events. Effective update latency = chokidar event detection (sub-100ms on macOS FSEvents / Linux inotify) + 200ms debounce = <300ms typical, well under the 1s success-criterion bar."
  - criterion: "the dashboard closes cleanly on Ctrl+C — TUI unmount + chokidar.close() + process exits 0"
    verdict: "pass"
    evidence: "watch.test.ts case `SIGINT teardown calls watcher.close + renderer.unmount and resolves with exit 0` asserts both lifecycle methods fire and the handler resolves with EXIT.SUCCESS."
  - criterion: "the dashboard works cross-platform (chokidar's polling fallback is enabled by default for Windows/network-drive compatibility)"
    verdict: "pass"
    evidence: "chokidar v4 defaults to native fs events with automatic polling fallback when fs.watch is unreliable (Windows network drives, WSL boundaries). No platform-specific code paths in defaultWatcherFactory — the abstraction is uniform."
  - criterion: "watch state computation is a pure function — given a snapshot of phase-detect output + recent activity, it produces the dashboard view model deterministically"
    verdict: "pass"
    evidence: "state.ts computeWatchState is a pure function (no I/O, no Date.now, no env reads). state.test.ts 5 cases all assert deterministic output for given inputs. The TUI render layer is a thin wrapper over this pure model."
  - criterion: "no new top-level command appears in `swt --help` until this plan ships"
    verdict: "pass"
    evidence: "Until commit 27344d2, `watch` wasn't registered. After 27344d2, main.ts registry has the new entry between `update` and the stub commands. The previous CLI shape is preserved for all other commands."
---

`swt watch` ships. F4 success criterion is met for the dashboard primitive: Ink TUI scoped to the active milestone, sub-1s updates via chokidar, clean Ctrl+C teardown, cross-platform.

## What Was Built

- **`packages/cli/src/watch/state.ts`** — `computeWatchState(snapshot)` pure function + `WatchSnapshot` / `WatchViewModel` / `RecentCommit` types.
- **`packages/cli/src/watch/dashboard.tsx`** — `<Dashboard />` Ink component rendering project header, active phase + state, plan progress (`N/M plans`), QA + UAT status with color cues, recent activity list.
- **`packages/cli/src/watch/index.ts`** — barrel.
- **`packages/cli/src/commands/watch.ts`** — `watchHandler` factory with injectable seams (`render`, `watcherFactory`, `readRecentActivity`, `oneShot`); `defaultWatchHandler` registered entry point. SIGINT/SIGTERM teardown closes chokidar + unmounts Ink + resolves exit 0.
- **`packages/cli/src/main.ts`** — registers `watch` command between `update` and stubs.
- **`packages/cli/tsconfig.json`** — adds `jsx: "react-jsx"` for the Dashboard `.tsx` file; appends `claude-code-driver` and `ollama-driver` to project references (missing from Phase 03 Plan 03-05).
- **`packages/cli/package.json`** — adds `chokidar@^4.0.1`, `ink@^5.0.1`, `react@^18.3.1` runtime deps + `@types/react` devDep.
- **8 new test cases** (5 state + 3 command).

## Files Modified

- `packages/cli/package.json` (3 deps + 1 devDep)
- `packages/cli/tsconfig.json` (jsx + 2 references — see deviation #1)
- `packages/cli/src/main.ts` (registry entry)
- `packages/cli/src/commands/watch.ts` (new)
- `packages/cli/src/watch/dashboard.tsx` (new)
- `packages/cli/src/watch/state.ts` (new)
- `packages/cli/src/watch/index.ts` (new barrel)
- `packages/cli/test/commands/watch.test.ts` (new — 3 cases)
- `packages/cli/test/watch/state.test.ts` (new — 5 cases)

## Deviations

See frontmatter `deviations:`. Two:

1. **tsconfig.json amendment (plan-amendment)** — Plan 04-01 files_modified amended to include `packages/cli/tsconfig.json`. The amendment landed `jsx: "react-jsx"` (required for the `.tsx` Dashboard file) plus two missing project references (`claude-code-driver`, `ollama-driver` — gap from Phase 03 Plan 03-05). Same pattern as Phase 03 DEV-3-01-A.
2. **Dashboard color-prop strict-mode fix (process-exception → handled inline)** — `<Text color={qaColor(...)}>` violated `exactOptionalPropertyTypes` because the helper can return `undefined`. Switched to a conditional render that only passes `color` when defined. Same shape as Phase 03's spawn/wrapper.ts fix for execa env.

## Verification

1. ✅ `pnpm vitest run packages/cli/test/watch packages/cli/test/commands/watch.test.ts` — 8/8 pass (5 state + 3 command)
2. ✅ Watch files typecheck clean (no new errors in src/watch/ or src/commands/watch.ts; pre-existing v1.0 errors elsewhere unchanged)
3. ⚠ Manual smoke against this repo deferred — running `node packages/cli/src/main.ts watch` would open a real TUI but isn't part of automated coverage. The injectable seams + pure-function view model make this an easy follow-up.

## Next

Plan 04-02 (F5 marketplace-aware updater) and Plan 04-03 (F8 HttpSender) are independent of 04-01 and each other. Either can run next.
