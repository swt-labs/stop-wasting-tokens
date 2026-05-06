import { describe, expect, it } from 'vitest';

import { OllamaAgentSpawner, PACKAGE_NAME, STATUS, VERSION } from '../src/index.js';

describe('OllamaAgentSpawner stub', () => {
  const spawner = new OllamaAgentSpawner();

  it('installAgent throws Not implemented', async () => {
    await expect(spawner.installAgent({} as any)).rejects.toThrow(/not implemented/i);
  });

  it('spawn throws Not implemented', async () => {
    await expect(spawner.spawn({} as any)).rejects.toThrow(/not implemented/i);
  });

  it('removeAgent throws Not implemented', async () => {
    await expect(spawner.removeAgent('dev')).rejects.toThrow(/not implemented/i);
  });

  it('error message references v1.5 roadmap', async () => {
    await expect(spawner.spawn({} as any)).rejects.toThrow(/v1\.5/);
  });
});

describe('@swt-labs/ollama-driver package metadata', () => {
  it('exports canonical package name', () => {
    expect(PACKAGE_NAME).toBe('@swt-labs/ollama-driver');
  });

  it('declares stub status', () => {
    expect(STATUS).toBe('stub');
  });

  it('starts at version 0.0.0', () => {
    expect(VERSION).toBe('0.0.0');
  });
});
