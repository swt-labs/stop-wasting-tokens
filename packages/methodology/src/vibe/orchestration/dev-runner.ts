import type { AgentSpec, AgentSpawner, DevSummaryPayload, SpawnResult } from '@swt-labs/core';

import type { PlanRecord } from './waves.js';

export interface DevRunInput {
  readonly phase: string;
  readonly plan: PlanRecord;
  readonly phaseDir: string;
  readonly spec: AgentSpec;
  readonly spawner: AgentSpawner;
  readonly cwd: string;
  readonly sessionId: string;
}

export interface DevRunResult {
  readonly plan: PlanRecord;
  readonly raw: SpawnResult;
  /** Parsed Dev summary payload, when the spawner returned one. */
  readonly summary: DevSummaryPayload | undefined;
  /** True when no usable summary was returned. */
  readonly degraded: boolean;
}

/**
 * Drive a single Dev work-unit. Composes a SpawnRequest and parses the
 * structured handoff into a DevSummaryPayload when present. Falls back to a
 * synthesized summary (status: partial) when the spawner returns text only.
 */
export async function runDev(input: DevRunInput): Promise<DevRunResult> {
  const result = await input.spawner.spawn({
    spec: input.spec,
    prompt: composePrompt(input),
    cwd: input.cwd,
    session_id: input.sessionId,
  });

  if (result.handoff !== undefined) {
    const payload = result.handoff as Record<string, unknown>;
    const possibleSummary = (payload.payload ?? payload) as DevSummaryPayload | undefined;
    if (looksLikeDevSummary(possibleSummary)) {
      return { plan: input.plan, raw: result, summary: possibleSummary, degraded: false };
    }
  }
  return { plan: input.plan, raw: result, summary: undefined, degraded: !result.success };
}

function composePrompt(input: DevRunInput): string {
  return [
    `# Dev work unit — Phase ${input.phase} / Plan ${input.plan.plan}`,
    '',
    `Title: ${input.plan.title}`,
    `Wave: ${input.plan.wave}`,
    input.plan.depends_on.length > 0 ? `Depends on: ${input.plan.depends_on.join(', ')}` : '',
    '',
    `Read the plan at ${input.phaseDir}/${input.phase}-${input.plan.plan}-PLAN.md and execute it task-by-task.`,
    `Persist a summary at ${input.phaseDir}/${input.phase}-${input.plan.plan}-SUMMARY.md.`,
    '',
    `Project root: ${input.cwd}.`,
    `Session: ${input.sessionId}.`,
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

function looksLikeDevSummary(value: unknown): value is DevSummaryPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<DevSummaryPayload>;
  return (
    typeof v.phase === 'string' &&
    typeof v.plan === 'string' &&
    typeof v.status === 'string' &&
    typeof v.tasks_completed === 'number' &&
    typeof v.tasks_total === 'number'
  );
}
