import { describe, expect, it } from 'vitest';

import { parseLine, parseStream } from '../src/spawn/parser.js';

const VALID_ENVELOPE = {
  from: 'scout',
  to: 'lead',
  kind: 'scout-findings',
  payload: {
    phase: '03',
    plan: '01',
    title: 'claude wiring',
    findings: ['auth flow'],
  },
  metadata: { created_at: new Date().toISOString() },
};

describe('Claude Code stream-json parser', () => {
  it('parses an assistant text chunk', () => {
    const result = parseLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello world' }] },
      }),
    );
    expect(result.text).toBe('hello world');
    expect(result.handoff).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });

  it('parses a structured handoff envelope', () => {
    const result = parseLine(JSON.stringify(VALID_ENVELOPE));
    expect(result.handoff).toBeDefined();
    expect(result.text).toBeUndefined();
  });

  it('parses a usage chunk', () => {
    const result = parseLine(
      JSON.stringify({ type: 'result', usage: { input_tokens: 2104, output_tokens: 156 } }),
    );
    expect(result.usage).toEqual({ input_tokens: 2104, output_tokens: 156 });
    expect(result.text).toBeUndefined();
    expect(result.handoff).toBeUndefined();
  });

  it('records an error for malformed JSON', () => {
    const result = parseLine('this is not json');
    expect(result.error).toBeDefined();
    expect(result.handoff).toBeUndefined();
  });

  it('parseStream concatenates assistant text + surfaces handoff + last-write-wins usage', () => {
    const buffer = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'chunk-1 ' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'chunk-2' }] },
      }),
      JSON.stringify(VALID_ENVELOPE),
      JSON.stringify({ type: 'result', usage: { input_tokens: 100, output_tokens: 25 } }),
      JSON.stringify({ type: 'result', usage: { input_tokens: 250, output_tokens: 42 } }),
    ].join('\n');
    const lines = parseStream(buffer);
    const handoffLine = lines.find((l) => l.handoff !== undefined);
    expect(handoffLine).toBeDefined();
    const usageLines = lines.filter((l) => l.usage !== undefined);
    expect(usageLines).toHaveLength(2);
    expect(usageLines[1]?.usage).toEqual({ input_tokens: 250, output_tokens: 42 });
  });
});
