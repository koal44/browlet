import { Buffer, isAscii } from 'node:buffer';
import { codeUnitsToString } from '../../js-engine/byte-string';
import { endOfQueue, type IOQueue, type QueueResult } from '../io-queue';

/** Encoding §14.1 — One error on nonempty input, then finish after the next item. */
export class ReplacementDecoder {
  #errorReturned = false;

  decode(
    input: IOQueue<Uint8Array>, output: IOQueue<string>,
    mode: 'replacement' | 'fatal' = 'replacement',
  ): QueueResult<null> {
    for (;;) {
      const byte = input.readAvailable();
      if (byte === undefined) return 'waiting';
      if (byte === endOfQueue || this.#errorReturned) {
        output.push(endOfQueue);
        return 'finished';
      }
      this.#errorReturned = true;
      if (mode === 'fatal') return { error: null };
      output.push('\ufffd');
    }
  }
}

/** Encoding §14.5 — Stateless ASCII and U+F780–U+F7FF mapping; no index is needed. */
export class XUserDefinedCodec {
  decode(input: IOQueue<Uint8Array>, output: IOQueue<string>): QueueResult<null> {
    for (;;) {
      const chunk = input.readChunk();
      if (chunk === undefined) return 'waiting';
      if (chunk === endOfQueue) {
        output.push(endOfQueue);
        return 'finished';
      }
      if (isAscii(chunk)) {
        output.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1'));
        continue;
      }
      const points = new Uint16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) points[i] = chunk[i]! < 0x80 ? chunk[i]! : chunk[i]! + 0xf700;
      output.push(codeUnitsToString(points));
    }
  }

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
      const capacity = Math.min(Math.max(chunk.length, 16), 4096);
      let bytes = new Uint8Array(capacity);
      let written = 0;
      for (let offset = 0; offset < chunk.length;) {
        if (written + maximumBytes > bytes.length) {
          output.push(bytes.subarray(0, written));
          bytes = new Uint8Array(capacity);
          written = 0;
        }
        const point = chunk.codePointAt(offset)!;
        offset += point > 0xffff ? 2 : 1;
        if (point < 0x80) {
          bytes[written++] = point;
        } else if (point >= 0xf780 && point <= 0xf7ff) {
          bytes[written++] = point - 0xf700;
        } else if (mode === 'fatal') {
          input.restore(chunk.slice(offset));
          output.push(bytes.subarray(0, written));
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
