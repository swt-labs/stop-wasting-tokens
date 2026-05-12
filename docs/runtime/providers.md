# Runtime — Providers

> **Status:** stub — populated incrementally.
>
> **Canonical reference:** [`TDD2.md` §7 (provider quirks JSON + role resolver)](../../TDD2.md).
> **Implementing package:** [`packages/runtime/src/providers/`](../../packages/runtime/src/providers/).
> **Owning ADR:** [ADR-003 — Provider quirks live in `quirks.json` applied via Pi Extension](../decisions/ADR-003-quirks-json-over-shims.md).

The provider layer is JSON-driven by design (per ADR-003). Two files + one resolver:

| File                 | Shape                                     | Purpose                                                                                                                                                                              |
| :------------------- | :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-tiers.json` | `Record<provider, Record<Tier, modelId>>` | Maps the methodology's `Tier` vocabulary (`cheap-fast`/`balanced`/`quality`/`reasoning`) to concrete model IDs per provider.                                                         |
| `quirks.json`        | `Record<provider, ProviderQuirk>`         | Per-provider compat flags + `thinkingLevelMap` overrides. Keys MUST be Pi `ThinkingLevel` values (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`), NOT SWT tier names.                |
| `role-resolver.ts`   | TS module                                 | Three pure functions: `resolveTierForRole(role)`, `resolveModelForRole(role, provider)`, `resolveThinkingLevelForRole(role)`. Per TDD2 §10.5: per-ROLE thinking level, not per-tier. |

## Role → tier → model → thinking-level chain

```
SDLCRole (scout|architect|lead|dev|qa|debugger)
  ↓ resolveTierForRole()                    [project config override possible]
Tier (cheap-fast|balanced|quality|reasoning)
  ↓ resolveModelForRole()
provider-specific model id (claude-haiku-4-5 | gpt-5 | …)

SDLCRole
  ↓ resolveThinkingLevelForRole()           [per-ROLE, not per-tier — §10.5]
Pi ThinkingLevel (off|minimal|low|medium|high|xhigh)
  ↓ quirks.json thinkingLevelMap
provider-specific thinking string
```

The orchestrator intentionally is not in `SDLCRole` — it dispatches; it doesn't prompt.

## Default role-to-tier map

| Role        | Tier         | Thinking |
| :---------- | :----------- | :------- |
| `scout`     | `cheap-fast` | `off`    |
| `architect` | `quality`    | `medium` |
| `lead`      | `balanced`   | `low`    |
| `dev`       | `balanced`   | `low`    |
| `qa`        | `balanced`   | `low`    |
| `debugger`  | `reasoning`  | `xhigh`  |

Project-level overrides go in `.swt-planning/config.json` under `roles[*].tier`. The resolver merges them in via the `overrides.roleTier` argument.

## Critical invariant: `thinkingLevelMap` keys

Per the Zod schema test at `runtime/test/providers/quirks-schema.test.ts`, every `thinkingLevelMap` key in `quirks.json` MUST be a Pi `ThinkingLevel` value (one of: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`). Writing `"balanced": "low"` (a SWT tier name as the key) is the TDD2 regression the Plan 01-01 audit caught and the schema test now enforces. CI fails if the regression returns.

## Adding a provider

JSON edit only — no TS change required.

1. Add an entry to `default-tiers.json` mapping each of the 4 tiers to a model ID.
2. (optional) Add an entry to `quirks.json` with `models[<modelGlob>]` overrides and `compat` flags.
3. The next `pnpm test --filter @swt-labs/runtime` exercises the new entry via the schema test + the `provider-overrides.test.ts` build test.
