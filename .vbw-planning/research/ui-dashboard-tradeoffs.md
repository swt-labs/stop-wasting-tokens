# UI / dashboard design notes (v1.5)

Date: 2026-05-06
Audience: v1.5 milestone scoping
Output: a recorded decision the v1.5 milestone can either re-affirm or revise based on actual beta feedback.

## Context

SWT v1.0 is CLI-only. Multi-week projects accumulate state — current phase, open UAT remediation rounds, telemetry signal, recent failures, friction reports across the closed beta. Surfacing that state via `swt status` works for "what's the next step" but doesn't scale to "watch progress live" or "see all my projects at once."

A dashboard is the natural v1.5 surface. The decision: **Ink TUI** (terminal-native, in-process), **web** (browser-based, separate process), or **hybrid** (Ink for live + static-site web for archived milestones).

REQ-V2-01 explicitly calls for design notes here, with the implementation deferred to v1.5+. This document is the input to that scoping.

## Option A — Ink TUI

A terminal UI in the same process as `swt`. Read-only against `.swt-planning/`. Renders a per-project live view: current phase, plan progress bar, agent status, last 5 events from the activity log, telemetry counters.

### Pros

- **Zero install** — bundled with `@swt-labs/cli`. `swt watch` opens it.
- **No separate process** — reads `.swt-planning/` directly via the existing artifact schemas. No server, no auth, no port.
- **Terminal-native** — fits the SWT user's existing workflow. They're already in tmux / iTerm / Warp running `swt vibe`.
- **Cross-platform** — works wherever Node + a terminal works. Same matrix as `swt vibe` itself.
- **Resilient to disconnect** — local-only; no network failure modes.

### Cons

- **Limited rendering** — terminal grid, no embedded charts, no color granularity beyond ANSI 256.
- **Per-project scope** — cross-project monitoring requires running multiple TUIs in different panes.
- **Ink dependency footprint** — ~5 MB additional bundle weight on `@swt-labs/cli`.
- **No URL sharing** — can't paste "look at my milestone" into a Slack thread.

### Cost estimate

S–M (~2 weeks of focused work for a useful first cut). Phases:
1. (3 days) `swt watch` command + Ink scaffold + read-only artifact tail
2. (4 days) live view layout: phase progress, plan list, agent status
3. (3 days) telemetry counters + last-N activity events
4. (2-3 days) keyboard nav (drill down into a phase, expand a plan, view UAT issues)

## Option B — Web

A browser-based dashboard served by a local HTTP server (`swt serve`). Renders rich charts, mermaid diagrams, multi-project view (if you point it at multiple `.swt-planning/` roots).

### Pros

- **Rich rendering** — charts (token spend over time), mermaid diagrams (lifecycle state), multi-project tabs.
- **Shareable URLs** — onboarding new contributors via link. "Look at the demo milestone state at this URL."
- **Decoupled** — could expose a hosted SaaS in v2 reusing the same UI.
- **Familiar UX** — most developers prefer a browser tab to a terminal pane for "watch progress."
- **Accessibility** — screen readers, font scaling, browser zoom all work natively.

### Cons

- **Adds a server process** — needs to manage port allocation, auth (if exposed beyond localhost), graceful shutdown.
- **Bundle size grows** — React + chart lib + Vite output bundles to ~600 KB+.
- **Maintenance burden** — separate test pipeline (jsdom or Playwright), separate deploy story, separate update cadence from the CLI.
- **Hosting is non-trivial** — local-only is fine; "share this URL" implies tunnel / SaaS / public hosting which becomes a v2 concern.
- **Cross-platform quirks** — Windows port allocation, macOS firewall prompts, Linux distro variation.

### Cost estimate

L (~4-6 weeks) plus operational setup. Phases:
1. (1 week) `swt serve` command + Vite scaffold + React shell
2. (1 week) live view layout matching Option A's feature set
3. (1 week) charts (token spend / phase duration / UAT remediation rounds)
4. (1 week) multi-project view + URL routing
5. (1-2 weeks) deploy story (local-only first; SaaS / tunnel deferred)

## Option C — Hybrid

Best of both: **Ink TUI for live in-progress work** (active milestone, current phase) + **static-site web for shipped milestones** (an HTML render of `milestones/<slug>/`).

The static-site half is a `swt vibe --archive --html` build step that generates Mintlify-style pages from the archived planning artifacts. Existing Mintlify build can render them natively via the same `@swt-labs/artifacts` schemas the docs site already uses.

### Pros

- **Right tool per use case** — terminal for live, browser for archived/shareable.
- **No server required** — both are static or in-process.
- **Web side leverages existing Mintlify infrastructure** — no new build pipeline.
- **Static HTML render of archived milestones** is shareable via the docs site directly.

### Cons

- **Two surfaces to design + maintain** — Ink layout AND HTML/Mintlify render.
- **HTML render still has design overhead** — Mintlify gives us components, but the milestone-page layout is bespoke.
- **More moving parts** — but each part is simpler than Option B.

### Cost estimate

M (~3 weeks). Phases:
1. (1.5 weeks) Ink TUI from Option A
2. (1.5 weeks) Static HTML render of `milestones/<slug>/` via `swt vibe --archive --html`

## Recommendation

**Start with Option A (Ink TUI) in v1.5** as the live progress surface, scoped to the active milestone. Defer Option B (web dashboard) to v2.0+ once SaaS / multi-project requirements solidify. **Consider Option C's static HTML render of archived milestones as a v1.5 stretch goal** if the Ink TUI lands early — it leverages the existing Mintlify infra at low marginal cost.

Rationale:
1. The closed beta will surface whether users actually want live progress visibility or whether `swt status` is sufficient. Ink TUI is the cheapest test for that demand.
2. Web dashboards in pre-1.0 dev tooling tend to over-promise and under-deliver. Better to ship the smallest useful thing and iterate.
3. The architecture stays clean: Ink TUI is a new package (`@swt-labs/dashboard-ink`); static HTML render is a method on existing `@swt-labs/artifacts` schemas. Neither change loads onto the core CLI or runtime.

## Decision criteria for the v1.5 milestone

After v1.0 beta closes (Phase 13 success criterion met), re-evaluate against these signals:

| Signal | Implication |
|--------|-------------|
| Users ask for live cross-project visibility | Revisit Option B (web) sooner — cross-project is the use case Option B serves uniquely |
| Users mostly run one project at a time | Option A (Ink) is sufficient — no need for Option B in v1.5 |
| Users want to share milestone state with stakeholders | Option C's static HTML render becomes the priority deliverable |
| Telemetry shows users running `swt status` >5x per day | Live dashboard demand is real; greenlight Ink TUI |
| Telemetry shows users rarely opening `swt status` | Defer dashboard work; users are happy with `swt vibe` only |

The v1.5 milestone scoping should review this matrix against actual beta feedback before committing to which option ships.

## What this document is NOT

- **Not a v1.5 commitment.** v1.5 may decide none of these options is high enough priority and defer all to v2.
- **Not a full design spec.** Layout, color choices, keyboard shortcuts, accessibility requirements all live in the v1.5 PLAN.md when work starts.
- **Not a final decision.** This is the input to v1.5 scoping. The actual decision happens with beta feedback in hand.

## Cross-references

- REQ-V2-01 (`.vbw-planning/REQUIREMENTS.md`)
- `docs/v1-5-roadmap/index.mdx` — F4 entry
- `docs/roadmap/v1.5.md` — F4 detailed entry
