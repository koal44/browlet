import { Buffer, isAscii } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { indexes } from '../gen/indexes';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §12.2.1 — ISO-2022-JP decoder. Escape sequences can cross input chunks. */
export class ISO2022JPDecoder {
  #state: DecoderState = 'ascii';
  #outputState: OutputState = 'ascii';
  #leading = 0;
  #output = false;

  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    // Reuse scratch storage when malformed escapes restore a chunk's suffix.
    let units: Uint16Array | undefined;
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        if (this.#state === 'trailing') {
          this.#state = 'leading';
        } else if (this.#state === 'escapeStart' || this.#state === 'escape') {
          if (this.#state === 'escape') {
            input.restore(Uint8Array.of(this.#leading));
            this.#leading = 0;
          }
          this.#state = this.#outputState;
          this.#output = false;
        } else {
          output.push(endOfQueue);
          return 'finished';
        }
        if (mode === 'fatal') return { error: null };
        output.push('\ufffd');
        continue;
      }
      // Restored malformed escapes often lead the suffix; avoid a view for those.
      if (this.#state === 'ascii' && chunk[0] !== 0x1b) {
        const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        if (!bytes.includes(0x1b) && isAscii(bytes) && !bytes.includes(0x0e) && !bytes.includes(0x0f)) {
          this.#output = false;
          output.push(bytes.toString('latin1'));
          continue;
        }
      }
      // A split escape can return to ASCII. A JIS0208 character keeps its mode.
      let limit = chunk.length;
      const length = this.#state === 'escapeStart' ? 2 : this.#state === 'escape' ? 1 : 0;
      if (length !== 0 && chunk.length >= 1024) {
        const suffix = Buffer.from(chunk.buffer, chunk.byteOffset + length, chunk.byteLength - length);
        if (!suffix.includes(0x1b) && isAscii(suffix)) {
          input.restore(suffix);
          limit = length;
        }
      }
      if (units === undefined || units.length < limit + 1) units = new Uint16Array(limit + 1);
      let written = 0;
      for (let offset = 0; offset < limit;) {
        const byte = chunk[offset++]!;
        let point: number | null = null;
        let restored: Uint8Array | undefined;
        switch (this.#state) {
          case 'ascii':
          case 'roman':
            if (byte === 0x1b) {
              this.#state = 'escapeStart';
              continue;
            }
            this.#output = false;
            if (byte < 0x80 && byte !== 0x0e && byte !== 0x0f) {
              point = this.#state === 'roman' && byte === 0x5c ? 0xa5 :
                this.#state === 'roman' && byte === 0x7e ? 0x203e : byte;
            }
            break;
          case 'katakana':
            if (byte === 0x1b) {
              this.#state = 'escapeStart';
              continue;
            }
            this.#output = false;
            if (byte >= 0x21 && byte <= 0x5f) point = 0xff61 - 0x21 + byte;
            break;
          case 'leading':
            if (byte === 0x1b) {
              this.#state = 'escapeStart';
              continue;
            }
            this.#output = false;
            if (byte >= 0x21 && byte <= 0x7e) {
              this.#leading = byte;
              this.#state = 'trailing';
              continue;
            }
            break;
          case 'trailing':
            this.#state = byte === 0x1b ? 'escapeStart' : 'leading';
            if (byte >= 0x21 && byte <= 0x7e) point = indexes.jis0208.codePoint((this.#leading - 0x21) * 94 + byte - 0x21);
            break;
          case 'escapeStart':
            if (byte === 0x24 || byte === 0x28) {
              this.#leading = byte;
              this.#state = 'escape';
              continue;
            }
            this.#output = false;
            this.#state = this.#outputState;
            offset--;
            break;
          case 'escape': {
            const leading = this.#leading;
            this.#leading = 0;
            let state: OutputState | undefined;
            if (leading === 0x28) {
              if (byte === 0x42) state = 'ascii';
              else if (byte === 0x4a) state = 'roman';
              else if (byte === 0x49) state = 'katakana';
            } else if (leading === 0x24 && (byte === 0x40 || byte === 0x42)) {
              state = 'leading';
            }
            if (state !== undefined) {
              this.#state = this.#outputState = state;
              const repeated = this.#output;
              this.#output = true;
              if (!repeated) continue;
            } else {
              restored = Uint8Array.of(leading, byte);
              this.#state = this.#outputState;
              this.#output = false;
            }
            break;
          }
        }
        if (point === null) {
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
        } else {
          units[written++] = point;
        }
      }
      output.push(codeUnitsToString(units, written));
    }
  }
}

/** Encoding §12.2.2 — ISO-2022-JP encoder retains its mode until end-of-input. */
export class ISO2022JPEncoder {
  #state: 'ascii' | 'roman' | 'jis0208' = 'ascii';

