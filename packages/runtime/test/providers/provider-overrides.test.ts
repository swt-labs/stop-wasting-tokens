import { describe, expect, it } from 'vitest';

import { buildAllProviderConfigs } from '../../src/extensions/provider-overrides.js';

describe('@swt-labs/runtime — extensions/provider-overrides', () => {
  it('builds one config object per provider in quirks.json (excluding _comment)', () => {
    const configs = buildAllProviderConfigs();
    const providers = Object.keys(configs);
    expect(providers).not.toContain('_comment');
    // M1 ships 4 providers in quirks.json (anthropic, openai, openrouter, google):
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
    expect(providers).toContain('openrouter');
    expect(providers).toContain('google');
  });

  it('promotes provider-level compat fields onto the config', () => {
    const configs = buildAllProviderConfigs();
    expect(configs['anthropic']?.compat?.['supportsLongCacheRetention']).toBe(true);
  });

  it('wildcards in model keys become `pattern`, literals become `id`', () => {
    const configs = buildAllProviderConfigs();
    const openai = configs['openai'];
    expect(openai).toBeDefined();
    const gpt5Entry = openai!.models.find((m) => m.pattern === 'gpt-5*' || m.id === 'gpt-5*');
    expect(gpt5Entry?.pattern).toBe('gpt-5*');

    const anthropic = configs['anthropic'];
    expect(anthropic).toBeDefined();
    const opus = anthropic!.models.find((m) => m.id === 'claude-opus-4-7');
    expect(opus?.id).toBe('claude-opus-4-7');
    expect(opus?.pattern).toBeUndefined();
  });

  it('passes thinkingLevelMap through verbatim', () => {
    const configs = buildAllProviderConfigs();
    const opus = configs['anthropic']!.models.find((m) => m.id === 'claude-opus-4-7');
    expect(opus?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: null,
      medium: 'low',
      high: 'medium',
      xhigh: 'high',
    });
  });

  it('drops undefined entries from thinkingLevelMap', () => {
    // No undefined entries in the actual file; this is a structural invariant
    // of buildProviderConfig — the test asserts the map only contains string|null values.
    const configs = buildAllProviderConfigs();
    for (const [, cfg] of Object.entries(configs)) {
      for (const model of cfg.models) {
        if (!model.thinkingLevelMap) continue;
        for (const v of Object.values(model.thinkingLevelMap)) {
          expect(v === null || typeof v === 'string').toBe(true);
        }
      }
    }
  });
});
