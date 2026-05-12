# Cassette recording (developer-local only)

> ⚠ This is a **developer-local** operation. CI never records cassettes — CI
> only replays them.

SWT v3 uses cassettes (JSONL recordings of real LLM provider HTTP exchanges)
for deterministic test playback. Every cassette is recorded once on a
developer machine with real API credentials, committed to the repo, and
replayed byte-identically by CI thereafter.

The infrastructure that records + replays cassettes lives in
[`@swt-labs/test-utils`](../../packages/test-utils/). PR-06 (M1 Plan 01-02)
ships the recorder + replayer + JSONL format schema + Zod validators. The
first cassette (`scout-read-readme.jsonl`) is recorded as a follow-on step
per the agreed PR-06 cassette-recording handoff.

## When you need to record a cassette

- **First time setup** — recording `scout-read-readme.jsonl` to unblock
  PR-07's `delta = 0 tokens` cassette-replay assertion and PR-09's first
  end-to-end test.
- **New scenario** — when M2..M5 add coverage for a new role / provider
  / interaction shape, a new cassette gets recorded.
- **Re-recording after a Pi API change** — if Pi's request/response
  shape changes in a way that invalidates an existing cassette, the
  cassette gets re-recorded against the updated provider behavior. The
  re-record commit message documents the why.

## How to record

1. **Pick a provider and model:** for M1 PR-06's first cassette, the plan
   recommends Anthropic (`claude-sonnet-4-5`). Fall back to OpenRouter
   (free-tier models like `meta-llama/llama-3.2-3b-instruct:free`) or a
   local Ollama instance (`provider=openrouter` with a local routing
   config; PR-08 lands the actual provider quirks) if you don't have
   Anthropic credit.

2. **Set the API key in your environment:**

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   # or
   export OPENROUTER_API_KEY=sk-or-...
   # or
   export OPENAI_API_KEY=sk-...
   ```

3. **Author the scenario module** (one-time per scenario) at
   `scripts/record-cassette-scenarios/{scenario}.mjs`. The module exports
   an async `run({ provider, model, apiKey })` function that performs the
   real provider call. For PR-06's `scout-read-readme`, the scenario is:
   - Create a Pi session against the chosen provider with read-only tools
     (`createReadOnlyTools(cwd)`)
   - Prompt: `"Read the file at ./README.md, then call swt_report_result
with status='success' and summary='Read README'."`
   - The session emits one round of `prompt → read tool call → assistant
response → swt_report_result call → session end`. The recorder
     captures each HTTP request/response pair as one cassette interaction.

4. **Run the recorder:**

   ```bash
   pnpm record -- --scenario=scout-read-readme --provider=anthropic --model=claude-sonnet-4-5
   ```

   The recorder:
   - Validates env vars + scenario module exist
   - Refuses to overwrite an existing cassette (delete it first if
     re-recording is intentional)
   - Installs an undici interceptor that captures every outbound HTTP
     request to known LLM provider endpoints
   - Runs the scenario module with the real API key
   - Normalises each request (strips cwd absolute paths, sensitive
     headers, request-time timestamps; canonicalises `cache_control`
     markers), computes a SHA-256 body hash
   - Writes the cassette JSONL to
     `packages/test-utils/cassettes/{scenario}.jsonl`

5. **Verify the recording locally:**

   ```bash
   pnpm test --filter @swt-labs/test-utils
   ```

   `replay.test.ts` should now run (no longer skipped) and the `loadCassette`
   structural checks pass.

6. **Commit the cassette** in a follow-up PR-06 commit:
   ```bash
   git add packages/test-utils/cassettes/{scenario}.jsonl scripts/record-cassette-scenarios/{scenario}.mjs
   git commit -m "feat(cassettes): record {scenario} against {provider}/{model} (PR-06 follow-up)"
   ```

## Cost discipline

Cassettes are small. The PR-06 `scout-read-readme` scenario is ~500 input
tokens, ~200 output tokens — under $0.01 on Claude Opus. Stay under $1
total per cassette; if a scenario approaches that ceiling, the scenario
itself is too large and should be split.

## What goes in vs. out of the cassette

| Goes in                                                               | Stays out                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Method, URL, normalised headers, body hash                            | `Authorization` / `X-API-Key` / `Cookie` / `Set-Cookie` headers |
| Response status, headers, body chunks                                 | `Date`, `X-Request-Id`, `cf-ray` (request-time noise)           |
| Token usage totals (from final `turn_end` event)                      | Absolute cwd paths (replaced with `<cwd>`)                      |
| `cwd_redacted: true` flag (the replayer refuses cassettes without it) | Anthropic `cache_control` exact-shape variants (canonicalised)  |

## Security

- **Never commit a cassette with `cwd_redacted: false`.** The replayer
  refuses to load it; CI would error before catching it in a PR review.
- **Cassettes may contain prompt content** — the model's responses and
  the user's prompt are recorded verbatim (sanitised of secrets, but not
  of intellectual property). Treat cassettes as you would source code:
  no proprietary customer data, no internal-only product details.
- The `@swt-labs/test-utils` package is `"private": true`. It can never
  be published to npm regardless of `publishConfig`.
