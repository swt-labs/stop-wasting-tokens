#!/usr/bin/env node
// Chaos suite stub.
//
// Lands in M3 PR-28 (SIGKILL-injected orchestrator + restart-then-complete
// assertion per TDD2 §15.5). Until then, exits 0 so `pnpm test:chaos`
// stays callable from CI without lying.
console.log('Chaos suite stub. Real implementation lands in M3 PR-28.');
process.exit(0);
