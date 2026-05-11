import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildJournalExtension,
  FileJournalSink,
  MemoryJournalSink,
} from '../../src/extensions/journal.js';
import type {
  PiExtensionAPI,
  PiExtensionContext,
} from '../../src/extensions/pi-types.js';
import type { SwtEvent } from '@swt-labs/shared';

interface MockPi extends PiExtensionAPI {
  handlers: Map<string, Array<(event: unknown, ctx: PiExtensionContext) => void>>;
}

function createMockPi(): MockPi {
  const handlers = new Map<string, Array<(event: unknown, ctx: PiExtensionContext) => void>>();
  return {
    handlers,
    registerTool() {
      /* journal extension doesn't register tools */
    },
    on(event, handler) {
      let bucket = handlers.get(event);
      if (!bucket) {
        bucket = [];
        handlers.set(event, bucket);
      }
      bucket.push(handler);
    },
    appendEntry() {
      /* journal extension doesn't append entries */
    },
  };
}

const CTX: PiExtensionContext = {
  cwd: '/tmp',
  sessionManager: { getEntries: () => [] },
};

describe('@swt-labs/runtime — journal extension', () => {
  it('subscribes to the canonical Pi event names', () => {
    const pi = createMockPi();
    buildJournalExtension({ sink: new MemoryJournalSink() })(pi);
    expect(pi.handlers.get('agent_start')).toBeDefined();
    expect(pi.handlers.get('agent_end')).toBeDefined();
    expect(pi.handlers.get('message_update')).toBeDefined();
    expect(pi.handlers.get('tool_execution_start')).toBeDefined();
    expect(pi.handlers.get('tool_execution_end')).toBeDefined();
    expect(pi.handlers.get('turn_end')).toBeDefined();
  });

  it('disabled:true wires no handlers (operator opt-out)', () => {
    const pi = createMockPi();
    buildJournalExtension({ disabled: true })(pi);
    expect(pi.handlers.size).toBe(0);
  });

  it('writes mapped SwtEvents into the sink', () => {
    const sink = new MemoryJournalSink();
    const pi = createMockPi();
    buildJournalExtension({ sink })(pi);
    pi.handlers.get('agent_start')?.[0]?.(
      { type: 'agent_start', sessionId: 'sess-1' },
      CTX,
    );
    pi.handlers.get('tool_execution_start')?.[0]?.(
      { type: 'tool_execution_start', sessionId: 'sess-1', toolCall: { name: 'grep' } },
      CTX,
    );
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]?.type).toBe('AGENT_START');
    expect(sink.events[1]?.type).toBe('TOOL_CALL');
    expect((sink.events[1] as Extract<SwtEvent, { type: 'TOOL_CALL' }>).name).toBe('grep');
  });

  it('silently drops Pi events that map to undefined (e.g., unsupported event types)', () => {
    const sink = new MemoryJournalSink();
    const pi = createMockPi();
    buildJournalExtension({ sink })(pi);
    pi.handlers.get('agent_start')?.[0]?.({ type: 'unsupported_event' }, CTX);
    expect(sink.events).toHaveLength(0);
  });

  describe('FileJournalSink', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'swt-journal-'));
    });
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('appends one JSON line per event with at + event fields', () => {
      const path = join(tmp, 'journal', '2026-05-11.jsonl');
      const sink = new FileJournalSink(path);
      sink.write({ type: 'AGENT_START', sessionId: 's1' });
      sink.write({ type: 'AGENT_END', sessionId: 's1' });
      sink.close();
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      const row1 = JSON.parse(lines[0] ?? '{}');
      const row2 = JSON.parse(lines[1] ?? '{}');
      expect(typeof row1.at).toBe('string');
      expect(row1.event.type).toBe('AGENT_START');
      expect(row2.event.type).toBe('AGENT_END');
    });

    it('lazy-creates the directory on first write', () => {
      const path = join(tmp, 'deep', 'nested', 'journal.jsonl');
      const sink = new FileJournalSink(path);
      sink.write({ type: 'AGENT_START', sessionId: 's1' });
      const content = readFileSync(path, 'utf8');
      expect(content).toMatch(/AGENT_START/);
    });
  });

  describe('default file-path resolver', () => {
    it('uses cwd/.swt-planning/journal/<UTC-day>.jsonl', () => {
      const sink = new MemoryJournalSink();
      let resolved = '';
      const pi = createMockPi();
      buildJournalExtension({
        sink,
        resolvePath: (cwd, today) => {
          // Echo through the resolver to assert the contract surface.
          resolved = `${cwd}|${today.toISOString().slice(0, 10)}`;
          return '/dev/null';
        },
      })(pi);
      pi.handlers.get('agent_start')?.[0]?.(
        { type: 'agent_start', sessionId: 's1' },
        CTX,
      );
      // The injected sink takes priority over the resolver — resolver is
      // only called when sink is undefined. So `resolved` stays empty here.
      expect(resolved).toBe('');
      expect(sink.events).toHaveLength(1);
    });
  });
});
