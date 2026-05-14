/**
 * Phase 2 / Plan 02-01 (G-R3) — Rate-card source loader.
 *
 * File-system loader for the `RateCard` shape defined in
 * `@swt-labs/shared`'s `types/rate-card.ts`. Resolves the active card in a
 * deterministic order:
 *
 *   1. `opts.path` — explicit override (when supplied AND the file exists).
 *   2. `<opts.cwd>/.swt-planning/rate-card.json` — project-level override.
 *   3. The embedded snapshot bundled with this package
 *      (`./rate-card.embedded.json`).
 *
 * The loader runs ONCE on construction: it reads the file from disk, JSON-
 * parses it, then `RateCardSchema.parse(...)`s the result. Malformed cards
 * throw a Zod validation error AT LOAD TIME (not lazily at first lookup), so
 * misconfigured projects fail fast at cook startup rather than silently
 * mis-routing on the first spawn.
 *
 * Sibling of `gate.ts` in `packages/runtime/src/budget/` because rate cards
 * are vendor-billing data: the runtime adapter already owns this neighborhood
 * (per `provider-overrides.ts` + `gate.ts`).
 *
 * Refresh is NOT a runtime concern — the embedded snapshot ages in git, and
 * `scripts/refresh-rate-card.mjs` (plan 02-01 T4) is the developer-local
 * refresh entrypoint (R1 decision (a)+(b)). Live fetch (option c) is
 * deferred; staleness is surfaced via `ageMs()` to telemetry in plan 02-04.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RateCardSchema, type RateCard, type RateCardEntry } from '@swt-labs/shared';

export interface RateCardSourceOptions {
  /** Project cwd; used to locate <cwd>/.swt-planning/rate-card.json. */
  readonly cwd: string;
  /**
   * Explicit override path; bypasses cwd-based resolution when set AND the
   * file exists. Treated as a `project-override` source for telemetry.
   */
  readonly path?: string;
  /**
   * Clock injection for staleness telemetry (test seam). Defaults to
   * `Date.now`. Plan 02-04 wires this into the snapshot event payload.
   */
  readonly clock?: () => number;
}

export interface RateCardSource {
  /** Returns the loaded card; cached after first read. */
  readCurrent(): RateCard;
  /**
   * Age in milliseconds of the OLDEST entry's `updated_at`. Used by Phase 2
   * telemetry (plan 02-04) so operators see when the embedded snapshot has
   * drifted from current vendor pricing.
   */
  ageMs(): number;
  /**
   * Lookup helper: returns the first entry matching `provider` (and `model`
   * when supplied). Deterministic by array order — when `model` is omitted,
   * the first provider-matching entry wins. Returns `undefined` on miss.
   */
  find(provider: string, model?: string): RateCardEntry | undefined;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EMBEDDED_PATH = resolve(__dirname, 'rate-card.embedded.json');

export function createRateCardSource(opts: RateCardSourceOptions): RateCardSource {
  const clock = opts.clock ?? Date.now;
  const projectOverridePath = resolve(opts.cwd, '.swt-planning', 'rate-card.json');

  let rawPath: string;
  let labelOverride: 'project-override' | undefined;
  if (opts.path !== undefined && existsSync(opts.path)) {
    rawPath = opts.path;
    labelOverride = 'project-override';
  } else if (existsSync(projectOverridePath)) {
    rawPath = projectOverridePath;
    labelOverride = 'project-override';
  } else {
    rawPath = EMBEDDED_PATH;
    labelOverride = undefined;
  }

  const raw = readFileSync(rawPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const card: RateCard = RateCardSchema.parse(parsed);
  const finalCard: RateCard =
    labelOverride !== undefined ? { ...card, source: labelOverride } : card;

  return {
    readCurrent: () => finalCard,
    ageMs: () => {
      const oldest = finalCard.entries.reduce<number>((min, e) => {
        const t = Date.parse(e.updated_at);
        return t < min ? t : min;
      }, Number.POSITIVE_INFINITY);
      if (!Number.isFinite(oldest)) {
        return 0;
      }
      return Math.max(0, clock() - oldest);
    },
    find: (provider, model) => {
      return finalCard.entries.find(
        (e) => e.provider === provider && (model === undefined || e.model === model),
      );
    },
  };
}
