import { Buffer, isAscii } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { indexes } from '../gen/indexes';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §§10.1.1, 10.2.1 — GBK and gb18030 share this decoder. */
export class GB18030Decoder {
  #first = 0;
  #second = 0;
  #third = 0;

  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    // Recovery can revisit successively shorter suffixes of the same chunk.
    // Materialized strings do not retain this scratch storage.
    let units: Uint16Array | undefined;
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        if (this.#first !== 0) {
          this.#first = this.#second = this.#third = 0;
          if (mode === 'fatal') return { error: null };
          output.push('\ufffd');
        }
        output.push(endOfQueue);
        return 'finished';
      }
      if (this.#first === 0 && isAscii(chunk)) {
        output.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1'));
        continue;
      }
      // Up to three bytes complete a pending sequence. Retry the large suffix
      // through the normal chunk path instead of keeping ASCII in this loop.
      let limit = chunk.length;
      if (this.#first !== 0 && chunk.length >= 1024) {
        const length = this.#third !== 0 ? 1 : this.#second !== 0 ? 2 : 3;
        const suffix = chunk.subarray(length);
        if (isAscii(suffix)) {
          input.restore(suffix);
          limit = length;
        }
      }
      if (units === undefined || units.length < limit + 2) units = new Uint16Array(limit + 2);
      let written = 0;
      for (let offset = 0; offset < limit;) {
        const byte = chunk[offset++]!;
        let point: number | null = null;
        let restored: Uint8Array | undefined;
        if (this.#third !== 0) {
          if (byte >= 0x30 && byte <= 0x39) {
            point = indexes['gb18030-ranges'].codePoint(
              (this.#first - 0x81) * 12600 + (this.#second - 0x30) * 1260 +
              (this.#third - 0x81) * 10 + byte - 0x30,
            );
          } else {
            restored = Uint8Array.of(this.#second, this.#third, byte);
          }
          this.#first = this.#second = this.#third = 0;
        } else if (this.#second !== 0) {
          if (byte >= 0x81 && byte <= 0xfe) {
            this.#third = byte;
            continue;
          }
          restored = Uint8Array.of(this.#second, byte);
          this.#first = this.#second = 0;
        } else if (this.#first !== 0) {
          if (byte >= 0x30 && byte <= 0x39) {
            this.#second = byte;
            continue;
          }
          const leading = this.#first;
          this.#first = 0;
          if (byte >= 0x40 && byte <= 0xfe && byte !== 0x7f) {
            point = indexes.gb18030.codePoint((leading - 0x81) * 190 + byte - (byte < 0x7f ? 0x40 : 0x41));
          }
          if (point === null && byte < 0x80) offset--;
        } else if (byte < 0x80) {
          point = byte;
        } else if (byte === 0x80) {
          point = 0x20ac;
        } else if (byte >= 0x81 && byte <= 0xfe) {
          this.#first = byte;
          continue;
        }

        if (point === null) {
          // Recovery may restore bytes from an earlier chunk. Preserve those
          // before the current chunk's suffix, including on a fatal return.
          if (restored) {
            input.restore(chunk.subarray(offset, limit));
            input.restore(restored);
          }
          if (mode === 'fatal') {
            if (!restored) input.restore(chunk.subarray(offset, limit));
            output.push(codeUnitsToString(units, written));
            return { error: null };
          }
          units[written++] = 0xfffd;
          if (restored) break;
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

/** Encoding §§10.1.2, 10.2.2 — GBK restricts this encoder to its two-byte repertoire. */
export class GB18030Encoder {
  readonly #isGBK: boolean;

  constructor(isGBK = false) {
    this.#isGBK = isGBK;
  }

  encode(input: IOQueue<string>, output: IOQueue<Uint8Array>, mode: 'fatal' | 'html' = 'fatal'): QueueResult<number> {
    const maximumBytes = mode === 'fatal' ? 4 : 10;
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
        if (this.#isGBK && point === 0x20ac) {
          bytes[written++] = 0x80;
          continue;
        }
        const override = compatibilityBytes.get(point);
        if (override !== undefined) {
          bytes[written++] = override >> 8;
          bytes[written++] = override & 0xff;
          continue;
        }
        let pointer = point === 0xe5e5 ? null : indexes.gb18030.pointer(point);
        if (pointer !== null) {
          bytes[written++] = Math.floor(pointer / 190) + 0x81;
          const trailing = pointer % 190;
          bytes[written++] = trailing + (trailing < 0x3f ? 0x40 : 0x41);
        } else if (point === 0xe5e5 || this.#isGBK) {
          if (mode === 'fatal') {
            output.push(bytes.subarray(0, written));
            input.restore(chunk.slice(offset));
            return { error: point };
          }
          const reference = `&#${point};`;
          for (let i = 0; i < reference.length; i++) bytes[written++] = reference.charCodeAt(i);
        } else {
          pointer = indexes['gb18030-ranges'].pointer(point);
          bytes[written++] = Math.floor(pointer / 12600) + 0x81;
          bytes[written++] = Math.floor(pointer % 12600 / 1260) + 0x30;
          bytes[written++] = Math.floor(pointer % 1260 / 10) + 0x81;
          bytes[written++] = pointer % 10 + 0x30;
        }
      }
      output.push(bytes.subarray(0, written));
    }
  }
}

/** §10.2.2 — Preserve the GB18030-2005 encoder mappings alongside the 2022 decoding index. */
const compatibilityBytes = new Map([
  [0xe78d, 0xa6d9], [0xe78e, 0xa6da], [0xe78f, 0xa6db], [0xe790, 0xa6dc],
  [0xe791, 0xa6dd], [0xe792, 0xa6de], [0xe793, 0xa6df], [0xe794, 0xa6ec],
  [0xe795, 0xa6ed], [0xe796, 0xa6f3], [0xe81e, 0xfe59], [0xe826, 0xfe61],
  [0xe82b, 0xfe66], [0xe82c, 0xfe67], [0xe832, 0xfe6d], [0xe843, 0xfe7e],
  [0xe854, 0xfe90], [0xe864, 0xfea0],
]);

const nonASCII = /[\u0080-\uffff]/;
