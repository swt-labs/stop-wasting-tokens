#!/usr/bin/env node
// Regression suite stub.
//
// Lands in M2 PR-18 (v2 → v3 byte-identical golden-bundle replay test).
// Until then, this script exits 0 so CI workflows that call `pnpm test:regression`
// stay green without lying about coverage. The `.github/workflows/regression.yml`
// workflow's `|| echo "..."` fallback prints a clear pointer to the M2 PR.
//
// One file per stub rather than inline `node -e` per the plan — Windows
// PowerShell quoting differs from bash for inline strings, so cross-platform
// CI matrices need real files.
console.log('Regression suite stub. Real implementation lands in M2 PR-18.');
process.exit(0);
