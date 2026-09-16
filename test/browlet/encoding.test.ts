import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Browlet } from '../../src/browlet/browlet';
import { singleByteDecodeDigests } from '../encoding/gen/single-byte-vectors';
import {
  observeBrowletPromise, performTestMicrotaskCheckpoint,
} from './test-runtime';

describe('Encoding projection', () => {
  it('decodes labels, options, and streaming input', () => {
    const window = createWindow();
    const TextDecoder_ = requireFunction(window, 'TextDecoder');
    const decoder = Reflect.construct(TextDecoder_, [
      'utf-8',
      { fatal: true, ignoreBOM: true },
    ]) as object;

    expect(Reflect.get(decoder, 'encoding')).toBe('utf-8');
    expect(Reflect.get(decoder, 'fatal')).toBe(true);
    expect(Reflect.get(decoder, 'ignoreBOM')).toBe(true);
    expect(call(decoder, 'decode', [Uint8Array.of(0xF0, 0x9F), {
      stream: true,
    }])).toBe('');
    expect(call(decoder, 'decode', [Uint8Array.of(0x98, 0x80)]))
      .toBe('😀');
  });

  it('throws decoding errors in the relevant realm', () => {
    const window = createWindow();
    const decoder = Reflect.construct(
      requireFunction(window, 'TextDecoder'),
      ['utf-8', { fatal: true }],
    ) as object;

    expect(() => call(decoder, 'decode', [Uint8Array.of(0xFF)]))
      .toThrow(requireFunction(window, 'TypeError'));
  });

  it.each(Object.entries(singleByteDecodeDigests))('decodes every %s byte through the public API', (label, digest) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label]) as object;
    const text = call(decoder, 'decode', [Uint8Array.from({ length: 256 }, (_, i) => i)]) as string;
    expect(createHash('sha256').update(Buffer.from(text, 'utf16le')).digest('hex')).toBe(digest);
    expect(Reflect.get(decoder, 'encoding')).toBe(label.toLowerCase());
    expect(Reflect.get(decoder, 'fatal')).toBe(false);
    expect(Reflect.get(decoder, 'ignoreBOM')).toBe(false);
  });

  it.each([
    ['gb2312', 'gbk', [0x94, 0x39, 0xfc, 0x36], '😀'],
    ['gb18030', 'gb18030', [0x94, 0x39, 0xfc, 0x36], '😀'],
    ['big5-hkscs', 'big5', [0x88, 0x62], '\u00ca\u0304'],
  ] as const)('decodes %s across chunks, flushes, and resets the decoder', (label, name, bytes, expected) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label]) as object;
    expect(Reflect.get(decoder, 'encoding')).toBe(name);
    for (let run = 0; run < 2; run++) {
      let text = '';
      for (const byte of bytes) text += call(decoder, 'decode', [Uint8Array.of(byte), { stream: true }]) as string;
      expect(text).toBe(expected);
      expect(call(decoder, 'decode', [Uint8Array.of(0x81), { stream: true }])).toBe('');
      expect(call(decoder, 'decode')).toBe('\ufffd');
      expect(call(decoder, 'decode', [Uint8Array.of(0x41)])).toBe('A');
    }
  });

  it.each([
    ['utf-8', [0xe2, 0x82], [0xac], '€'],
    ['utf-16le', [0x3d, 0xd8, 0], [0xde], '😀'],
    ['utf-16be', [0xd8, 0x3d, 0xde], [0], '😀'],
    ['gb18030', [0x81, 0x30, 0x81], [0x30], '\u0080'],
    ['gbk', [0xd6], [0xd0], '中'],
    ['big5', [0xa4], [0x40], '一'],
    ['euc-jp', [0xa4], [0xa2], 'あ'],
    ['iso-2022-jp', [0x1b, 0x24], [0x42, 0x24, 0x22, 0x1b, 0x28, 0x42], 'あ'],
    ['shift_jis', [0x82], [0xa0], 'あ'],
    ['euc-kr', [0xb0], [0xa1], '가'],
  ] as const)('%s retains incomplete characters independently of consumed input', (label, prefix, suffix, expected) => {
    const window = createWindow();
    for (const shared of [false, true]) {
      const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label]) as object;
      const buffer = shared ? new SharedArrayBuffer(prefix.length) : new ArrayBuffer(prefix.length);
      const input = new Uint8Array(buffer);
      input.set(prefix);
      expect(call(decoder, 'decode', [input, { stream: true }])).toBe('');
      input.fill(0);
      expect(call(decoder, 'decode', [Uint8Array.from(suffix)])).toBe(expected);
    }
  });

  it.each([false, true])('decodes the actual bytes of a shadowed view (shared=%s)', (shared) => {
    const window = createWindow();
    const buffer = shared ? new SharedArrayBuffer(5) : new ArrayBuffer(5);
    new Uint8Array(buffer).set([0, 0x61, 0xc3, 0xa9, 0]);
    for (const input of [new Uint8Array(buffer, 1, 3), new DataView(buffer, 1, 3)]) {
      for (const key of ['buffer', 'byteOffset', 'byteLength', 'length']) {
        Object.defineProperty(input, key, { get() { throw new Error(`read shadowed ${key}`); } });
      }
      const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), []) as object;
      expect(call(decoder, 'decode', [input])).toBe('aé');
    }
  });

  it.each(['gbk', 'gb18030', 'big5'])('%s realizes fatal errors in the decoder realm and resets after flush', (label) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label, { fatal: true }]) as object;
    expect(call(decoder, 'decode', [Uint8Array.of(0x81), { stream: true }])).toBe('');
    expect(() => call(decoder, 'decode')).toThrow(requireFunction(window, 'TypeError'));
    expect(call(decoder, 'decode', [Uint8Array.of(0x41)])).toBe('A');
    expect(() => call(decoder, 'decode', [Uint8Array.of(0xff)])).toThrow(requireFunction(window, 'TypeError'));
    expect(call(decoder, 'decode', [Uint8Array.of(0x42)])).toBe('B');
  });

  it('does not strip a GB18030-encoded BOM or confuse it with UTF-8 BOM sniffing', () => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), ['gb18030']) as object;
    expect(call(decoder, 'decode', [Uint8Array.of(0x84, 0x31, 0x95, 0x33, 0x41)])).toBe('\ufeffA');
  });

  it.each([
    ['gbk', [0x81, 0x30, 0x81, 0x22, 0x41], '"A'],
    ['gb18030', [0x81, 0x30, 0x22, 0x41], '0"A'],
    ['big5', [0x81, 0x40, 0x41], '@A'],
  ] as const)('%s retains copied input and restored bytes after a fatal streaming error', (label, bytes, suffix) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label, { fatal: true }]) as object;
    const input = Uint8Array.from(bytes);
    expect(() => call(decoder, 'decode', [input, { stream: true }])).toThrow(requireFunction(window, 'TypeError'));
    input.fill(0);
    if (label === 'gbk') {
      // The restored sequence contains a second malformed lead. It must
      // throw again, then retain the ASCII suffix rather than dropping it.
      expect(() => call(decoder, 'decode', [undefined, { stream: true }])).toThrow(requireFunction(window, 'TypeError'));
    }
    expect(call(decoder, 'decode')).toBe(suffix);
  });

  it.each([
    ['gbk', [0x94, 0x39, 0xfc, 0x36, 0x81, 0x30], '😀\ufffd'],
    ['gb18030', [0x94, 0x39, 0xfc, 0x36, 0x81, 0x30], '😀\ufffd'],
    ['big5', [0x88, 0x62, 0x81], '\u00ca\u0304\ufffd'],
  ] as const)('streams %s through bindings and flushes an incomplete final sequence', async (label, bytes, expected) => {
    const browlet = new Browlet({ route: () => '' });
    const completion = browlet.evaluate(async ({ label, bytes }) => {
      const stream = new TextDecoderStream(label);
      const reader = stream.readable.getReader();
      const writer = stream.writable.getWriter();
      const reading = (async () => {
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return text;
          text += value;
        }
      })();
      for (const byte of bytes) await writer.write(Uint8Array.of(byte));
      await writer.close();
      return await reading;
    }, { label, bytes });
    await expect(completion).resolves.toBe(expected);
  });

  it.each([
    ['x-euc-jp', 'euc-jp', [0xc6, 0xfc, 0xcb, 0xdc, 0x8f, 0xa2, 0xaf], '日本˘'],
    ['csiso2022jp', 'iso-2022-jp', [0x1b, 0x28, 0x4a, 0x5c, 0x1b, 0x24, 0x42, 0x24, 0x22], '¥あ'],
    ['windows-31j', 'shift_jis', [0x93, 0xfa, 0x96, 0x7b, 0x80], '日本\u0080'],
    ['windows-949', 'euc-kr', [0xc7, 0xd1, 0xb1, 0xdb, 0x81, 0x41], '한글갂'],
  ] as const)('decodes %s through the public API at every byte split', (label, name, bytes, expected) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label]) as object;
    expect(Reflect.get(decoder, 'encoding')).toBe(name);
    for (let split = 0; split <= bytes.length; split++) {
      const first = call(decoder, 'decode', [Uint8Array.from(bytes.slice(0, split)), { stream: true }]) as string;
      const rest = call(decoder, 'decode', [Uint8Array.from(bytes.slice(split))]) as string;
      expect(first + rest).toBe(expected);
      expect(call(decoder, 'decode', [Uint8Array.of(0x41)])).toBe('A');
    }
  });

  it.each([
    ['euc-jp', [0x8f, 0xa2]], ['iso-2022-jp', [0x1b, 0x24, 0x42, 0x24]],
    ['shift_jis', [0x82]], ['euc-kr', [0x81]],
  ] as const)('%s resets its mode after a fatal flush', (label, bytes) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label, { fatal: true }]) as object;
    expect(call(decoder, 'decode', [Uint8Array.from(bytes), { stream: true }])).toBe('');
    expect(() => call(decoder, 'decode')).toThrow(requireFunction(window, 'TypeError'));
    expect(call(decoder, 'decode', [Uint8Array.of(0x41)])).toBe('A');
  });

  it.each([
    ['euc-jp', [0x8f, 0xa2, 0x22, 0x41], '"A'],
    ['iso-2022-jp', [0x1b, 0x24, 0x58, 0x41], '$XA'],
    ['shift_jis', [0x82, 0x22, 0x41], '"A'],
    ['euc-kr', [0x81, 0x5b, 0x41], '[A'],
  ] as const)('%s retains restored input after a fatal streaming error', (label, bytes, expected) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label, { fatal: true }]) as object;
    const input = Uint8Array.from(bytes);
    expect(() => call(decoder, 'decode', [input, { stream: true }])).toThrow(requireFunction(window, 'TypeError'));
    input.fill(0);
    expect(call(decoder, 'decode')).toBe(expected);
  });

  it.each([
    ['euc-jp', [0xa4, 0xa2, 0x8f, 0xa2], 'あ\ufffd'],
    ['iso-2022-jp', [0x1b, 0x24, 0x42, 0x24, 0x22, 0x1b], 'あ\ufffd'],
    ['shift_jis', [0x82, 0xa0, 0x82], 'あ\ufffd'],
    ['euc-kr', [0xc7, 0xd1, 0x81], '한\ufffd'],
  ] as const)('streams %s through bindings, including incomplete final input', async (label, bytes, expected) => {
    const browlet = new Browlet({ route: () => '' });
    const completion = browlet.evaluate(async ({ label, bytes }) => {
      const stream = new TextDecoderStream(label);
      const reader = stream.readable.getReader();
      const writer = stream.writable.getWriter();
      const reading = (async () => {
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return text;
          text += value;
        }
      })();
      for (const byte of bytes) await writer.write(Uint8Array.of(byte));
      await writer.close();
      return await reading;
    }, { label, bytes });
    await expect(completion).resolves.toBe(expected);
  });

  it.each(['UTF-16LE', 'UTF-16BE'])('%s handles split BOMs, surrogate pairs, and decoder reset', (label) => {
    const window = createWindow();
    const bytes = Buffer.from('\ufeffA😀\ufeff', 'utf16le');
    if (label === 'UTF-16BE') bytes.swap16();
    for (const ignoreBOM of [false, true]) {
      const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label, { ignoreBOM }]) as object;
      for (let run = 0; run < 2; run++) {
        let text = '';
        for (const byte of bytes) {
          text += call(decoder, 'decode', [Uint8Array.of(byte), { stream: true }]) as string;
          expect(call(decoder, 'decode', [undefined, { stream: true }])).toBe('');
        }
        text += call(decoder, 'decode') as string;
        expect(text).toBe(ignoreBOM ? '\ufeffA😀\ufeff' : 'A😀\ufeff');
      }
      // Unlike the legacy decode hook, TextDecoder does not change byte order
      // to match an opposite BOM. It decodes those code units as U+FFFE.
      const opposite = Buffer.from(bytes).swap16();
      expect((call(decoder, 'decode', [opposite]) as string).startsWith('\ufffe')).toBe(true);
    }
  });

  it.each(['UTF-16LE', 'UTF-16BE'])('%s retains copied bytes after fatal errors and resets after fatal EOF', (label) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [label, { fatal: true }]) as object;
    const bytes = Buffer.from('A\ud800BC', 'utf16le');
    if (label === 'UTF-16BE') bytes.swap16();
    expect(call(decoder, 'decode', [bytes.subarray(0, 5), { stream: true }])).toBe('A');
    expect(() => call(decoder, 'decode', [bytes.subarray(5), { stream: true }])).toThrow(requireFunction(window, 'TypeError'));
    bytes.fill(0);
    expect(call(decoder, 'decode')).toBe('BC');
    expect(call(decoder, 'decode', [Uint8Array.of(0), { stream: true }])).toBe('');
    expect(() => call(decoder, 'decode')).toThrow(requireFunction(window, 'TypeError'));
    const valid = label === 'UTF-16LE' ? [0x41, 0] : [0, 0x41];
    expect(call(decoder, 'decode', [Uint8Array.from(valid)])).toBe('A');
  });

  it('supports x-user-defined through TextDecoder with either BOM policy', () => {
    const window = createWindow();
    for (const ignoreBOM of [false, true]) {
      const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), ['x-user-defined', { ignoreBOM, fatal: true }]) as object;
      expect(call(decoder, 'decode', [Uint8Array.of(0x41, 0x80, 0xff)])).toBe('A\uf780\uf7ff');
      expect(call(decoder, 'decode', [Uint8Array.of(0xff, 0xfe)])).toBe('\uf7ff\uf7fe');
    }
  });

  it.each([
    ['utf-16le', [0xff, 0xfe, 0x41, 0, 0x3d, 0xd8, 0, 0xde, 0], 'A😀\ufffd'],
    ['utf-16be', [0xfe, 0xff, 0, 0x41, 0xd8, 0x3d, 0xde, 0, 0], 'A😀\ufffd'],
    ['x-user-defined', [0x41, 0x80, 0xff], 'A\uf780\uf7ff'],
  ] as const)('streams %s through the public bindings and flushes incomplete data', async (label, bytes, expected) => {
    const browlet = new Browlet({ route: () => '' });
    const completion = browlet.evaluate(async ({ label, bytes }) => {
      const stream = new TextDecoderStream(label);
      const reader = stream.readable.getReader();
      const writer = stream.writable.getWriter();
      const reading = (async () => {
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return text;
          text += value;
        }
      })();
      for (const byte of bytes) await writer.write(Uint8Array.of(byte));
      await writer.close();
      return await reading;
    }, { label, bytes });
    await expect(completion).resolves.toBe(expected);
  });

  it.each(['utf-16le', 'utf-16be'])('%s rejects an incomplete fatal stream in the owner realm', async (label) => {
    const browlet = new Browlet({ route: () => '' });
    const completion = browlet.evaluate(async (label) => {
      const stream = new TextDecoderStream(label, { fatal: true });
      const reader = stream.readable.getReader();
      const writer = stream.writable.getWriter();
      const reading = reader.read().then(() => false, (error: unknown) => error instanceof TypeError);
      await writer.write(Uint8Array.of(0));
      const closing = writer.close().then(() => false, (error: unknown) => error instanceof TypeError);
      return [await reading, await closing];
    }, label);
    await expect(completion).resolves.toEqual([true, true]);
  });

  it.each([false, true])('handles split BOMs and resets between streams (ignoreBOM=%s)', (ignoreBOM) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), ['utf-8', { ignoreBOM }]) as object;
    const bytes = [0xef, 0xbb, 0xbf, 0x61, 0xef, 0xbb, 0xbf];
    for (let run = 0; run < 2; run++) {
      let text = '';
      for (const byte of bytes) {
        text += call(decoder, 'decode', [Uint8Array.of(byte), { stream: true }]) as string;
        expect(call(decoder, 'decode', [undefined, { stream: true }])).toBe('');
      }
      text += call(decoder, 'decode') as string;
      expect(text).toBe(ignoreBOM ? '\ufeffa\ufeff' : 'a\ufeff');
    }
  });

  it('flushes incomplete input, resets after fatal flush, and rejects replacement labels', () => {
    const window = createWindow();
    for (const fatal of [false, true]) {
      const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), ['utf-8', { fatal }]) as object;
      expect(call(decoder, 'decode', [Uint8Array.of(0xe2, 0x82), { stream: true }])).toBe('');
      if (fatal) expect(() => call(decoder, 'decode')).toThrow(requireFunction(window, 'TypeError'));
      else expect(call(decoder, 'decode')).toBe('\ufffd');
      expect(call(decoder, 'decode', [Uint8Array.of(0x61)])).toBe('a');
    }
    for (const name of ['TextDecoder', 'TextDecoderStream']) {
      for (const label of ['replacement', 'iso-2022-kr', '\u00a0utf-8']) {
        expect(() => { Reflect.construct(requireFunction(window, name), [label]); })
          .toThrow(requireFunction(window, 'RangeError'));
      }
    }
  });

  // §7.2 retains unread input after a streaming error. Chromium 149, Firefox
  // 151, and Playwright WebKit 26.5 instead returned an empty string on the
  // next decode in these cases (2026-09-11). Keep the specification expectation.
  it.each([
    ['utf-8', [0x61, 0xFF, 0x62], 'b'],
    ['utf-8', [0x61, 0xE2, 0x22, 0x62], '"b'],
    ['iso-8859-3', [0x61, 0xA5, 0x62], 'b'],
  ] as const)('retains unread %s input after a fatal streaming error', (label, bytes, remaining) => {
    const window = createWindow();
    const decoder = Reflect.construct(requireFunction(window, 'TextDecoder'), [
      label, { fatal: true },
    ]) as object;
    const input = Uint8Array.from(bytes);

    expect(() => call(decoder, 'decode', [input, { stream: true }]))
      .toThrow(requireFunction(window, 'TypeError'));
    input.fill(0);
    expect(call(decoder, 'decode')).toBe(remaining);
  });

  it('throws decoding errors in the method realm when decode is borrowed', () => {
    const receiverWindow = createWindow();
    const methodWindow = createWindow();
    const decoder = Reflect.construct(
      requireFunction(receiverWindow, 'TextDecoder'),
      ['utf-8', { fatal: true }],
    ) as object;
    const decode = Reflect.get(
      requireFunction(methodWindow, 'TextDecoder').prototype,
      'decode',
    ) as CallableFunction;

    expect(() => {
      Reflect.apply(decode, decoder, [Uint8Array.of(0xFF)]);
    }).toThrow(requireFunction(methodWindow, 'TypeError'));
  });

  it.each(['TextDecoder', 'TextDecoderStream'])(
    'throws invalid %s labels in the constructor realm',
    (name) => {
      const window = createWindow();
      expect(() => {
        Reflect.construct(requireFunction(window, name), ['not-an-encoding']);
      }).toThrow(requireFunction(window, 'RangeError'));
    },
  );

  it.each(['TextEncoderStream', 'TextDecoderStream'])(
    'aborts the writable side of %s',
    async (name) => {
      const window = createWindow();
      const stream = Reflect.construct(requireFunction(window, name), []) as object;
      const writable = requireObject(stream, 'writable');
      const aborted = observeBrowletPromise(
        window, call(writable, 'abort', ['stop']) as Promise<unknown>,
      );
      performTestMicrotaskCheckpoint(window);

      await expect(aborted).resolves.toBeUndefined();
    },
  );

  it.each(['TextDecoder', 'TextDecoderStream'])(
    'preserves author exceptions during %s argument conversion',
    (name) => {
      const window = createWindow();
      const labelError = new RangeError('label conversion');
      const optionsError = new TypeError('options conversion');
      const cases = [
        { args: [{ toString() { throw labelError; } }], reason: labelError },
        {
          args: ['utf-8', { get fatal() { throw optionsError; } }],
          reason: optionsError,
        },
      ];

      for (const { args, reason } of cases) {
        let caught: unknown;
        try {
          Reflect.construct(requireFunction(window, name), args);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBe(reason);
      }
    },
  );

  it.each(['write', 'flush'])(
    'shares one realm-owned decoder error across stream rejections during %s',
    async (phase) => {
      const { window, reader, writer } = createDecoderStream({ fatal: true });
      const read = observeBrowletPromise(
        window, call(reader, 'read') as Promise<unknown>,
      ).catch((reason: unknown) => reason);
      const write = observeBrowletPromise(
        window,
        call(writer, 'write', [
          Uint8Array.of(phase === 'write' ? 0xFF : 0xC2),
        ]) as Promise<unknown>,
      ).catch((reason: unknown) => reason);
      performTestMicrotaskCheckpoint(window);

      let completion = write;
      if (phase === 'flush') {
        await expect(write).resolves.toBeUndefined();
        completion = observeBrowletPromise(
          window, call(writer, 'close') as Promise<unknown>,
        ).catch((reason: unknown) => reason);
        performTestMicrotaskCheckpoint(window);
      }

      const reason = await read;
      expect(reason).toBeInstanceOf(requireFunction(window, 'TypeError'));
      await expect(completion).resolves.toBe(reason);
    },
  );

  it('creates realm-owned encoded bytes and writes into a destination', () => {
    const window = createWindow();
    const encoder = Reflect.construct(
      requireFunction(window, 'TextEncoder'),
      [],
    ) as object;
    const Uint8Array_ = requireFunction(window, 'Uint8Array');
    const encoded = call(encoder, 'encode', ['😀']) as object;

    expect(encoded).toBeInstanceOf(Uint8Array_);
    expect(Array.from(encoded as Uint8Array)).toEqual([240, 159, 152, 128]);

    const destination = Reflect.construct(Uint8Array_, [5]) as Uint8Array;
    const result = call(encoder, 'encodeInto', ['A😀', destination]);
    expect(result).toEqual({ read: 3, written: 5 });
    expect(Array.from(destination)).toEqual([65, 240, 159, 152, 128]);
  });

  it('fills a two-byte destination from a longer string of two-byte scalars', () => {
    const window = createWindow();
    const encoder = Reflect.construct(requireFunction(window, 'TextEncoder'), []) as object;
    const destination = Reflect.construct(requireFunction(window, 'Uint8Array'), [2]) as Uint8Array;
    expect(call(encoder, 'encodeInto', ['\u0400'.repeat(33), destination])).toEqual({ read: 1, written: 2 });
    expect(Array.from(destination)).toEqual([0xd0, 0x80]);
  });

  it('makes the same encoding progress regardless of an unread suffix', () => {
    const window = createWindow();
    const encoder = Reflect.construct(requireFunction(window, 'TextEncoder'), []) as object;
    for (const suffix of ['', '☺']) {
      const destination = Reflect.construct(requireFunction(window, 'Uint8Array'), [2]) as Uint8Array;
      expect(call(encoder, 'encodeInto', ['é'.repeat(33) + suffix, destination])).toEqual({ read: 1, written: 2 });
      expect(Array.from(destination)).toEqual([0xc3, 0xa9]);
    }
  });

  it.each([false, true])('fills remaining ASCII capacity after a surrogate pair (shared=%s)', (shared) => {
    const window = createWindow();
    const encoder = Reflect.construct(requireFunction(window, 'TextEncoder'), []) as object;
    const buffer = shared ? new SharedArrayBuffer(15) : new ArrayBuffer(15);
    const storage = new Uint8Array(buffer).fill(0xaa);
    const destination = new Uint8Array(buffer, 2, 11);
    const text = '漢漢😀A' + '漢'.repeat(28);

    expect(call(encoder, 'encodeInto', [text, destination])).toEqual({ read: 5, written: 11 });
    expect(Array.from(destination)).toEqual([0xe6, 0xbc, 0xa2, 0xe6, 0xbc, 0xa2, 0xf0, 0x9f, 0x98, 0x80, 0x41]);
    expect(Array.from(storage.subarray(0, 2))).toEqual([0xaa, 0xaa]);
    expect(Array.from(storage.subarray(13))).toEqual([0xaa, 0xaa]);
  });

  it('keeps encoded bytes in the receiver realm when encode is borrowed', () => {
    const receiverWindow = createWindow();
    const functionWindow = createWindow();
    const encoder = Reflect.construct(requireFunction(receiverWindow, 'TextEncoder'), []) as object;
    const encode = Reflect.get(requireFunction(functionWindow, 'TextEncoder').prototype, 'encode') as CallableFunction;
    const bytes = Reflect.apply(encode, encoder, ['A\uD800']) as Uint8Array;

    expect(bytes).toBeInstanceOf(requireFunction(receiverWindow, 'Uint8Array'));
    expect(bytes).not.toBeInstanceOf(requireFunction(functionWindow, 'Uint8Array'));
    expect(Array.from(bytes)).toEqual([65, 239, 191, 189]);
    expect(Reflect.apply(encode, encoder, ['A\uD800'])).not.toBe(bytes);
  });

  it.each([false, true])('writes directly into an offset destination (shared=%s)', (shared) => {
    const window = createWindow();
    const encoder = Reflect.construct(requireFunction(window, 'TextEncoder'), []) as object;
    const buffer = shared ? new SharedArrayBuffer(10) : new ArrayBuffer(10);
    const storage = new Uint8Array(buffer).fill(0xaa);
    const destination = new Uint8Array(buffer, 2, 6);
    for (const property of ['buffer', 'byteOffset', 'byteLength', 'length']) {
      Object.defineProperty(destination, property, { get() { throw new Error(`Read ${property}`); } });
    }
    expect(call(encoder, 'encodeInto', ['A😀\uD800', destination])).toEqual({ read: 3, written: 5 });
    expect(Array.from(storage)).toEqual([0xaa, 0xaa, 65, 240, 159, 152, 128, 0xaa, 0xaa, 0xaa]);
    expect(call(encoder, 'encodeInto', ['\uD800', destination])).toEqual({ read: 1, written: 3 });
    expect(Array.from(storage.subarray(2, 5))).toEqual([239, 191, 189]);
  });

  it('decodes through Browlet Transform Streams', async () => {
    const { window, reader, writer } = createDecoderStream();
    const read = observeBrowletPromise(
      window,
      call(reader, 'read') as Promise<unknown>,
    );

    const firstWrite = observeBrowletPromise(
      window,
      call(writer, 'write', [
        Uint8Array.of(0xF0, 0x9F),
      ]) as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);
    await expect(firstWrite).resolves.toBeUndefined();
    const secondWrite = observeBrowletPromise(
      window,
      call(writer, 'write', [
        Uint8Array.of(0x98, 0x80),
      ]) as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);
    await expect(secondWrite).resolves.toBeUndefined();
    await expect(read).resolves.toEqual({ done: false, value: '😀' });
  });

  it('encodes through Browlet Transform Streams', async () => {
    const window = createWindow();
    const encoder = Reflect.construct(
      requireFunction(window, 'TextEncoderStream'),
      [],
    ) as object;
    const writer = call(
      requireObject(encoder, 'writable'),
      'getWriter',
    ) as object;
    const reader = call(
      requireObject(encoder, 'readable'),
      'getReader',
    ) as object;
    const firstRead = observeBrowletPromise(
      window,
      call(reader, 'read') as Promise<{
        done: boolean;
        value: Uint8Array;
      }>,
    );

    const firstWrite = observeBrowletPromise(
      window,
      call(writer, 'write', ['A\uD83D']) as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);
    await expect(firstWrite).resolves.toBeUndefined();
    const first = await firstRead;
    expect(first.done).toBe(false);
    expect(first.value).toBeInstanceOf(requireFunction(window, 'Uint8Array'));
    expect(Array.from(first.value)).toEqual([65]);

    const secondRead = observeBrowletPromise(
      window,
      call(reader, 'read') as Promise<{
        done: boolean;
        value: Uint8Array;
      }>,
    );
    const secondWrite = observeBrowletPromise(
      window,
      call(writer, 'write', ['\uDE00']) as Promise<unknown>,
    );
    performTestMicrotaskCheckpoint(window);
    await expect(secondWrite).resolves.toBeUndefined();
    const second = await secondRead;
    expect(second.done).toBe(false);
    expect(Array.from(second.value)).toEqual([240, 159, 152, 128]);
  });

  it('creates encoded bytes in the encoder realm before downstream callbacks', async () => {
    const browlet = new Browlet({ route: () => '' });
    const completion = browlet.evaluate(async () => {
      const encoder = new TextEncoderStream();
      let seen: Uint8Array | undefined;
      let arrayInRealm = false;
      let bufferInRealm = false;
      const downstream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen = chunk;
          arrayInRealm = chunk instanceof Uint8Array;
          bufferInRealm = chunk.buffer instanceof ArrayBuffer;
          controller.enqueue(chunk);
        },
      });
      const reader = encoder.readable.pipeThrough(downstream).getReader();
      const writer = encoder.writable.getWriter();
      const read = reader.read();
      await writer.write('A');
      const first = await read;
      const end = reader.read();
      await writer.close();
      await end;
      return {
        arrayInRealm,
        bufferInRealm,
        sameChunk: first.value === seen,
        bytes: Array.from(first.value!),
      };
    });

    await expect(completion).resolves.toEqual({
      arrayInRealm: true,
      bufferInRealm: true,
      sameChunk: true,
      bytes: [65],
    });
  });
});

function createWindow(): Window {
  return new Browlet({ route: () => '' }).window;
}

function createDecoderStream(options: TextDecoderOptions = {}) {
  const window = createWindow();
  const decoder = Reflect.construct(
    requireFunction(window, 'TextDecoderStream'), ['utf-8', options],
  ) as object;
  const writer = call(requireObject(decoder, 'writable'), 'getWriter') as object;
  const reader = call(requireObject(decoder, 'readable'), 'getReader') as object;
  return { window, reader, writer };
}

function call(
  object: object,
  name: string,
  argumentsList: unknown[] = [],
): unknown {
  return Reflect.apply(requireFunction(object, name), object, argumentsList);
}

function requireFunction(object: object, name: string): CallableFunction {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  return value;
}

function requireObject(object: object, name: string): object {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${name} is not an object`);
  }
  return value;
}
