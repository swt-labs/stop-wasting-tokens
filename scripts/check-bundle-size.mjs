#!/usr/bin/env node
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const SPA_BUDGET_KB = 80;
const SPA_BUDGET_BYTES = SPA_BUDGET_KB * 1024;
const DAEMON_BUDGET_KB = 200;
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
