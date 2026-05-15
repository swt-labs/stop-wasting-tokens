import type { SwtEvent, SwtSession } from '@swt-labs/runtime';
import { describe, expect, it } from 'vitest';

import { createDispatcher, type SessionFactory, type TaskBrief } from '../src/index.js';

/**
 * Phase 02 / Plan 02-01 T3 — regression coverage for the dispatcher
 * production path:
 *
 *   1. SUCCESS path — `session.prompt(promptContext.prompt)` is called
 *      with the brief's prompt text; per-turn TASK_TOKEN_USAGE deltas
 *      surface on `TaskResult.usage`.
 *   2. THROW path — when `session.prompt()` throws, the dispatcher
 *      returns a `{status: 'failed'}` TaskResult (it does NOT bubble
 *      the exception upward).
 *   3. STUB-REGRESSION guard — even when no usage events fire, a brief
 *      with `promptContext.prompt` MUST drive a `prompt()` call AND
 *      MUST NOT return the legacy M1 PR-09 synthetic-stub summary. This
 *      case fails LOUDLY if a future refactor reintroduces the stub
 *      short-circuit.
 *   4. LEGACY no-prompt seam — when `promptContext` is undefined (the
 *      shape the existing `dispatcher.test.ts` dispatches with), the
 *      dispatcher preserves the synthetic-success behaviour without
 *      calling `prompt()`. Documents the deliberate test seam.
 *
 * Pattern A — injected recording `sessionFactory` (createDispatcher's
 * first-class option). No new test seam is required; we mirror the
 * shape used by the existing `dispatcher.test.ts`. The `'stub'`
 * harvest strategy (production default) is what triggers the new
 * prompt+harvest behaviour — `'entries'` / `'file'` strategies remain
 * the declarative test-injection seams used by `dispatcher.int.test.ts`.
 */

interface RecordingSession {
  readonly factory: SessionFactory;
  readonly promptCalls: string[];
  /** Count of `dispose()` invocations. Read as a getter so we get the live value. */
  readonly disposals: () => number;
  readonly emitUsage: (event: SwtEvent) => void;
}

interface RecordingSessionOptions {
  /** When true, `session.prompt(text)` throws `new Error(throwMessage)`. */
  readonly throwOnPrompt?: boolean;
  /** Required when `throwOnPrompt: true`. */
  readonly throwMessage?: string;
  /** Events fired synchronously inside `prompt()` BEFORE the resolved promise / throw. */
  readonly usageEvents?: ReadonlyArray<SwtEvent>;
}

