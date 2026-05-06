---
phase: 09
plan: 03b
title: Discussion engine — calibrate, gray-area, capture protocol; interactive bootstrap + scope
wave: 8
depends_on: [09-03, 09-06]
must_haves:
  - 'Calibration: inferCalibration({signals}) reads project description, requirements, prior answers and returns ''builder'' (minimal questions) or ''architect'' (deep exploration). Inference rules mirror VBW discussion-engine calibrate signals.'
  - 'Gray-area generation: generateGrayAreas({context, calibration, mode}) returns an ordered list of GrayArea decisions the user has not addressed. Mode = ''bootstrap'' | ''scope'' | ''phase''. Recommendation Principle: technical decisions lead with enterprise-standard defaults; product decisions present equally.'
  - 'Discussion engine: runDiscussionEngine({prompter, context, mode, signals}) drives calibrate -> gray-areas -> per-decision askChoice/askText loop -> DiscoveryPayload (answered, inferred, deferred). Honors the existing Prompter abstraction (PLAN 06).'
  - 'DiscoveryPayload + writer: typed answered/inferred/deferred entries with id, topic, decision, rationale, source. writeDiscovery (already exists from PLAN 03) accepts the new typed payload.'
  - 'Bootstrap interactive path: when bootstrap-input.json is missing AND a Prompter is injected, bootstrapHandler runs the engine in ''bootstrap'' mode. The engine collects project_name, description, core_value, plus discovery answers; bootstrapHandler then composes the writers as today.'
  - 'Scope interactive path: when phases.json is missing AND a Prompter is injected, scopeHandler runs the engine in ''scope'' mode. The engine collects scope_boundary, decomposition_rationale, and a phases[] array (3-5 phases with name, slug, goal); scopeHandler then composes phase dirs + CONTEXTs as today.'
  - 'Vitest covers: calibrate inference happy paths (builder vs architect signals); gray-area generation per mode; engine end-to-end via ScriptedPrompter (capture answer / accept default / defer); bootstrap interactive happy path; scope interactive happy path.'
  - 'CLI vibe.ts wires the existing ReadlinePrompter into bootstrapHandler and scopeHandler so the interactive paths work on a TTY without a JSON input file.'
deferred_to_followup:
  - 'Real Codex AgentSpawner wiring around @swt-labs/codex-driver (executeHandler + qaHandler unblocker — outside Phase 9 scope).'
  - 'CLI add-phase composition triggered by milestoneUatRecoveryHandler create-remediation decision (PLAN 06 D1).'
  - 'rolling_summary compilation + post-archive hook dispatcher (PLAN 07 D1).'
  - 'Tier-aware Verification audit (PLAN 07 D2).'
acceptance_criteria: |
  Given a Prompter that scripts answers for calibration + every gray-area
  decision, runDiscussionEngine returns a DiscoveryPayload that round-trips
  through writeDiscovery. Given no bootstrap-input.json and an injected
  Prompter, bootstrapHandler runs the engine and composes PROJECT/REQUIREMENTS
  /ROADMAP(empty)/STATE/CLAUDE artifacts. Given no phases.json and an
  injected Prompter, scopeHandler runs the engine and composes ROADMAP +
  per-phase CONTEXT + milestone CONTEXT artifacts. Vitest covers the named
  scenarios end-to-end with ScriptedPrompter against temp dirs.
---

# Phase 9 / Plan 03b: Discussion engine

## Why last in Phase 9

PLAN 03 shipped the bootstrap + scope handlers but deferred the interactive paths to this plan (NotImplementedError when no JSON input file is supplied). PLAN 06 shipped the Prompter abstraction, which is the foundation for the engine. PLAN 03b composes those two into the calibrate / gray-area / capture protocol that drives interactive bootstrap and scope. After this lands, Phase 9 is fully complete: every methodology runtime mode has a working in-process path.

## Layout

