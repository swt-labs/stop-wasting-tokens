# stop-wasting-tokens

> **Status:** alpha — under active development. APIs, file layouts, and command surface will change without notice until v1.0. See [ROADMAP](.vbw-planning/ROADMAP.md).

A token-disciplined, methodology-first software development lifecycle for the OpenAI Codex CLI.

`swt` is a Node/TypeScript CLI distributed via npm. It brings a six-agent SDLC (Scout, Architect, Lead, Dev, QA, Debugger), goal-backward verification, and durable phased planning artefacts to your Codex sessions. v1 targets the Codex CLI; v1.5 will add additional backend drivers behind the same four core abstractions (HookHost, AgentSpawner, PermissionGate, MemoryStore).

## Why

- **Cache discipline.** Every prompt has an intentional split between a stable static prefix and a dynamic per-call layer.
- **Cost transparency.** Every plan exposes its token cost; every agent has an explicit model profile.
- **Methodology over tooling.** Skills, AGENTS.md, and structured artefacts carry the workflow — not bespoke slash commands.
- **Cross-platform.** Node/TypeScript only. No Bash hard dependency. Windows works natively.

## Install (planned)

```
npm i -g stop-wasting-tokens
```

The package is not yet published. Track Phase 9 (Distribution) on the roadmap for the v0.1.0-alpha release.

## Quick start (planned)

```
swt init
swt vibe
```

## Status

| Phase | Name | Status |
|-------|------|--------|
| 1 | Repo & org setup | In progress |
| 2 | Foundation (TS monorepo, CI) | Pending |
| 3 | Core abstractions | Pending |
| 4 | Codex backend driver | Pending |
| 5 | Methodology authoring | Pending |
| 6 | Commands | Pending |
| 7 | Artefacts engine | Pending |
| 8 | Verification & QA | Pending |
| 9 | Documentation site | Pending |
| 10 | Distribution | Pending |
| 11 | Beta & feedback | Pending |
| 12 | v1.0 launch | Pending |
| 13 | v1.5 forward-compat prep | Pending |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions are governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md) for the disclosure policy.

## License

MIT — see [LICENSE](LICENSE).
