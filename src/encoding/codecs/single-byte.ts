import { Buffer, isAscii } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { codeUnitsToString } from '../../js-engine/byte-string';

import type { Encoding } from '../encodings';
import type { EncodingIndex } from '../indexes';
import { singleByteIndexes } from '../gen/indexes';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding Standard §9 — Stateless single-byte handlers, processed in chunks. */
export class SingleByteCodec {
  readonly #index: EncodingIndex;
  readonly #encoding: Encoding;
  #decoder?: TextDecoder;
  #decodeTable?: Uint16Array;
  #reverse?: Uint8Array;

  constructor(index: EncodingIndex, encoding: Encoding) {
    this.#index = index;
    this.#encoding = encoding;
  }

  /** §4.1 processing a queue using the §9.1 decoder, until input runs out. */
  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        output.push(endOfQueue);
        return 'finished';
      }
      // ASCII needs neither an expanded index nor a native decoder.
      if (isAscii(chunk)) {
        output.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1'));
        continue;
      }
      if (mode === 'replacement' && chunk.length >= 2048) {
        // Native calls pay off on larger chunks; single-byte chunks have no
        // pending state. Fatal mode retains exact error positions below.
        const decoder = this.#decoder ??= new TextDecoder(this.#encoding, { ignoreBOM: true });
        output.push(decoder.decode(chunk));
        continue;
      }
      const values = new Uint16Array(chunk.length);
      const table = this.#decodeTable ??= this.#createDecodeTable();
      if (mode === 'replacement') {
        for (let i = 0; i < chunk.length; i++) values[i] = table[chunk[i]!]!;
      } else {
        for (let i = 0; i < chunk.length; i++) {
          const byte = chunk[i]!;
          const point = table[byte]!;
          if (point === 0xfffd && this.#index.values[byte - 0x80] === 0) {
            output.push(codeUnitsToString(values, i));
            input.restore(chunk.subarray(i + 1));
            return { error: null };
          }
          values[i] = point;
        }
      }
      output.push(codeUnitsToString(values));
    }
  }

  /** §4.1 processing a queue using the §9.2 encoder, until input runs out. */
  encode(input: IOQueue<string>, output: IOQueue<Uint8Array>, mode: 'fatal' | 'html' = 'fatal'): QueueResult<number> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        output.push(endOfQueue);
        return 'finished';
      }
      if (!nonASCII.test(chunk)) {
        output.push(Buffer.from(chunk, 'latin1'));
        continue;
      }
      const maximumBytes = mode === 'fatal' ? 1 : 10;
      const blockSize = Math.min(Math.max(chunk.length, 16), 4096);
      // Leave room to finish one character beyond the block target.
      let bytes = new Uint8Array(blockSize + maximumBytes - 1);
      let written = 0;
      const reverse = this.#reverse ??= this.#createReverseIndex();
      for (let offset = 0; offset < chunk.length;) {
        if (written >= blockSize) {
          output.push(bytes.subarray(0, written));
          bytes = new Uint8Array(blockSize + maximumBytes - 1);
          written = 0;
        }
        // Mapped BMP characters each consume one code unit and one output byte.
        const limit = Math.min(chunk.length, offset + blockSize - written);
        for (; offset < limit; offset++) {
          const point = chunk.charCodeAt(offset);
          const byte = reverse[point] ?? 0;
          if (byte === 0 && point !== 0) break;
          bytes[written++] = byte;
        }
        if (offset === limit) continue;
        // Only unmappable input reaches the scalar/error handling below.
        const point = chunk.codePointAt(offset)!;
        offset += point > 0xffff ? 2 : 1;
        if (mode === 'fatal') {
          output.push(bytes.subarray(0, written));
          input.restore(chunk.slice(offset));
          return { error: point };
        } else {
          const reference = `&#${point};`;
          for (let i = 0; i < reference.length; i++) bytes[written++] = reference.charCodeAt(i);
        }
      }
      output.push(bytes.subarray(0, written));
    }
  }

  #createDecodeTable(): Uint16Array {
    // Small replacement chunks and fatal decoding share this 512-byte lookup.
    const table = new Uint16Array(256);
    const index = this.#index.values;
    for (let byte = 0; byte < 0x80; byte++) table[byte] = byte;
    for (let byte = 0x80; byte < 256; byte++) table[byte] = index[byte - 0x80] || 0xfffd;
    return table;
  }

  #createReverseIndex(): Uint8Array {
    const index = this.#index.values;
    // Include ASCII so the mapped loop needs only one lookup per code unit.
    const reverse = new Uint8Array(Math.max(0x7f, ...index) + 1);
    for (let point = 0; point < 0x80; point++) reverse[point] = point;
    // Preserve the first matching pointer. Zero marks missing entries and NUL.
    for (let pointer = 0; pointer < index.length; pointer++) {
      const point = index[pointer]!;
      if (point === 0) continue;
      if (reverse[point] === 0) reverse[point] = pointer + 0x80;
    }
    return reverse;
  }
}

/** Return the shared handler for a single-byte encoding, or null for another family. */
export function getSingleByteCodec(encoding: Encoding): SingleByteCodec | null {
  const index = (singleByteIndexes as Partial<Record<Encoding, EncodingIndex>>)[encoding];
  if (!index) return null;
  let codec = codecs.get(index);
  if (!codec) {
    codec = new SingleByteCodec(index, encoding);
    codecs.set(index, codec);
  }
  return codec;
}

const nonASCII = /[\u0080-\uffff]/;
const codecs = new Map<EncodingIndex, SingleByteCodec>();
