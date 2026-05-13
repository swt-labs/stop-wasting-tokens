/**
 * Plan 03-02 (Phase 3) T1 — `swt_ask_user` Pi custom-tool bridge contract.
 *
 * Assertions:
 *   B.1 — the tool is registered with name exactly 'swt_ask_user'.
 *   B.2 — execute() invokes the injected askUser with mapped input (header,
 *         options, preview, multiSelect plumbed through).
 *   B.3 — execute() returns {selectedOption: option.id} when askUser picks an
 *         option (label-keyed reply mapped back to id).
 *   B.4 — execute() returns {selectedOption: 'other', freeform: ...} when
 *         askUser returns a freeform reply.
 *   B.5 — the JSON Schema parameters include id, question, options and reject
 *         additional properties (registered correctly with the Pi typing).
 *   B.6 — the public surface (buildSwtAskUserExtension + SWT_ASK_USER_TOOL_NAME)
 *         is exported from `@swt-labs/runtime`.
 */

import { describe, expect, it, vi } from 'vitest';

import type { AskUserQuestion, AskUserResponse } from '../../src/ask-user/ask-user.js';
import {
  buildSwtAskUserExtension,
  SWT_ASK_USER_TOOL_NAME,
  type SwtAskUserToolParams,
} from '../../src/ask-user/swt-ask-user-tool.js';
import type {
  PiExtensionAPI,
  PiExtensionContext,
  PiToolDefinition,
} from '../../src/extensions/pi-types.js';

/**
 * Build a fake `PiExtensionAPI` that captures every `registerTool` call. The
 * test invokes the registered `execute` directly to assert the IPC contract.
 */
function makeFakePi(): {
  pi: PiExtensionAPI;
  registered: PiToolDefinition[];
} {
  const registered: PiToolDefinition[] = [];
  const pi: PiExtensionAPI = {
    registerTool: (def) => {
      registered.push(def as unknown as PiToolDefinition);
    },
    on: () => undefined,
    appendEntry: () => undefined,
  };
  return { pi, registered };
}

function makeCtx(): PiExtensionContext {
  return {
    cwd: '/tmp/swt-bridge-test',
    sessionManager: {
      getEntries: () => [],
    },
  };
}

describe('@swt-labs/runtime — swt_ask_user Pi custom-tool bridge (Plan 03-02 T1)', () => {
  it("B.1 — registers a tool with name 'swt_ask_user'", () => {
    const { pi, registered } = makeFakePi();
    const factory = buildSwtAskUserExtension({
      askUserImpl: vi.fn(),
    });
    factory(pi);

    expect(registered.length).toBe(1);
    expect(registered[0]?.name).toBe(SWT_ASK_USER_TOOL_NAME);
    expect(SWT_ASK_USER_TOOL_NAME).toBe('swt_ask_user');
  });

  it('B.2 — execute() invokes askUser with mapped header / options / preview / multiSelect', async () => {
    const { pi, registered } = makeFakePi();
    const askUserMock = vi.fn(async (_q: AskUserQuestion): Promise<AskUserResponse> => {
      return { selectedOption: 'Run it', freeform: null };
    });
    const factory = buildSwtAskUserExtension({ askUserImpl: askUserMock });
    factory(pi);

    const tool = registered[0]!;
    const input: SwtAskUserToolParams = {
      id: 'prompt-1',
      question: 'Continue?',
      options: [
        { id: 'go', label: 'Run it', isRecommended: true },
        { id: 'stop', label: 'Hold' },
      ],
      header: 'Confirm',
      multiSelect: false,
      preview: 'preview body',
    };
    const result = await tool.execute('tc-1', input, undefined, undefined, makeCtx());

    expect(askUserMock).toHaveBeenCalledTimes(1);
    const calledWith = askUserMock.mock.calls[0]?.[0];
    expect(calledWith?.question).toBe('Continue?');
    expect(calledWith?.header).toBe('Confirm');
    expect(calledWith?.multiSelect).toBe(false);
    expect(calledWith?.preview).toBe('preview body');
    expect(calledWith?.options).toEqual([
      { label: 'Run it', isRecommended: true },
      { label: 'Hold' },
    ]);
    // Result shape — option.label 'Run it' resolves to option.id 'go'.
    expect(result.details).toEqual({ selectedOption: 'go' });
  });

  it('B.3 — execute() maps askUser label-keyed reply back to option.id', async () => {
    const { pi, registered } = makeFakePi();
    const askUserMock = vi.fn(
      async (): Promise<AskUserResponse> => ({ selectedOption: 'Hold', freeform: null }),
    );
    const factory = buildSwtAskUserExtension({ askUserImpl: askUserMock });
    factory(pi);

    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-2',
      {
        id: 'prompt-2',
        question: 'Continue?',
        options: [
          { id: 'go', label: 'Run it' },
          { id: 'stop', label: 'Hold' },
        ],
      } as SwtAskUserToolParams,
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.details).toEqual({ selectedOption: 'stop' });
  });

  it("B.4 — execute() returns {selectedOption:'other', freeform} when askUser returns freeform", async () => {
    const { pi, registered } = makeFakePi();
    const askUserMock = vi.fn(
      async (): Promise<AskUserResponse> => ({ selectedOption: null, freeform: 'do something else' }),
    );
    const factory = buildSwtAskUserExtension({ askUserImpl: askUserMock });
    factory(pi);

    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-3',
      {
        id: 'prompt-3',
        question: 'Continue?',
        options: [{ id: 'go', label: 'Run it' }],
      } as SwtAskUserToolParams,
      undefined,
      undefined,
      makeCtx(),
    );

    expect(result.details).toEqual({ selectedOption: 'other', freeform: 'do something else' });
  });

  it('B.5 — parameters JSON Schema requires id/question/options and forbids additionalProperties', () => {
    const { pi, registered } = makeFakePi();
    const factory = buildSwtAskUserExtension({ askUserImpl: vi.fn() });
    factory(pi);
    const tool = registered[0]!;
    const schema = tool.parameters as Record<string, unknown>;
    expect(schema['type']).toBe('object');
    expect(schema['required']).toEqual(['id', 'question', 'options']);
    expect(schema['additionalProperties']).toBe(false);
    const props = schema['properties'] as Record<string, unknown>;
    expect(props['id']).toBeDefined();
    expect(props['question']).toBeDefined();
    expect(props['options']).toBeDefined();
  });

  it('B.6 — public surface is exported from @swt-labs/runtime', async () => {
    const runtime = await import('@swt-labs/runtime');
    expect(typeof runtime.buildSwtAskUserExtension).toBe('function');
    expect(runtime.SWT_ASK_USER_TOOL_NAME).toBe('swt_ask_user');
  });
});
