import { Writable } from 'node:stream';

export class StringStream extends Writable {
  public readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}
