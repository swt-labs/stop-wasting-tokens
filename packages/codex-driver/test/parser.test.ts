import { describe, expect, it } from 'vitest';

import { parseLine, parseStream } from '../src/spawn/parser.js';

const VALID_ENVELOPE = {
  from: 'lead',
  to: 'dev',
  kind: 'lead-plan',
  payload: {
    phase: '04',
    plan: '01',
    title: 'wire codex driver',
    must_haves: ['emitter works'],
    tasks: [{ id: 'T1', description: 'do', acceptance_criteria: ['done'] }],
  },
  metadata: { created_at: new Date().toISOString() },
};

describe('NDJSON parser', () => {
  it('parses a text chunk line', () => {
    const result = parseLine(JSON.stringify({ text: 'hello world' }));
    expect(result.text).toBe('hello world');
    expect(result.handoff).toBeUndefined();
  });

  it('parses a structured handoff envelope', () => {
    const result = parseLine(JSON.stringify(VALID_ENVELOPE));
    expect(result.handoff).toBeDefined();
    expect(result.text).toBeUndefined();
  });

  it('records an error for malformed JSON', () => {
    const result = parseLine('this is not json');
    expect(result.error).toBeDefined();
    expect(result.handoff).toBeUndefined();
  });

  it('skips empty lines', () => {
    expect(parseLine('').text).toBeUndefined();
  });

  it('parseStream concatenates text chunks and surfaces the latest handoff', () => {
    const buffer = [
      JSON.stringify({ text: 'chunk-1 ' }),
      JSON.stringify({ text: 'chunk-2' }),
      '',
      JSON.stringify(VALID_ENVELOPE),
    ].join('\n');
    const lines = parseStream(buffer);
    expect(lines).toHaveLength(3);
    const handoffLine = lines.find((l) => l.handoff !== undefined);
    expect(handoffLine).toBeDefined();
  });
});
