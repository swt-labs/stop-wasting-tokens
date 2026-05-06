# stop-wasting-tokens

> **Status:** alpha — under active development. APIs, file layouts, and command surface will change without notice until v1.0. See [ROADMAP](.vbw-planning/ROADMAP.md).

A token-disciplined, methodology-first software development lifecycle for the OpenAI Codex CLI.

`swt` is a Node/TypeScript CLI distributed via npm. It brings a six-agent SDLC (Scout, Architect, Lead, Dev, QA, Debugger), goal-backward verification, and durable phased planning artefacts to your Codex sessions. v1 targets the Codex CLI; v1.5 will add additional backend drivers behind the same four core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore).

## Why

- **Cache discipline.** Every prompt has an intentional split between a stable static prefix and a dynamic per-call layer.
- **Cost transparency.** Every plan exposes its token cost; every agent has an explicit model profile.
- **Methodology over tooling.** Skills, AGENTS.md, and structured artefacts carry the workflow — not bespoke slash commands.
- **Cross-platform.** Node/TypeScript only. No Bash hard dependency. Windows works natively.

## Install

```bash
npm install -g @swt-labs/cli
# or
pnpm add -g @swt-labs/cli
# or
bun add -g @swt-labs/cli
```

All packages publish with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) — verify with `npm view @swt-labs/cli`.

[![install-smoke](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/install-smoke.yml/badge.svg)](https://github.com/swt-labs/stop-wasting-tokens/actions/workflows/install-smoke.yml)

## Marketplace

The Codex Plugin Marketplace listing is shipped via `packages/cli/codex-plugin.json` (PLAN 12-03). The live marketplace URL lands once Codex accepts the submission — track [docs.stopwastingtokens.dev](https://docs.stopwastingtokens.dev) for the link.

## Quick start

```bash
swt init      # bootstrap a project
swt vibe      # plan + execute the next phase
swt update    # check for newer published version
```

See [docs.stopwastingtokens.dev](https://docs.stopwastingtokens.dev) for the full guide.

## Release notes

The first stable release is documented in [RELEASE-NOTES-v1.0.md](RELEASE-NOTES-v1.0.md). Per-version changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Repo & org setup | Complete |
| 2 | Foundation (TS monorepo, CI) | Complete |
| 3 | Core abstractions | Complete |
| 4 | Codex backend driver | Complete |
| 5 | Methodology authoring | Complete |
| 6 | Commands | Complete |
| 7 | Artefacts engine | Complete |
| 8 | Verification & QA | Complete |
| 9 | Methodology runtime | Complete |
| 10 | Template fidelity | Complete |
| 11 | Documentation site | Complete |
| 12 | Distribution | Complete |
| 13 | Beta & feedback | Complete |
| 14 | v1.0 launch | In progress |
| 15 | v1.5 forward-compat prep | Pending |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions are governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for the disclosure policy.

## License

MIT — see [LICENSE](LICENSE).
