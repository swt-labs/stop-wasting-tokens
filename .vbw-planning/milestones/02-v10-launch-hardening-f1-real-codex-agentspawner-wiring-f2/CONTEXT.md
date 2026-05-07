# stop-wasting-tokens — Milestone Context

Gathered: 2026-05-06
Calibration: architect

## Scope Boundary

Close the v1.0 launch audit findings (5 criticals + 4 majors) and deliver the 8 stable Fn features tracked in `docs/roadmap/v1.5.md`. Audit fixes ride together in Phase 1 because they're all small text/wiring changes; Fn features fan out into Phases 2-5 grouped by domain coupling rather than 1-Fn-per-phase.

**In scope:**
- C1-C5 + M1, M3, M6, M7 from the v1.0 audit (Phase 1)
- F1 — Real Codex AgentSpawner wiring (Phase 2)
- F2 + F3 — Claude Code + Ollama drivers (Phase 3)
- F4 + F5 + F8 — Ink TUI, marketplace integration, telemetry HTTP sender (Phase 4)
- F6 + F7 — Auto-derived reference docs + hook event taxonomy expansion (Phase 5)

**Explicitly excluded:**
- M2 — Project root `CLAUDE.md` rewrite to SWT-driven instructions. Developer-local; only matters once we dogfood SWT on itself, which is post-v1.5.
- v2 items (web UI, hosted SaaS, multi-tenant) — surfaced in `docs/roadmap/v1.5.md` "Beyond v1.5" but not promised here.

## Decomposition Decisions

### Phase Count & Grouping

5 phases. The natural shape is 1 hardening pass + 4 feature buckets:

- **Phase 1 (audit hardening)** is its own phase rather than a long-tail of in-progress fixes because the C-tier items are launch-blocking for a credible v1.0 — bundling them gives one PR / one commit boundary / one verification pass to close them all.
- **Phase 2 (F1) stands alone** because it's the cornerstone everything else lifts through. Real AgentSpawner wiring is the first place SWT actually executes against the live Codex CLI; it has to land first and be stable before F2/F3 build on its interface.
- **Phase 3 bundles F2 + F3** because both drivers consume F1's interface in lockstep. Splitting them would risk interface drift between the Claude Code and Ollama drivers — landing them together forces the AgentSpawner contract to stay backend-agnostic from day one. Cost: Phase 3 is the heaviest (~9 weeks), but the verification pass covers two drivers at once.
- **Phase 4 bundles F4 + F5 + F8** because they're three independent S/M-complexity user-facing additions that share no driver coupling. Bundling them avoids three thin phases.
- **Phase 5 bundles F6 + F7** because both are methodology-internal infrastructure — neither surfaces in user workflows directly, and they share the "improves how the runtime is consumed by docs/hooks" theme.

### Phase Ordering

1. **v1.0 launch hardening** first — every other phase is harder to land cleanly while AGENTS.md / `## VBW Rules` / placeholder schemas are still in product code.
2. **F1 (real AgentSpawner)** second — F2/F3 lift through F1's interface, so F1 must stabilise the contract first.
3. **F2 + F3 (multi-backend drivers)** third — depends on F1; landing both together prevents interface drift.
4. **F4 + F5 + F8 (user-facing surfaces)** fourth — independent of F1/F2/F3 in principle, but conventionally lands after the driver foundation so the TUI / marketplace / telemetry can speak the real driver vocabulary.
5. **F6 + F7 (methodology infra)** last — F7's load-bearing implementations need F2 (Claude Code 12-event hooks) so the new events have a non-Codex driver to validate against. F6 is independent but lands here for cohesion.

### Scope Coverage

Covered: all 5 audit criticals (C1-C5), 4 of 7 audit majors (M1, M3, M6, M7), all 8 v1.5 Fn features (F1-F8).

Excluded: M2 (developer-local), M4 (RELEASE-NOTES/CHANGELOG VBW lineage — keep as-is, intentional credit), M5 (docs landing page VBW positioning — intentional marketing). Out-of-scope by config: v2 items.

## Requirement Mapping

| Phase | REQ-IDs |
|-------|---------|
| 01-launch-hardening | REQ-02, REQ-06, REQ-17, REQ-19 |
| 02-codex-spawner | REQ-02, REQ-04 |
| 03-multi-backend-drivers | REQ-04, REQ-20 |
| 04-user-surfaces | REQ-12, REQ-19 (plus telemetry contract from `@swt-labs/telemetry`) |
| 05-methodology-infra | REQ-13, REQ-18 |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Bundle audit fixes into one phase rather than split per critical | All C-tier and bundled M-tier items are small text/wiring changes; one verification pass closes them cleanly. |
| Bundle F2 + F3 into one phase | Both consume F1's AgentSpawner interface; landing together forces the contract to stay backend-agnostic and prevents interface drift. |
| Defer M2 (root CLAUDE.md → SWT-driven instructions) to post-v1.5 | Developer-local file; only matters when we dogfood SWT on itself, which is contingent on Phase 2-3 completing. |
| Keep VBW lineage acknowledgements in RELEASE-NOTES / CHANGELOG / docs landing | Intentional credit + marketing positioning; not residue. |

## Deferred Ideas

- Web-based dashboard (UI Option B) — re-evaluate after Ink TUI ships in Phase 4
- Hosted SaaS / cloud orchestration — v2 candidate
- Multi-tenant team workflows — v2 candidate
- IDE extensions — v2 candidate, relying on Codex/Claude Code CLI for now
- Codex CLI version pin guidance (`>= 0.124.0` for stable hooks) — fold into Phase 2 doctor command if F1 surfaces version-dependent behaviour