function makeRecordingSession(opts: RecordingSessionOptions = {}): RecordingSession {
  const promptCalls: string[] = [];
  let disposalCount = 0;
  const listeners: Array<(event: SwtEvent) => void> = [];

  const factory: SessionFactory = async () => {
    const session: SwtSession = {
      sessionId: 'recording-session-id',
      async prompt(text: string): Promise<void> {
        promptCalls.push(text);
        // Fire synthetic usage events INSIDE prompt() so the dispatcher's
        // accumulator sees them before resolving. This matches the real
        // Pi adapter's fan-out: per-turn TASK_TOKEN_USAGE events fire as
        // the prompt round-trip progresses, not on a separate channel.
        for (const ev of opts.usageEvents ?? []) {
          for (const listener of listeners) listener(ev);
        }
        if (opts.throwOnPrompt === true) {
          throw new Error(opts.throwMessage ?? 'prompt failed');
        }
      },
      subscribe(listener) {
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
      dispose() {
        disposalCount += 1;
      },
    };
    return session;
  };

  return {
    factory,
    promptCalls,
    disposals: () => disposalCount,
    emitUsage: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}

function makePromptContext(prompt: string): Readonly<Record<string, unknown>> {
  return {
    role: 'orchestrator',
    cwd: '/tmp',
    prompt,
    sessionId: 's1',
    installRoot: '/tmp',
    maxTurns: 100,
  };
}

describe('@swt-labs/orchestration — dispatcher prompt wiring (Phase 02 / Plan 02-01)', () => {
  it('calls session.prompt with task.promptContext.prompt and returns success with accumulated usage', async () => {
    const recording = makeRecordingSession({
      usageEvents: [
        {
          type: 'TASK_TOKEN_USAGE',
          sessionId: 'recording-session-id',
          usage: {
            input: 42,
            output: 17,
            cacheRead: 0,
            cacheWrite: 0,
            turn: 1,
            provider: 'mock',
            model: 'mock-1',
          },
        },
      ],
    });
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });
    const brief: TaskBrief = {
      taskId: 'T-prompt-success',
      role: 'orchestrator',
      cwd: '/tmp',
      promptContext: makePromptContext('hello orchestrator'),
    };
    const result = await dispatcher.dispatch(brief);

    // (a) Factory recorded the exact prompt text from promptContext.prompt
    expect(recording.promptCalls).toEqual(['hello orchestrator']);
    // (b) Production path returned a success TaskResult
    expect(result.status).toBe('success');
    expect(result.schema_version).toBe(1);
    expect(result.task_id).toBe('T-prompt-success');
    // (c) Accumulated usage surfaces on the envelope
    expect(result.usage?.input_tokens).toBe(42);
    expect(result.usage?.output_tokens).toBe(17);
    // (d) Lifecycle: session was disposed even on the success path
    expect(recording.disposals()).toBe(1);
  });

  it('accumulates TASK_TOKEN_USAGE deltas across multiple turns', async () => {
    const recording = makeRecordingSession({
      usageEvents: [
        {
          type: 'TASK_TOKEN_USAGE',
          sessionId: 'recording-session-id',
          usage: {
            input: 10,
            output: 5,
            cacheRead: 2,
            cacheWrite: 1,
            turn: 1,
            provider: 'mock',
            model: 'mock-1',
          },
        },
        {
          type: 'TASK_TOKEN_USAGE',
          sessionId: 'recording-session-id',
          usage: {
            input: 30,
            output: 12,
            cacheRead: 4,
            cacheWrite: 0,
            turn: 2,
            provider: 'mock',
            model: 'mock-1',
          },
        },
      ],
    });
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });
    const result = await dispatcher.dispatch({
      taskId: 'T-prompt-multi-turn',
      role: 'orchestrator',
      cwd: '/tmp',
      promptContext: makePromptContext('multi-turn'),
    });

    expect(result.status).toBe('success');
    expect(result.usage?.input_tokens).toBe(40);
    expect(result.usage?.output_tokens).toBe(17);
    expect(result.usage?.cache_read_tokens).toBe(6);
    expect(result.usage?.cache_write_tokens).toBe(1);
  });

  it('returns a failed TaskResult when session.prompt() throws (no synthetic success leak)', async () => {
    const recording = makeRecordingSession({
      throwOnPrompt: true,
      throwMessage: 'provider auth failure: 401 Unauthorized',
    });
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });

    let caught: unknown = undefined;
    let result: Awaited<ReturnType<typeof dispatcher.dispatch>>;
    try {
      result = await dispatcher.dispatch({
        taskId: 'T-prompt-throw',
        role: 'orchestrator',
        cwd: '/tmp',
        promptContext: makePromptContext('doomed'),
      });
    } catch (err) {
      caught = err;
      throw err;
    }

    // (a) Dispatcher did NOT throw — it returned a structured TaskResult.
    expect(caught).toBeUndefined();
    // (b) Status is 'failed'
    expect(result.status).toBe('failed');
    // (c) Summary carries the provider's error message
    expect(result.summary).toContain('provider auth failure');
    // (d) files_changed stays empty
    expect(result.files_changed.length).toBe(0);
    // (e) Lifecycle preserved — session.dispose was still called
    expect(recording.disposals()).toBe(1);
    // (f) No accidental usage payload on a failed result
    expect(result.usage).toBeUndefined();
  });

  it('truncates session.prompt() error summaries to 500 chars (defend the JSONL channel)', async () => {
    const longMessage = 'A'.repeat(2000);
    const recording = makeRecordingSession({
      throwOnPrompt: true,
      throwMessage: longMessage,
    });
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });
    const result = await dispatcher.dispatch({
      taskId: 'T-prompt-throw-long',
      role: 'orchestrator',
      cwd: '/tmp',
      promptContext: makePromptContext('doomed'),
    });

    expect(result.status).toBe('failed');
    expect(result.summary.length).toBeLessThanOrEqual(500);
  });

  it('stub-regression guard: when promptContext.prompt is present, the dispatcher MUST NOT return the legacy synthetic stub summary', async () => {
    const recording = makeRecordingSession(); // no usage events; prompt resolves silently
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });
    const result = await dispatcher.dispatch({
      taskId: 'T-prompt-stub-guard',
      role: 'orchestrator',
      cwd: '/tmp',
      promptContext: makePromptContext('real prompt'),
    });

    // (a) The factory's recorded prompt-call count is exactly 1 — proving
    // the production path drove a real session.prompt() invocation.
    expect(recording.promptCalls).toEqual(['real prompt']);
    expect(recording.promptCalls.length).toBe(1);
    // (b) The summary MUST NOT contain the legacy stub markers. If a
    // future refactor reintroduces the synthetic-success short-circuit
    // these assertions fail LOUDLY and the regression is caught at CI.
    expect(result.summary).not.toContain('M1 PR-09 stub dispatcher');
    expect(result.summary).not.toContain('real prompt wiring lands in M2 PR-12');
    // (c) Status is still 'success' because prompt() resolved cleanly
    // (the success-with-zero-usage case).
    expect(result.status).toBe('success');
  });

  it('legacy no-prompt path (test seam): when promptContext is undefined, preserves synthetic-success for existing dispatcher.test.ts', async () => {
    const recording = makeRecordingSession();
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });
    const result = await dispatcher.dispatch({
      taskId: 'T-no-prompt-seam',
      role: 'scout',
      cwd: '/tmp',
      // NO promptContext — the shape the existing dispatcher.test.ts uses.
    });

    expect(result.status).toBe('success');
    // The factory recorded ZERO prompt calls — the test-seam path NEVER
    // invokes session.prompt(). This documents the deliberate behaviour
    // preserved by T1 step 4 (and is what keeps `dispatcher.test.ts`
    // passing without edits).
    expect(recording.promptCalls.length).toBe(0);
    expect(recording.disposals()).toBe(1);
  });

  it('legacy seam also handles promptContext present but prompt field absent (typed as Record<string, unknown>)', async () => {
    const recording = makeRecordingSession();
    const dispatcher = createDispatcher({ sessionFactory: recording.factory });
    const result = await dispatcher.dispatch({
      taskId: 'T-no-prompt-key',
      role: 'scout',
      cwd: '/tmp',
      promptContext: { role: 'scout', cwd: '/tmp' }, // no `prompt` key
    });

    // Still the synthetic-success path — defensive against TaskBrief
    // shapes that don't carry the prompt body.
    expect(result.status).toBe('success');
    expect(recording.promptCalls.length).toBe(0);
  });
});
