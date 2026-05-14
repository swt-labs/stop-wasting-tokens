#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// Patterns that would mean the SPA tries to reach a third-party origin at runtime.
// Allowed: localhost / 127.* / relative URLs / data: URIs / blob: URIs / mailto: / `https://docs.stopwastingtokens.dev`
// (which is documentation reference text only and never fetched at runtime — it
// only appears in human-facing markdown if a docs page reference slipped through).
// Also allowed: `www.w3.org` — these are XML namespace URIs (`xmlns` for SVG /
// XLink / MathML), emitted by `solid-js`'s `createElementNS` rendering path.
// They are namespace *identifiers*, never network requests; the SPA works
// fully offline with them present. Allowlisted like docs.stopwastingtokens.dev.
const FORBIDDEN_PATTERNS = [
  /https?:\/\/(?!127\.|localhost|0\.0\.0\.0|0:0:0:0:0:0:0:1|::1|docs\.stopwastingtokens\.dev|www\.w3\.org)[a-z0-9.-]+/gi,
  /\bcdnjs\.cloudflare\.com\b/gi,
  /\bunpkg\.com\b/gi,
  /\bjsdelivr\.net\b/gi,
  /\bfonts\.googleapis\.com\b/gi,
  /\bfonts\.gstatic\.com\b/gi,
];

function walk(dir, accept) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, accept));
    else if (st.isFile() && accept(name)) out.push(abs);
  }
  return out;
}

const spaDir = path.resolve('packages/dashboard/dist/client');
const targets = walk(spaDir, (n) => /\.(js|css|html|mjs)$/.test(n));

if (targets.length === 0) {
  console.error(
    `check-offline: no SPA build artifacts found in ${spaDir}. ` +
      `Run \`pnpm --filter @swt-labs/dashboard build\` first.`,
  );
  process.exit(1);
}

const findings = [];
for (const file of targets) {
  const text = readFileSync(file, 'utf8');
  for (const re of FORBIDDEN_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      findings.push({ file: path.relative(process.cwd(), file), match: m[0] });
    }
  }
}

if (findings.length === 0) {
  console.log(
    `OFFLINE-OK — scanned ${targets.length} file(s) under ${spaDir}, no forbidden remote URLs`,
  );
  process.exit(0);
}

console.error(`✗ Found ${findings.length} forbidden remote URL reference(s) in SPA bundle:`);
for (const f of findings) {
  console.error(`  ${f.file} → ${f.match}`);
}
console.error(
  `\nThe dashboard must work fully offline (AC-11). Inline assets, ship locally, or remove the reference.`,
);
process.exit(1);
