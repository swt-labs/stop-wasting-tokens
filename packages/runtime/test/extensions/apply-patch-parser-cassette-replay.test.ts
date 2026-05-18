import { describe, expect, it } from 'vitest';

import { parseApplyPatch } from '../../src/extensions/apply-patch-parser.js';

/**
 * Phase 06 plan 06-01 T4 — cassette-replay byte-identity contract.
 *
 * Guards against any future regeneration of `apply-patch-parser.ts` (via
 * `pnpm gen:apply-patch-parser`) silently changing the parser's structured
 * output. The 14 fixtures are an inline copy of the inputs from
 * `apply-patch-parser.test.ts`; for each input, the expected output is the
 * canonical serialized result captured at the moment Phase 6 T3 swapped the
 * old hand-rolled parser to the Lark-derived generator output.
 *
 * If a future generator change alters the JSON shape of any fixture's
 * result, the corresponding `it()` block fails with a precise diff. To
 * regenerate the baseline (after a deliberate, reviewed change):
 *
 *   pnpm tsx scripts/codegen/capture-apply-patch-fixtures.ts /tmp/new-baseline.json
 *   # then update EXPECTED below with the new JSON-stringified result(s)
 *
 * Why JSON.stringify? It's a single, stable encoding that captures all four
 * `ApplyPatchResult` variants (ok/error with optional line/moveTo/etc.) in a
 * lossless, comparable form — sidesteps the need to write 14 bespoke shape
 * assertions while still producing readable failure messages.
 */

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
}

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: '1. add-file: single add hunk with "+"-prefixed lines',
    input: ['*** Begin Patch', '*** Add File: hello.txt', '+Hello', '+world', '*** End Patch'].join(
      '\n',
    ),
    expected: '{"ok":true,"ops":[{"kind":"add","path":"hello.txt","lines":["Hello","world"]}]}',
  },
  {
    name: '2. delete-file: single delete hunk',
    input: ['*** Begin Patch', '*** Delete File: stale.md', '*** End Patch'].join('\n'),
    expected: '{"ok":true,"ops":[{"kind":"delete","path":"stale.md"}]}',
  },
  {
    name: '3. update-file: single hunk with context + +/- lines',
    input: [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      ' before',
      '-old',
      '+new',
      ' after',
      '*** End Patch',
    ].join('\n'),
    expected:
      '{"ok":true,"ops":[{"kind":"update","path":"src/app.ts","hunks":[{"contexts":[""],"lines":[{"op":" ","text":"before"},{"op":"-","text":"old"},{"op":"+","text":"new"},{"op":" ","text":"after"}],"endOfFile":false}]}]}',
  },
  {
    name: '4. update-with-move: pure rename (no body hunks)',
    input: [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '*** End Patch',
    ].join('\n'),
    expected:
      '{"ok":true,"ops":[{"kind":"update","path":"src/old.ts","hunks":[],"moveTo":"src/new.ts"}]}',
  },
  {
    name: '5. update-with-move-and-body: rename plus a hunk',
    input: [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '@@',
      '-foo',
      '+bar',
      '*** End Patch',
    ].join('\n'),
    expected:
      '{"ok":true,"ops":[{"kind":"update","path":"src/old.ts","hunks":[{"contexts":[""],"lines":[{"op":"-","text":"foo"},{"op":"+","text":"bar"}],"endOfFile":false}],"moveTo":"src/new.ts"}]}',
  },
  {
    name: '6. multiple-hunks: one Update with two "@@" blocks',
    input: [
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
    ].join('\n'),
    expected:
      '{"ok":true,"ops":[{"kind":"update","path":"src/big.ts","hunks":[{"contexts":["class Foo"],"lines":[{"op":" ","text":"before1"},{"op":"-","text":"x"},{"op":"+","text":"y"}],"endOfFile":false},{"contexts":["class Bar"],"lines":[{"op":" ","text":"before2"},{"op":"-","text":"a"},{"op":"+","text":"b"}],"endOfFile":false}]}]}',
  },
  {
    name: '7. end-of-file sentinel sets hunk.endOfFile=true',
    input: [
      '*** Begin Patch',
      '*** Update File: f.ts',
      '@@',
      ' keep',
      '-drop_tail',
      '*** End of File',
      '*** End Patch',
    ].join('\n'),
    expected:
      '{"ok":true,"ops":[{"kind":"update","path":"f.ts","hunks":[{"contexts":[""],"lines":[{"op":" ","text":"keep"},{"op":"-","text":"drop_tail"}],"endOfFile":true}]}]}',
  },
  {
    name: '8. CRLF input is rejected with "CRLF" in the error message',
    input: '*** Begin Patch\r\n*** Add File: x\r\n+a\r\n*** End Patch\r\n',
    expected: '{"ok":false,"error":"CRLF line endings are not allowed; use LF.","line":1}',
  },
  {
    name: '9. absolute path is rejected',
    input: ['*** Begin Patch', '*** Add File: /etc/passwd', '+oops', '*** End Patch'].join('\n'),
    expected: '{"ok":false,"error":"Absolute path not allowed: /etc/passwd","line":2}',
  },
  {
    name: '10. zero hunks: Begin Patch → End Patch is rejected',
    input: ['*** Begin Patch', '*** End Patch'].join('\n'),
    expected:
      '{"ok":false,"error":"Patch must contain at least one hunk (zero-hunk patch).","line":2}',
  },
  {
    name: '11. malformed begin sentinel is rejected',
    input: ['*** Begin Patc', '*** Add File: x', '+a', '*** End Patch'].join('\n'),
    expected:
      '{"ok":false,"error":"Expected \\"*** Begin Patch\\", got: \\"*** Begin Patc\\"","line":1}',
  },
  {
    name: '12. add_line missing "+" prefix is rejected',
    input: ['*** Begin Patch', '*** Add File: x', 'no-plus-prefix', '*** End Patch'].join('\n'),
    expected:
      '{"ok":false,"error":"Add File body line missing \\"+\\" prefix (file x): \\"no-plus-prefix\\"","line":3}',
  },
  {
    name: 'combined patch (Add + Update+Move+hunk + Delete) parses to 3 ops',
    input: [
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
    ].join('\n'),
    expected:
      '{"ok":true,"ops":[{"kind":"add","path":"hello.txt","lines":["Hello world"]},{"kind":"update","path":"src/app.py","hunks":[{"contexts":["def greet():"],"lines":[{"op":"-","text":"print(\\"Hi\\")"},{"op":"+","text":"print(\\"Hello, world!\\")"}],"endOfFile":false}],"moveTo":"src/main.py"},{"kind":"delete","path":"obsolete.txt"}]}',
  },
  {
    name: 'trailing LF after End Patch is allowed',
    input: '*** Begin Patch\n*** Add File: x\n+y\n*** End Patch\n',
    expected: '{"ok":true,"ops":[{"kind":"add","path":"x","lines":["y"]}]}',
  },
];

describe('apply_patch parser — cassette-replay byte-identity', () => {
  for (const fixture of FIXTURES) {
    it(`byte-identical: ${fixture.name}`, () => {
      const actual = JSON.stringify(parseApplyPatch(fixture.input));
      expect(actual).toBe(fixture.expected);
    });
  }
});
