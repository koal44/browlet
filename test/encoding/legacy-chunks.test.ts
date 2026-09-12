import { describe, expect, it } from 'vitest';
import { getDecoder, getEncoder } from '../../src/encoding/encodings';
import { endOfQueue, IOQueue } from '../../src/encoding/io-queue';

describe('legacy codec chunk processing', () => {
  it('limits ISO-2022-JP ASCII scanning to the supplied byte view', () => {
    const bytes = new Uint8Array(65538).fill(0x41);
    bytes[0] = bytes[bytes.length - 1] = 0xff;
    const view = bytes.subarray(1, bytes.length - 1);
    const output = new IOQueue<string>();
    expect(getDecoder('ISO-2022-JP').decode(IOQueue.from(view), output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('A'.repeat(view.length));
    for (const byte of [0x0e, 0x0f, 0x1b, 0xff]) {
      view[view.length - 1] = byte;
      expect(getDecoder('ISO-2022-JP').decode(IOQueue.from(view), output, 'replacement')).toBe('finished');
      expect(output.takeString()).toBe('A'.repeat(view.length - 1) + '\ufffd');
    }
  });

  it.each([
    ['Big5', [0x41, 0x88, 0x62, 0x9c, 0x71], 'A\u00ca\u0304\u{20021}'],
    ['EUC-JP', [0x41, 0xa4, 0xa2, 0x8f, 0xa2, 0xaf], 'Aあ\u02d8'],
    ['EUC-KR', [0x41, 0xb0, 0xa1], 'A가'],
    ['Shift_JIS', [0x41, 0x82, 0xa0], 'Aあ'],
    ['gb18030', [0x41, 0xd6, 0xd0, 0x94, 0x39, 0xfc, 0x36], 'A中😀'],
    ['ISO-2022-JP', [0x1b, 0x24, 0x42, 0x24, 0x22, 0x1b, 0x28, 0x42, 0x41], 'あA'],
  ] as const)('%s preserves a large decoded prefix before an error and resumption', (encoding, pattern, text) => {
    for (const count of [4095, 4096, 4097, 16385]) {
      for (const mode of ['fatal', 'replacement'] as const) {
        const bytes = new Uint8Array(pattern.length * count + 2);
        for (let offset = 0; offset < bytes.length - 2; offset += pattern.length) bytes.set(pattern, offset);
        bytes.set([0xff, 0x5a], bytes.length - 2);
        const decoder = getDecoder(encoding);
        const input = IOQueue.from(bytes);
        const output = new IOQueue<string>();
        if (mode === 'fatal') {
          expect(decoder.decode(input, output, mode)).toEqual({ error: null });
          expect(output.takeString()).toBe(text.repeat(count));
          expect(decoder.decode(input, output, mode)).toBe('finished');
          expect(output.takeString()).toBe('Z');
        } else {
          expect(decoder.decode(input, output, mode)).toBe('finished');
          expect(output.takeString()).toBe(text.repeat(count) + '\ufffdZ');
        }
        expect(output.readAvailable()).toBe(endOfQueue);
      }
    }
  });

  it.each([
    ['Big5', '一', [0xa4, 0x40]],
    ['gb18030', '中', [0xd6, 0xd0]],
    ['gb18030', '😀', [0x94, 0x39, 0xfc, 0x36]],
    ['Shift_JIS', 'あ', [0x82, 0xa0]],
    ['x-user-defined', '\uf780', [0x80]],
    ['windows-1252', 'é', [0xe9]],
  ] as const)('%s preserves encoded output before an unmappable character and resumption', (encoding, text, sequence) => {
    for (const count of [15, 16, 17, 2047, 2048, 2049, 4095, 4096, 4097]) {
      for (const mode of ['fatal', 'html'] as const) {
        const encoder = getEncoder(encoding);
        const input = IOQueue.from(text.repeat(count) + 'A\ue5e5Z');
        const output = new IOQueue<Uint8Array>();
        const prefix = new Uint8Array(sequence.length * count + 1);
        for (let offset = 0; offset < prefix.length - 1; offset += sequence.length) prefix.set(sequence, offset);
        prefix[prefix.length - 1] = 0x41;
        if (mode === 'fatal') {
          expect(encoder.encode(input, output, mode)).toEqual({ error: 0xe5e5 });
          expect(output.takeBytes()).toEqual(prefix);
          expect(encoder.encode(input, output, mode)).toBe('finished');
          expect(output.takeBytes()).toEqual(Uint8Array.of(0x5a));
        } else {
          expect(encoder.encode(input, output, mode)).toBe('finished');
          const suffix = Uint8Array.from('&#58853;Z', (c) => c.charCodeAt(0));
          const expected = new Uint8Array(prefix.length + suffix.length);
          expected.set(prefix);
          expected.set(suffix, prefix.length);
          expect(output.takeBytes()).toEqual(expected);
        }
        expect(output.readAvailable()).toBe(endOfQueue);
      }
    }
  });

  it.each([
    ['Shift_JIS', 'あ', [0x82, 0xa0]],
    ['x-user-defined', '\uf780', [0x80]],
    ['windows-1252', 'é', [0xe9]],
  ] as const)('%s emits complete HTML references across byte output boundaries', (encoding, text, sequence) => {
    for (const count of [6, 7, 15, 16, 2047, 2048, 4095, 4096]) {
      const input = IOQueue.from(text.repeat(count) + '\u{10ffff}Z');
      const output = new IOQueue<Uint8Array>();
      expect(getEncoder(encoding).encode(input, output, 'html')).toBe('finished');
      const prefix = Uint8Array.from({ length: count * sequence.length }, (_, i) => sequence[i % sequence.length]!);
      const suffix = Uint8Array.from('&#1114111;Z', (c) => c.charCodeAt(0));
      const expected = new Uint8Array(prefix.length + suffix.length);
      expected.set(prefix);
      expected.set(suffix, prefix.length);
      expect(output.takeBytes()).toEqual(expected);
      expect(output.readAvailable()).toBe(endOfQueue);
    }
  });

  it.each([
    ['gb18030', [0x81, 0x30, 0x20], '\ufffd0 '],
    ['ISO-2022-JP', [0x1b, 0x28, 0x20], '\ufffd( '],
  ] as const)('%s preserves output through repeated malformed recovery', (encoding, pattern, text) => {
    const bytes = Uint8Array.from({ length: 768 }, (_, i) => pattern[i % pattern.length]!);
    for (const chunkSize of [bytes.length, 1, 7, 64]) {
      const decoder = getDecoder(encoding);
      const input = new IOQueue<Uint8Array>();
      const output = new IOQueue<string>();
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        input.push(bytes.subarray(offset, offset + chunkSize));
      }
      // A subsequent, larger chunk exercises continued decoding after recovery.
      const larger = new Uint8Array(2049).fill(0x41);
      larger[2048] = 0xff;
      input.push(larger);
      input.push(endOfQueue);
      expect(decoder.decode(input, output, 'replacement')).toBe('finished');
      expect(output.takeString()).toBe(text.repeat(256) + 'A'.repeat(2048) + '\ufffd');
      expect(output.readAvailable()).toBe(endOfQueue);
    }
  });

  it.each([
    ['Big5', [0xa4, 0x40], '一'],
    ['Big5', [0x88, 0x62], '\u00ca\u0304'],
    ['Big5', [0x9c, 0x71], '\u{20021}'],
    ['EUC-JP', [0xa4, 0xa2], 'あ'],
    ['EUC-JP', [0x8e, 0xb6], 'ｶ'],
    ['EUC-JP', [0x8f, 0xa2, 0xaf], '\u02d8'],
    ['EUC-KR', [0xb0, 0xa1], '가'],
    ['Shift_JIS', [0x82, 0xa0], 'あ'],
    ['Shift_JIS', [0x81, 0x40], '\u3000'],
    ['gb18030', [0xd6, 0xd0], '中'],
    ['gb18030', [0x81, 0x30, 0x81, 0x30], '\u0080'],
    ['gb18030', [0x94, 0x39, 0xfc, 0x36], '😀'],
    ['ISO-2022-JP', [0x1b, 0x28, 0x42], ''],
  ] as const)('%s completes split %j before ASCII and a later error', (encoding, prefix, text) => {
    for (let split = 1; split < prefix.length; split++) {
      for (const mode of ['fatal', 'replacement'] as const) {
        const decoder = getDecoder(encoding);
        const input = new IOQueue<Uint8Array>();
        const output = new IOQueue<string>();
        input.push(Uint8Array.from(prefix.slice(0, split)));
        expect(decoder.decode(input, output, mode)).toBe('waiting');
        expect(output.takeString()).toBe('');
        const suffix = new Uint8Array(prefix.length - split + 65536).fill(0x41);
        suffix.set(prefix.slice(split));
        input.push(suffix);
        expect(decoder.decode(input, output, mode)).toBe('waiting');
        expect(output.takeString()).toBe(text + 'A'.repeat(65536));

        input.push(Uint8Array.of(0xff, 0x5a));
        input.push(endOfQueue);
        if (mode === 'fatal') {
          expect(decoder.decode(input, output, mode)).toEqual({ error: null });
          expect(output.takeString()).toBe('');
          expect(decoder.decode(input, output, mode)).toBe('finished');
          expect(output.takeString()).toBe('Z');
        } else {
          expect(decoder.decode(input, output, mode)).toBe('finished');
          expect(output.takeString()).toBe('\ufffdZ');
        }
        expect(output.readAvailable()).toBe(endOfQueue);
      }
    }
  });

  it.each([
    ['Big5', [0xa4], [0x22], [0x22]],
    ['EUC-JP', [0x8f, 0xa2], [0x22], [0x22]],
    ['EUC-KR', [0x81], [0x5b], [0x5b]],
    ['Shift_JIS', [0x82], [0x22], [0x22]],
    ['Shift_JIS', [0x82], [0xff], []],
    ['gb18030', [0x81, 0x30], [0x22], [0x30, 0x22]],
    ['gb18030', [0x81, 0x30, 0x81], [0x22], [0x30, 0x81, 0x22]],
    ['ISO-2022-JP', [0x1b, 0x24], [0x58], [0x24, 0x58]],
  ] as const)('%s restores a malformed split prefix before a large suffix', (encoding, first, last, restored) => {
    const decoder = getDecoder(encoding);
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    input.push(Uint8Array.from(first));
    expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
    const suffix = new Uint8Array(last.length + 4096).fill(0x41);
    suffix.set(last);
    input.push(suffix);
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('');
    const expected = new Uint8Array(restored.length + 4096).fill(0x41);
    expected.set(restored);
    expect(input.takeBytes()).toEqual(expected);
  });

  it.each([
    ['EUC-JP', 'あ', [0xa4, 0xa2]],
    ['EUC-KR', '가', [0xb0, 0xa1]],
    ['ISO-2022-JP', 'あ', [0x24, 0x22]],
  ] as const)('%s fills output across repeated mappings and expanding references', (encoding, text, pair) => {
    for (const count of [16, 32, 256, 2048, 2049, 8192]) {
      for (const mode of ['fatal', 'html'] as const) {
        const encoder = getEncoder(encoding);
        const input = new IOQueue<string>();
        const output = new IOQueue<Uint8Array>();
        input.push(text.repeat(count));
        expect(encoder.encode(input, output, mode)).toBe('waiting');
        const prefix = output.takeBytes();
        const expected = Uint8Array.from({ length: count * 2 }, (_, i) => pair[i % 2]!);
        expect(prefix).toEqual(encoding === 'ISO-2022-JP'
          ? Uint8Array.of(0x1b, 0x24, 0x42, ...expected) : expected);

        input.push('\u{10ffff}Z');
        input.push(endOfQueue);
        if (mode === 'fatal') {
          expect(encoder.encode(input, output, mode)).toEqual({ error: 0x10ffff });
          expect(output.takeBytes()).toEqual(encoding === 'ISO-2022-JP'
            ? Uint8Array.of(0x1b, 0x28, 0x42) : new Uint8Array());
          expect(encoder.encode(input, output, mode)).toBe('finished');
          expect(output.takeBytes()).toEqual(Uint8Array.of(0x5a));
        } else {
          expect(encoder.encode(input, output, mode)).toBe('finished');
          expect(output.takeBytes()).toEqual(Uint8Array.from(
            (encoding === 'ISO-2022-JP' ? '\x1b(B' : '') + '&#1114111;Z', (c) => c.charCodeAt(0),
          ));
        }
        expect(output.readAvailable()).toBe(endOfQueue);
      }
    }
  });
});
