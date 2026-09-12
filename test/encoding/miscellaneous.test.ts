import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decode, encode, getDecoder, getEncoder } from '../../src/encoding/encodings';
import { endOfQueue, IOQueue } from '../../src/encoding/io-queue';

const utf16 = ['UTF-16LE', 'UTF-16BE'] as const;

describe('Encoding §14.1: replacement', () => {
  it('emits nothing for empty input and one replacement for nonempty input', () => {
    expect(decode(new Uint8Array(), 'replacement')).toBe('');
    expect(decode(Uint8Array.of(0), 'replacement')).toBe('\ufffd');
    expect(decode(Uint8Array.of(0, 1, 2, 3), 'replacement')).toBe('\ufffd');
  });

  it('finishes after its second item without consuming the rest of an open input', () => {
    const decoder = getDecoder('replacement');
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    input.push(Uint8Array.of(0));
    expect(decoder.decode(input, output, 'replacement')).toBe('waiting');
    expect(output.takeString()).toBe('\ufffd');
    input.push(Uint8Array.of(1, 2, 3));
    expect(decoder.decode(input, output, 'replacement')).toBe('finished');
    expect(output.readAvailable()).toBe(endOfQueue);
    expect(input.takeList()).toEqual([2, 3]);
  });

  it('returns its fatal error only once and retains the unread input', () => {
    const decoder = getDecoder('replacement');
    const input = IOQueue.from(Uint8Array.of(1, 2, 3));
    const output = new IOQueue<string>();
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(input.peek(3)).toEqual([2, 3]);
    expect(output.readAvailable()).toBeUndefined();
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('');
    expect(input.takeList()).toEqual([3]);
  });
});

