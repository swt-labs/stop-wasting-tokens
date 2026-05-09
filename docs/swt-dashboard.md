# `swt dashboard`

Localhost web dashboard for the SWT (stop-wasting-tokens) CLI. Renders live project state — phases, plans, summaries, agent timeline, log stream, cost rollups — and lets you record UAT CHECKPOINTs from the browser. Aspirationally documented at `docs.stopwastingtokens.dev/swt-dashboard` (coming soon).

## Quick start

```bash
swt dashboard            # boots the daemon on a free port (54320–54420), opens your browser
swt dashboard --port 8080
swt dashboard --no-open  # skip auto-open (CI / SSH / tmux)
swt dashboard --debug    # run from source via tsx, inherit stdio (development)
```

The daemon prints its address to stderr and exits gracefully on `Ctrl+C` (SIGINT). The default port is OS-assigned within `54320–54420`; if every port in that range is busy, an OS-assigned port is used (loopback-only).

## Flags

| Flag              | Default     | Notes                                                                                            |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `--port N`        | auto        | Bind to a specific port instead of the auto-pick                                                 |
| `--host H`        | `127.0.0.1` | Override the bind host. Non-loopback hosts are rejected unless `--unsafe-public` is passed       |
| `--unsafe-public` | off         | Allow non-loopback bind. **Don't** unless you understand the network/security implications       |
| `--no-open`       | false       | Skip auto-launching the browser (useful for CI, SSH, tmux)                                       |
| `--debug`         | false       | Run the daemon directly from `packages/dashboard/src/server/main.ts` via `tsx`, inheriting stdio |

Environment overrides (mirrored by the CLI's flag parsing):

| Variable                        | Effect                    |
| ------------------------------- | ------------------------- |
| `SWT_DASHBOARD_PORT`            | Same as `--port`          |
| `SWT_DASHBOARD_HOST`            | Same as `--host`          |
| `SWT_DASHBOARD_UNSAFE_PUBLIC=1` | Same as `--unsafe-public` |

## Localhost-only by default (AC-14)

The daemon refuses to bind to any host other than `127.0.0.1`, `localhost`, or `::1` unless `--unsafe-public` (or `SWT_DASHBOARD_UNSAFE_PUBLIC=1`) is set. This guard is enforced both in the CLI command and in the server boot path (defence-in-depth). There is no token, basic auth, or TLS — the security boundary is the loopback interface itself.

## Auto-open behaviour (AC-01)

By default, the dashboard launches your default browser via the [`open`](https://www.npmjs.com/package/open) package once the daemon prints its ready line. Opt out with `--no-open`. Auto-open is also disabled automatically when `process.env.CI=1` or stdout is not a TTY.

If the auto-open fails (no display, missing `xdg-open`, etc.), the CLI logs `auto-open failed` and continues — the URL is always printed so you can paste it manually.

## Offline guarantee (AC-11)

The SPA bundle ships with zero third-party CDN references. Fonts use the OS stack (`Inter`, `Fira Code`, `JetBrains Mono`) and fall back to system fallback families if the user does not have them installed. Syntax highlighting (`@shikijs/rehype`) runs on the daemon side and the browser only receives the rendered HTML. Run `node scripts/check-offline.mjs` against the built SPA to verify; the script greps for known CDN hosts and exits non-zero if any are present.

## Size budgets (AC-10)

| Artifact                                  | Budget                  | Where  |
| ----------------------------------------- | ----------------------- | ------ |
| `packages/dashboard/dist/client/assets/*` | ≤ 80 KB gzipped (total) | SPA    |
| `packages/dashboard/dist/server/*`        | ≤ 200 KB raw (total)    | Daemon |

Verify locally with:

```bash
pnpm --filter @swt-labs/dashboard build
node scripts/check-bundle-size.mjs
```

The script prints a per-file table and exits 1 on any budget violation.

## Accessibility (AC-12, AC-13)

The dashboard uses semantic HTML throughout: `<nav role="tree">` for the artifact tree, `<button>` (not `<div>` with click) for every interactive element, `aria-current="step"` on the active phase, `aria-live="polite"` on the agent timeline, and `aria-label` on each panel. Tab order is predictable: TopBar → PhaseStepper → ArtifactTree → ArtifactPreview → AgentTimeline → CostPanel. There are no focus traps.

Reduced-motion users get static cards instead of the running-agent pulse animation (the `@keyframes pulse` rule is gated behind `@media (prefers-reduced-motion: reduce)`). All BRANDKIT colors meet WCAG AA contrast against the deep-void background — see `non_production_files/UI/BRANDKIT.md` for the canonical token table.

Manual verification of these contracts is part of the per-phase UAT script (P04-T05). An automated `axe-cli` CI gate is on the roadmap for v1.6.1.

## Live performance polish

- **Log channel rate limit (server-side):** the SSE `log.append` channel is rate-limited to 100 lines/sec. Excess lines are dropped silently and a periodic `[swt] N log lines dropped due to rate limit` notice is emitted to keep the user informed without flooding the channel.
- **Long-artifact virtualization (client-side):** `ArtifactPreview` renders the first 500 paragraphs of any rendered artifact by default. A `Show paragraphs 501–N of M` button appears at the bottom for longer artifacts and pages in another 500 paragraphs per click. This keeps the DOM responsive even when previewing the longest summaries.

## Common troubleshooting

- **Port conflict:** all ports in `54320–54420` are in use → OS-assigned fallback runs automatically. Check the printed address.
- **Browser didn't open:** running over SSH or in CI — pass `--no-open` and visit the printed URL manually.
- **Daemon exits immediately:** check stderr for the binding-guard rejection if you passed `--host` to anything non-loopback.
- **No Phases visible:** the dashboard reads `.swt-planning/`. Run from a SWT project root, or set `cwd` accordingly.

## Related

- `non_production_files/UI/TDD.md` — full Technical Design Document (architecture, contracts, accessibility plan)
- `non_production_files/UI/BRANDKIT.md` — design tokens and color contrast tables
- `.vbw-planning/milestones/*/SHIPPED.md` — historical milestone shipping records
