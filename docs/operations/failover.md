# Operations — Provider Failover

> **Status:** stub — expanded at M5 (multi-provider routing ships).
>
> **Canonical reference:** [`TDD2.md` §7.4](../../TDD2.md).

The router strategies in `runtime/src/providers/role-resolver.ts` choose providers per dispatch. M5 adds fallback chains: when the primary fails (rate-limited, 503, auth expired), the dispatcher routes the same task to a configured fallback. The fallback shares Pi's `auto_retry_*` retry budget so a flapping primary doesn't burn the same retry count twice.

Router strategies:

| Strategy                       | Behaviour                                                                              |
| :----------------------------- | :------------------------------------------------------------------------------------- |
| `pinned`                       | Each role always uses the same provider. No fallback.                                  |
| `round-robin`                  | Rotates providers across dispatches. Even load.                                        |
| `tier-routed` (default)        | Provider chosen by the role's tier; per-tier provider map in config.                   |
| `cost-optimized`               | Cheapest provider per tier. Refreshed from `default-tiers.json` + provider rate cards. |
| `quality-pinned-cost-failover` | Quality tier pinned to a single provider; non-quality tiers cost-optimized.            |

M5 PR-43 ships the strategies. M5 PR-44's provider-matrix CI workflow exercises fallback against simulated 503 responses via cassettes.

This page expands at M5.
