import { describe, expect, it } from 'vitest';

import { runDiscussionEngine } from '../../src/discussion/engine.js';
import { ScriptedPrompter } from '../../../core/test/mock-driver.js';

describe('runDiscussionEngine', () => {
  it('captures bootstrap answers via a scripted prompter', async () => {
    const prompter = new ScriptedPrompter([
      { kind: 'text', value: 'demo' }, // project_name
      { kind: 'text', value: 'a demo project' }, // description
      { kind: 'text', value: 'short core value' }, // core_value
      { kind: 'choice', value: 'mit' }, // license (recommendation)
      { kind: 'choice', value: 'just-me' }, // target_users
    ]);
    const result = await runDiscussionEngine({
      prompter,
      context: { mode: 'bootstrap' },
    });
    expect(result.calibration).toBe('builder');
    const ids = result.payload.answered.map((a) => a.id);
    expect(ids).toContain('project_name');
    expect(ids).toContain('description');
    const license = result.payload.answered.find((a) => a.id === 'license');
    expect(license?.value).toBe('mit');
    expect(license?.source).toBe('recommendation');
  });

  it('records inferred answers when text is left empty and a default exists', async () => {
    const prompter = new ScriptedPrompter([
      { kind: 'text', value: 'demo' },
      { kind: 'text', value: 'a demo' },
      { kind: 'text', value: '' }, // core_value (no default → deferred)
      { kind: 'choice', value: 'mit' },
      { kind: 'choice', value: 'just-me' },
    ]);
    const result = await runDiscussionEngine({
      prompter,
      context: { mode: 'bootstrap' },
    });
    const deferred = result.payload.deferred.find((a) => a.id === 'core_value');
    expect(deferred?.decision).toBe('deferred');
  });

  it('records deferred when the user types "defer"', async () => {
    const prompter = new ScriptedPrompter([
      { kind: 'text', value: 'demo' },
      { kind: 'text', value: 'a demo' },
      { kind: 'text', value: 'defer' }, // core_value
      { kind: 'choice', value: 'mit' },
      { kind: 'choice', value: 'just-me' },
    ]);
    const result = await runDiscussionEngine({
      prompter,
      context: { mode: 'bootstrap' },
    });
    const deferred = result.payload.deferred.find((a) => a.id === 'core_value');
    expect(deferred?.decision).toBe('deferred');
    expect(deferred?.rationale).toBe('user deferred');
  });

  it('honors forced calibration via signals', async () => {
    const prompter = new ScriptedPrompter([
      { kind: 'text', value: 'demo' },
      { kind: 'text', value: 'a demo' },
      { kind: 'text', value: 'cv' },
      { kind: 'choice', value: 'mit' },
      { kind: 'choice', value: 'just-me' },
      { kind: 'choice', value: 'node-ts' }, // tech_stack (architect-only)
      { kind: 'choice', value: 'cli' }, // deployment (architect-only)
    ]);
    const result = await runDiscussionEngine({
      prompter,
      context: { mode: 'bootstrap' },
      signals: { forced: 'architect' },
    });
    expect(result.calibration).toBe('architect');
    expect(result.payload.answered.map((a) => a.id)).toContain('tech_stack');
  });
});
