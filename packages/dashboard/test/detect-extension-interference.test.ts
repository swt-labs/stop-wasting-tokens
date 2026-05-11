import { describe, expect, it } from 'vitest';

import { detectExtensionInterference } from '../src/client/lib/detect-extension-interference.js';

describe('detectExtensionInterference', () => {
  it('returns interferenceDetected:false on a clean globalRef', () => {
    const result = detectExtensionInterference({});
    expect(result.interferenceDetected).toBe(false);
    expect(result.sources).toEqual([]);
  });

  it('detects window.ethereum (MetaMask / Coinbase / Brave / Rabby)', () => {
    const result = detectExtensionInterference({ ethereum: { isMetaMask: true } });
    expect(result.interferenceDetected).toBe(true);
    const ids = result.sources.map((s) => s.id);
    expect(ids).toContain('ethereum');
    expect(result.sources.find((s) => s.id === 'ethereum')?.category).toBe('wallet');
  });

  it('detects window.cardano (Yoroi / Nami / Eternl / Lace)', () => {
    const result = detectExtensionInterference({ cardano: { yoroi: { enable: () => {} } } });
    expect(result.interferenceDetected).toBe(true);
    expect(result.sources.find((s) => s.id === 'cardano')?.category).toBe('wallet');
  });

  it('detects window.phantom (Solana)', () => {
    const result = detectExtensionInterference({ phantom: { solana: {} } });
    expect(result.interferenceDetected).toBe(true);
    expect(result.sources.find((s) => s.id === 'phantom')?.category).toBe('wallet');
  });

  it('detects multiple wallets coexisting in a single global', () => {
    const result = detectExtensionInterference({
      ethereum: { isMetaMask: true },
      cardano: { yoroi: {} },
      phantom: { solana: {} },
    });
    expect(result.interferenceDetected).toBe(true);
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('detects SES lockdown via globalThis.lockdown function (pre-lockdown signature)', () => {
    const result = detectExtensionInterference({ lockdown: () => {} });
    expect(result.interferenceDetected).toBe(true);
    expect(result.sources.find((s) => s.id === 'ses')?.category).toBe('lockdown');
  });

  it('detects SES lockdown via globalThis.harden function', () => {
    const result = detectExtensionInterference({ harden: () => {} });
    expect(result.interferenceDetected).toBe(true);
    expect(result.sources.find((s) => s.id === 'ses')?.category).toBe('lockdown');
  });

  it('does NOT flag a globalRef that has unrelated functions named lockdown-like', () => {
    // Word "lockdown" as a string, not a function, should not trigger.
    const result = detectExtensionInterference({ lockdown: 'COVID-style banner copy' });
    expect(result.interferenceDetected).toBe(false);
  });

  it('returns a remediation string with a concrete action', () => {
    const result = detectExtensionInterference({ ethereum: {} });
    expect(result.remediation.toLowerCase()).toContain('incognito');
    expect(result.remediation.toLowerCase()).toContain('extensions');
  });

  it('is defensive against probes that throw (extension getter sabotage)', () => {
    // Construct an object where accessing a property throws — simulates
    // a malicious / buggy extension that traps getters. The detector
    // must not crash; it should just skip that probe.
    const trapping: Record<string, unknown> = {};
    Object.defineProperty(trapping, 'ethereum', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => detectExtensionInterference(trapping)).not.toThrow();
  });
});
