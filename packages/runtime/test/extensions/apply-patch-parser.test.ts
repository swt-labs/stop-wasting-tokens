import { describe, expect, it } from 'vitest';

import { parseApplyPatch } from '../../src/extensions/apply-patch-parser.js';

/**
 * Phase 03 plan 03-01 T1 — parser unit tests.
 *
 * Coverage matches the plan's 12-case table: add/delete/update/move/multi-
 * hunk/eof/CRLF/absolute/zero-hunk/malformed-begin/missing-+ plus a
 * sanity-rendered combined patch from the grammar prose example.
 */
describe('parseApplyPatch — grammar acceptance', () => {
  it('1. add-file: single add hunk with "+"-prefixed lines', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: hello.txt',
      '+Hello',
      '+world',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toEqual({ kind: 'add', path: 'hello.txt', lines: ['Hello', 'world'] });
  });

  it('2. delete-file: single delete hunk', () => {
    const patch = ['*** Begin Patch', '*** Delete File: stale.md', '*** End Patch'].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toEqual([{ kind: 'delete', path: 'stale.md' }]);
  });

  it('3. update-file: single hunk with context + +/- lines', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      ' before',
      '-old',
      '+new',
      ' after',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0]!;
    expect(op.kind).toBe('update');
    if (op.kind !== 'update') return;
    expect(op.path).toBe('src/app.ts');
    expect(op.hunks).toHaveLength(1);
    expect(op.hunks[0]?.lines).toEqual([
      { op: ' ', text: 'before' },
      { op: '-', text: 'old' },
      { op: '+', text: 'new' },
      { op: ' ', text: 'after' },
    ]);
    expect(op.hunks[0]?.endOfFile).toBe(false);
  });

  it('4. update-with-move: pure rename (no body hunks)', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toHaveLength(1);
    const op = r.ops[0]!;
    expect(op.kind).toBe('update');
    if (op.kind !== 'update') return;
    expect(op.path).toBe('src/old.ts');
    expect(op.moveTo).toBe('src/new.ts');
    expect(op.hunks).toEqual([]);
  });

  it('5. update-with-move-and-body: rename plus a hunk', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '@@',
      '-foo',
      '+bar',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const op = r.ops[0]!;
    if (op.kind !== 'update') {
      expect.fail('expected update op');
      return;
    }
    expect(op.moveTo).toBe('src/new.ts');
    expect(op.hunks).toHaveLength(1);
    expect(op.hunks[0]?.lines).toEqual([
      { op: '-', text: 'foo' },
      { op: '+', text: 'bar' },
    ]);
  });

  it('6. multiple-hunks: one Update with two "@@" blocks', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/big.ts',
      '@@ class Foo',
      ' before1',
      '-x',
      '+y',
      '@@ class Bar',
      ' before2',
      '-a',
      '+b',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const op = r.ops[0]!;
    if (op.kind !== 'update') {
      expect.fail('expected update op');
      return;
    }
    expect(op.hunks).toHaveLength(2);
    expect(op.hunks[0]?.contexts).toEqual(['class Foo']);
    expect(op.hunks[1]?.contexts).toEqual(['class Bar']);
  });

  it('7. end-of-file sentinel sets hunk.endOfFile=true', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: f.ts',
      '@@',
      ' keep',
      '-drop_tail',
      '*** End of File',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const op = r.ops[0]!;
    if (op.kind !== 'update') {
      expect.fail('expected update op');
      return;
    }
    expect(op.hunks).toHaveLength(1);
    expect(op.hunks[0]?.endOfFile).toBe(true);
  });

  it('8. CRLF input is rejected with "CRLF" in the error message', () => {
    const patch = '*** Begin Patch\r\n*** Add File: x\r\n+a\r\n*** End Patch\r\n';
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/CRLF/);
  });

  it('9. absolute path is rejected', () => {
    const patch = ['*** Begin Patch', '*** Add File: /etc/passwd', '+oops', '*** End Patch'].join(
      '\n',
    );
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/[Aa]bsolute/);
  });

  it('10. zero hunks: Begin Patch → End Patch is rejected', () => {
    const patch = ['*** Begin Patch', '*** End Patch'].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/at least one|zero/i);
  });

  it('11. malformed begin sentinel is rejected', () => {
    const patch = ['*** Begin Patc', '*** Add File: x', '+a', '*** End Patch'].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/Begin Patch/);
  });

  it('12. add_line missing "+" prefix is rejected', () => {
    const patch = ['*** Begin Patch', '*** Add File: x', 'no-plus-prefix', '*** End Patch'].join(
      '\n',
    );
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/\+/);
  });

  it('combined patch (Add + Update+Move+hunk + Delete) parses to 3 ops', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: hello.txt',
      '+Hello world',
      '*** Update File: src/app.py',
      '*** Move to: src/main.py',
      '@@ def greet():',
      '-print("Hi")',
      '+print("Hello, world!")',
      '*** Delete File: obsolete.txt',
      '*** End Patch',
    ].join('\n');
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ops).toHaveLength(3);
    expect(r.ops.map((o) => o.kind)).toEqual(['add', 'update', 'delete']);
  });

  it('trailing LF after End Patch is allowed', () => {
    const patch = '*** Begin Patch\n*** Add File: x\n+y\n*** End Patch\n';
    const r = parseApplyPatch(patch);
    expect(r.ok).toBe(true);
  });
});
