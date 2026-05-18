/**
 * `update_plan` Pi extension — Codex parity shim.
 *
 * Phase 17 plan 04-01 Task 1.
 *
 * Registers a Pi customTool whose JSON contract mirrors Codex's
 * `plan_tool.rs` byte-for-byte:
 *
 *   `UpdatePlanArgs { plan: PlanItemArg[], explanation?: string }`
 *   `PlanItemArg   { step: string, status: 'pending' | 'in_progress' | 'completed' }`
 *
 * Upstream source: `a_non_production_files/codex-main/codex-rs/protocol/src/plan_tool.rs`
 * (pinned at SHA 22dd9ad). The Zod `.strict()` calls mirror Rust's
 * `#[serde(deny_unknown_fields)]` so unknown fields are rejected at the
 * parse boundary rather than silently dropped.
 *
 * Pi 0.74 surface (mirror of `apply_patch`):
 *   - Registered via `pi.registerTool({...})` with a JSON-Schema parameters
 *     object — Pi has no first-class enum-narrowing on `status`, so the
 *     schema emits `status: { type: 'string', description: '...' }` and
 *     the Zod schema does the narrower validation inside `execute`.
 *   - On successful parse: `pi.appendEntry('cook.plan_update', parsedArgs)`
 *     exactly once. The dashboard reducer consumes this entry from the
 *     cook events JSONL channel and renders it inline in the unified-log
 *     monospace lane via REPLACE semantics (replace the most-recent
 *     `cook-plan-update` entry for the same session — see
 *     `dashboard-store.handleCookEvent` `cook.plan_update` branch).
 *   - On Zod rejection: structured text-error result; `pi.appendEntry`
 *     is NOT called. The Pi runtime's own validator may pre-check JSON
 *     shape, but this guard handles non-validating patch releases.
 *
 * D7 — no feature flags, no parallel paths, no `.bak`. Wire it cleanly the
 * first time. The factory shape is `(opts?) => (pi) => void`, mirroring
 * `buildApplyPatchExtension` exactly so `SpawnAgentExtension.factory`
 * remains a uniform signature.
 *
 * R06 — the `execute` callback has zero filesystem writes. It validates,
 * calls `pi.appendEntry`, and returns the literal `"Plan updated"` text
 * result. No `.vbw-planning/` writes from runtime.
 */

import { z } from 'zod';

import type { PiExtensionAPI, PiToolExecuteResult } from './pi-types.js';

export const UPDATE_PLAN_TOOL_NAME = 'update_plan';

/**
 * Tool description shown to the model — verbatim Codex `plan_spec.rs`
 * (Codex/upstream cache @ SHA 22dd9ad). Future maintainers replaying drift
 * compare against the citation tail below.
 */
export const TOOL_DESCRIPTION =
  'Updates the task plan. Provide an optional explanation and a list of plan items, each with a step and status. At most one step can be in_progress at a time.';

/**
 * JSON Schema handed to Pi's `registerTool`. Mirrors Codex's
 * `plan_tool.rs::PARAMETERS_JSON_SCHEMA` — `additionalProperties: false`
 * enforces the same shape Rust's `#[serde(deny_unknown_fields)]` does at
 * the Pi-validator layer; the Zod `.strict()` calls inside `execute` are
 * the second line of defence for Pi patch releases whose validator does
 * not honor `additionalProperties`.
 *
 * `status` is emitted as `type: 'string'` to Pi (no `enum` in the JSON
 * schema): Pi 0.74 enum-narrowing on tool parameters is uneven across
 * providers, so the Zod enum below does the narrower validation.
 */
export const PARAMETERS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['plan'],
  additionalProperties: false,
  properties: {
    explanation: { type: 'string' },
    plan: {
      type: 'array',
      description: 'The list of steps',
      items: {
        type: 'object',
        required: ['step', 'status'],
        additionalProperties: false,
        properties: {
          step: { type: 'string' },
          status: {
            type: 'string',
            description: 'One of: pending, in_progress, completed',
          },
        },
      },
    },
  },
};

export const PlanItemArgSchema = z
  .object({
    step: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  })
  .strict();

export const UpdatePlanArgsSchema = z
  .object({
    plan: z.array(PlanItemArgSchema),
    explanation: z.string().optional(),
  })
  .strict();

export type PlanItemArg = z.infer<typeof PlanItemArgSchema>;
export type UpdatePlanArgs = z.infer<typeof UpdatePlanArgsSchema>;

/**
 * Reserved for future test injections (currently empty). Kept on the
 * factory signature so additions don't force a downstream version bump
 * and the shape mirrors `buildApplyPatchExtension`'s
 * `BuildApplyPatchExtensionOptions`. Modelled as a `Record<string, never>`
 * to satisfy the eslint `@typescript-eslint/no-empty-object-type` rule.
 */
export type BuildUpdatePlanExtensionOptions = Record<string, never>;

/**
 * Build the `update_plan` Pi extension factory. Shape exactly mirrors
 * `buildApplyPatchExtension`:
 *   `(opts?) => (pi: PiExtensionAPI) => void`.
 *
 * Production omits `opts`. Future tests may inject seams here.
 */
export function buildUpdatePlanExtension(
  _opts: BuildUpdatePlanExtensionOptions = {},
): (pi: PiExtensionAPI) => void {
  return function updatePlanExtension(pi: PiExtensionAPI): void {
    pi.registerTool<unknown>({
      name: UPDATE_PLAN_TOOL_NAME,
      label: 'Update the task plan',
      description: TOOL_DESCRIPTION,
      promptSnippet:
        'update_plan — record the current task plan as an ordered list of (step, status) pairs',
      promptGuidelines: [
        'Provide an optional `explanation` paragraph that motivates the plan.',
        'Each plan item is `{ step: string, status: "pending" | "in_progress" | "completed" }`.',
        'At most one step may be `in_progress` at a time.',
        'Re-call `update_plan` after every meaningful state change — calls REPLACE the previous plan; they do not append.',
      ],
      parameters: PARAMETERS_JSON_SCHEMA,
      async execute(
        _toolCallId,
        rawParams,
        _signal,
        _onUpdate,
        _ctx,
      ): Promise<PiToolExecuteResult> {
        const parsed = UpdatePlanArgsSchema.safeParse(rawParams);
        if (!parsed.success) {
          // Mirror apply_patch's structured-error result shape — string
          // content with the Zod issue summary. DO NOT call appendEntry
          // when the parse fails (per plan must_have: "On Zod
          // strict-rejection ... does NOT call pi.appendEntry").
          const summary = parsed.error.issues
            .map((iss) => `${iss.path.join('.') || '(root)'}: ${iss.message}`)
            .join('; ');
          return {
            content: [
              {
                type: 'text',
                text: `update_plan: invalid arguments — ${summary}`,
              },
            ],
          };
        }
        pi.appendEntry('cook.plan_update', parsed.data);
        return {
          content: [
            {
              type: 'text',
              text: 'Plan updated',
            },
          ],
        };
      },
    });
  };
}

/**
 * Default extension instance — equivalent to `buildUpdatePlanExtension()`
 * with no overrides. Symmetric with `applyPatchExtension` /
 * `resultProtocolExtension` defaults.
 */
export default buildUpdatePlanExtension();
