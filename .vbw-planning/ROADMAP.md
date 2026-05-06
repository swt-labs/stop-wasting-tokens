# stop-wasting-tokens Roadmap

**Goal:** Ship a Codex-first, methodology-first CLI (`swt`) on npm, sunset VBW, and prepare a v1.5 multi-backend driver layer.

**Scope:** 15 phases — 13 from the source plan (artifact phases 0–12) plus two retrofit phases (9, 10) added 2026-05-06 after the VBW gap analysis, which exposed two needed deliverables that were under-scoped: the methodology runtime and template fidelity.

## Progress
| Phase | Status | Plans | Tasks | Commits |
|-------|--------|-------|-------|---------|
| 01 | ● Done |
| 02 | ● Done |
| 03 | ● Done |
| 04 | ● Done |
| 05 | ● Done |
| 06 | ● Done |
| 07 | ● Done |
| 08 | ● Done |
| 09 | ● Done |
| 10 | ● Done |
| 11 | ● Done |
| 12 | ● Done |
| 13 | ● Done |
| 14 | ● Done |
| 15 | ● Done |

---

## Phase List
- [x] [Phase 1: Repo & org setup](#phase-1-repo--org-setup)
- [x] [Phase 2: Foundation](#phase-2-foundation)
- [x] [Phase 3: Core abstractions](#phase-3-core-abstractions)
- [x] [Phase 4: Codex backend driver](#phase-4-codex-backend-driver)
- [x] [Phase 5: Methodology authoring](#phase-5-methodology-authoring)
- [x] [Phase 6: Commands](#phase-6-commands)
- [x] [Phase 7: Artifacts engine](#phase-7-artifacts-engine)
- [x] [Phase 8: Verification & QA](#phase-8-verification--qa)
- [x] [Phase 9: Methodology runtime (retrofit)](#phase-9-methodology-runtime-retrofit)
- [x] [Phase 10: Template fidelity (retrofit)](#phase-10-template-fidelity-retrofit)
- [x] [Phase 11: Documentation site](#phase-11-documentation-site)
- [x] [Phase 12: Distribution](#phase-12-distribution)
- [x] [Phase 13: Beta & feedback](#phase-13-beta--feedback)
- [x] [Phase 14: v1.0 launch](#phase-14-v10-launch)
- [x] [Phase 15: v1.5 forward-compatibility prep](#phase-15-v15-forward-compatibility-prep)

---

## Phase 1: Repo & org setup
*(Artifact Phase 0)*

**Goal:** Stand up swt-labs org and stop-wasting-tokens repo with branding, license, contributing guide, and minimum viable README.

**Requirements:** REQ-01

**Success Criteria:**
- Repo exists with README, MIT LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY
- npm package name `stop-wasting-tokens` reserved
- VBW sunset announcement pinned

**Dependencies:** None

---

## Phase 2: Foundation
*(Artifact Phase 1)*

**Goal:** TypeScript monorepo, build tooling, CI/CD scaffolding, package layout.

**Requirements:** REQ-01, REQ-17

**Success Criteria:**
- `pnpm install && pnpm build && pnpm test` passes from a fresh clone
- Node 20 and 22 supported on Linux/macOS/Windows
- Changesets initialised; release workflow drafted

**Dependencies:** Phase 1

---

## Phase 3: Core abstractions
*(Artifact Phase 2)*

**Goal:** Define and document the four backend-agnostic interfaces (HookHost, AgentSpawner, PermissionGate, MemoryStore) with handoff schemas.

**Requirements:** REQ-04, REQ-07

**Success Criteria:**
- `packages/core` exports typed interfaces and Zod handoff schemas
- Mock backend driver covers type contracts
- Vitest tests pass for schema parse/validate, profile resolution, error formatting

**Dependencies:** Phase 2

---

## Phase 4: Codex backend driver
*(Artifact Phase 3)*

**Goal:** Implement `packages/codex-driver` end-to-end against the Codex CLI.

**Requirements:** REQ-02, REQ-13

**Success Criteria:**
- Driver emits 6 agent TOMLs and a valid hooks.json
- `codex exec` launches with correct sandbox/approval flags
- Driver parses --json output stream and `codex resume` integration works

**Dependencies:** Phase 3

---

## Phase 5: Methodology authoring
*(Artifact Phase 4)*

**Goal:** Author the six agents (TOML + behavioural specs), the SWT skills, the cache-aware prompt builder, memory model, and effort/autonomy resolution.

**Requirements:** REQ-03, REQ-05, REQ-08, REQ-11

**Success Criteria:**
- All six agents spawn under agents.max_threads = 6
- Each skill auto-matches an obvious user prompt
- Prompt builder produces a stable static prefix across sessions for a given config

**Dependencies:** Phase 4

---

## Phase 6: Commands
*(Artifact Phase 5)*

**Goal:** Implement the full `swt` CLI command surface.

**Requirements:** REQ-12

**Success Criteria:**
- All 28+ swt verbs implemented with help text
- Each command has at least smoke-test coverage
- Command reference docs auto-generated from source

**Dependencies:** Phase 5

---

## Phase 7: Artifacts engine
*(Artifact Phase 6)*

**Goal:** Reliable PROJECT/REQUIREMENTS/ROADMAP/STATE pipeline plus per-phase PLAN/SUMMARY/VERIFICATION generation.

**Requirements:** REQ-06

**Success Criteria:**
- Round-trip: SWT writes artefacts, external editor edits, SWT re-reads without data loss
- YAML frontmatter validates against schema
- Traceability links: REQUIREMENTS ↔ ROADMAP ↔ PLAN ↔ SUMMARY ↔ VERIFICATION

**Dependencies:** Phase 6

---

## Phase 8: Verification & QA
*(Artifact Phase 7)*

**Goal:** Continuous QA via hooks during builds, deep verification on demand via `swt qa`, goal-backward methodology.

**Requirements:** REQ-09, REQ-10, REQ-13, REQ-14

**Success Criteria:**
- PreToolUse bash-guard, file-guard, security-filter implemented
- PostToolUse SUMMARY/commit/frontmatter validation implemented
- `swt qa` runner ships three tiers (quick/standard/deep) with documented coverage targets

**Dependencies:** Phase 7

---

## Phase 9: Methodology runtime (retrofit)
*(Inserted 2026-05-06 after the VBW gap analysis under `.vbw-planning/research/swt-vs-vbw-gap-analysis.md`. Has no artifact-phase analogue.)*

**Goal:** Port the methodology runtime from VBW so that `swt vibe`, `swt plan`, `swt execute`, `swt qa`, `swt verify`, `swt discuss`, and the UAT remediation flow stop being stubs and actually orchestrate Scout → Lead → Dev → QA → UAT.

**Requirements:** REQ-03, REQ-05, REQ-08, REQ-09, REQ-10, REQ-11, REQ-12

**Success Criteria:**
- `phase-detect` (TypeScript port of VBW's 1,604-line state-detection script) returns the same `next_phase_state` decision for every fixture as the VBW reference.
- `swt vibe` end-to-end on a fresh project: bootstrap → scope → plan → execute → qa → verify (UAT) → archive without manual intervention.
- UAT remediation pipeline closes: phase-level VERIFICATION.md FAIL routes to round-01 plan, dev, QA, gate, and re-verify until PASS or `max_uat_remediation_rounds` cap.
- Discussion engine (`/vbw:vibe --discuss`) runs the calibrate / gray-area / capture protocol against AskUserQuestion-equivalent input.
- Compaction circuit breaker integrates with a real `PreCompact`-equivalent hook.

**Dependencies:** Phase 8

---

## Phase 10: Template fidelity (retrofit)
*(Inserted 2026-05-06 after the VBW gap analysis. Has no artifact-phase analogue.)*

**Goal:** Bring SWT's PLAN, SUMMARY, VERIFICATION, UAT, RESEARCH, and remediation templates up to VBW shape so that QA, the deterministic gate, and UAT remediation operate against the same contract VBW does.

**Requirements:** REQ-06, REQ-07, REQ-09

**Success Criteria:**
- PLAN.md frontmatter carries `must_haves: { truths[], artifacts[], key_links[] }` plus `cross_phase_deps`, `effort_override`, `forbidden_commands`, `skills_used`, `files_modified`.
- SUMMARY.md frontmatter carries `ac_results: [{criterion, verdict, evidence}]` and `pre_existing_issues`.
- VERIFICATION.md carries `tier`, `result: PASS|FAIL|PARTIAL`, `passed/failed/total`, `plans_verified`, plus the Must-Have / Artifact / Key-Link / Anti-pattern / Convention / Requirement-mapping tabular sections.
- UAT.md, DEBUG-SESSION.md, RESEARCH.md, STANDALONE-RESEARCH.md, REMEDIATION-PLAN.md, REMEDIATION-RESEARCH.md, REMEDIATION-SUMMARY.md, CONTEXT.md, MILESTONE-CONTEXT.md ship as both Zod schemas and template strings in `@swt-labs/artifacts/templates/`.
- Round-trip: VBW-generated PLAN/SUMMARY/VERIFICATION parse cleanly through SWT's schemas without data loss.

**Dependencies:** Phase 9

---

## Phase 11: Documentation site
*(Artifact Phase 8)*

**Goal:** Publish a docs site at docs.stopwastingtokens.dev covering getting-started, concepts, reference, recipes, and v1.5 roadmap.

**Requirements:** REQ-18

**Success Criteria:**
- Mintlify (or Docusaurus) site live and indexed
- Migration guide from VBW published
- `vale` prose linting in CI passes

**Dependencies:** Phase 10

---

## Phase 12: Distribution
*(Artifact Phase 9)*

**Goal:** Reliable npm publishing, semantic versioning, automated changelog, install scripts, plugin marketplace listing.

**Requirements:** REQ-17, REQ-19

**Success Criteria:**
- v0.1.0-alpha published on npm with provenance
- `swt update` works against the published package
- Codex Plugin Marketplace listing accepted

**Dependencies:** Phase 11

---

## Phase 13: Beta & feedback
*(Artifact Phase 10)*

**Goal:** Closed-beta channel, working feedback loop, opt-in telemetry.

**Requirements:** REQ-19

**Success Criteria:**
- Discord server live with code-of-conduct
- 10 beta users onboarded from VBW community
- Top-10 friction reports triaged and addressed

**Dependencies:** Phase 12

---

## Phase 14: v1.0 launch
*(Artifact Phase 11)*

**Goal:** Final security review, docs sweep, launch artefacts, and VBW deprecation.

**Requirements:** _(none specific — cross-cutting)_

**Success Criteria:**
- RELEASE-NOTES-v1.0 published
- 5–8 minute demo video and launch blog post live
- VBW README points to SWT and VBW v1.0.97-final archived

**Dependencies:** Phase 13

---

## Phase 15: v1.5 forward-compatibility prep
*(Artifact Phase 12)*

**Goal:** Audit core abstractions for Codex-specific leakage and stub the Claude Code / Ollama drivers for v1.5.

**Requirements:** REQ-20

**Success Criteria:**
- Stub packages compile with `Not implemented` errors as expected
- `docs/roadmap/v1.5.md` published
- UI/dashboard design notes committed (Ink TUI vs web)

**Dependencies:** Phase 14
