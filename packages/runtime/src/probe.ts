/**
 * Layer-1 Pi availability probe.
 *
 * Centralised in runtime/ so consumers (orchestration's PiSpawnerEnvironment,
 * cli's doctor command via the spawner chain) don't need to import
 * `@earendil-works/pi-coding-agent` directly — that would violate Principle 1
 * (only Layer 1 imports the Pi SDK).
 *
 * Uses dynamic `import()` so a missing peerDep doesn't crash module load —
 * doctor.ts / vibe.ts can still run and surface a useful "Pi not installed"
 * message instead of an opaque ESM-resolution error.
 */

export interface ProbePiResult {
  readonly available: boolean;
  readonly version?: string;
  readonly reason?: string;
}

export async function probePiAvailable(): Promise<ProbePiResult> {
  try {
    await import('@earendil-works/pi-coding-agent');
    // Pi's main export does not include a stable `version` constant; the
    // package.json `version` is the source of truth and is checked at install
    // time via the pinned-range dep (^0.74.0 per ADR-010). Returning a
    // sentinel string keeps the SpawnerProbeResult contract satisfied.
    return { available: true, version: 'peer-dep-resolved' };
  } catch (err) {
    return {
      available: false,
      reason:
        '@earendil-works/pi-coding-agent peerDep not resolvable. ' +
        `Run \`pnpm install\` from the repo root. (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}
