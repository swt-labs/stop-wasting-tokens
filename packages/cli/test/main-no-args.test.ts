import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

let originalNoDashboard: string | undefined;

beforeEach(() => {
  originalNoDashboard = process.env['SWT_NO_DASHBOARD'];
});

afterEach(() => {
  if (originalNoDashboard === undefined) {
    delete process.env['SWT_NO_DASHBOARD'];
  } else {
    process.env['SWT_NO_DASHBOARD'] = originalNoDashboard;
  }
});

describe('main() v2.0 no-args behavior', () => {
  it('dispatches to the dashboard verb when argv is empty', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    let dispatchedVerb: string | undefined;
    const registry = new CommandRegistry();
    registry.register({
      name: 'dashboard',
      description: 'launch the dashboard',
      handler: (parsed, io) => {
        dispatchedVerb = parsed.verb;
        io.stdout.write('dashboard launched\n');
        return EXIT.SUCCESS;
      },
    });
    delete process.env['SWT_NO_DASHBOARD'];

    const code = await main([], { stdout, stderr, registry });
    expect(code).toBe(EXIT.SUCCESS);
    expect(dispatchedVerb).toBe('dashboard');
    expect(stdout.text()).toContain('dashboard launched');
  });

  it('renders help when SWT_NO_DASHBOARD=1 is set (escape hatch)', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    process.env['SWT_NO_DASHBOARD'] = '1';

    const code = await main([], { stdout, stderr });
    expect(code).toBe(EXIT.SUCCESS);
    const out = stdout.text();
    expect(out).toContain('swt'); // help banner mentions the binary
    expect(out.length).toBeGreaterThan(50);
  });

  it('renders help when --help is passed (regardless of dashboard default)', async () => {
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    delete process.env['SWT_NO_DASHBOARD'];

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
