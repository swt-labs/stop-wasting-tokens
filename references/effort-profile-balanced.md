# Balanced Profile (EFRT-02)

**Recommended model profile:** Balanced | **Use when:** Standard development work, most phases. The recommended default.

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
| Lead | high | Solid research, clear decomposition, coverage+feasibility self-review |
| Architect | high | Complete scope, clear criteria, standard dependency justification |
| Dev | medium | Focused implementation, standard verification, concise commits |
| QA | medium | Standard tier (15-25 checks). Content structure, key links, conventions |
| Scout | medium | Targeted research, one source per finding. Runs on session model (Opus) |
| Debugger | medium | Focused investigation, rank-order hypotheses, stop on confirmation |

## Plan Approval (EFRT-07)

| Autonomy | Gate |
|----------|------|
| cautious | required |
| standard | OFF |
| confident / pure-vibe | OFF |

## Effort Parameter Mapping

| Level | Behavior |
|-------|----------|
| high | Deep reasoning with focused scope |
| medium | Moderate reasoning depth, standard exploration |

Per-invocation override: `--effort=balanced` overrides config default for one invocation (EFRT-05).
