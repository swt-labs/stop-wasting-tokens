#!/usr/bin/env node
/**
 * Developer-local cassette recorder.
 *
 * Usage:
 *   pnpm record -- --scenario=scout-read-readme --provider=anthropic --model=claude-sonnet-4-5
 *
 * Requires an API key in the environment for the chosen provider:
 *   ANTHROPIC_API_KEY   (provider=anthropic)
 *   OPENAI_API_KEY      (provider=openai)
 *   OPENROUTER_API_KEY  (provider=openrouter)
 *
 * Writes the cassette to: packages/test-utils/cassettes/{scenario}.jsonl
 *
 * NEVER invoked from CI — CI only REPLAYS cassettes. This script is
 * deliberately small and human-driven; the real recording session
 * (typically the first one for a project) is intentionally interactive
 * so the developer can verify the scenario produces sensible output
 * before committing it.
 *
 * The corresponding scenarios are loaded from scripts/record-cassette-scenarios/
 * (added incrementally as new cassettes get recorded).
 */

import { argv, env } from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs() {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function bail(msg) {
  console.error(`record-cassette: ${msg}`);
  process.exit(1);
}

const args = parseArgs();
const scenario = args.scenario;
const provider = args.provider;
const model = args.model;

if (!scenario) bail('missing --scenario=<name> (e.g., --scenario=scout-read-readme)');
if (!provider) bail('missing --provider=<name> (e.g., --provider=anthropic)');
if (!model) bail('missing --model=<id> (e.g., --model=claude-sonnet-4-5)');

const ENV_KEY_BY_PROVIDER = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_API_KEY',
};

const keyVar = ENV_KEY_BY_PROVIDER[provider];
if (!keyVar)
  bail(`unknown provider: ${provider}. Known: ${Object.keys(ENV_KEY_BY_PROVIDER).join(', ')}`);
if (!env[keyVar]) bail(`missing env var ${keyVar} (required for provider=${provider}).`);

const outputPath = join(process.cwd(), 'packages/test-utils/cassettes', `${scenario}.jsonl`);

if (existsSync(outputPath)) {
  bail(
    `cassette already exists at ${outputPath}. Delete it first if you want to re-record (and document why in the commit message).`,
  );
}

console.log(`record-cassette: scenario=${scenario} provider=${provider} model=${model}`);
console.log(`record-cassette: output → ${outputPath}`);

// Load the scenario module and hand it to the recorder. PR-06 ships this
// script's CLI skeleton; the first real recording session adds the
// `scripts/record-cassette-scenarios/{scenario}.mjs` files alongside.
const scenarioPath = join(process.cwd(), 'scripts/record-cassette-scenarios', `${scenario}.mjs`);
if (!existsSync(scenarioPath)) {
  bail(
    `scenario module ${scenarioPath} does not exist yet. Create it as part of the cassette-recording session — see docs/operations/cassette-recording.md for the template.`,
  );
}

const scenarioModule = await import(scenarioPath);
if (typeof scenarioModule.run !== 'function') {
  bail(`scenario module at ${scenarioPath} must export a \`run(opts)\` async function.`);
}

const { record } = await import(join(process.cwd(), 'packages/test-utils/src/cassettes/index.js'));

await record({
  scenario,
  provider,
  model,
  outputPath,
  cwd: process.cwd(),
  run: () => scenarioModule.run({ provider, model, apiKey: env[keyVar] }),
});

console.log(`record-cassette: ✓ wrote ${outputPath}`);
