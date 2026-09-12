import { Buffer, isAscii } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { indexes } from '../gen/indexes';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §11.1.1 — Big5 decoder, including its four two-scalar mappings. */
export class Big5Decoder {
  #leading = 0;

  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        if (this.#leading !== 0) {
          this.#leading = 0;
          if (mode === 'fatal') return { error: null };
          output.push('\ufffd');
        }
        output.push(endOfQueue);
        return 'finished';
      }
      if (this.#leading === 0 && isAscii(chunk)) {
        output.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1'));
        continue;
      }
      // Complete a pending character before attempting bulk ASCII decoding.
      // Leave small chunks in one pass to avoid extra queue and output pieces.
      let limit = chunk.length;
      if (this.#leading !== 0 && chunk.length >= 1024) {
        const suffix = chunk.subarray(1);
        if (isAscii(suffix)) {
          input.restore(suffix);
          limit = 1;
        }
      }
      const units = new Uint16Array(limit + 1);
      let written = 0;
      for (let offset = 0; offset < limit;) {
        const byte = chunk[offset++]!;
        let point: number | null = null;
        if (this.#leading !== 0) {
          const leading = this.#leading;
          this.#leading = 0;
          if (byte >= 0x40 && byte <= 0x7e || byte >= 0xa1 && byte <= 0xfe) {
            const pointer = (leading - 0x81) * 157 + byte - (byte < 0x7f ? 0x40 : 0x62);
            if (pointer === 1133 || pointer === 1135 || pointer === 1164 || pointer === 1166) {
              units[written++] = pointer < 1164 ? 0xca : 0xea;
              units[written++] = pointer === 1133 || pointer === 1164 ? 0x304 : 0x30c;
              continue;
            }
            point = indexes.big5.codePoint(pointer);
          }
          if (point === null && byte < 0x80) offset--;
        } else if (byte < 0x80) {
          point = byte;
        } else if (byte >= 0x81 && byte <= 0xfe) {
          this.#leading = byte;
          continue;
        }
        if (point === null) {
          if (mode === 'fatal') {
            input.restore(chunk.subarray(offset, limit));
            output.push(codeUnitsToString(units, written));
            return { error: null };
          }
          units[written++] = 0xfffd;
        } else if (point <= 0xffff) {
          units[written++] = point;
        } else {
          point -= 0x10000;
          units[written++] = 0xd800 + (point >> 10);
          units[written++] = 0xdc00 + (point & 0x3ff);
        }
      }
      output.push(codeUnitsToString(units, written));
    }
  }
}

/** Encoding §11.1.2 — Big5 encoder; the index owns exclusions and duplicate selection. */
export class Big5Encoder {
  encode(input: IOQueue<string>, output: IOQueue<Uint8Array>, mode: 'fatal' | 'html' = 'fatal'): QueueResult<number> {
    const maximumBytes = mode === 'fatal' ? 2 : 10;
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
      const blockSize = Math.min(Math.max(chunk.length * 2, 32), 4096);
      // Leave room to finish one character beyond the block target.
      let bytes = new Uint8Array(blockSize + maximumBytes - 1);
      let written = 0;
      for (let offset = 0; offset < chunk.length;) {
        if (written >= blockSize) {
          output.push(bytes.subarray(0, written));
          bytes = new Uint8Array(blockSize + maximumBytes - 1);
          written = 0;
        }
        const point = chunk.codePointAt(offset)!;
        offset += point > 0xffff ? 2 : 1;
        if (point < 0x80) {
          bytes[written++] = point;
          continue;
        }
        const pointer = indexes.big5.pointer(point);
        if (pointer !== null) {
          bytes[written++] = Math.floor(pointer / 157) + 0x81;
          const trailing = pointer % 157;
          bytes[written++] = trailing + (trailing < 0x3f ? 0x40 : 0x62);
        } else if (mode === 'fatal') {
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
}

const nonASCII = /[\u0080-\uffff]/;
