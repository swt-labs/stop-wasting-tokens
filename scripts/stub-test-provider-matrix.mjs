#!/usr/bin/env node
// Provider matrix suite stub.
//
// Lands in M5 PR-44 (cassette-replay assertions across all supported providers
// per ADR-011 — no live API keys in CI). Until then, exits 0 so
// `pnpm test:provider-matrix` stays callable from CI without lying.
console.log('Provider matrix suite stub. Real implementation lands in M5 PR-44.');
process.exit(0);