describe.each(utf16)('Encoding §§14.2–14.4: %s', (encoding) => {
  it('decodes aligned offset views without modifying their storage', () => {
    const text = 'A日本😀\ufeff'.repeat(1024);
    const bytes = toBytes(text, encoding);
    const storage = new Uint8Array(bytes.length + 3);
    storage.set(bytes, 1);
    const before = storage.slice();
    const output = new IOQueue<string>();
    expect(getDecoder(encoding).decode(IOQueue.from(storage.subarray(1, -2)), output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe(text);
    expect(storage).toEqual(before);
  });

  it('decodes every Unicode scalar across odd byte boundaries', () => {
    const decoder = getDecoder(encoding);
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    for (let start = 0; start <= 0x10ffff; start += 4096) {
      const points: number[] = [];
      for (let point = start; point < start + 4096 && point <= 0x10ffff; point++) {
        if (point < 0xd800 || point > 0xdfff) points.push(point);
      }
      const text = String.fromCodePoint(...points);
      const bytes = toBytes(text, encoding);
      for (let i = 0; i < bytes.length; i += 257) {
        input.push(bytes.subarray(i, i + 257));
        expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
      }
      expect(output.takeString()).toBe(text);
    }
    input.push(endOfQueue);
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('');
  });

  it.each(['replacement', 'fatal'] as const)('emits the complete middle between split surrogate pairs in %s mode', (mode) => {
    const middle = 'A日本\ufeff'.repeat(256);
    const bytes = toBytes('😀' + middle + '😀', encoding);
    for (const split of [1, 2, 3]) {
      const decoder = getDecoder(encoding);
      const input = new IOQueue<Uint8Array>();
      const output = new IOQueue<string>();
      input.push(bytes.subarray(0, split));
      expect(decoder.decode(input, output, mode)).toBe('waiting');
      expect(output.takeString()).toBe('');
      const tail = bytes.length - 4 + split;
      input.push(bytes.subarray(split, tail));
      expect(decoder.decode(input, output, mode)).toBe('waiting');
      expect(output.takeString()).toBe('😀' + middle);
      input.push(bytes.subarray(tail));
      input.push(endOfQueue);
      expect(decoder.decode(input, output, mode)).toBe('finished');
      expect(output.takeString()).toBe('😀');
      expect(output.readAvailable()).toBe(endOfQueue);
    }
  });

  it('replaces every isolated surrogate while preserving all other code units', () => {
    const parts: string[] = [];
    for (let unit = 0; unit <= 0xffff; unit++) parts.push(String.fromCharCode(unit), 'A');
    const text = parts.join('');
    const output = new IOQueue<string>();
    expect(getDecoder(encoding).decode(IOQueue.from(toBytes(text, encoding)), output, 'replacement')).toBe('finished');
    expect(output.takeString()).toBe(text.toWellFormed());
  });

  it.each([
    ['', false, ''], ['A\ud800', false, 'A\ufffd'],
    ['\ud800A', false, '\ufffdA'], ['\udc00A', false, '\ufffdA'],
    ['\ud800\ud801\udc00', false, '\ufffd\u{10400}'],
    ['\ud800', true, '\ufffd'], ['', true, '\ufffd'],
    ['\ufeffA\ufffe', false, '\ufeffA\ufffe'],
  ] as const)('handles every partition of %j (odd tail=%s)', (text, oddTail, expected) => {
    const bytes = [...toBytes(text, encoding), ...(oddTail ? [0x41] : [])];
    for (let mask = 0; mask < 1 << Math.max(0, bytes.length - 1); mask++) {
      const decoder = getDecoder(encoding);
      const input = new IOQueue<Uint8Array>();
      const output = IOQueue.from('prefix:');
      let start = 0;
      for (let end = 1; end <= bytes.length; end++) {
        if (end !== bytes.length && !(mask & 1 << (end - 1))) continue;
        input.push(Uint8Array.from(bytes.slice(start, end)));
        expect(decoder.decode(input, output, 'replacement')).toBe('waiting');
        start = end;
      }
      input.push(endOfQueue);
      expect(decoder.decode(input, output, 'replacement')).toBe('finished');
      expect(output.takeString()).toBe('prefix:' + expected);
      expect(output.readAvailable()).toBe(endOfQueue);
    }
  });

  it.each([1, 128])('restores a split non-trailing code unit after a fatal surrogate error, with %i following pairs', (length) => {
    const decoder = getDecoder(encoding);
    const suffix = 'BC'.repeat(length);
    const bytes = toBytes('A\ud800' + suffix, encoding);
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    input.push(bytes.subarray(0, 5));
    expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
    input.push(bytes.subarray(5));
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('A');
    expect(output.readAvailable()).toBeUndefined();
    expect(input.peek(suffix.length * 2)).toEqual([...toBytes(suffix, encoding)]);
    input.push(endOfQueue);
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe(suffix);
  });

  it.each(['replacement', 'fatal'] as const)('keeps an incomplete final pair after a large prefix until EOF in %s mode', (mode) => {
    for (const oddTail of [false, true]) {
      const decoder = getDecoder(encoding);
      const prefix = 'A日本'.repeat(128);
      const bytes = toBytes(prefix + '\ud800', encoding);
      const input = new IOQueue<Uint8Array>();
      const output = new IOQueue<string>();
      input.push(oddTail ? Uint8Array.from([...bytes, 0]) : bytes);
      expect(decoder.decode(input, output, mode)).toBe('waiting');
      expect(output.takeString()).toBe(prefix);
      input.push(endOfQueue);
      expect(decoder.decode(input, output, mode)).toEqual(mode === 'fatal' ? { error: null } : 'finished');
      expect(output.takeString()).toBe(mode === 'fatal' ? '' : '\ufffd');
      expect(output.readAvailable()).toBe(mode === 'fatal' ? undefined : endOfQueue);
    }
  });

  it('clears both incomplete fields on a fatal EOF and can resume with new input', () => {
    const decoder = getDecoder(encoding);
    const input = IOQueue.from(Uint8Array.from([...toBytes('\ud800', encoding), 0]));
    const output = new IOQueue<string>();
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    input.push(toBytes('A', encoding));
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('A');
  });
});

describe('Encoding §14.5: x-user-defined', () => {
  it('round-trips all 256 bytes without a mapping index', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = String.fromCodePoint(...Array.from(bytes, (byte) => byte < 0x80 ? byte : 0xf700 + byte));
    expect(decode(bytes, 'x-user-defined')).toBe(text);
    expect(encode(text, 'x-user-defined')).toEqual(bytes);
    const input = IOQueue.from(text);
    const output = new IOQueue<Uint8Array>();
    expect(getEncoder('x-user-defined').encode(input, output, 'fatal')).toBe('finished');
    expect(output.takeBytes()).toEqual(bytes);
  });

  it.each([0x80, 0xff, 0xf77f, 0xf800, 0x1f600, 0x10ffff])('reports unmappable U+%s without consuming the suffix', (point) => {
    const text = 'A' + String.fromCodePoint(point) + '\uf780';
    const input = IOQueue.from(text);
    const output = new IOQueue<Uint8Array>();
    expect(getEncoder('x-user-defined').encode(input, output, 'fatal')).toEqual({ error: point });
    expect([...output.takeBytes()]).toEqual([0x41]);
    expect(input.takeString()).toBe('\uf780');
    expect(encode(text, 'x-user-defined')).toEqual(Uint8Array.from([...Buffer.from(`A&#${point};`), 0x80]));
  });

  it('handles HTML expansion across output blocks and ASCII chunks', () => {
    const text = 'A😀'.repeat(8192);
    expect(decode(encode(text, 'x-user-defined'), 'x-user-defined')).toBe('A&#128512;'.repeat(8192));
    const ascii = 'abc\0'.repeat(8192);
    expect(decode(encode(ascii, 'x-user-defined'), 'x-user-defined')).toBe(ascii);
  });
});

function toBytes(text: string, encoding: typeof utf16[number]): Uint8Array<ArrayBuffer> {
  const bytes = Buffer.from(text, 'utf16le');
  return encoding === 'UTF-16BE' ? bytes.swap16() : bytes;
}
