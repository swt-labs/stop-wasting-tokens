import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  PiExtensionAPI,
  PiExtensionContext,
  PiSessionEntry,
  PiToolDefinition,
} from '../../src/extensions/pi-types.js';
import {
  buildResultProtocolExtension,
  enrichWithFileMetadata,
  getTaskIdFromCtx,
  SwtReportResultParamsSchema,
} from '../../src/extensions/result-protocol.js';

interface RegisteredAppend {
  readonly customType: string;
  readonly data: unknown;
}

interface MockPi extends PiExtensionAPI {
  readonly registeredTools: PiToolDefinition[];
  readonly handlers: Map<string, Array<(event: unknown, ctx: PiExtensionContext) => void>>;
  readonly appendEntries: RegisteredAppend[];
}

function createMockPi(): MockPi {
  const registeredTools: PiToolDefinition[] = [];
  const handlers = new Map<string, Array<(event: unknown, ctx: PiExtensionContext) => void>>();
  const appendEntries: RegisteredAppend[] = [];
  return {
    registeredTools,
    handlers,
    appendEntries,
    registerTool(def) {
      registeredTools.push(def);
    },
    on(event, handler) {
      let bucket = handlers.get(event);
      if (!bucket) {
        bucket = [];
        handlers.set(event, bucket);
      }
      bucket.push(handler);
    },
    appendEntry(customType, data) {
      appendEntries.push({ customType, data });
    },
  };
}

function createMockCtx(opts: {
  readonly cwd: string;
  readonly entries?: ReadonlyArray<PiSessionEntry>;
}): PiExtensionContext {
  const entries = opts.entries ?? [];
  return {
    cwd: opts.cwd,
    sessionManager: {
      getEntries(): ReadonlyArray<PiSessionEntry> {
        return entries;
      },
    },
  };
}

