import { createServer } from 'node:net';

export interface PickPortOptions {
  readonly start: number;
  readonly end: number;
  readonly host?: string;
}

const LOOPBACK = '127.0.0.1';

function tryBind(port: number, host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.once('listening', () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr !== null ? addr.port : port;
      server.close(() => resolve(actual));
    });
    try {
      server.listen({ port, host });
    } catch {
      resolve(null);
    }
  });
}

export async function pickPort(opts: PickPortOptions): Promise<number> {
  const host = opts.host ?? LOOPBACK;
  for (let p = opts.start; p <= opts.end; p += 1) {
    const port = await tryBind(p, host);
    if (port !== null) return port;
  }
  const fallback = await tryBind(0, host);
  if (fallback === null) {
    throw new Error(
      `pickPort: no port available in [${opts.start}, ${opts.end}] and OS-assigned bind failed on ${host}`,
    );
  }
  return fallback;
}
