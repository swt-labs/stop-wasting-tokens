# stop-wasting-tokens — v1.0.0 release notes

**The first stable release.** A token-disciplined methodology runtime for the Codex CLI, distributed as a portable npm package.

## 30-second pitch

Codex is excellent at small tasks and unpredictable on large ones. Without structure, multi-week projects burn tokens on rework: re-explaining context every session, reinventing abstractions, hand-waving verification.

SWT structures the work so token spend goes toward _new_ progress. Phases on disk. Plans on disk. Verification as a separate stage. Eleven deterministic lifecycle states. Built on the proven VBW methodology, ported to a portable CLI for Codex (with Claude Code and Ollama drivers landing in v1.5).

```bash
npm install -g @swt-labs/cli
swt init
swt vibe
```

## What's in v1.0

### Foundation (Phases 1–2)

- Repo + org setup (`swt-labs/stop-wasting-tokens` GitHub org, MIT license, CI matrix on Node 20/22 × Linux/macOS/Windows)
- TypeScript monorepo with pnpm workspaces, tsup builds, Vitest test runner, GitHub Actions + CodeQL + Dependabot
- Seven workspace packages: `@swt-labs/{cli, core, methodology, artifacts, codex-driver, verification, telemetry}`

### Core abstractions + Codex driver (Phases 3–4)

- Four core abstractions: **HookHost**, **AgentSpawner**, **PermissionGate**, **MemoryStore** — designed for v1.5 multi-driver expansion (Claude Code, Ollama)
- Codex backend driver wiring (live AgentSpawner integration is a v1.5 deliverable; v1.0 ships the abstraction layer + mock driver for hermetic tests)
- Typed handoff envelopes between agents

### Methodology authoring + Commands (Phases 5–6)

- Six-agent SDLC: Scout (research), Architect (design), Lead (planning), Dev (implementation), QA (contract verification), Debugger (investigation)
- Goal-backward verification — every plan must declare must-haves before execution begins
- Hook event taxonomy and skill-routing primitives
- CLI command surface: `swt init`, `swt vibe`, `swt detect-phase`, `swt config`, `swt status`, `swt doctor`, `swt update`

### Artifacts engine + Verification & QA (Phases 7–8)

- Twelve typed artifact schemas in `@swt-labs/artifacts`: PLAN, SUMMARY, VERIFICATION, UAT, RESEARCH, STANDALONE-RESEARCH, REMEDIATION-{PLAN,SUMMARY,RESEARCH}, DEBUG-SESSION, CONTEXT, MILESTONE-CONTEXT
- Frontmatter parser handling flat scalars, inline arrays, block-style YAML arrays, inline JSON objects, and JSON-array-of-objects shapes
- QA + UAT separation: QA verifies against plan must-haves; UAT walks interactively against acceptance criteria

### Methodology runtime (Phase 9)

- TypeScript port of VBW's bash phase-detect — `swt detect-phase --json` (or `--bash-format` for VBW compat)
- VibeRoute discriminated union with thirteen mode handlers
- Discussion engine port (calibration → gray-area generation → per-decision exploration)
- Pre-archive 7-point audit gate: roadmap completeness, plan coverage, summary status, fresh QA, UAT clean, requirements coverage, hard UAT gate
- QA → Verify → re-verify → Archive lifecycle with bounded remediation rounds and recurrence tracking
- ScriptedPrompter pattern for hermetic test runs; ReadlinePrompter for terminal interactive UAT

### Template fidelity (Phase 10)

- Every VBW artifact kind has a Zod-typed schema with read/write helpers
- Backwards-compatibility transforms — VBW frontmatter (`{id, must_have, status}`) and SWT frontmatter (`{id, criterion, verdict, evidence}`) both parse cleanly via union types
- Multi-section body parsers for VERIFICATION (Must-Have Checks table + Result + Pre-Existing Issues + Plan Coverage), CONTEXT (Notes/Decisions/Deferred Ideas), MILESTONE-CONTEXT (six canonical sections)
- Round-trip helpers preserve the modeled fields exactly; round-trip tests committed against real VBW SUMMARY fixtures

### Documentation site (Phase 11)

- Mintlify-based docs site under `docs/` with six navigation groups (Getting Started / Concepts / Reference / Recipes / Migration / v1.5 Roadmap)
- Eighteen authored pages — install, init, first-vibe walkthrough, methodology pitch, artifact taxonomy, lifecycle states (with Mermaid diagram), autonomy levels, effort levels, CLI reference, config reference, artifact schema reference, five end-to-end recipes, three migration pages, v1.5 roadmap
- Vale prose linting in CI with section-scoped rule overrides + project vocabulary
- Migration guide: VBW → SWT is `mv .vbw-planning .swt-planning` plus a config rename