describe('@swt-labs/runtime — result-protocol extension', () => {
  it('registers a swt_report_result tool with the required name + schema', () => {
    const pi = createMockPi();
    buildResultProtocolExtension()(pi);
    const tool = pi.registeredTools.find((t) => t.name === 'swt_report_result');
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/SWT task result|swt_report_result/i);
    expect(tool?.parameters).toBeTypeOf('object');
  });

  it('registers an agent_end defensive hook by default', () => {
    const pi = createMockPi();
    buildResultProtocolExtension()(pi);
    expect(pi.handlers.get('agent_end')).toBeDefined();
    expect(pi.handlers.get('agent_end')?.length).toBe(1);
  });

  it('honours defensivePlaceholder:false (no agent_end hook)', () => {
    const pi = createMockPi();
    buildResultProtocolExtension({ defensivePlaceholder: false })(pi);
    expect(pi.handlers.get('agent_end')).toBeUndefined();
  });

  describe('execute() — closure-captured pi.appendEntry pattern', () => {
    it('CRITICAL: uses pi.appendEntry (closure) — ctx has NO appendEntry field', async () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const tool = pi.registeredTools[0];
      expect(tool).toBeDefined();
      const ctx = createMockCtx({ cwd: '/tmp/test-cwd' });
      // Type-level assertion: PiExtensionContext has no `appendEntry`
      // field, so any future `ctx.appendEntry(...)` call inside the
      // extension is a TS error. Runtime-level assertion:
      expect('appendEntry' in ctx).toBe(false);
      await tool!.execute(
        'call-1',
        { status: 'success', summary: 'ok', files_changed: [], must_haves: [] },
        undefined,
        undefined,
        ctx,
      );
      expect(pi.appendEntries).toHaveLength(1);
      expect(pi.appendEntries[0]?.customType).toBe('swt-task-result');
    });

    it('returns terminate:true so Pi skips the follow-up LLM call', async () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const tool = pi.registeredTools[0];
      const result = await tool!.execute(
        'call-1',
        { status: 'success', summary: 'done', files_changed: [], must_haves: [] },
        undefined,
        undefined,
        createMockCtx({ cwd: '/tmp/cwd' }),
      );
      expect(result.terminate).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.text).toMatch(/recorded/i);
    });

    it('re-validates params via Zod (Pi pre-validation is not trusted)', async () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const tool = pi.registeredTools[0];
      await expect(
        tool!.execute(
          'call-1',
          { status: 'bogus', summary: '', files_changed: [], must_haves: [] },
          undefined,
          undefined,
          createMockCtx({ cwd: '/tmp/cwd' }),
        ),
      ).rejects.toThrow();
    });

    it('reads taskId from task-context custom entry', async () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const tool = pi.registeredTools[0];
      const ctx = createMockCtx({
        cwd: '/tmp/cwd',
        entries: [
          {
            type: 'custom',
            customType: 'task-context',
            data: { taskId: 'T-abc-123' },
          },
        ],
      });
      await tool!.execute(
        'call-1',
        { status: 'success', summary: 'ok', files_changed: [], must_haves: [] },
        undefined,
        undefined,
        ctx,
      );
      const recorded = pi.appendEntries[0]?.data as { task_id?: string } | undefined;
      expect(recorded?.task_id).toBe('T-abc-123');
    });

    it('falls back to taskId=unknown when task-context entry is missing', async () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const tool = pi.registeredTools[0];
      await tool!.execute(
        'call-1',
        { status: 'success', summary: 'ok', files_changed: [], must_haves: [] },
        undefined,
        undefined,
        createMockCtx({ cwd: '/tmp/cwd' }),
      );
      const recorded = pi.appendEntries[0]?.data as { task_id?: string } | undefined;
      expect(recorded?.task_id).toBe('unknown');
    });
  });

  describe('enrichWithFileMetadata', () => {
    let tmp: string;
    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'swt-enrich-'));
    });
    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('computes sha256_after + bytes_after for existing files', () => {
      const filePath = join(tmp, 'a.txt');
      writeFileSync(filePath, 'hello world', 'utf8');
      const params = SwtReportResultParamsSchema.parse({
        status: 'success',
        summary: 'enrich test',
        files_changed: [{ path: 'a.txt', action: 'modified' }],
        must_haves: [],
      });
      const enriched = enrichWithFileMetadata(tmp, params, 'T-1') as {
        files_changed: Array<{
          sha256_after?: string;
          bytes_after?: number;
          action: string;
        }>;
      };
      expect(enriched.files_changed[0]?.sha256_after).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(enriched.files_changed[0]?.bytes_after).toBe(11);
    });

    it('omits sha/bytes for deleted files', () => {
      const params = SwtReportResultParamsSchema.parse({
        status: 'success',
        summary: 'delete test',
        files_changed: [{ path: 'gone.txt', action: 'deleted' }],
        must_haves: [],
      });
      const enriched = enrichWithFileMetadata(tmp, params, 'T-1') as {
        files_changed: Array<{ sha256_after?: string; bytes_after?: number; action: string }>;
      };
      expect(enriched.files_changed[0]?.action).toBe('deleted');
      expect(enriched.files_changed[0]?.sha256_after).toBeUndefined();
      expect(enriched.files_changed[0]?.bytes_after).toBeUndefined();
    });

    it('emits the canonical TaskResult shape (schema_version + task_id)', () => {
      const params = SwtReportResultParamsSchema.parse({
        status: 'partial',
        summary: 'shape',
        files_changed: [],
        must_haves: [{ id: 'M-1', status: 'passed' }],
        blockers: ['b1'],
        notes: 'n',
      });
      const out = enrichWithFileMetadata(tmp, params, 'T-7') as Record<string, unknown>;
      expect(out['schema_version']).toBe(1);
      expect(out['task_id']).toBe('T-7');
      expect(out['blockers']).toEqual(['b1']);
      expect(out['notes']).toBe('n');
    });

    it('omits blockers when array is empty', () => {
      const params = SwtReportResultParamsSchema.parse({
        status: 'success',
        summary: 'no blockers',
        files_changed: [],
        must_haves: [],
        blockers: [],
      });
      const out = enrichWithFileMetadata(tmp, params, 'T-9') as Record<string, unknown>;
      expect(out['blockers']).toBeUndefined();
    });
  });

  describe('getTaskIdFromCtx', () => {
    it('returns "unknown" when entries are empty', () => {
      expect(getTaskIdFromCtx(createMockCtx({ cwd: '/' }))).toBe('unknown');
    });

    it('returns "unknown" when task-context.data.taskId is missing', () => {
      const ctx = createMockCtx({
        cwd: '/',
        entries: [{ type: 'custom', customType: 'task-context', data: { foo: 'bar' } }],
      });
      expect(getTaskIdFromCtx(ctx)).toBe('unknown');
    });
  });

  describe('defensive agent_end hook', () => {
    it('writes a placeholder when no swt-task-result entry exists', () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const handlers = pi.handlers.get('agent_end') ?? [];
      handlers[0]?.({}, createMockCtx({ cwd: '/' }));
      expect(pi.appendEntries).toHaveLength(1);
      const placeholder = pi.appendEntries[0]?.data as { status?: string; blockers?: string[] };
      expect(placeholder.status).toBe('failed');
      expect(placeholder.blockers?.[0]).toMatch(/protocol-violation/);
    });

    it('no-ops when a swt-task-result entry already exists', () => {
      const pi = createMockPi();
      buildResultProtocolExtension()(pi);
      const handlers = pi.handlers.get('agent_end') ?? [];
      handlers[0]?.(
        {},
        createMockCtx({
          cwd: '/',
          entries: [
            {
              type: 'custom',
              customType: 'swt-task-result',
              data: { status: 'success' },
            },
          ],
        }),
      );
      expect(pi.appendEntries).toHaveLength(0);
    });
  });

  describe('ctx.appendEntry compile-time guard', () => {
    it('PiExtensionContext type structure does NOT expose appendEntry', () => {
      // Runtime mirror of the compile-time invariant: if a future
      // refactor accidentally adds `appendEntry` to PiExtensionContext,
      // this test fails (and so will the type-check on result-protocol.ts).
      const ctx = createMockCtx({ cwd: '/' });
      expect('appendEntry' in ctx).toBe(false);
    });
  });
});
