# stop-wasting-tokens — Milestone Context

Gathered: 2026-05-07
Calibration: builder

## Scope Boundary

**In scope:** the 11 findings classified as Tier 1, Tier 2, or Tier 3 in the Codex SDK verification research (`.vbw-planning/research/20260507-081032-verify-codex-sdk-best-practices.md`). Specifically: F-01, F-02, F-03, F-04, F-08, F-09, F-10, F-11, F-13, F-14. The milestone makes SWT's shipped v1.5 product code conform to the documented Codex SDK schemas at `developers.openai.com/codex` so a real Codex CLI can load SWT's agent profiles, install SWT via the Plugin Marketplace, and process SWT-emitted hooks.

**Out of scope:** the 6 findings classified as Tier 4 (v1.6+ follow-ups): F-05, F-06, F-07, F-12, F-15, F-17. These are schema-evolution decisions and deeper test coverage that the user has explicitly deferred.

## Decomposition Decisions

### Phase Count & Grouping

3 phases, one per remediation tier from the research:

- **Phase 1 (Tier 1)** is the must-fix critical pass — without it, no agent profile loads in Codex. Tightest scope, smallest blast radius (text edits + tests in 6 TOML files plus one test file).
- **Phase 2 (Tier 2)** is the Plugin Marketplace prerequisite — it groups manifest path + schema + version sync into a self-contained shippable unit. Independent from Phase 1.
- **Phase 3 (Tier 3)** is the codex-driver hooks integration — it wires the methodology layer's HookHost contract to Codex's actual `hooks.json` schema. It's the largest phase (touches the codex-driver package, adds new tests) and depends only on existing v1.5 work.

Each phase ships independently and can be QA-verified + UAT-validated on its own. No cross-phase dependencies.

### Phase Ordering

1. **Phase 1 first** because it's the highest-severity (CRITICAL) gap and the smallest. Quick win.
2. **Phase 2 second** because it's a clean prerequisite for marketplace listing — doesn't require Phase 1.
3. **Phase 3 last** because it's the largest in scope (touches codex-driver hooks emit path + adds tests) and the lowest user-visible severity (drift, not breakage).

### Scope Coverage

- ✅ Phase 1 covers all CRITICAL findings (F-01, F-02) plus the missing required Codex subagent fields (F-04).
- ✅ Phase 2 covers all Plugin Marketplace-blocking findings (F-03, F-13) plus version hygiene (F-14).
- ✅ Phase 3 covers all hook-integration drift findings (F-08, F-09, F-10, F-11).
- ❌ Tier 4 (F-05, F-06, F-07, F-12, F-15, F-17) is explicitly deferred to v1.6+. The roadmap "Out of Scope" section documents each deferred finding with rationale.

## Requirement Mapping

| Phase | REQ-IDs | Findings |
|-------|---------|----------|
| 01 SDK Critical Conformance | REQ-02, REQ-03 | F-01, F-02, F-04 |
| 02 Plugin Marketplace Prep | REQ-19 | F-03, F-13, F-14 |
| 03 Hook Integration & Drift Cleanup | REQ-13 | F-08, F-09, F-10, F-11 |

## Key Decisions

- **Group findings by remediation tier, not by file or feature.** The research file already triaged findings into Tier 1 (must-fix), Tier 2 (marketplace prep), Tier 3 (drift cleanup), Tier 4 (v1.6+). Adopting that triage as the phase decomposition keeps each phase shippable on its own and the tier-to-phase mapping legible to future readers.
- **Authoritative Codex schema source = `developers.openai.com/codex`.** All Phase 1-3 PLAN.md artifacts must cite the documented schema directly (model identifiers, reasoning_effort enum, manifest schema, hook event names) rather than guessing or extrapolating.
- **`gpt-5.3-codex` is the documented coding-tuned identifier** — Phase 1 picks it (over `gpt-5.5`) because the SWT methodology emphasizes coding-tuned per-role agents. This decision can be revisited per role if `gpt-5.5` proves better for non-coding roles like Architect.
- **Tier 4 deferral is explicit, not implicit.** The roadmap "Out of Scope" section lists each deferred finding with the v1.6+ rationale so the next milestone scoping has the context.

## Deferred Ideas

- Per-role MCP server scoping (F-05) — the question is whether SWT should ship per-role allow-lists (would require a SWT-namespaced field in agent TOMLs that the codex-driver translates to actual Codex `[mcp_servers.X]` blocks at install time) or just inherit MCP from the parent's config.toml. Deferred until there's a real user request.
- Codex permission profile integration — Codex's `:read-only`, `:workspace`, `:danger-no-sandbox` named profiles aren't currently consumed by SWT's verification_tier. A future v1.6+ feature could allow SWT to inject named permission profiles via the codex-driver's config writer.
- Strict-prose check (`--strict-prose` flag) for F6 docs codegen — would assert every Zod key has documented prose. Not a Codex-conformance issue but a docs-quality one. Tracked in v1.5 follow-ups.
