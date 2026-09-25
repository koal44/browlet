import type { Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { HTTPContentDecoder, HTTPContentDecoderListener } from '../../fetch/index';
import { InternalError } from '../../infra/internal-error';

/** HTTP codecs supplied by Node; Fetch advertises and selects the supported codings. */
export const supportedContentCodings = new Set(['gzip', 'deflate', 'br']);

/** Allocate a fresh, bounded decoder chain for one HTTP response. */
export function createContentDecoder(codings: string[], listener: HTTPContentDecoderListener): HTTPContentDecoder {
  const stages = codings.toReversed().map((coding) => {
    switch (coding) {
      case 'gzip': return createGunzip();
      case 'deflate': return createInflate();
      case 'br': return createBrotliDecompress();
      default: throw new InternalError(`Unsupported HTTP content coding: ${coding}`);
    }
  });
  if (stages.length === 0) throw new InternalError('A content decoder requires at least one coding');
  return new NodeHTTPContentDecoder(stages, listener);
}

/** Native transform queues bound both encoded input and decoded output. */
class NodeHTTPContentDecoder implements HTTPContentDecoder {
  #stages: Transform[];
  #listener: HTTPContentDecoderListener;
  #finished = false;
  #hasInput = false;

  constructor(stages: Transform[], listener: HTTPContentDecoderListener) {
    this.#stages = stages;
    this.#listener = listener;
    stages.forEach((stage, index) => {
      stage.on('error', () => {
        if (this.#finished) return;
        this.abort();
        listener.onError();
      });
      if (index > 0) stages[index - 1]!.pipe(stage);
    });
    stages[0]!.on('drain', () => { if (!this.#finished) listener.onDrain(); });
    const output = stages[stages.length - 1]!;
    output.on('data', (bytes: Buffer) => { if (!this.#finished) listener.onData(bytes); });
    output.on('end', () => {
      if (this.#finished) return;
      this.#finished = true;
      listener.onEnd();
    });
  }

  write(bytes: Uint8Array): boolean {
    if (this.#finished) return false;
    this.#hasInput ||= bytes.byteLength !== 0;
    return this.#stages[0]!.write(bytes);
  }

  end(): void {
    if (this.#finished) return;
    // Fetch only invokes decoding for transmitted bytes; a zero-byte message has none.
    if (!this.#hasInput) {
      this.abort();
      this.#listener.onEnd();
    } else {
      this.#stages[0]!.end();
    }
  }

  pause(): void { this.#stages[this.#stages.length - 1]!.pause(); }
  resume(): void { if (!this.#finished) this.#stages[this.#stages.length - 1]!.resume(); }

  abort(): void {
    this.#finished = true;
    for (const stage of this.#stages) stage.destroy();
  }
}
