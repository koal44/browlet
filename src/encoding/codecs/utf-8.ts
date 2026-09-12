import { codeUnitsToString, decodeValidUTF8, readUTF8, utf8ByteLength, writeUTF8 } from '../../js-engine/byte-string';
import type { PromiseValue } from '../../js-engine/promises';
import type { RuntimeContext } from '../../js-engine/runtime-context';
import { endOfQueue, IOQueue, processQueue, type QueueResult } from '../io-queue';

/** Complete-input convenience for Encoding §6 — UTF-8 decode. */
export function utf8Decode(input: Uint8Array): string {
  return utf8DecodeWithoutBOM(hasBOM(input) ? input.subarray(3) : input);
}

/** Complete-input convenience for UTF-8 decode without BOM (preserves U+FEFF). */
export function utf8DecodeWithoutBOM(input: Uint8Array): string {
  return input.length === 0 ? '' : readUTF8(input);
}

/** Complete-input convenience for UTF-8 decode without BOM or fail. */
export function utf8DecodeWithoutBOMOrFail(input: Uint8Array): string | null {
  return input.length === 0 ? '' : decodeValidUTF8(input) ?? null;
}

/** Complete-string UTF-8 encoding, with one allocation in the supplied runtime. */
export function utf8Encode(input: string, runtime?: RuntimeContext): Uint8Array<ArrayBuffer> {
  const length = utf8ByteLength(input);
  const bytes = runtime
    ? runtime.buffers.createView('Uint8Array', runtime.buffers.allocateArrayBuffer(length))
    : new Uint8Array(length);
  writeUTF8(input, bytes);
  return bytes;
}

/** Encoding §6 — UTF-8 decode; consume one leading BOM, including across chunks. */
export function utf8DecodeQueue(
  input: IOQueue<Uint8Array>, output: IOQueue<string> = new IOQueue<string>(), runtime: RuntimeContext,
): PromiseValue<IOQueue<string>> {
  return input.waitFor(3, runtime).then(() => {
    if (hasBOM(input.peek(3)!)) input.readAvailable(3);
    return utf8DecodeWithoutBOMQueue(input, output, runtime);
  });
}

/** Encoding §6 — UTF-8 decode without BOM; append to the caller's output. */
export function utf8DecodeWithoutBOMQueue(
  input: IOQueue<Uint8Array>, output: IOQueue<string> = new IOQueue<string>(), runtime: RuntimeContext,
): PromiseValue<IOQueue<string>> {
  const decoder = new UTF8Decoder();
  return processQueue(input, () => decoder.decode(input, output), runtime).then(() => output);
}

/** Encoding §6 — Fatal decoding leaves the emitted prefix and unread input available. */
export function utf8DecodeWithoutBOMOrFailQueue(
  input: IOQueue<Uint8Array>, output: IOQueue<string> = new IOQueue<string>(), runtime: RuntimeContext,
): PromiseValue<IOQueue<string> | null> {
  const decoder = new UTF8Decoder();
  return processQueue(input, () => decoder.decode(input, output, 'fatal'), runtime)
    .then((result) => typeof result === 'object' ? null : output);
}

/** Encoding §6 — UTF-8 encode, retaining streaming input and supplied output. */
export function utf8EncodeQueue(
  input: IOQueue<string>, output: IOQueue<Uint8Array> = new IOQueue<Uint8Array>(), runtime: RuntimeContext,
): PromiseValue<IOQueue<Uint8Array>> {
  const encoder = new UTF8Encoder();
  return processQueue(input, () => encoder.encode(input, output), runtime).then(() => output);
}

// -- Encoding §8: UTF-8 -------------------------------------------------

/** §8.1.1 — UTF-8 decoder state survives input chunk boundaries. BOM policy belongs to callers. */
export class UTF8Decoder {
  #codePoint = 0;
  #bytesSeen = 0;
  #bytesNeeded = 0;
  #lowerBoundary = 0x80;
  #upperBoundary = 0xbf;

