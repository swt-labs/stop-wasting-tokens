import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { EXIT } from '../src/exit-codes.js';
import { main } from '../src/main.js';
import { CommandRegistry } from '../src/router.js';

class CaptureStream extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('main() no-args behavior (v3.0.0-alpha.3+)', () => {
  it('dispatches to the vibe verb when argv is empty', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    let dispatchedVerb: string | undefined;
    const registry = new CommandRegistry();
    registry.register({
      name: 'vibe',
      description: 'methodology orchestrator',
      handler: (parsed, io) => {
        dispatchedVerb = parsed.verb;
        io.stdout.write('vibe launched\n');
        return EXIT.SUCCESS;
      },
    });

    const code = await main([], { stdout, stderr, registry });
    expect(code).toBe(EXIT.SUCCESS);
    expect(dispatchedVerb).toBe('vibe');
    expect(stdout.text()).toContain('vibe launched');
  });

  it('renders help when --help is passed', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const code = await main(['--help'], { stdout, stderr });
    expect(code).toBe(EXIT.SUCCESS);
    const out = stdout.text();
    expect(out.length).toBeGreaterThan(50);
  });

  it('prints version when --version is passed', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const code = await main(['--version'], { stdout, stderr, version: '2.0.0' });
    expect(code).toBe(EXIT.SUCCESS);
    expect(stdout.text()).toContain('swt 2.0.0');
  });

  it('renders help when verb is "help"', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const code = await main(['help'], { stdout, stderr });
    expect(code).toBe(EXIT.SUCCESS);
    expect(stdout.text().length).toBeGreaterThan(50);
  });
});
