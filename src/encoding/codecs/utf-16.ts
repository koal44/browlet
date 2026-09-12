import { Buffer } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §§14.2–14.4 — Shared UTF-16 decoder. BOM handling belongs to its caller. */
export class UTF16Decoder {
  readonly #bigEndian: boolean;
  #leadingByte: number | null = null;
  #leadingSurrogate: number | null = null;

  constructor(bigEndian = false) {
    this.#bigEndian = bigEndian;
  }

  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        if (this.#leadingByte !== null || this.#leadingSurrogate !== null) {
          this.#leadingByte = this.#leadingSurrogate = null;
          if (mode === 'fatal') return { error: null };
          output.push('\ufffd');
        }
        output.push(endOfQueue);
        return 'finished';
      }
      let offset = 0;
      let bulk = true;
      // Keep tiny chunks in one pass instead of materializing several pieces.
      const split = chunk.length >= 64;
      // Resolving a pending byte/pair needs at most three new bytes. Then the
      // complete middle can use native conversion even if this chunk is odd.
      let limit = !split ? chunk.length : this.#leadingByte !== null ? Math.min(chunk.length, 3) :
        this.#leadingSurrogate !== null ? Math.min(chunk.length, 2) : chunk.length;
      while (offset < chunk.length) {
        if (bulk && this.#leadingByte === null && this.#leadingSurrogate === null) {
          let end = chunk.length - (chunk.length - offset) % 2;
          if (!split && end !== chunk.length) end = offset;
          if (end > offset) {
            const last = this.#bigEndian ? chunk[end - 2]! << 8 | chunk[end - 1]! :
              chunk[end - 1]! << 8 | chunk[end - 2]!;
            // A final leading surrogate can still pair with the next chunk.
            if (last >= 0xd800 && last <= 0xdbff) end = split ? end - 2 : offset;
          }
          if (end > offset) {
            const bytes = this.#bigEndian ? Buffer.from(chunk.subarray(offset, end)).swap16() :
              Buffer.from(chunk.buffer, chunk.byteOffset + offset, end - offset);
            const text = bytes.toString('utf16le');
            if (mode === 'replacement' || text.isWellFormed()) {
              output.push(mode === 'replacement' ? text.toWellFormed() : text);
              offset = end;
            }
          }
          // Fatal malformed input needs the scalar handler's exact stop and
          // restoration position; do not repeatedly validate its suffixes.
          bulk = false;
          limit = chunk.length;
          if (offset === chunk.length) break;
        }
        const completingPrefix = limit < chunk.length;
        const units = new Uint16Array(Math.ceil((limit - offset) / 2) + 2);
        let written = 0;
        for (; offset < limit && (!completingPrefix || this.#leadingByte !== null || this.#leadingSurrogate !== null);) {
          const byte = chunk[offset++]!;
          if (this.#leadingByte === null) {
            this.#leadingByte = byte;
            continue;
          }
          const leadingByte = this.#leadingByte;
          const unit = this.#bigEndian ? leadingByte << 8 | byte : byte << 8 | leadingByte;
          this.#leadingByte = null;
          if (this.#leadingSurrogate !== null) {
            const leading = this.#leadingSurrogate;
            this.#leadingSurrogate = null;
            if (unit >= 0xdc00 && unit <= 0xdfff) {
              units[written++] = leading;
              units[written++] = unit;
              continue;
            }
            if (mode === 'fatal') {
              input.restore(chunk.subarray(offset));
              input.restore(Uint8Array.of(leadingByte, byte));
              output.push(codeUnitsToString(units, written));
              return { error: null };
            }
            // Replacement mode reprocesses this code unit locally. Fatal mode
            // restores both bytes, including a leading byte from an earlier chunk.
            units[written++] = 0xfffd;
          }
          if (unit >= 0xd800 && unit <= 0xdbff) {
            this.#leadingSurrogate = unit;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            if (mode === 'fatal') {
              input.restore(chunk.subarray(offset));
              output.push(codeUnitsToString(units, written));
              return { error: null };
            }
            units[written++] = 0xfffd;
          } else {
            units[written++] = unit;
          }
        }
        output.push(codeUnitsToString(units, written));
        limit = chunk.length;
      }
    }
  }
}
