import { describe, expect, it } from 'vitest';

import {
  BackendError,
  ConfigError,
  HandoffError,
  MemoryError,
  PermissionDeniedError,
  SwtError,
  formatCause,
  isSwtError,
} from '../src/errors/SwtError.js';

describe('SwtError hierarchy', () => {
  it('exposes a literal `code` per subclass', () => {
    expect(new ConfigError('').code).toBe('config_error');
    expect(new HandoffError('').code).toBe('handoff_error');
    expect(new PermissionDeniedError('').code).toBe('permission_denied');
    expect(new MemoryError('').code).toBe('memory_error');
    expect(new BackendError('').code).toBe('backend_error');
  });

  it('narrows correctly with instanceof', () => {
    const err: SwtError = new ConfigError('boom');
    expect(err instanceof ConfigError).toBe(true);
    expect(err instanceof HandoffError).toBe(false);
    expect(isSwtError(err)).toBe(true);
    expect(isSwtError(new Error('plain'))).toBe(false);
  });

  it('preserves context through toJSON()', () => {
    const err = new HandoffError('bad payload', { context: { kind: 'scout-findings' } });
    expect(err.toJSON()).toEqual({
      name: 'HandoffError',
      code: 'handoff_error',
      message: 'bad payload',
      context: { kind: 'scout-findings' },
    });
  });

  it('formats causes safely', () => {
    expect(formatCause(new Error('inner'))).toBe('Error: inner');
    expect(formatCause('string cause')).toBe('string cause');
    expect(formatCause({ x: 1 })).toBe('{"x":1}');
  });
});
