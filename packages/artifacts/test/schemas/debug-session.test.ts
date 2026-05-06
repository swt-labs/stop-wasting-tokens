import { describe, expect, it } from 'vitest';

import {
  readDebugSession,
  writeDebugSession,
  type DebugSessionDoc,
} from '../../src/schemas/debug-session.js';

describe('DebugSession schema', () => {
  it('round-trips a structured debug session doc', () => {
    const doc: DebugSessionDoc = {
      frontmatter: {
        session_id: 'sess-2026-05-06-0001',
        started: '2026-05-06T10:30:00.000Z',
        agent: 'debugger',
        phase: '03',
        plan: '02',
        status: 'resolved',
        summary: 'Fixed login regression introduced by commit abc1234.',
      },
      investigation: 'Read src/auth.ts; ran failing test; reproduced 500.',
      findings: 'Stray slash in redirect URL.',
      resolution: 'Strip trailing slash before redirect.',
    };
    const rendered = writeDebugSession(doc);
    const reparsed = readDebugSession(rendered);
    expect(reparsed.frontmatter).toEqual(doc.frontmatter);
    expect(reparsed.investigation).toBe(doc.investigation);
    expect(reparsed.findings).toBe(doc.findings);
    expect(reparsed.resolution).toBe(doc.resolution);
  });

  it('rejects malformed agent values', () => {
    const raw = `---
session_id: x
started: 2026-05-06T00:00:00.000Z
agent: gardener
status: open
summary: bad agent
---

## Investigation

stuff
`;
    expect(() => readDebugSession(raw)).toThrow();
  });
});
