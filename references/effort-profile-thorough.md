# Thorough Profile (EFRT-01)

**Recommended model profile:** Quality | **Use when:** Critical features, complex architecture, production-impacting changes.

## Effort vs Model Profile

**Effort controls:** Planning depth, verification thoroughness, research scope (workflow behavior)
**Model profile controls:** Which Claude model each agent uses (cost optimization)

These are independent settings. You can run Thorough effort on Budget profile (deep workflow, cheap models) or Fast effort on Quality profile (quick workflow, expensive models). Most users: match them (balanced+balanced, thorough+quality, fast+budget).

Configure via:
- Effort: `swt config effort <level>` or `swt cook --effort=<level>`
- Model: `swt config model_profile <profile>`

See: @references/model-profiles.md for model profile details.

## Matrix Row

| Agent | Level | Notes |
|-------|-------|-------|
| Lead | max | Exhaustive research, detailed decomposition, full self-review |
| Architect | max | Comprehensive scope, full requirement mapping, traceability matrix |
| Dev | high | `plan_mode_required` -- read-only until lead approves. Thorough inline verification |
| QA | high | Deep tier (30+ checks). Full anti-pattern scan, requirement mapping |
| Scout | high | Broad research, cross-reference, adjacent topics. Runs on session model (Opus) |
| Debugger | high | All 3 hypotheses tested. Full regression suite. Detailed report |

## Plan Approval (EFRT-07)

| Autonomy | Gate |
|----------|------|
| cautious | required |
| standard | required |
| confident / pure-vibe | OFF |

Platform-enforced: Dev cannot write files until lead approves.

## Effort Parameter Mapping

| Level | Behavior |
|-------|----------|
| max | No effort override (default maximum reasoning) |
| high | Deep reasoning with focused scope |

Per-invocation override: `--effort=thorough` overrides config default for one invocation (EFRT-05).
