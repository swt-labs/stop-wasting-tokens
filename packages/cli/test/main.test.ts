import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, VERSION } from '../src/index.js';

describe('@swt-labs/cli smoke', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@swt-labs/cli');
  });

  it('starts at version 0.0.0', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
