/**
 * `scripts/codegen/capture-apply-patch-fixtures.ts` — Phase 06 plan 06-01 T1/T4.
 *
 * Captures `parseApplyPatch(input)` results across the 14 canonical fixtures
 * lifted verbatim from `packages/runtime/test/extensions/apply-patch-parser.test.ts`,
 * serializing them to a JSON file. Drives the cassette-replay byte-identity
 * assertion in T4: the baseline captured BEFORE the parser swap (T1) must be
 * byte-identical to the output captured AFTER the swap (T4).
 *
 * Usage:
 *   pnpm tsx scripts/codegen/capture-apply-patch-fixtures.ts <output.json>
 *
 * Why embed the fixtures inline instead of importing the test file?
 *   The test file uses vitest's `it()` and `describe()` runtime — importing it
 *   into a non-test context throws. Inlining the 14 inputs decouples this
 *   capture helper from the vitest runner.
 *
 * Output shape:
 *   [
 *     { "name": "1. add-file: ...", "input": "*** Begin Patch\\n...", "result": {...} },
 *     ...
 *   ]
 *
 * Indent = 2 (stable, prettier-compatible). Sorted-keys NOT applied — the
 * parser's result shape is the authoritative ordering.
 */

import { writeFileSync } from 'node:fs';

import { parseApplyPatch } from '../../packages/runtime/src/extensions/apply-patch-parser.js';

interface Fixture {
  readonly name: string;
  readonly input: string;
}

const FIXTURES: ReadonlyArray<Fixture> = [
  {
    name: '1. add-file: single add hunk with "+"-prefixed lines',
    input: [
      '*** Begin Patch',
      '*** Add File: hello.txt',
      '+Hello',
      '+world',
      '*** End Patch',
    ].join('\n'),
  },
  {
    name: '2. delete-file: single delete hunk',
    input: ['*** Begin Patch', '*** Delete File: stale.md', '*** End Patch'].join('\n'),
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
  },
  {
    name: '4. update-with-move: pure rename (no body hunks)',
    input: [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '*** End Patch',
    ].join('\n'),
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
  },
  {
    name: '8. CRLF input is rejected with "CRLF" in the error message',
    input: '*** Begin Patch\r\n*** Add File: x\r\n+a\r\n*** End Patch\r\n',
  },
  {
    name: '9. absolute path is rejected',
    input: ['*** Begin Patch', '*** Add File: /etc/passwd', '+oops', '*** End Patch'].join('\n'),
  },
  {
    name: '10. zero hunks: Begin Patch → End Patch is rejected',
    input: ['*** Begin Patch', '*** End Patch'].join('\n'),
  },
  {
    name: '11. malformed begin sentinel is rejected',
    input: ['*** Begin Patc', '*** Add File: x', '+a', '*** End Patch'].join('\n'),
  },
  {
    name: '12. add_line missing "+" prefix is rejected',
    input: ['*** Begin Patch', '*** Add File: x', 'no-plus-prefix', '*** End Patch'].join('\n'),
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
  },
  {
    name: 'trailing LF after End Patch is allowed',
    input: '*** Begin Patch\n*** Add File: x\n+y\n*** End Patch\n',
  },
];

function main(): void {
  const outPath = process.argv[2];
  if (!outPath) {
    process.stderr.write(
      'usage: pnpm tsx scripts/codegen/capture-apply-patch-fixtures.ts <output.json>\n',
    );
    process.exit(1);
  }
  const captured = FIXTURES.map((fixture) => ({
    name: fixture.name,
    input: fixture.input,
    result: parseApplyPatch(fixture.input),
  }));
  writeFileSync(outPath, JSON.stringify(captured, null, 2) + '\n');
}

main();
