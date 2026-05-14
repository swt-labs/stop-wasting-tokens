#!/usr/bin/env node
/**
 * scripts/refresh-rate-card.mjs — developer-local rate-card refresh.
 *
 * Phase 2 / Plan 02-01 T4 (G-R3 R1 decision (a)+(b)).
 *
 * Reads `packages/runtime/src/budget/rate-card.embedded.json` in place,
 * refreshes:
 *
 *   - OpenRouter slice: programmatic fetch from
 *     https://openrouter.ai/api/v1/models (pricing.prompt +
 *     pricing.completion). Per-token values are multiplied by 1000 to
 *     convert to per-1k.
 *   - Other providers (anthropic, openai, google): prompts for current
 *     per-1k values interactively, unless --non-interactive is passed
 *     (then no-op for those entries).
 *
 * Updates each touched entry's `updated_at` to `new Date().toISOString()`
 * and the card's `generated_at` to the same. Runs a lightweight invariant
 * check before writing (full Zod re-parse happens at runtime via
 * createRateCardSource on next load).
 *
 * Usage:
 *   node scripts/refresh-rate-card.mjs                    # interactive
 *   node scripts/refresh-rate-card.mjs --non-interactive  # OpenRouter only
 *
 * The script does NOT commit or push; it edits the file and exits 0.
 * Review the diff with: git diff packages/runtime/src/budget/rate-card.embedded.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CARD_PATH = resolve(
  __dirname,
  '..',
  'packages',
  'runtime',
  'src',
  'budget',
  'rate-card.embedded.json',
);

const args = new Set(process.argv.slice(2));
const NON_INTERACTIVE = args.has('--non-interactive');

async function refreshOpenRouter(entries) {
  let res;
  try {
    res = await fetch('https://openrouter.ai/api/v1/models');
  } catch (err) {
    console.warn(
      `[refresh-rate-card] OpenRouter fetch threw: ${err?.message ?? err}. Skipping OpenRouter slice.`,
    );
    return 0;
  }
  if (!res.ok) {
    console.warn(
      `[refresh-rate-card] OpenRouter fetch failed: ${res.status} ${res.statusText}. Skipping OpenRouter slice.`,
    );
    return 0;
  }
  const data = await res.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  let updated = 0;
  for (const entry of entries) {
    if (entry.provider !== 'openrouter') continue;
    // OpenRouter model ids in the snapshot are namespaced (e.g.
    // "openrouter/anthropic/claude-opus-4-7"); the API returns the bare
    // upstream id (e.g. "anthropic/claude-opus-4-7"), so we strip the
    // leading "openrouter/" namespace before matching.
    const upstreamId = entry.model.replace(/^openrouter\//, '');
    const m = models.find((m) => m.id === upstreamId);
    if (!m || !m.pricing) continue;
    const inputPerToken = Number(m.pricing.prompt);
    const outputPerToken = Number(m.pricing.completion);
    if (Number.isFinite(inputPerToken)) {
      entry.input_per_1k = inputPerToken * 1000;
    }
    if (Number.isFinite(outputPerToken)) {
      entry.output_per_1k = outputPerToken * 1000;
    }
    entry.updated_at = new Date().toISOString();
    updated++;
  }
  console.log(`[refresh-rate-card] OpenRouter: ${updated} entries refreshed.`);
  return updated;
}

async function refreshInteractive(entries) {
  if (NON_INTERACTIVE) {
    console.log(
      '[refresh-rate-card] --non-interactive: skipping anthropic/openai/google manual refresh.',
    );
    return 0;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  let updated = 0;
  try {
    for (const entry of entries) {
      if (entry.provider === 'openrouter') continue;
      console.log(
        `\n[${entry.provider} / ${entry.model}] current: input=$${entry.input_per_1k}/1k, output=$${entry.output_per_1k}/1k`,
      );
      const newIn = (
        await rl.question('  new input_per_1k (blank to keep): ')
      ).trim();
      const newOut = (
        await rl.question('  new output_per_1k (blank to keep): ')
      ).trim();
      let touched = false;
      if (newIn !== '' && Number.isFinite(Number(newIn))) {
        entry.input_per_1k = Number(newIn);
        touched = true;
      }
      if (newOut !== '' && Number.isFinite(Number(newOut))) {
        entry.output_per_1k = Number(newOut);
        touched = true;
      }
      if (touched) {
        entry.updated_at = new Date().toISOString();
        updated++;
      }
    }
  } finally {
    rl.close();
  }
  console.log(`[refresh-rate-card] Interactive: ${updated} entries refreshed.`);
  return updated;
}

async function main() {
  const raw = readFileSync(CARD_PATH, 'utf8');
  const card = JSON.parse(raw);

  const orUpdated = await refreshOpenRouter(card.entries);
  const intUpdated = await refreshInteractive(card.entries);

  if (orUpdated + intUpdated > 0) {
    card.generated_at = new Date().toISOString();
  }

  // Lightweight in-script validation: required top-level keys + each entry
  // shape. The full Zod re-parse happens at runtime in the loader; this is
  // a safety net so the script doesn't write a malformed file.
  if (
    card.schema_version !== 1 ||
    !['embedded', 'project-override', 'fetched'].includes(card.source) ||
    !Array.isArray(card.entries) ||
    card.entries.length < 1
  ) {
    throw new Error(
      'refresh-rate-card: invariant violation post-refresh; refusing to write.',
    );
  }
  for (const e of card.entries) {
    if (!e.provider || !e.model) {
      throw new Error(
        `refresh-rate-card: malformed entry: ${JSON.stringify(e)}`,
      );
    }
    if (typeof e.input_per_1k !== 'number' || e.input_per_1k < 0) {
      throw new Error(
        `refresh-rate-card: bad input_per_1k for ${e.provider}/${e.model}`,
      );
    }
    if (typeof e.output_per_1k !== 'number' || e.output_per_1k < 0) {
      throw new Error(
        `refresh-rate-card: bad output_per_1k for ${e.provider}/${e.model}`,
      );
    }
  }

  writeFileSync(CARD_PATH, JSON.stringify(card, null, 2) + '\n', 'utf8');
  console.log(
    `\n[refresh-rate-card] Wrote ${CARD_PATH} (${orUpdated + intUpdated} entries refreshed).`,
  );
  console.log(`\nReview the diff: git diff ${CARD_PATH}`);
}

main().catch((err) => {
  console.error('refresh-rate-card: failed:', err);
  process.exitCode = 1;
});
