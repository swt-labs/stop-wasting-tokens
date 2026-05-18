import { describe, expect, it } from 'vitest';

import type {
  PiExtensionAPI,
  PiExtensionContext,
  PiToolDefinition,
} from '../../src/extensions/pi-types.js';
import {
  UPDATE_PLAN_TOOL_NAME,
  buildUpdatePlanExtension,
} from '../../src/extensions/update-plan-tool.js';

/**
 * Phase 17 plan 04-01 Task 4 — `update_plan` Pi customTool registration
 * + execute callback tests.
 *
 * Mirrors the `apply-patch-tool.test.ts` precedent (Scout §G.1). The
 * factory is a `(pi) => void` Pi extension builder; we drive it with a
 * recording `PiExtensionAPI` shim that captures the single
 * `registerTool` call and every `pi.appendEntry` invocation.
 *
 * Coverage maps to the plan's `must_haves`:
 *   1.  tool name shown to the model is the literal "update_plan"
 *   2.  description contains the verbatim Codex tail phrase
 *   3.  parameters JSON schema shape (type / required / additionalProperties)
 *   4.  valid args → pi.appendEntry('cook.plan_update', parsedArgs) once
 *   5.  valid args → success returns the literal "Plan updated"
 *   6.  explanation absent still succeeds
 *   7.  PlanItemArg extra field is rejected; appendEntry NOT called
 *   8.  invalid status enum value is rejected; appendEntry NOT called
 *   9.  missing required plan field is rejected; appendEntry NOT called
 *   10. empty plan: [] is ACCEPTED — matches Codex Vec<PlanItemArg>
 */

function makeRecordingPi(): {
  pi: PiExtensionAPI;
  registered: PiToolDefinition[];
  appended: Array<{ customType: string; data: unknown }>;
} {
  const registered: PiToolDefinition[] = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const pi: PiExtensionAPI = {
    registerTool<TParams = unknown>(def: PiToolDefinition<TParams>): void {
      registered.push(def);
    },
    on() {
      // unused by update_plan
    },
    appendEntry(customType, data) {
      appended.push({ customType, data });
    },
  };
  return { pi, registered, appended };
}

function makeCtx(cwd: string): PiExtensionContext {
  return { cwd, sessionManager: { getEntries: () => [] } };
}

describe('buildUpdatePlanExtension — tool registration', () => {
  it('1. factory invokes registerTool exactly once with name "update_plan"', () => {
    const { pi, registered } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).toBe(UPDATE_PLAN_TOOL_NAME);
    expect(registered[0]?.name).toBe('update_plan');
  });

  it('2. tool description contains the verbatim Codex plan_spec.rs tail phrase', () => {
    const { pi, registered } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const desc = registered[0]?.description ?? '';
    expect(desc).toMatch(/Updates the task plan\./);
    expect(desc).toMatch(/At most one step can be in_progress at a time\./);
  });

  it('3. parameters JSON schema has type:object, required:[plan], additionalProperties:false', () => {
    const { pi, registered } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const params = registered[0]?.parameters as Record<string, unknown>;
    expect(params['type']).toBe('object');
    expect(params['required']).toEqual(['plan']);
    expect(params['additionalProperties']).toBe(false);
    const props = params['properties'] as Record<string, unknown>;
    const plan = props['plan'] as Record<string, unknown>;
    expect(plan['type']).toBe('array');
    const planItems = plan['items'] as Record<string, unknown>;
    expect(planItems['type']).toBe('object');
    expect(planItems['required']).toEqual(['step', 'status']);
    expect(planItems['additionalProperties']).toBe(false);
  });
});

describe('buildUpdatePlanExtension — execute callback', () => {
  it('4. valid UpdatePlanArgs → pi.appendEntry called once with customType cook.plan_update', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const args = {
      plan: [
        { step: 'first step', status: 'completed' },
        { step: 'second step', status: 'in_progress' },
        { step: 'third step', status: 'pending' },
      ],
      explanation: 'starting work',
    };
    await tool.execute('tc-1', args, undefined, undefined, makeCtx('/proj'));
    expect(appended).toHaveLength(1);
    expect(appended[0]?.customType).toBe('cook.plan_update');
    expect(appended[0]?.data).toEqual(args);
  });

  it('5. execute with valid args returns the literal "Plan updated" tool-result text', async () => {
    const { pi, registered } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-2',
      { plan: [{ step: 'do thing', status: 'pending' }] },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toBe('Plan updated');
  });

  it('6. execute with explanation absent → still succeeds; appendEntry called once', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-3',
      { plan: [{ step: 'sole step', status: 'completed' }] },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toBe('Plan updated');
    expect(appended).toHaveLength(1);
    expect(appended[0]?.customType).toBe('cook.plan_update');
    // Optional-field semantics: when omitted at the boundary, the parsed
    // data object must NOT carry an `explanation` key (Zod strict() drops
    // unknown keys; optional() makes it OK to omit).
    const data = appended[0]?.data as Record<string, unknown>;
    expect('explanation' in data).toBe(false);
  });

  it('7. execute with extra field on PlanItemArg → strict rejection; appendEntry NOT called', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-4',
      { plan: [{ step: 'x', status: 'pending', priority: 'high' }] },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/invalid arguments/);
    expect(appended).toHaveLength(0);
  });

  it('8. execute with unknown status value (e.g. "blocked") → strict rejection; appendEntry NOT called', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-5',
      { plan: [{ step: 'x', status: 'blocked' }] },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/invalid arguments/);
    expect(appended).toHaveLength(0);
  });

  it('9. execute with missing required "plan" field → rejection; appendEntry NOT called', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-6',
      { explanation: 'no plan here' },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/invalid arguments/);
    expect(appended).toHaveLength(0);
  });

  it('10. execute with plan: [] (empty array) → ACCEPTED; appendEntry called with data.plan = []', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute('tc-7', { plan: [] }, undefined, undefined, makeCtx('/proj'));
    expect(result.content[0]?.text).toBe('Plan updated');
    expect(appended).toHaveLength(1);
    const data = appended[0]?.data as { plan: unknown[] };
    expect(Array.isArray(data.plan)).toBe(true);
    expect(data.plan).toHaveLength(0);
  });

  it('rejects an unknown top-level field on UpdatePlanArgs (strict on the outer object)', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-8',
      { plan: [], rogue_field: 42 },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/invalid arguments/);
    expect(appended).toHaveLength(0);
  });

  it('accepts each status value (pending / in_progress / completed)', async () => {
    const { pi, registered, appended } = makeRecordingPi();
    buildUpdatePlanExtension()(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-9',
      {
        plan: [
          { step: 'a', status: 'pending' },
          { step: 'b', status: 'in_progress' },
          { step: 'c', status: 'completed' },
        ],
      },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toBe('Plan updated');
    expect(appended).toHaveLength(1);
  });
});