  /** Fuse §4.1 queue processing with the §8.1.1 handler, without per-byte allocations. */
  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        if (this.#bytesNeeded !== 0) {
          this.#bytesNeeded = 0;
          if (mode === 'fatal') return { error: null };
          output.push('\ufffd');
        }
        output.push(endOfQueue);
        return 'finished';
      }
      let offset = 0;
      // Splitting tiny chunks costs more conversions and output pieces than
      // processing them in one pass. Complete chunks still use native decoding.
      const split = chunk.length >= 64;
      let bulkEnd = completeUTF8Prefix(chunk);
      if (!split && bulkEnd !== chunk.length) bulkEnd = 0;
      // Finish the character from the previous chunk before attempting the
      // bulk middle. The trailing incomplete character uses the same handler.
      let limit = !split || this.#bytesNeeded === 0 ? chunk.length :
        Math.min(chunk.length, this.#bytesNeeded - this.#bytesSeen);
      while (offset < chunk.length) {
        if (this.#bytesNeeded === 0 && offset < bulkEnd) {
          const bytes = offset === 0 && bulkEnd === chunk.length ? chunk : chunk.subarray(offset, bulkEnd);
          const text = mode === 'replacement' ? readUTF8(bytes) : decodeValidUTF8(bytes);
          if (text !== undefined) {
            output.push(text);
            offset = bulkEnd;
          }
          // Fatal errors need the scalar handler's exact stop and restoration
          // position. Do not retry validation at each following character.
          bulkEnd = 0;
          limit = chunk.length;
          if (offset === chunk.length) break;
        }
        const units = new Uint16Array(limit - offset + 2);
        let written = 0;
        for (; offset < limit;) {
          const byte = chunk[offset++]!;
          if (this.#bytesNeeded === 0) {
            if (byte <= 0x7f) {
              units[written++] = byte;
              continue;
            }
            if (byte >= 0xc2 && byte <= 0xdf) {
              this.#bytesNeeded = 1;
              this.#codePoint = byte & 0x1f;
              continue;
            }
            if (byte >= 0xe0 && byte <= 0xef) {
              if (byte === 0xe0) this.#lowerBoundary = 0xa0;
              if (byte === 0xed) this.#upperBoundary = 0x9f;
              this.#bytesNeeded = 2;
              this.#codePoint = byte & 0x0f;
              continue;
            }
            if (byte >= 0xf0 && byte <= 0xf4) {
              if (byte === 0xf0) this.#lowerBoundary = 0x90;
              if (byte === 0xf4) this.#upperBoundary = 0x8f;
              this.#bytesNeeded = 3;
              this.#codePoint = byte & 0x07;
              continue;
            }
          } else if (byte >= this.#lowerBoundary && byte <= this.#upperBoundary) {
            this.#lowerBoundary = 0x80;
            this.#upperBoundary = 0xbf;
            this.#codePoint = (this.#codePoint << 6) | (byte & 0x3f);
            if (++this.#bytesSeen !== this.#bytesNeeded) continue;
            if (this.#codePoint <= 0xffff) {
              units[written++] = this.#codePoint;
            } else {
              const point = this.#codePoint - 0x10000;
              units[written++] = 0xd800 + (point >> 10);
              units[written++] = 0xdc00 + (point & 0x3ff);
            }
            this.#codePoint = this.#bytesSeen = this.#bytesNeeded = 0;
            continue;
          } else {
            this.#codePoint = this.#bytesSeen = this.#bytesNeeded = 0;
            this.#lowerBoundary = 0x80;
            this.#upperBoundary = 0xbf;
            // Restore the current byte; an invalid continuation must not mask ASCII.
            offset--;
          }
          if (mode === 'fatal') {
            output.push(codeUnitsToString(units, written));
            input.restore(chunk.subarray(offset));
            return { error: null };
          }
          units[written++] = 0xfffd;
        }
        output.push(codeUnitsToString(units, written));
        limit = chunk.length;
      }
    }
  }
}

/** §8.1.2 — Stateless UTF-8 encoder for scalar-value queues. */
export class UTF8Encoder {
  encode(input: IOQueue<string>, output: IOQueue<Uint8Array>): QueueResult<never> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        output.push(endOfQueue);
        return 'finished';
      }
      output.push(utf8Encode(chunk));
    }
  }
}

/** §7.4 — Write whole scalar values directly into an existing Uint8Array. */
export { writeUTF8Into as utf8EncodeInto } from '../../js-engine/byte-string';

function hasBOM(bytes: Uint8Array | readonly number[]): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** Leave a possibly incomplete final sequence for the stateful handler. */
function completeUTF8Prefix(bytes: Uint8Array): number {
  const end = bytes.length;
  let start = end - 1;
  const first = Math.max(0, end - 4);
  while (start > first && (bytes[start]! & 0xc0) === 0x80) start--;
  const lead = bytes[start]!;
  const length = lead >= 0xc2 && lead <= 0xdf ? 2 :
    lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 1;
  return end - start < length ? start : end;
}
