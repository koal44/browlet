import { Buffer, isAscii } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { indexes } from '../gen/indexes';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §12.3.1 — Shift_JIS decoder, including Windows private-use mappings. */
export class ShiftJISDecoder {
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
      // Finish a split character first, then let the suffix try the ASCII path.
      // Small chunks cost less to process together.
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
          if (byte >= 0x40 && byte <= 0xfc && byte !== 0x7f) {
            const pointer = (leading - (leading < 0xa0 ? 0x81 : 0xc1)) * 188 + byte - (byte < 0x7f ? 0x40 : 0x41);
            point = pointer >= 8836 && pointer <= 10715 ? 0xe000 - 8836 + pointer : indexes.jis0208.codePoint(pointer);
          }
          if (point === null && byte < 0x80) offset--;
        } else if (byte <= 0x80) {
          point = byte;
        } else if (byte >= 0xa1 && byte <= 0xdf) {
          point = 0xff61 - 0xa1 + byte;
        } else if (byte >= 0x81 && byte <= 0x9f || byte >= 0xe0 && byte <= 0xfc) {
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

/** Encoding §12.3.2 — Shift_JIS encoder uses the index's excluded-pointer lookup. */
export class ShiftJISEncoder {
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
      const maximumBytes = mode === 'fatal' ? 2 : 10;
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
        if (point <= 0x80 || point === 0xa5 || point === 0x203e) {
          bytes[written++] = point === 0xa5 ? 0x5c : point === 0x203e ? 0x7e : point;
          continue;
        }
        if (point >= 0xff61 && point <= 0xff9f) {
          bytes[written++] = point - 0xff61 + 0xa1;
          continue;
        }
        if (point === 0x2212) point = 0xff0d;
        const pointer = indexes.jis0208.shiftJISPointer(point);
        if (pointer !== null) {
          const leading = Math.floor(pointer / 188);
          const trailing = pointer % 188;
          bytes[written++] = leading + (leading < 0x1f ? 0x81 : 0xc1);
          bytes[written++] = trailing + (trailing < 0x3f ? 0x40 : 0x41);
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