  encode(input: IOQueue<string>, output: IOQueue<Uint8Array>, mode: 'fatal' | 'html' = 'fatal'): QueueResult<number> {
    // A mode switch plus one mapped character, or an HTML character reference.
    const maximumBytes = mode === 'fatal' ? 5 : 13;
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        if (this.#state !== 'ascii') {
          this.#state = 'ascii';
          output.push(Uint8Array.of(0x1b, 0x28, 0x42));
        }
        output.push(endOfQueue);
        return 'finished';
      }
      if (this.#state === 'ascii' && !nonASCIIOrControl.test(chunk)) {
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
        let pointer: number | null = null;
        if (point === 0x0e || point === 0x0f || point === 0x1b) {
          // The standard reports U+FFFD for these controls, including after
          // returning from JIS0208 to ASCII, to prevent escape injection.
          point = 0xfffd;
        } else if (point < 0x80) {
          if (this.#state === 'jis0208' || this.#state === 'roman' && (point === 0x5c || point === 0x7e)) {
            bytes[written++] = 0x1b;
            bytes[written++] = 0x28;
            bytes[written++] = 0x42;
            this.#state = 'ascii';
          }
          bytes[written++] = point;
          continue;
        } else if (point === 0xa5 || point === 0x203e) {
          if (this.#state !== 'roman') {
            bytes[written++] = 0x1b;
            bytes[written++] = 0x28;
            bytes[written++] = 0x4a;
            this.#state = 'roman';
          }
          bytes[written++] = point === 0xa5 ? 0x5c : 0x7e;
          continue;
        } else {
          if (point === 0x2212) point = 0xff0d;
          if (point >= 0xff61 && point <= 0xff9f) point = indexes['iso-2022-jp-katakana'].codePoint(point - 0xff61)!;
          pointer = indexes.jis0208.pointer(point);
        }
        if (pointer === null) {
          if (this.#state === 'jis0208') {
            bytes[written++] = 0x1b;
            bytes[written++] = 0x28;
            bytes[written++] = 0x42;
            this.#state = 'ascii';
          }
          if (mode === 'fatal') {
            output.push(bytes.subarray(0, written));
            input.restore(chunk.slice(offset));
            return { error: point };
          }
          const reference = `&#${point};`;
          for (let i = 0; i < reference.length; i++) bytes[written++] = reference.charCodeAt(i);
        } else {
          if (this.#state !== 'jis0208') {
            bytes[written++] = 0x1b;
            bytes[written++] = 0x24;
            bytes[written++] = 0x42;
            this.#state = 'jis0208';
          }
          bytes[written++] = Math.floor(pointer / 94) + 0x21;
          bytes[written++] = pointer % 94 + 0x21;
        }
      }
      output.push(bytes.subarray(0, written));
    }
  }
}

type OutputState = 'ascii' | 'roman' | 'katakana' | 'leading';
type DecoderState = OutputState | 'trailing' | 'escapeStart' | 'escape';
// eslint-disable-next-line no-control-regex -- ISO-2022-JP forbids these ASCII controls as data.
const nonASCIIOrControl = /[\u000e\u000f\u001b\u0080-\uffff]/;
