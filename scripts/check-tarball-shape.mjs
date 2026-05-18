#!/usr/bin/env node
// check-tarball-shape.mjs — Verifies the npm tarball contains the required
// runtime assets. Runs `npm pack --dry-run --json` to get the file list
// in-memory (no tarball written to disk), then asserts a sentinel set.
//
// Exit 0 = pass.
// Exit 1 = fail (with diagnostics to stderr).
//
// Per milestone 18 Locked Decision #6 (no silent fallbacks): any missing
// sentinel is a HARD ERROR — never a skip-with-warning.

import { execSync } from 'node:child_process';
import path from 'node:path';

const SENTINELS = [
  'references/execute-protocol.md',
  'references/discussion-engine.md',
  'references/verification-protocol.md',
  'references/handoff-schemas.md',
  'references/swt-brand-essentials.md',
  'scripts/phase-detect.sh',
  'scripts/clean-stale-teams.sh',
  'scripts/planning-git.sh',
  'templates/MILESTONE-CONTEXT.md',
  'config/model-profiles.json',
];

let packOutput;
try {
  packOutput = execSync('npm pack --dry-run --json', {
    cwd: path.resolve(process.cwd()),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error('check-tarball-shape: `npm pack --dry-run --json` failed:', err.message);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(packOutput);
} catch (err) {
  console.error(
    'check-tarball-shape: failed to parse `npm pack --dry-run --json` output as JSON:',
    err.message,
  );
  console.error('raw output (first 500 chars):', packOutput.slice(0, 500));
  process.exit(1);
}

// npm 9+ returns an array of pack results; defensively normalize in case a
// future npm version returns a bare object for the single-package case.
const entries = Array.isArray(parsed) ? parsed : [parsed];
const root = entries[0];
if (!root || !Array.isArray(root.files)) {
  console.error(
    'check-tarball-shape: unexpected `npm pack --json` shape — missing `files` array on first entry.',
  );
  console.error('parsed:', JSON.stringify(root, null, 2).slice(0, 500));
  process.exit(1);
}

// npm 9/10 prefixes paths with `package/`; npm 11 strips that prefix.
// Defensively strip in both cases so the sentinel comparison is stable.
const files = new Set(root.files.map((f) => f.path.replace(/^package\//, '')));

const missing = [];
for (const sentinel of SENTINELS) {
  if (!files.has(sentinel)) {
    missing.push(sentinel);
  }
}

if (missing.length > 0) {
  console.error(
    `\ncheck-tarball-shape: FAIL — ${missing.length} required file(s) missing from npm tarball:`,
  );
  for (const m of missing) {
    console.error(`  MISSING: ${m}`);
  }
  console.error(
    '\nExtend package.json `files[]` to include the missing directories ' +
      '(`references`, `templates`, `scripts`, `config`), or verify `scripts/.npmignore` ' +
      'is not over-excluding required paths. Run `npm pack --dry-run` manually ' +
      'to see the full file list.',
  );
  process.exit(1);
}

console.log(
  `\ncheck-tarball-shape: OK — all ${SENTINELS.length} sentinel files present in tarball (${root.entryCount ?? root.files.length} total entries).`,
);
