/**
 * Plan 05-01 T2 — `swt provider-tuning-sources` verb handler.
 *
 * Read-only verb that enumerates all registered ProviderTuningPack
 * instances via `getAllPacks(installRoot)`, calls `pack.upstreamSources()`
 * on each, and emits an enriched-envelope JSON document to stdout.
 *
 * The envelope shape is the API contract consumed by
 * `scripts/audit-upstream-prompts.sh` (Plan 05-01 T3) and the GHA
 * `upstream-prompt-audit.yml` workflow (Plan 05-01 T4). The `schema`
 * field is the version marker — bump to 'v2' if the envelope shape
 * changes (the bash consumer asserts `schema === 'v1'`).
 *
 * Pack metadata (`packId`, `packDisplayName`, `method`) is added at the
 * CLI envelope layer rather than the `UpstreamSource` type so the
 * interface stays at its D3 ≤8-field cap
 * (DEVN-PHASE-05-CLI-ENVELOPE-ENRICHMENT).
 *
 * Always-JSON: NO `--json` flag toggle. The bash script consumer
 * always needs JSON, and there is no useful human text-mode alternative
 * for an artifact whose primary consumer is automation.
 */

import { getAllPacks, type UpstreamSource } from '@swt-labs/orchestration';
import { resolveInstallRoot } from '@swt-labs/runtime';

import type { ParsedArgv } from '../argv.js';
import { EXIT, type ExitCode } from '../exit-codes.js';
import type { CommandHandler, CommandIO } from '../router.js';

interface EnrichedSource extends UpstreamSource {
  readonly packId: string;
  readonly packDisplayName: string;
  readonly method: 'upstreamSources';
}

interface Envelope {
  readonly schema: 'v1';
  readonly generated_at: string;
  readonly sources: readonly EnrichedSource[];
}

export const providerTuningSourcesHandler: CommandHandler = (
  _parsed: ParsedArgv,
  io: CommandIO,
): ExitCode => {
  let installRoot: string;
  try {
    installRoot = resolveInstallRoot();
  } catch (err) {
    io.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.RUNTIME_ERROR;
  }
  const packs = getAllPacks(installRoot);
  const sources: EnrichedSource[] = [];
  for (const pack of packs) {
    for (const src of pack.upstreamSources()) {
      sources.push({
        packId: pack.providerId,
        packDisplayName: pack.displayName,
        method: 'upstreamSources',
        ...src,
      });
    }
  }
  const envelope: Envelope = {
    schema: 'v1',
    generated_at: new Date().toISOString(),
    sources,
  };
  io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  return EXIT.SUCCESS;
};
