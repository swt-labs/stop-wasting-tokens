**[Tool] SWT — token-disciplined SDLC for Codex CLI (v0.1.0-alpha)**

Solving the "Codex is great at small tasks, drifts on large ones" problem. Plans → executes → verifies multi-week projects with persistent on-disk state.

**What you get:**
- 11 deterministic lifecycle states (you can run `swt detect-phase --json` and predict exactly what `swt vibe` does next)
- Phases → plans → summaries (typed Zod contracts, no prompt drift)
- QA + UAT separation with row-by-row acceptance evidence
- UAT remediation pipeline: research → plan → execute → re-verify, bounded round caps
- VBW-compatible (`mv .vbw-planning .swt-planning`)
- Cross-platform — Node-only, no Bash hard dep, Windows works natively

**Install:**

```
npm install -g @swt-labs/cli
swt init
swt vibe
```

Closed beta is open this week. Looking for 10 testers — comment if interested or DM for an invite.

Repo: https://github.com/swt-labs/stop-wasting-tokens
Docs: https://docs.stopwastingtokens.dev

Friction reports, edge cases, and "this should be smoother" feedback all welcome.
