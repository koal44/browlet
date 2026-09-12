import { Buffer, isAscii } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { indexes } from '../gen/indexes';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §12.1.1 — EUC-JP decoder, including the decoder-only JIS0212 plane. */
export class EUCJPDecoder {
  #jis0212 = false;
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
      // Complete the pending character, then retry ASCII on a large suffix.
      let limit = chunk.length;
      if (this.#leading !== 0 && chunk.length >= 1024) {
        const length = this.#leading === 0x8f ? 2 : 1;
        const suffix = chunk.subarray(length);
        if (isAscii(suffix)) {
          input.restore(suffix);
          limit = length;
        }
      }
      const units = new Uint16Array(limit + 1);
      let written = 0;
      for (let offset = 0; offset < limit;) {
        const byte = chunk[offset++]!;
        let point: number | null = null;
        if (this.#leading === 0x8e && byte >= 0xa1 && byte <= 0xdf) {
          this.#leading = 0;
          point = 0xff61 - 0xa1 + byte;
        } else if (this.#leading === 0x8f && byte >= 0xa1 && byte <= 0xfe) {
          this.#jis0212 = true;
          this.#leading = byte;
          continue;
        } else if (this.#leading !== 0) {
          const leading = this.#leading;
          this.#leading = 0;
          if (leading >= 0xa1 && leading <= 0xfe && byte >= 0xa1 && byte <= 0xfe) {
            point = (this.#jis0212 ? indexes.jis0212 : indexes.jis0208)
              .codePoint((leading - 0xa1) * 94 + byte - 0xa1);
          }
          this.#jis0212 = false;
          if (point === null && byte < 0x80) offset--;
        } else if (byte < 0x80) {
          point = byte;
        } else if (byte === 0x8e || byte === 0x8f || byte >= 0xa1 && byte <= 0xfe) {
          this.#leading = byte;
          continue;
        }
        if (point === null && mode === 'fatal') {
          input.restore(chunk.subarray(offset, limit));
          output.push(codeUnitsToString(units, written));
          return { error: null };
        }
        units[written++] = point ?? 0xfffd;
      }
      output.push(codeUnitsToString(units, written));
    }
  }
}

/** Encoding §12.1.2 — EUC-JP encoder uses JIS0208, not JIS0212. */
export class EUCJPEncoder {
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
      const capacity = Math.min(Math.max(chunk.length * 2, 32), 4096);
      let bytes = new Uint8Array(capacity);
      let written = 0;
      for (let offset = 0; offset < chunk.length;) {
        if (written + maximumBytes > bytes.length) {
          output.push(bytes.subarray(0, written));
          bytes = new Uint8Array(capacity);
          written = 0;
        }
        let point = chunk.codePointAt(offset)!;
        offset += point > 0xffff ? 2 : 1;
        if (point < 0x80 || point === 0xa5 || point === 0x203e) {
          bytes[written++] = point === 0xa5 ? 0x5c : point === 0x203e ? 0x7e : point;
          continue;
        }
        if (point >= 0xff61 && point <= 0xff9f) {
          bytes[written++] = 0x8e;
          bytes[written++] = point - 0xff61 + 0xa1;
          continue;
        }
        if (point === 0x2212) point = 0xff0d;
        const pointer = indexes.jis0208.pointer(point);
        if (pointer !== null) {
          bytes[written++] = Math.floor(pointer / 94) + 0xa1;
          bytes[written++] = pointer % 94 + 0xa1;
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