```
packages/methodology/src/discussion/index.ts
packages/methodology/src/discussion/calibrate.ts        # inferCalibration
packages/methodology/src/discussion/gray-areas.ts       # generateGrayAreas
packages/methodology/src/discussion/engine.ts           # runDiscussionEngine
packages/methodology/src/discussion/types.ts            # DiscoveryAnswer, GrayArea, DiscussionContext
packages/methodology/src/vibe/handlers/bootstrap.ts     # interactive path via engine
packages/methodology/src/vibe/handlers/scope.ts         # interactive path via engine
packages/methodology/test/discussion/calibrate.test.ts
packages/methodology/test/discussion/gray-areas.test.ts
packages/methodology/test/discussion/engine.test.ts
packages/methodology/test/vibe/handlers/bootstrap.test.ts (extended)
packages/methodology/test/vibe/handlers/scope.test.ts (extended)
```

## Tasks

### T1 — methodology/discussion/types.ts
Typed shapes used across the engine: `DiscussionMode = 'bootstrap' | 'scope' | 'phase'`,
`Calibration = 'builder' | 'architect'`, `GrayArea = {id, topic, prompt, options?, defaultValue?, kind: 'choice' | 'text', recommendation?}`,
`DiscoveryAnswer = {id, topic, decision: 'answered' | 'inferred' | 'deferred', value: string, rationale: string, source: 'user' | 'engine' | 'recommendation'}`.

### T2 — methodology/discussion/calibrate.ts
`inferCalibration(signals)` reads:
- project description length (longer + technical jargon → architect)
- explicit "deep dive" / "lots of options" phrasing → architect
- explicit "minimal" / "just the essentials" phrasing → builder
- default → builder
Returns `Calibration`.

### T3 — methodology/discussion/gray-areas.ts
`generateGrayAreas({mode, context, calibration})` returns an ordered list of
`GrayArea`. Mode-specific catalogs:
- `bootstrap`: target users, pricing model, license, deployment surface, tech stack defaults.
- `scope`: phase grouping rationale, milestone duration target, deferred-ideas capture.
- `phase`: per-phase scope edge, validation criteria.
Architect calibration includes a richer set than builder. Recommendation Principle: technical
gray-areas (license, stack, hosting) carry an enterprise-standard `recommendation`; product
gray-areas (target users, pricing) do not.

### T4 — methodology/discussion/engine.ts
`runDiscussionEngine({prompter, context, mode, signals?})`:
1. Determine calibration via `inferCalibration` (signals override).
2. Generate gray areas.
3. For each: ask via prompter (`askChoice` when options present, else `askText`).
4. When the user picks the recommendation, mark the answer `source='recommendation'`.
5. When the user defers (text answer === 'defer' or chooses a 'defer' option), record under `deferred`.
6. Return `DiscoveryPayload` with `answered`, `inferred`, `deferred` arrays.

### T5 — bootstrapHandler interactive path
Add `prompter?: Prompter` to `BootstrapHandlerOptions`. When `bootstrap-input.json` is missing:
- If a prompter is supplied, run `runDiscussionEngine({mode: 'bootstrap'})` to collect
  `project_name`, `description`, `core_value`, then proceed with the existing writer composition.
- If no prompter, throw NotImplementedError (today's behavior).

### T6 — scopeHandler interactive path
Add `prompter?: Prompter` to `ScopeHandlerOptions`. When `phases.json` is missing:
- If a prompter is supplied, run the engine in `scope` mode. The engine asks for
  `scope_boundary`, `decomposition_rationale`, and a list of phases (name + goal) up to 5.
- Compose phase dirs + per-phase CONTEXT + milestone CONTEXT as today.
- If no prompter, throw NotImplementedError.

### T7 — Wire into vibe registry
Update `packages/cli/src/commands/vibe.ts` to pass the existing `ReadlinePrompter` into
both handlers (alongside verifyHandler and milestoneUatRecoveryHandler from PLAN 06).

### T8 — Vitest
- `calibrate.test.ts`: builder vs architect signals.
- `gray-areas.test.ts`: bootstrap / scope / phase modes + calibration variance.
- `engine.test.ts`: ScriptedPrompter answers / accepts recommendation / defers.
- `bootstrap.test.ts` (extended): interactive happy path via ScriptedPrompter writes the
  PROJECT/REQUIREMENTS/ROADMAP(empty)/STATE/CLAUDE quintet.
- `scope.test.ts` (extended): interactive happy path writes ROADMAP + per-phase CONTEXTs +
  milestone CONTEXT.

### T9 — Commit + summary
`feat(methodology): discussion engine — calibrate, gray-area, capture (Phase 9 / PLAN 03b)`.
