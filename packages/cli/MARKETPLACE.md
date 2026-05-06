# stop-wasting-tokens

A token-disciplined methodology runtime for the Codex CLI.

Codex is excellent at small tasks and unpredictable on large ones. Without structure, multi-week projects burn tokens on rework: the model re-reads files it already saw, reinvents abstractions every session, and conflates verification with implementation.

SWT structures the work so that token spend goes toward _new_ progress, not toward re-explaining context.

## Install

```bash
npm install -g @swt-labs/cli
swt init
swt vibe
```

That's the whole onboarding. Three commands, one disk path (`.swt-planning/`), and you're shipping.

## What you get

- **Phases + plans + summaries.** Every step has a typed Zod-validated contract. No prompt drift between sessions.
- **11 lifecycle states.** Deterministic routing from `swt detect-phase` — same disk state always returns the same next step.
- **QA + UAT separation.** Verification is a stage, not an afterthought. Row-by-row evidence per acceptance criterion.
- **Remediation pipeline.** Failed UAT routes through research → plan → execute → re-verify with bounded round caps and recurrence tracking.
- **VBW-compatible.** Existing VBW projects migrate via `mv .vbw-planning .swt-planning`. Same artifacts, same lifecycle states.
- **Cross-platform.** Pure Node/TypeScript. No Bash hard dependency. Windows works natively.

## Install from this marketplace

This listing is the canonical Codex Plugin Marketplace entry. Once installed, `swt` is on your PATH and ready to drive any project — greenfield, brownfield, or mid-flight VBW migration.

## Learn more

- [Documentation](https://docs.stopwastingtokens.dev) — getting started, concepts, reference, recipes, migration
- [GitHub](https://github.com/swt-labs/stop-wasting-tokens) — source, issues, contributing
- [Migration from VBW](https://docs.stopwastingtokens.dev/migration/from-vbw) — feature parity matrix + step-by-step

## License

MIT — full text at [github.com/swt-labs/stop-wasting-tokens/blob/main/LICENSE](https://github.com/swt-labs/stop-wasting-tokens/blob/main/LICENSE).
