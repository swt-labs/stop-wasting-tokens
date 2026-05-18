/**
 * Plan 05-01 T2 — `swt provider-tuning-sources` verb unit tests.
 *
 * Exercises the handler against the REAL pack registry (no mocks) so the
 * test doubles as an integration sanity check that the orchestration
 * barrel exports + getAllPacks() + every pack's upstreamSources() all
 * combine into the documented envelope shape.
 */

import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type { ParsedArgv } from '../../src/argv.js';
import { providerTuningSourcesHandler } from '../../src/commands/provider-tuning-sources.js';
import { EXIT } from '../../src/exit-codes.js';
import type { CommandIO } from '../../src/router.js';

class CaptureStream extends Writable {
  output = '';
  _write(chunk: unknown, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.output += String(chunk);
    cb();
  }
}

function makeIO(cwd: string): { stdout: CaptureStream; stderr: CaptureStream; io: CommandIO } {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  return { stdout, stderr, io: { stdout, stderr, cwd } };
}

const parsed: ParsedArgv = { verb: 'provider-tuning-sources', positionals: [], flags: {} };

describe('provider-tuning-sources', () => {
  it('emits a v1 envelope with a parseable ISO8601 generated_at and a sources array', () => {
    const { stdout, io } = makeIO(process.cwd());
    const exit = providerTuningSourcesHandler(parsed, io);
    expect(exit).toBe(EXIT.SUCCESS);
    const parsed_out = JSON.parse(stdout.output);
    expect(Object.keys(parsed_out).sort()).toEqual(['generated_at', 'schema', 'sources']);
    expect(parsed_out.schema).toBe('v1');
    expect(typeof parsed_out.generated_at).toBe('string');
    // ISO8601 parses to a non-NaN epoch.
    expect(Number.isNaN(Date.parse(parsed_out.generated_at))).toBe(false);
    expect(Array.isArray(parsed_out.sources)).toBe(true);
  });

  it('emits exactly 4 sources at Phase 5 end-state (1 anthropic + 3 codex)', () => {
    const { stdout, io } = makeIO(process.cwd());
    void providerTuningSourcesHandler(parsed, io);
    const env = JSON.parse(stdout.output);
    expect(env.sources).toHaveLength(4);
  });

  it('orders sources deterministically: anthropic first, then openai', () => {
    const { stdout, io } = makeIO(process.cwd());
    void providerTuningSourcesHandler(parsed, io);
    const env = JSON.parse(stdout.output);
    const packIds = env.sources.map((s: { packId: string }) => s.packId);
    // Anthropic block (1) then OpenAI block (3) — getAllPacks order is
    // [anthropic, openai].
    expect(packIds).toEqual(['anthropic', 'openai', 'openai', 'openai']);
  });

  it('enriches every source with packId, packDisplayName, method, url, description, contentHash', () => {
    const { stdout, io } = makeIO(process.cwd());
    void providerTuningSourcesHandler(parsed, io);
    const env = JSON.parse(stdout.output);
    for (const src of env.sources) {
      expect(typeof src.packId).toBe('string');
      expect(src.packId.length).toBeGreaterThan(0);
      expect(typeof src.packDisplayName).toBe('string');
      expect(src.packDisplayName.length).toBeGreaterThan(0);
      expect(src.method).toBe('upstreamSources');
      expect(typeof src.url).toBe('string');
      expect(src.url.length).toBeGreaterThan(0);
      expect(typeof src.description).toBe('string');
      expect(src.description.length).toBeGreaterThan(0);
      // Phase 5 captures contentHash for all 4 sources.
      expect(src.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('Codex (openai) entries preserve the canonical-template → agents_md.rs → apply_patch.lark order', () => {
    const { stdout, io } = makeIO(process.cwd());
    void providerTuningSourcesHandler(parsed, io);
    const env = JSON.parse(stdout.output);
    const codexUrls = env.sources
      .filter((s: { packId: string }) => s.packId === 'openai')
      .map((s: { url: string }) => s.url);
    expect(codexUrls).toEqual([
      'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/templates/model_instructions/gpt-5.2-codex_instructions_template.md',
      'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md.rs',
      'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/apply_patch.lark',
    ]);
  });

  it('Anthropic source uses the npm: URL-prefix discriminator', () => {
    const { stdout, io } = makeIO(process.cwd());
    void providerTuningSourcesHandler(parsed, io);
    const env = JSON.parse(stdout.output);
    const anthropic = env.sources.filter((s: { packId: string }) => s.packId === 'anthropic');
    expect(anthropic).toHaveLength(1);
    expect(anthropic[0].url.startsWith('npm:')).toBe(true);
    expect(anthropic[0].packDisplayName).toBe('Anthropic (via Pi)');
  });
});
