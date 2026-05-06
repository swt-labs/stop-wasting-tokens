import { describe, expect, it } from 'vitest';

import { renderHelp } from '../src/help.js';
import { buildRegistry } from '../src/main.js';
import { STUB_SPECS } from '../src/commands/stubs.js';

describe('renderHelp', () => {
  const registry = buildRegistry();
  const text = renderHelp(registry);

  it('lists every registered command', () => {
    for (const stub of STUB_SPECS) {
      expect(text).toContain(stub.name);
    }
    expect(text).toContain('help');
    expect(text).toContain('version');
    expect(text).toContain('config');
    expect(text).toContain('status');
    expect(text).toContain('doctor');
  });

  it('documents global flags', () => {
    expect(text).toContain('--effort');
    expect(text).toContain('--yolo');
    expect(text).toContain('--skip-qa');
    expect(text).toContain('--plan');
  });
});
