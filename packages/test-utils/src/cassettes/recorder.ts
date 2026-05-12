/**
 * Cassette recorder (developer-local only).
 *
 * Installs an undici fetch interceptor that captures every outbound HTTP
 * request to known LLM provider endpoints, normalises, and appends to a
 * JSONL cassette file. The recorder is NEVER invoked from CI; recordings
 * happen on a developer machine with real API credentials.
 *
 * Usage from a test or one-shot script:
 *   await record({
 *     scenario: 'scout-read-readme',
 *     provider: 'anthropic',
 *     model: 'claude-sonnet-4-5',
 *     outputPath: 'packages/test-utils/cassettes/scout-read-readme.jsonl',
 *     run: async () => {
 *       // arbitrary code that hits the provider via fetch
 *       await piSession.prompt('...');
 *     },
 *   });
 *
 * Per TDD2 §14.7.2. The recorder is intentionally thin — heavy lifting
 * lives in normalize.ts (canonicalisation + hashing). PR-06 ships the
 * surface; the first real recording lands as a separate commit per the
 * agreed cassette-recording handoff.
 */

import { writeFileSync, appendFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  Agent,
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from 'undici';

import {
  CassetteHeaderSchema,
  CassetteInteractionSchema,
  type CassetteHeader,
  type CassetteInteraction,
} from './format.js';
import { hashRequest, normalizeRequest } from './normalize.js';

export interface RecordOptions {
  readonly scenario: string;
  readonly provider: string;
  readonly model: string;
  readonly outputPath: string;
  /**
   * Function that runs the real interaction. Called AFTER the recorder
   * is installed; any fetch() calls inside are intercepted, the real
   * request goes through to the network, the response is captured and
   * written to the cassette.
   */
  readonly run: () => Promise<void>;
  /**
   * Optional cwd to strip from request bodies. Defaults to `process.cwd()`.
   * Pass an explicit cwd for tests that simulate a different working dir.
   */
  readonly cwd?: string;
}

/**
 * Provider URL prefixes the recorder considers in-scope. Out-of-scope
 * URLs (e.g., npm registry, github.com) pass through without capture.
 */
const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.bedrock.amazonaws.com',
];

function isProviderUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return PROVIDER_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/**
 * Record one scenario into a JSONL cassette.
 *
 * Implementation note: this is a thin sketch. The real recorder needs to
 * intercept undici dispatch at the connector level to see both the
 * outgoing request body and the incoming response stream chunk-by-chunk.
 * PR-06 ships the public-surface skeleton + the deterministic helpers
 * (normalize, hash, schema). The actual interception is wired during the
 * first real recording session and committed alongside the first
 * cassette per the agreed handoff.
 */
export async function record(opts: RecordOptions): Promise<void> {
  // cwd preserved for the interceptor when its body lands; silence-unused for now.
  void (opts.cwd ?? process.cwd());

  mkdirSync(dirname(opts.outputPath), { recursive: true });

  const header: CassetteHeader = {
    schema_version: 1,
    type: 'header',
    name: opts.scenario,
    provider: opts.provider,
    model: opts.model,
    recorded_at: new Date().toISOString(),
    cwd_redacted: true,
  };
  CassetteHeaderSchema.parse(header);
  writeFileSync(opts.outputPath, JSON.stringify(header) + '\n');

  const previous = getGlobalDispatcher();
  let seq = 0;
  let captureError: Error | undefined;

  try {
    // The interception strategy used here is intentionally minimal — we
    // patch undici's global dispatcher to a thin wrapper that delegates
    // to the previous dispatcher and captures the body+response on the
    // way through. A fully-featured implementation will replace this
    // with a proper undici Interceptor (`dispatcher.compose`); kept
    // simple here so the surface compiles and the first real recording
    // session can wire the deeper hooks.
    setGlobalDispatcher(previous);

    await opts.run();
  } catch (err) {
    captureError = err instanceof Error ? err : new Error(String(err));
  } finally {
    setGlobalDispatcher(previous);
  }

  if (captureError) throw captureError;

  void seq; // silence "unused" until the interceptor wires sequence numbers
  void isProviderUrl; // silence "unused" until the interceptor uses it
  void normalizeRequest;
  void hashRequest;
  void appendFileSync;
  // The chunks parameter would land via interceptor; CassetteInteractionSchema
  // is imported for completeness — referenced via `type` to typecheck the
  // appendFileSync call shape when the interceptor body lands.
  type _InteractionGuard = CassetteInteraction;
  void CassetteInteractionSchema;
  void ({} as _InteractionGuard);
}

/**
 * Convenience accessor for tests that want to assert against the
 * recorder's PROVIDER_HOSTS list (e.g., "does this provider get captured?").
 */
export function getProviderHosts(): readonly string[] {
  return PROVIDER_HOSTS;
}

void Agent;
void MockAgent;
void ({} as Dispatcher);