### Distribution (Phase 12)

- All seven packages publishable with npm provenance attestation
- Changesets-driven release with lockstep versioning across `@swt-labs/*`
- `swt update` CLI command — checks the npm registry for newer versions, supports `--json` / `--strict` / `--registry` / `--no-cache`, caches results 24h locally
- Codex Plugin Marketplace manifest at `packages/cli/codex-plugin.json` — submission process is user-side
- Install smoke test workflow validates the published install across a 6-cell matrix (ubuntu+macos × npm/pnpm/bun)

### Beta & feedback (Phase 13)

- Opt-in telemetry (`@swt-labs/telemetry`) — privacy-by-default (off), anonymous UUIDv4, PII-stripping sanitize pass, five initial events (cli.command_invoked / vibe.phase_started / vibe.phase_completed / uat.checkpoint / uat.remediation_round_started)
- Friction issue template, GitHub Discussions templates (Ideas / Q&A / Show-and-Tell), CODE_OF_CONDUCT.md (Contributor Covenant 2.1 reference-style)
- Beta tester guide at `docs/recipes/beta-feedback.mdx` — install, what to test, how to report friction, telemetry opt-in walkthrough
- Four announcement templates ready for the user to copy-paste at launch (Discord, HN, Reddit, Twitter/X)

## VBW compatibility

SWT and VBW share the same methodology — moving between them is a rename, not a rewrite.

- **Frontmatter shapes** are wire-compatible. `must_haves`, `ac_results`, `fail_classifications`, `known_issues_input`, `known_issue_outcomes` — all parse via Zod transforms that accept both the VBW form and the SWT form, normalizing on read.
- **Lifecycle states** are 1:1. The eleven `next_phase_state` values match VBW's bash phase-detect exactly. `swt detect-phase --bash-format` produces VBW-compatible `key=value` output, so VBW shell scripts continue to work against SWT's planning dir.
- **Config keys** are a strict superset. VBW configs read through SWT silently; SWT configs read through VBW silently.

Migration is `mv .vbw-planning .swt-planning`. See [docs.stopwastingtokens.dev/migration/from-vbw](https://docs.stopwastingtokens.dev/migration/from-vbw) for the full step-by-step.

## Install + quickstart

```bash
npm install -g @swt-labs/cli
# or pnpm add -g @swt-labs/cli
# or bun add -g @swt-labs/cli

swt --version
# 1.0.0

swt init      # bootstrap a project
swt vibe      # plan + execute the next phase
swt update    # check for newer published version
```

All packages publish with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements). Verify with `npm view @swt-labs/cli`.

## What's intentionally not in v1.0

- **Real Codex AgentSpawner wiring.** v1.0 ships the abstraction layer + mock driver. Live execution against Codex CLI requires the Codex CLI to expose a stable subagent-spawn API. v1.5 candidate.
- **Claude Code + Ollama backend drivers.** Same shape as the Codex driver, behind the same four abstractions. v1.5.
- **Ink TUI dashboard.** Real-time phase progress, agent status, token spend. v1.5.
- **Auto-derived reference docs.** v1.0 hand-authors CLI/config/artifact reference; v1.5 codegens from source.
- **Live deployment to docs.stopwastingtokens.dev.** Engineering layer (Mintlify config + content + Vale CI) ships in v1.0; live hosting is a launch-day user-side action (Mintlify project + DNS CNAME).

See [`docs/v1-5-roadmap/`](https://docs.stopwastingtokens.dev/v1-5-roadmap/index) for the full v1.5 plan.

## Acknowledgments

- The VBW community — [Hesreallyhim](https://github.com/Hesreallyhim) and contributors who shaped the methodology in Claude Code. SWT exists because VBW worked.
- Anthropic and OpenAI — for the LLM substrate that makes any of this possible.
- Beta testers — closed beta opens this week.

## Links

- **Docs:** https://docs.stopwastingtokens.dev
- **Repo:** https://github.com/swt-labs/stop-wasting-tokens
- **npm:** https://www.npmjs.com/package/@swt-labs/cli
- **Codex Plugin Marketplace:** placeholder URL until Codex accepts the listing
- **Migration from VBW:** https://docs.stopwastingtokens.dev/migration/from-vbw
- **Beta feedback:** https://docs.stopwastingtokens.dev/recipes/beta-feedback
