# Changelog

All notable changes to stop-wasting-tokens are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v1.5

- Real Codex AgentSpawner wiring against the Codex CLI subagent API
- Claude Code backend driver
- Ollama backend driver
- Ink TUI dashboard
- Auto-derived reference docs (CLI / config / artifacts) generated at build time
- Configurable telemetry cache TTL
- Real HTTP telemetry sender pointing at a hosted analytics endpoint
- Custom Vale rules under `docs/styles/SWT/`
- Hook event taxonomy expansion (`pre_archive`, `post_phase`, `post_uat_fail`)

## [1.0.0] — `<DATE-OF-PUBLISH>`

The first stable release. See [`RELEASE-NOTES-v1.0.md`](RELEASE-NOTES-v1.0.md) for the full launch narrative.

### Added

- **Methodology runtime** — TypeScript port of VBW's bash phase-detect, VibeRoute discriminated union with thirteen mode handlers, discussion engine, 7-point pre-archive audit, QA + UAT remediation pipelines with bounded round caps and recurrence tracking.
- **Twelve typed artifact schemas** — PLAN, SUMMARY, VERIFICATION, UAT, RESEARCH, STANDALONE-RESEARCH, REMEDIATION-{PLAN,SUMMARY,RESEARCH}, DEBUG-SESSION, CONTEXT, MILESTONE-CONTEXT, all with Zod schemas + read/write helpers + backwards-compatibility transforms accepting both VBW and SWT shapes.
- **Six-agent SDLC** — Scout, Architect, Lead, Dev, QA, Debugger; goal-backward verification; typed handoff envelopes.
- **CLI command surface** — `swt init`, `swt vibe`, `swt detect-phase`, `swt config`, `swt status`, `swt doctor`, `swt update`.
- **Mintlify documentation site** — eighteen authored pages across Getting Started / Concepts / Reference / Recipes / Migration / v1.5 Roadmap, with Vale prose linting in CI.
- **npm distribution** — seven packages publishable with provenance attestation, changesets-driven release with lockstep versioning, install smoke test workflow on a 6-cell matrix.
- **Codex Plugin Marketplace manifest** — `packages/cli/codex-plugin.json` ready for submission.
- **Opt-in telemetry** — `@swt-labs/telemetry` with privacy-by-default, anonymous UUIDv4, PII-stripping sanitize pass, five initial events.
- **Beta-feedback infrastructure** — friction issue template, GitHub Discussions templates, CODE_OF_CONDUCT.md, beta tester guide, four announcement templates.

### Compatibility

- VBW frontmatter shapes parse cleanly via Zod transforms.
- The eleven lifecycle states match VBW 1:1.
- `swt detect-phase --bash-format` produces VBW-compatible `key=value` output.
- Config keys are a strict superset of VBW's.
- Migration: `mv .vbw-planning .swt-planning`.

### Security

- Comprehensive self-audit logged in [`SECURITY-REVIEW-v1.0.md`](SECURITY-REVIEW-v1.0.md) covering input handling, filesystem access, network, child process, and secrets handling.
- All packages publish with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements).

## [0.1.0-alpha] — `2026-05-XX`

Initial public alpha. Closed beta launched. Engineering deliverables for all 13 prior phases shipped:

- Phase 1 — Repo & org setup
- Phase 2 — Foundation (TypeScript monorepo, CI matrix)
- Phase 3 — Core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore)
- Phase 4 — Codex backend driver wiring
- Phase 5 — Methodology authoring (six-agent SDLC + skill routing)
- Phase 6 — CLI commands
- Phase 7 — Artifacts engine (twelve schemas)
- Phase 8 — Verification & QA pipelines
- Phase 9 — Methodology runtime (phase-detect + VibeRoute)
- Phase 10 — Template fidelity (Zod schemas + transforms)
- Phase 11 — Documentation site (Mintlify scaffold + content + Vale)
- Phase 12 — Distribution (npm publish + provenance + `swt update` + marketplace manifest)
- Phase 13 — Beta & feedback (telemetry + friction template + CoC + beta guide + announcements)

### Compatibility

- Drop-in replacement for VBW projects via directory rename.

[Unreleased]: https://github.com/swt-labs/stop-wasting-tokens/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/swt-labs/stop-wasting-tokens/releases/tag/v1.0.0
[0.1.0-alpha]: https://github.com/swt-labs/stop-wasting-tokens/releases/tag/v0.1.0-alpha
