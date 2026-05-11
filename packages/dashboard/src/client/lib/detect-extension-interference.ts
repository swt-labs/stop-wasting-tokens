/**
 * Runtime detection of browser extensions that inject scripts into the
 * dashboard page and may break it.
 *
 * **Why this exists.** Web3 wallet extensions (MetaMask, Yoroi, Phantom,
 * Rabby, Brave Wallet, Coinbase Wallet, etc.) inject scripts into every
 * `http://` page they encounter — including localhost. Most of them
 * additionally drop SES (Secure ECMAScript) lockdown into the page to
 * freeze JS primordials for security. SES lockdown can interfere with
 * Solid's reactivity primitives and other standard library usage,
 * causing the dashboard's natural-language command-bar classifier to
 * silently fail and route every input to `/api/command` instead of
 * `/api/vibe`.
 *
 * **Defense layers (v2.3.4):**
 *   1. Server-side CSP header blocks Manifest V3 MAIN_WORLD content-script
 *      injection at the browser. Cleanest, no app code involved.
 *   2. This detector is the safety net. If an extension somehow bypasses
 *      CSP (older browser, weird vendor injection, etc.), we detect it at
 *      JS boot and render a clear remediation banner so the user doesn't
 *      see mysterious silent breakage.
 *
 * The detector is extension-vendor-aware. Adding a new wallet is a single
 * entry in `KNOWN_WALLET_GLOBALS`.
 */

export interface DetectedSource {
  readonly id: string;
  readonly label: string;
  readonly category: 'wallet' | 'lockdown' | 'unknown';
}

export interface DetectionResult {
  readonly interferenceDetected: boolean;
  readonly sources: ReadonlyArray<DetectedSource>;
  readonly remediation: string;
}

/**
 * Globals injected by known wallet extensions. Detection is best-effort:
 * a wallet that doesn't inject (rare) won't be caught here. The SES
 * lockdown check below catches everything that uses Agoric's hardened-JS
 * library regardless of vendor, which is the practical superset.
 *
 * Sources for each entry:
 *   - MetaMask, Coinbase Wallet, Trust Wallet — `window.ethereum` (EIP-1193).
 *     Vendor distinguished via `ethereum.isMetaMask` / `isCoinbaseWallet`.
 *     We only detect presence here; vendor split is non-essential for the UX.
 *   - Yoroi (Cardano) — `window.cardano.yoroi`.
 *   - Phantom (Solana) — `window.phantom`.
 *   - Rabby (multi-chain) — `window.rabby` + adds to `window.ethereum`.
 *   - Brave Wallet — `window.ethereum.isBraveWallet`.
 */
interface WalletProbe {
  readonly id: string;
  readonly label: string;
  readonly probe: (g: Record<string, unknown>) => boolean;
}

const KNOWN_WALLET_GLOBALS: ReadonlyArray<WalletProbe> = [
  {
    id: 'ethereum',
    label: 'EVM wallet (MetaMask / Coinbase / Brave / Rabby)',
    probe: (g) => typeof g['ethereum'] === 'object' && g['ethereum'] !== null,
  },
  {
    id: 'cardano',
    label: 'Cardano wallet (Yoroi / Nami / Eternl / Lace)',
    probe: (g) => typeof g['cardano'] === 'object' && g['cardano'] !== null,
  },
  {
    id: 'phantom',
    label: 'Solana wallet (Phantom)',
    probe: (g) => typeof g['phantom'] === 'object' && g['phantom'] !== null,
  },
  {
    id: 'solana',
    label: 'Solana wallet (provider)',
    probe: (g) => typeof g['solana'] === 'object' && g['solana'] !== null,
  },
  {
    id: 'tronWeb',
    label: 'Tron wallet (TronLink)',
    probe: (g) => typeof g['tronWeb'] === 'object' && g['tronWeb'] !== null,
  },
];

/**
 * SES lockdown leaves a few telltale signs:
 *   - `globalThis.lockdown` is a function (pre-lockdown — wallet preloaded).
 *   - `Object.isFrozen(Array.prototype)` returns true (post-lockdown).
 *   - `globalThis.harden` is a function.
 *
 * We check all three because timing matters: in some injection orders the
 * lockdown function is removed after lockdown completes.
 */
function detectSesLockdown(g: Record<string, unknown>): boolean {
  if (typeof g['lockdown'] === 'function') return true;
  if (typeof g['harden'] === 'function') return true;
  try {
    if (Object.isFrozen(Array.prototype)) return true;
  } catch {
    // pre-ES6 / weird shim — ignore
  }
  return false;
}

const REMEDIATION =
  'A browser extension is injecting code into the dashboard, which can break some features ' +
  '(notably the natural-language command bar). To fix: open the dashboard in an Incognito ' +
  'window (extensions are disabled there by default), or disable wallet extensions for ' +
  '127.0.0.1 in chrome://extensions.';

/**
 * Run detection against the current global object. Pass an explicit
 * `globalRef` for testability (vitest can pass a stub).
 *
 * Returns `{interferenceDetected: false, sources: [], …}` when nothing is
 * detected — render nothing in that case.
 */
export function detectExtensionInterference(
  globalRef: Record<string, unknown> = globalThis,
): DetectionResult {
  const sources: DetectedSource[] = [];

  for (const probe of KNOWN_WALLET_GLOBALS) {
    try {
      if (probe.probe(globalRef)) {
        sources.push({ id: probe.id, label: probe.label, category: 'wallet' });
      }
    } catch {
      // Defensive: a probe must never throw. Extensions can do weird
      // things to getters; swallow and continue.
    }
  }

  if (detectSesLockdown(globalRef)) {
    sources.push({
      id: 'ses',
      label: 'SES lockdown (Agoric hardened-JS, used by many wallets)',
      category: 'lockdown',
    });
  }

  return {
    interferenceDetected: sources.length > 0,
    sources,
    remediation: REMEDIATION,
  };
}
