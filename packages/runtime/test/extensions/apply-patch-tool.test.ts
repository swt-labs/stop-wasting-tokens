import { describe, expect, it, vi } from 'vitest';

import {
  APPLY_PATCH_TOOL_NAME,
  buildApplyPatchExtension,
  type ApplyPatchFs,
} from '../../src/extensions/apply-patch-tool.js';
import type {
  PiExtensionAPI,
  PiExtensionContext,
  PiToolDefinition,
} from '../../src/extensions/pi-types.js';

/**
 * Phase 03 plan 03-01 T2 — tool registration + execute callback tests.
 *
 * The factory is a Pi extension `(pi) => void` builder; we drive it with a
 * recording `PiExtensionAPI` shim that captures the single `registerTool`
 * call. The captured tool's `execute` is then exercised against an
 * in-memory `ApplyPatchFs` stub so we never hit the real filesystem.
 */

function makeRecordingPi(): {
  pi: PiExtensionAPI;
  registered: PiToolDefinition[];
  appended: Array<{ customType: string; data: unknown }>;
} {
  const registered: PiToolDefinition[] = [];
  const appended: Array<{ customType: string; data: unknown }> = [];
  const pi: PiExtensionAPI = {
    registerTool<TParams = unknown>(def: PiToolDefinition<TParams>): void {
      registered.push(def);
    },
    on() {
      // unused by apply_patch
    },
    appendEntry(customType, data) {
      appended.push({ customType, data });
    },
  };
  return { pi, registered, appended };
}

function makeMemFs(initial: Record<string, string> = {}): ApplyPatchFs & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    readFileSync(p: string): string {
      const v = files.get(p);
      if (v === undefined) throw new Error(`memfs: ENOENT ${p}`);
      return v;
    },
    writeFileSync(p: string, body: string): void {
      files.set(p, body);
    },
    unlinkSync(p: string): void {
      if (!files.has(p)) throw new Error(`memfs: ENOENT ${p}`);
      files.delete(p);
    },
    existsSync(p: string): boolean {
      return files.has(p);
    },
  };
}

function makeCtx(cwd: string): PiExtensionContext {
  return { cwd, sessionManager: { getEntries: () => [] } };
}

describe('buildApplyPatchExtension — tool registration', () => {
  it('1. factory invokes registerTool exactly once with name "apply_patch"', () => {
    const { pi, registered } = makeRecordingPi();
    buildApplyPatchExtension()(pi);
    expect(registered).toHaveLength(1);
    expect(registered[0]?.name).toBe(APPLY_PATCH_TOOL_NAME);
    expect(registered[0]?.name).toBe('apply_patch');
  });

  it('2. tool description contains the upstream citation tail', () => {
    const { pi, registered } = makeRecordingPi();
    buildApplyPatchExtension()(pi);
    const desc = registered[0]?.description ?? '';
    expect(desc).toMatch(
      /Grammar source: codex-rs\/apply-patch\/apply_patch_tool_instructions\.md/,
    );
    expect(desc).toMatch(/paraphrased/);
    expect(desc).toMatch(/no verbatim text copied/);
  });

  it('3. parameters schema is { type: object, required: [patch], properties.patch: string }', () => {
    const { pi, registered } = makeRecordingPi();
    buildApplyPatchExtension()(pi);
    const params = registered[0]?.parameters as Record<string, unknown>;
    expect(params['type']).toBe('object');
    expect(params['required']).toEqual(['patch']);
    const props = params['properties'] as Record<string, { type: string }>;
    expect(props['patch']?.type).toBe('string');
  });
});

describe('buildApplyPatchExtension — execute callback', () => {
  it('4. valid Add patch + mock fs → writeFileSync called and "Applied" returned', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs();
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-1',
      { patch: '*** Begin Patch\n*** Add File: hello.txt\n+Hello\n*** End Patch\n' },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith('/proj/hello.txt', 'Hello\n');
    expect(result.content[0]?.text).toMatch(/Applied 1 file op/);
    expect(fs.files.get('/proj/hello.txt')).toBe('Hello\n');
  });

  it('5. valid Delete patch + mock fs (existing file) → unlinkSync called', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs({ '/proj/stale.md': 'old content' });
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync');
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-2',
      { patch: '*** Begin Patch\n*** Delete File: stale.md\n*** End Patch\n' },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(unlinkSpy).toHaveBeenCalledWith('/proj/stale.md');
    expect(fs.files.has('/proj/stale.md')).toBe(false);
    expect(result.content[0]?.text).toMatch(/1 file op/);
  });

  it('6. CRLF patch → execute returns structured parse error, no fs calls made', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs();
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync');
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-3',
      { patch: '*** Begin Patch\r\n*** Add File: x\r\n+a\r\n*** End Patch\r\n' },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/parse error/);
    expect(result.content[0]?.text).toMatch(/CRLF/);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('7. Add patch on an already-existing file → structured error, no overwrite', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs({ '/proj/hello.txt': 'KEEP' });
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-4',
      { patch: '*** Begin Patch\n*** Add File: hello.txt\n+OVERWRITE\n*** End Patch\n' },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/already exists/);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(fs.files.get('/proj/hello.txt')).toBe('KEEP');
  });

  it('Update patch with hunk locates and replaces the matched block', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs({ '/proj/src/app.ts': 'before\nold\nafter\n' });
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      ' before',
      '-old',
      '+new',
      ' after',
      '*** End Patch',
      '',
    ].join('\n');
    const result = await tool.execute('tc-5', { patch }, undefined, undefined, makeCtx('/proj'));
    expect(result.content[0]?.text).toMatch(/1 file op/);
    expect(fs.files.get('/proj/src/app.ts')).toBe('before\nnew\nafter\n');
  });

  it('Update + Move renames and rewrites in one op', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs({ '/proj/src/old.ts': 'foo\n' });
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '@@',
      '-foo',
      '+bar',
      '*** End Patch',
      '',
    ].join('\n');
    const result = await tool.execute('tc-6', { patch }, undefined, undefined, makeCtx('/proj'));
    expect(result.content[0]?.text).toMatch(/1 file op/);
    expect(fs.files.has('/proj/src/old.ts')).toBe(false);
    expect(fs.files.get('/proj/src/new.ts')).toBe('bar\n');
  });

  it('execute returns a non-string patch error gracefully (no fs side effects)', async () => {
    const { pi, registered } = makeRecordingPi();
    const fs = makeMemFs();
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    buildApplyPatchExtension({ fs, cwd: '/proj' })(pi);
    const tool = registered[0]!;
    const result = await tool.execute(
      'tc-7',
      { patch: 42 as unknown as string },
      undefined,
      undefined,
      makeCtx('/proj'),
    );
    expect(result.content[0]?.text).toMatch(/missing or non-string/);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
