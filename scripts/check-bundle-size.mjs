#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Bumped from 80 → 100 KB (gzipped) ahead of alpha.34. Post-Tutorials-removal
// rebuild reports 83.7 KB gz; growth driven by milestone 22's 4 new components
// (SettingsTable + SettingsValueControl + setting-descriptions + ProfileDropdown)
// plus bundled Themes Dropdown (8 :root[data-theme] CSS blocks) plus agent_card
// Wave 1 polish. 100 KB gives ~16 KB headroom for the next milestone before
// the next budget revisit. Tighten in a future code-splitting pass that
// lazy-loads SettingsTable + ThemesDropdown behind dynamic imports.
const SPA_BUDGET_KB = 100;
const SPA_BUDGET_BYTES = SPA_BUDGET_KB * 1024;
// Bumped from 200 → 300 ahead of alpha.34 to accommodate cumulative growth
// across milestones 21 (OpenAI Codex OAuth — +3 dashboard files) + 22 (Settings
// Dropdown v2 — 4 new components: SettingsTable, SettingsValueControl,
// setting-descriptions, ProfileDropdown) + bonus user-authored Themes Dropdown
// (8 :root[data-theme] palette blocks) + agent_card Wave 1 (model-helpers,
// ActiveAgentsPane fixes). 200 KB was sized when the dashboard was significantly
// smaller; alpha.33 bundle was already close to the ceiling. 300 KB is a
// reasonable next checkpoint — tighten in a future milestone after a
// code-splitting pass that lazy-loads SettingsTable + ThemesDropdown behind
// dynamic imports.
const DAEMON_BUDGET_KB = 300;
const DAEMON_BUDGET_BYTES = DAEMON_BUDGET_KB * 1024;

function walk(dir, accept) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walk(abs, accept));
    } else if (st.isFile() && accept(name)) {
      out.push(abs);
    }
  }
  return out;
}

function fmt(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

let failed = 0;

const spaDir = path.resolve('packages/dashboard/dist/client/assets');
const spaFiles = walk(spaDir, (n) => /\.(js|css|mjs)$/.test(n));
let spaTotal = 0;
console.log(`\nSPA assets in ${spaDir}:`);
for (const f of spaFiles) {
  const raw = readFileSync(f);
  const gz = gzipSync(raw).length;
  spaTotal += gz;
  console.log(
    `  ${path.relative(process.cwd(), f).padEnd(48)} raw=${fmt(raw.length).padStart(10)} gz=${fmt(gz).padStart(10)}`,
  );
}
if (spaFiles.length === 0) {
  console.log('  (no SPA assets — did you run `pnpm --filter @swt-labs/dashboard build`?)');
}
console.log(`  total gzipped: ${fmt(spaTotal)} (budget: ${SPA_BUDGET_KB} KB)`);
if (spaTotal > SPA_BUDGET_BYTES) {
  console.error(`\n✗ SPA gz total (${fmt(spaTotal)}) exceeds budget (${SPA_BUDGET_KB} KB)`);
  failed += 1;
} else if (spaFiles.length > 0) {
  console.log('  ✓ within budget');
}

const daemonDir = path.resolve('packages/dashboard/dist/server');
const daemonFiles = walk(daemonDir, (n) => /\.(mjs|cjs|js)$/.test(n));
let daemonTotal = 0;
console.log(`\nDaemon bundle in ${daemonDir}:`);
for (const f of daemonFiles) {
  const raw = readFileSync(f);
  daemonTotal += raw.length;
  console.log(
    `  ${path.relative(process.cwd(), f).padEnd(48)} raw=${fmt(raw.length).padStart(10)}`,
  );
}
if (daemonFiles.length === 0) {
  console.log('  (no daemon files — did you run `pnpm --filter @swt-labs/dashboard build`?)');
}
console.log(`  total raw: ${fmt(daemonTotal)} (budget: ${DAEMON_BUDGET_KB} KB)`);
if (daemonTotal > DAEMON_BUDGET_BYTES) {
  console.error(
    `\n✗ Daemon raw total (${fmt(daemonTotal)}) exceeds budget (${DAEMON_BUDGET_KB} KB)`,
  );
  failed += 1;
} else if (daemonFiles.length > 0) {
  console.log('  ✓ within budget');
}

if (failed > 0) {
  console.error(`\nFAIL: ${failed} budget violation(s)`);
  process.exit(1);
}
console.log('\n✓ bundle sizes within budget');
