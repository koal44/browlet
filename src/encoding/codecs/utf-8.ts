import { Buffer, isUtf8 } from 'node:buffer';
import { TextEncoder } from 'node:util';

import { internalType, type InternalPromise } from '../../infra/promises';
import { codeUnitsToString, type JSEnvironment } from '../../js-engine/index';

import { detectBOM } from '../decoding';
import { endOfQueue, IOQueue, processQueue, type QueueResult } from '../io-queue';

/** Decode complete UTF-8 with replacement, removing one initial BOM. */
// https://encoding.spec.whatwg.org/#utf-8-decode
export function utf8Decode(input: Uint8Array): string {
  return utf8DecodeWithoutBOM(detectBOM(input) === 'UTF-8' ? input.subarray(3) : input);
}

/** Decode complete UTF-8 with replacement, preserving U+FEFF. */
// https://encoding.spec.whatwg.org/#utf-8-decode-without-bom
export function utf8DecodeWithoutBOM(input: Uint8Array): string {
  return input.length === 0 ? '' : Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('utf8');
}

/** Decode complete UTF-8, preserving U+FEFF; null represents malformed or incomplete input. */
// https://encoding.spec.whatwg.org/#utf-8-decode-without-bom-or-fail
export function utf8DecodeWithoutBOMOrFail(input: Uint8Array): string | null {
  if (input.length === 0) return '';
  return isUtf8(input) ? utf8DecodeWithoutBOM(input) : null;
}

/** Encode complete UTF-8 into an internal byte sequence with one backing allocation. */
// https://encoding.spec.whatwg.org/#utf-8-encode
export function utf8Encode(input: string): Uint8Array<ArrayBuffer> {
  const length = utf8ByteLength(input);
  const buffer = new ArrayBuffer(length);
  writeUTF8(input, buffer, 0, length);
  return new Uint8Array(buffer);
}

/** Count UTF-8 bytes, replacing unpaired surrogate code units with U+FFFD. */
export function utf8ByteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

/** Write complete UTF-8 sequences within the supplied storage bounds; return the byte count. */
export function writeUTF8(input: string, buffer: ArrayBufferLike, byteOffset: number, byteLength: number): number {
  return Buffer.from(buffer, byteOffset, byteLength).write(input, 'utf8');
}

/**
 * Write complete UTF-8 sequences and report UTF-16 code units read and bytes written.
 * Supply an internal byte view; callers resolve author-supplied views through the engine first.
 */
export function utf8EncodeInto(source: string, destination: Uint8Array): { read: number; written: number; } {
  const result = encoder.encodeInto(source, destination);
  if (result.read === source.length || result.written === destination.length) return result;
  // ACCOMMODATION(node-utf8-encode-into): Node's fitting can stop too soon at
  // two-byte scalars or surrogate pairs. Its prefix is correct; finish from the
  // reported positions, retaining native conversion for the bulk of the input.
  let { read, written } = result;
  while (read < source.length) {
    let point = source.codePointAt(read)!;
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    const length = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (written + length > destination.length) break;
    read += point > 0xffff ? 2 : 1;
    if (length === 1) {
      destination[written++] = point;
    } else {
      if (length === 2) {
        destination[written++] = 0xc0 | (point >> 6);
      } else {
        if (length === 3) {
          destination[written++] = 0xe0 | (point >> 12);
        } else {
          destination[written++] = 0xf0 | (point >> 18);
          destination[written++] = 0x80 | ((point >> 12) & 0x3f);
        }
        destination[written++] = 0x80 | ((point >> 6) & 0x3f);
      }
      destination[written++] = 0x80 | (point & 0x3f);
    }
  }
  result.read = read;
  result.written = written;
  return result;
}

/** Encoding §6 — UTF-8 decode; consume one leading BOM, including across chunks. */
export function utf8DecodeQueue(
  input: IOQueue<Uint8Array>, output: IOQueue<string> = new IOQueue<string>(), env: JSEnvironment,
): InternalPromise<IOQueue<string>> {
  return input.waitFor(3, env).then(() => {
    if (detectBOM(input.peek(3)!) === 'UTF-8') input.readAvailable(3);
    return utf8DecodeWithoutBOMQueue(input, output, env);
  }, undefined, internalType<IOQueue<string>>());
}

/** Encoding §6 — UTF-8 decode without BOM; append to the caller's output. */
export function utf8DecodeWithoutBOMQueue(
  input: IOQueue<Uint8Array>, output: IOQueue<string> = new IOQueue<string>(), env: JSEnvironment,
): InternalPromise<IOQueue<string>> {
  const decoder = new UTF8Decoder();
  return processQueue(input, () => decoder.decode(input, output), env).then(() => output, undefined, internalType<IOQueue<string>>());
}

/** Encoding §6 — Fatal decoding leaves the emitted prefix and unread input available. */
export function utf8DecodeWithoutBOMOrFailQueue(
  input: IOQueue<Uint8Array>, output: IOQueue<string> = new IOQueue<string>(), env: JSEnvironment,
): InternalPromise<IOQueue<string> | null> {
  const decoder = new UTF8Decoder();
  return processQueue(input, () => decoder.decode(input, output, 'fatal'), env)
    .then((result) => typeof result === 'object' ? null : output, undefined, internalType<IOQueue<string> | null>());
}

/** Encoding §6 — UTF-8 encode, retaining streaming input and supplied output. */
export function utf8EncodeQueue(
  input: IOQueue<string>, output: IOQueue<Uint8Array> = new IOQueue<Uint8Array>(), env: JSEnvironment,
): InternalPromise<IOQueue<Uint8Array>> {
  const encoder = new UTF8Encoder();
  return processQueue(input, () => encoder.encode(input, output), env).then(() => output, undefined, internalType<IOQueue<Uint8Array>>());
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
          const text = mode === 'replacement' ? utf8DecodeWithoutBOM(bytes) : utf8DecodeWithoutBOMOrFail(bytes);
          if (text !== null) {
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

const encoder = new TextEncoder();
