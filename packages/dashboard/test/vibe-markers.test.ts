import { describe, expect, it } from 'vitest';

import {
  createLineBuffer,
  formatAskUserMarker,
  formatUserReplyMarker,
  tryParseMarker,
} from '../src/server/vibe/markers.js';

describe('tryParseMarker', () => {
  it('parses a valid ASK_USER clarification with options', () => {
    const line =
      '<<<ASK_USER:{"subtype":"clarification","question":"Color?","options":[{"value":"red","label":"Red"}]}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
    expect(marker!.kind).toBe('ASK_USER');
    expect((marker!.payload as { subtype: string }).subtype).toBe('clarification');
  });

  it('parses a valid ASK_USER clarification without options', () => {
    const line = '<<<ASK_USER:{"subtype":"clarification","question":"What goal?"}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
  });

  it('parses a valid ASK_USER permission with context', () => {
    const line =
      '<<<ASK_USER:{"subtype":"permission","question":"Run shell?","context":{"operation":"shell","target":"npm install"}}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
    expect((marker!.payload as { subtype: string }).subtype).toBe('permission');
  });

  it('parses a valid USER_REPLY free_form', () => {
    const line = '<<<USER_REPLY:{"kind":"free_form","text":"a snake game"}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
    expect(marker!.kind).toBe('USER_REPLY');
  });

  it('parses a valid USER_REPLY choice', () => {
    const line = '<<<USER_REPLY:{"kind":"choice","value":"red"}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
  });

  it('parses a valid USER_REPLY permission with optional user_note', () => {
    const line = '<<<USER_REPLY:{"kind":"permission","decision":"deny","user_note":"too risky"}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
  });

  it('parses a valid USER_REPLY expired', () => {
    const line = '<<<USER_REPLY:{"kind":"expired"}>>>';
    const marker = tryParseMarker(line);
    expect(marker).not.toBeNull();
  });

  it('returns null for non-marker lines', () => {
    expect(tryParseMarker('hello world')).toBeNull();
    expect(tryParseMarker('')).toBeNull();
    expect(tryParseMarker('<<<NOT_A_MARKER:{}>>>')).toBeNull();
  });

  it('returns null for marker lines with malformed JSON', () => {
    expect(tryParseMarker('<<<ASK_USER:{not valid json}>>>')).toBeNull();
    expect(tryParseMarker('<<<ASK_USER:>>>')).toBeNull();
    expect(tryParseMarker('<<<ASK_USER:"a string">>>')).toBeNull();
  });

  it('returns null for ASK_USER with unknown subtype', () => {
    const line = '<<<ASK_USER:{"subtype":"mystery","question":"q?"}>>>';
    expect(tryParseMarker(line)).toBeNull();
  });

  it('returns null for ASK_USER missing question', () => {
    const line = '<<<ASK_USER:{"subtype":"clarification"}>>>';
    expect(tryParseMarker(line)).toBeNull();
  });

  it('returns null for USER_REPLY with unknown kind', () => {
    const line = '<<<USER_REPLY:{"kind":"mystery"}>>>';
    expect(tryParseMarker(line)).toBeNull();
  });

  it('tolerates leading whitespace before the marker', () => {
    const line = '   <<<ASK_USER:{"subtype":"clarification","question":"q?"}>>>';
    expect(tryParseMarker(line)).not.toBeNull();
  });
});

describe('formatUserReplyMarker / formatAskUserMarker', () => {
  it('formatUserReplyMarker round-trips through tryParseMarker', () => {
    const reply = { kind: 'free_form', text: 'hello' };
    const line = formatUserReplyMarker(reply);
    expect(line.endsWith('\n')).toBe(true);
    const parsed = tryParseMarker(line.trimEnd());
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('USER_REPLY');
  });

  it('formatAskUserMarker round-trips through tryParseMarker', () => {
    const payload = { subtype: 'clarification', question: 'Color?' };
    const line = formatAskUserMarker(payload);
    expect(line.endsWith('\n')).toBe(true);
    const parsed = tryParseMarker(line.trimEnd());
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('ASK_USER');
  });
});

describe('createLineBuffer', () => {
  it('emits one line per newline-terminated chunk', () => {
    const stdoutLines: string[] = [];
    const buf = createLineBuffer({
      onMarker: () => undefined,
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    buf.push('line one\nline two\n');
    expect(stdoutLines).toEqual(['line one', 'line two']);
  });

  it('buffers partial lines until a newline arrives', () => {
    const stdoutLines: string[] = [];
    const buf = createLineBuffer({
      onMarker: () => undefined,
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    buf.push('partial');
    expect(stdoutLines).toEqual([]);
    buf.push(' line\n');
    expect(stdoutLines).toEqual(['partial line']);
  });

  it('routes marker lines via onMarker; non-markers via onStdoutLine', () => {
    const markers: { kind: string }[] = [];
    const stdouts: string[] = [];
    const buf = createLineBuffer({
      onMarker: (m) => markers.push({ kind: m.kind }),
      onStdoutLine: (l) => stdouts.push(l),
    });
    buf.push('hello world\n');
    buf.push('<<<ASK_USER:{"subtype":"clarification","question":"q?"}>>>\n');
    buf.push('more output\n');
    expect(stdouts).toEqual(['hello world', 'more output']);
    expect(markers).toEqual([{ kind: 'ASK_USER' }]);
  });

  it('flush() consumes any remaining buffered text as a final line', () => {
    const stdouts: string[] = [];
    const buf = createLineBuffer({
      onMarker: () => undefined,
      onStdoutLine: (l) => stdouts.push(l),
    });
    buf.push('no trailing newline');
    buf.flush();
    expect(stdouts).toEqual(['no trailing newline']);
  });
});
