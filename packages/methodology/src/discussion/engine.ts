import type { Prompter } from '@swt-labs/core';

import { inferCalibration } from './calibrate.js';
import { generateGrayAreas } from './gray-areas.js';
import type {
  Calibration,
  CalibrationSignals,
  DiscoveryAnswer,
  DiscoveryPayload,
  DiscussionContext,
} from './types.js';

export interface RunDiscussionEngineInput {
  readonly prompter: Prompter;
  readonly context: DiscussionContext;
  readonly signals?: CalibrationSignals;
}

export interface DiscussionEngineResult {
  readonly calibration: Calibration;
  readonly payload: DiscoveryPayload;
}

export async function runDiscussionEngine(
  input: RunDiscussionEngineInput,
): Promise<DiscussionEngineResult> {
  const calibration = inferCalibration({
    description: input.context.description,
    hints: input.signals?.hints,
    ...(input.signals?.forced !== undefined ? { forced: input.signals.forced } : {}),
  });
  const grayAreas = generateGrayAreas({
    mode: input.context.mode,
    context: input.context,
    calibration,
  });

  const answered: DiscoveryAnswer[] = [];
  const inferred: DiscoveryAnswer[] = [];
  const deferred: DiscoveryAnswer[] = [];

  for (const area of grayAreas) {
    if (area.kind === 'choice') {
      const value = await input.prompter.askChoice<string>({
        prompt: area.prompt,
        options: area.options ?? [],
        ...(area.defaultValue !== undefined ? { defaultValue: area.defaultValue } : {}),
      });
      const decision: DiscoveryAnswer['decision'] = value === 'defer' ? 'deferred' : 'answered';
      const source: DiscoveryAnswer['source'] =
        area.recommendation !== undefined && value === area.recommendation
          ? 'recommendation'
          : 'user';
      const answer: DiscoveryAnswer = {
        id: area.id,
        topic: area.topic,
        decision,
        value,
        rationale: source === 'recommendation' ? `default recommendation` : 'user choice',
        source,
      };
      pushTarget(answer, answered, deferred);
      continue;
    }

    const value = await input.prompter.askText({
      prompt: area.prompt,
      ...(area.defaultValue !== undefined ? { defaultValue: area.defaultValue } : {}),
      ...(area.required === true ? { required: true } : {}),
    });
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      if (area.defaultValue !== undefined) {
        inferred.push({
          id: area.id,
          topic: area.topic,
          decision: 'inferred',
          value: area.defaultValue,
          rationale: 'engine default',
          source: 'engine',
        });
      } else {
        deferred.push({
          id: area.id,
          topic: area.topic,
          decision: 'deferred',
          value: '',
          rationale: 'no answer provided',
          source: 'user',
        });
      }
      continue;
    }
    if (trimmed.toLowerCase() === 'defer') {
      deferred.push({
        id: area.id,
        topic: area.topic,
        decision: 'deferred',
        value: '',
        rationale: 'user deferred',
        source: 'user',
      });
      continue;
    }
    answered.push({
      id: area.id,
      topic: area.topic,
      decision: 'answered',
      value: trimmed,
      rationale: 'user answer',
      source: 'user',
    });
  }

  return {
    calibration,
    payload: { answered, inferred, deferred },
  };
}

function pushTarget(
  answer: DiscoveryAnswer,
  answered: DiscoveryAnswer[],
  deferred: DiscoveryAnswer[],
): void {
  if (answer.decision === 'deferred') {
    deferred.push(answer);
    return;
  }
  answered.push(answer);
}
