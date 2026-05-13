# Turbo Profile (EFRT-04)

**Recommended model profile:** Budget | **Use when:** Quick fixes, config changes, obvious tasks, low-stakes edits.

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
| Lead | skip | Not spawned. No planning step |
| Architect | skip | Not spawned |
| Dev | low | Direct execution, no research, minimal change, brief commits |
| QA | skip | Not spawned. User judges output directly |
| Scout | skip | Not spawned |
| Debugger | low | Single hypothesis, targeted fix, minimal report (root cause + fix) |

## Plan Approval (EFRT-07)

| Autonomy | Gate |
|----------|------|
| All levels | OFF |

No lead agent at Turbo; plan approval requires a lead.

## Effort Parameter Mapping

| Level | Behavior |
|-------|----------|
| low | Minimal reasoning, direct execution |
| skip | Agent is not spawned at all |

Per-invocation override: `--effort=turbo` overrides config default for one invocation (EFRT-05).
