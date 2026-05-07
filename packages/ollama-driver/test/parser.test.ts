import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseLine, parseStream } from '../src/spawn/parser.js';

describe('Ollama /api/chat NDJSON parser', () => {
  it('parses a streaming chunk (done: false with text content)', () => {
    const result = parseLine(
      JSON.stringify({
        model: 'llama3.2',
        message: { role: 'assistant', content: 'hello' },
        done: false,
      }),
    );
    expect(result.text).toBe('hello');
    expect(result.done).toBe(false);
    expect(result.usage).toBeUndefined();
  });

  it('parses the final line (done: true) and surfaces usage from prompt_eval_count + eval_count', () => {
    const result = parseLine(
      JSON.stringify({
        model: 'llama3.2',
        message: { role: 'assistant', content: '' },
        done: true,
        prompt_eval_count: 2104,
        eval_count: 156,
      }),
    );
    expect(result.done).toBe(true);
    expect(result.usage).toEqual({ input_tokens: 2104, output_tokens: 156 });
  });

  it('rejects malformed JSON line', () => {
    const result = parseLine('this is not json');
    expect(result.error).toBeDefined();
    expect(result.text).toBeUndefined();
  });

  it('parseStream extracts handoff envelope from concatenated text', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'ollama-stream-with-handoff.ndjson');
    const buffer = await readFile(fixturePath, 'utf8');
    const result = parseStream(buffer);
    expect(result.handoff).toBeDefined();
    expect(result.handoff?.kind).toBe('scout-findings');
    expect(result.usage).toEqual({ input_tokens: 3140, output_tokens: 284 });
  });

  it('parseStream concatenates text across chunks + surfaces final usage', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'ollama-stream-text.ndjson');
    const buffer = await readFile(fixturePath, 'utf8');
    const result = parseStream(buffer);
    expect(result.text).toBe('Investigating the auth module.');
    expect(result.usage).toEqual({ input_tokens: 2104, output_tokens: 156 });
    expect(result.handoff).toBeUndefined();
    expect(result.errors).toEqual([]);
  });
});
