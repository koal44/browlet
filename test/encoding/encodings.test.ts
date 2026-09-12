import { isomorphicEncode } from '../../src/js-engine/byte-string';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

import {
  type Encoding,
  bomSniff, decode, decodeQueue, encode, encodeQueue, encodeOrFail, encodeOrFailSync,
  getEncoder, getEncoding, getOutputEncoding,
} from '../../src/encoding/encodings';
import { endOfQueue, IOQueue } from '../../src/encoding/io-queue';
import { getSingleByteCodec } from '../../src/encoding/codecs/single-byte';
import { createRuntime } from '../js-engine/runtime-fixture';

const encodings: Encoding[] = [
  'UTF-8', 'IBM866',
  'ISO-8859-2', 'ISO-8859-3', 'ISO-8859-4', 'ISO-8859-5', 'ISO-8859-6',
  'ISO-8859-7', 'ISO-8859-8', 'ISO-8859-8-I', 'ISO-8859-10', 'ISO-8859-13',
  'ISO-8859-14', 'ISO-8859-15', 'ISO-8859-16', 'KOI8-R', 'KOI8-U', 'macintosh',
  'windows-874', 'windows-1250', 'windows-1251', 'windows-1252', 'windows-1253',
  'windows-1254', 'windows-1255', 'windows-1256', 'windows-1257', 'windows-1258',
  'x-mac-cyrillic', 'GBK', 'gb18030', 'Big5', 'EUC-JP', 'ISO-2022-JP',
  'Shift_JIS', 'EUC-KR', 'replacement', 'UTF-16BE', 'UTF-16LE', 'x-user-defined',
];

describe('Encoding §4.2: get an encoding', () => {
  it.each([
    ['\t\n\f\r UtF-8 \r\f\n\t', 'UTF-8'],
    ['ASCII', 'windows-1252'],
    ['latin1', 'windows-1252'],
    ['ISO-8859-1', 'windows-1252'],
    ['sHiFt_jIs', 'Shift_JIS'],
    ['logical', 'ISO-8859-8-I'],
    ['visual', 'ISO-8859-8'],
    ['utf-16', 'UTF-16LE'],
    ['iso-2022-kr', 'replacement'],
  ] satisfies [string, Encoding][])('resolves %j to %s', (label, encoding) => {
    expect(getEncoding(label)).toBe(encoding);
  });

  it.each([
    '', 'unknown-encoding', 'utf_8', 'utf 8',
    '\vutf-8', '\u00a0utf-8', 'utf-8\ufeff', '\u212Aoi8-r',
  ])('rejects %j without Unicode trimming or case folding', (label) => {
    expect(getEncoding(label)).toBeNull();
  });
});

describe('Encoding §4.3: get an output encoding', () => {
  it.each(['replacement', 'UTF-16BE', 'UTF-16LE'] as const)('uses UTF-8 for %s', (encoding) => {
    expect(getOutputEncoding(encoding)).toBe('UTF-8');
  });

  it.each(['UTF-8', 'windows-1252', 'ISO-2022-JP', 'x-user-defined'] as const)(
    'retains %s', (encoding) => { expect(getOutputEncoding(encoding)).toBe(encoding); },
  );
});

describe('Encoding §6.1: decode', () => {
  it.each([
    [[0x80, 0x81, 0xe9], '€\u0081é'],
    [[0xef, 0xbb, 0xbf, 0xc3, 0xa9], 'é'],
    [[0xff, 0xfe, 0xe9, 0], 'é'],
    [[0xfe, 0xff, 0, 0xe9], 'é'],
    [[0xef, 0xbb], 'ï»'],
  ] as const)('decodes %j, letting a complete Unicode BOM override the fallback', (bytes, text) => {
    expect(decode(Uint8Array.from(bytes), 'windows-1252')).toBe(text);
  });

  it('does not mask an ASCII quote after an invalid Shift_JIS lead byte (§2)', () => {
    expect(decode(Uint8Array.of(0x82, 0x22), 'Shift_JIS')).toBe('\ufffd"');
  });
});

describe('Encoding §6.1: BOM sniff', () => {
  it.each([
    [[0xef, 0xbb, 0xbf], 'UTF-8'], [[0xfe, 0xff], 'UTF-16BE'],
    [[0xff, 0xfe, 0x61], 'UTF-16LE'], [[], null], [[0xef, 0xbb], null],
    [[0x61, 0xef, 0xbb, 0xbf], null],
  ] as const)('sniffs %j without consuming it', (bytes, encoding) => {
    const input = IOQueue.from(Uint8Array.from(bytes));
    expect(bomSniff(input)).toBe(encoding);
    expect(input.takeList()).toEqual(bytes);
    expect(input.readAvailable()).toBe(endOfQueue);
  });

  it('waits for three bytes across chunks, or for end-of-input', () => {
    const input = new IOQueue<Uint8Array>();
    input.push(Uint8Array.of(0xef));
    expect(bomSniff(input)).toBeUndefined();
    input.push(Uint8Array.of(0xbb));
    expect(bomSniff(input)).toBeUndefined();
    input.push(Uint8Array.of(0xbf));
    expect(bomSniff(input)).toBe('UTF-8');
    expect(input.takeList()).toEqual([0xef, 0xbb, 0xbf]);

    input.push(Uint8Array.of(0xff, 0xfe));
    expect(bomSniff(input)).toBeUndefined();
    input.push(endOfQueue);
    expect(bomSniff(input)).toBe('UTF-16LE');
    expect(input.takeList()).toEqual([0xff, 0xfe]);
  });
});

describe('Encoding §6.1: encode with HTML error handling', () => {
  it.each([
    ['UTF-8', 'é💩\0', [0xc3, 0xa9, 0xf0, 0x9f, 0x92, 0xa9, 0]],
    ['windows-1252', 'é€', [0xe9, 0x80]],
    ['Shift_JIS', '日本', [0x93, 0xfa, 0x96, 0x7b]],
    ['x-user-defined', '\uf780', [0x80]],
  ] satisfies [Encoding, string, number[]][])('encodes %s', (encoding, value, bytes) => {
    expect(encode(value, encoding)).toEqual(Uint8Array.from(bytes));
  });

  it('uses decimal references without decoding literal percent escapes', () => {
    expect(encode('💩 %80 %0A %26 &#123; +\0\r\n', 'windows-1252'))
      .toEqual(isomorphicEncode('&#128169; %80 %0A %26 &#123; +\0\r\n'));
  });

  it('retains stateful encoding transitions around an unrepresentable character', () => {
    expect(encode('日💩本', 'ISO-2022-JP')).toEqual(isomorphicEncode(
      '\x1b$BF|\x1b(B&#128169;\x1b$BK\\\x1b(B',
    ));
  });

  it.each(['replacement', 'UTF-16LE', 'UTF-16BE'] as const)(
    'requires an encoding with an encoder: %s',
    (encoding) => expect(() => encode('text', encoding)).toThrow(RangeError),
  );
});

describe('Encoding §6.1: encode or fail', () => {
  it('supports immediate queues without changing the encoder lifecycle', () => {
    const input = IOQueue.from('¥😀¥');
    const encoder = getEncoder('ISO-2022-JP');
    const first = new IOQueue<Uint8Array>();
    expect(encodeOrFailSync(input, encoder, first)).toBe(0x1f600);
    expect([...first.takeBytes()]).toEqual([0x1b, 0x28, 0x4a, 0x5c]);
    expect(first.readAvailable()).toBe(endOfQueue);
    const rest = new IOQueue<Uint8Array>();
    expect(encodeOrFailSync(input, encoder, rest)).toBeNull();
    expect([...rest.takeBytes()]).toEqual([0x5c, 0x1b, 0x28, 0x42]);
    expect(rest.readAvailable()).toBe(endOfQueue);
  });
  it('ends an error output and resumes with the same encoder and unread input', async () => {
    const input = IOQueue.from('é💩€');
    const encoder = getSingleByteCodec('windows-1252')!;
    const output = new IOQueue<Uint8Array>();
    const runtime = createRuntime();
    const results: unknown[] = [];
    output.push(Uint8Array.of(0x2a));
    encodeOrFail(input, encoder, output, runtime).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    await nextTurn();
    expect(results).toEqual([0x1f4a9]);
    expect(output.takeBytes()).toEqual(Uint8Array.of(0x2a, 0xe9));
    expect(output.readAvailable()).toBe(endOfQueue);
    expect(input.peek(2)).toEqual([0x20ac]);

    const remainder = new IOQueue<Uint8Array>();
    encodeOrFail(input, encoder, remainder, runtime).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    await nextTurn();
    expect(results).toEqual([0x1f4a9, null]);
    expect(remainder.takeBytes()).toEqual(Uint8Array.of(0x80));
    expect(remainder.readAvailable()).toBe(endOfQueue);
    expect(input.readAvailable()).toBe(endOfQueue);
  });

  it('allows the supplied output to be read before streamed input finishes', async () => {
    const input = new IOQueue<string>();
    const output = new IOQueue<Uint8Array>();
    const results: unknown[] = [];
    input.push('a');
    encodeOrFail(input, getSingleByteCodec('windows-1252')!, output, createRuntime()).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    expect(output.takeBytes()).toEqual(Uint8Array.of(0x61));
    expect(output.readAvailable()).toBeUndefined();
    expect(results).toEqual([]);
    input.push('é');
    await nextTurn();
    expect(output.takeBytes()).toEqual(Uint8Array.of(0xe9));
    expect(results).toEqual([]);
    input.push(endOfQueue);
    await nextTurn();
    expect(results).toEqual([null]);
    expect(output.readAvailable()).toBe(endOfQueue);
  });
});

describe('Encoding §6.1: completed queue hooks', () => {
  it.each(encodings)('decodes %s into supplied output', async (encoding) => {
    const bytes = encoding === 'UTF-16LE' ? [0x41, 0] : encoding === 'UTF-16BE' ? [0, 0x41] : [0x41];
    const output = IOQueue.from('prefix:');
    const results: unknown[] = [];
    decodeQueue(IOQueue.from(Uint8Array.from(bytes)), encoding, output, createRuntime()).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    await nextTurn();
    expect(results).toEqual([output]);
    expect(output.takeString()).toBe('prefix:' + (encoding === 'replacement' ? '\ufffd' : 'A'));
    expect(output.readAvailable()).toBe(endOfQueue);
  });

  it.each([...new Set(encodings.map(getOutputEncoding))])(
    'encodes open %s input before completion', async (encoding) => {
      const input = new IOQueue<string>();
      const output = new IOQueue<Uint8Array>();
      output.push(Uint8Array.of(0x3e));
      const results: unknown[] = [];
      encodeQueue(input, encoding, output, createRuntime()).observe(
        (value) => { results.push(value); }, (error) => { results.push(error); },
      );
      input.push('A');
      await nextTurn();
      expect([...output.takeBytes()]).toEqual([0x3e, 0x41]);
      expect(results).toEqual([]);
      input.push(endOfQueue);
      await nextTurn();
      expect(results).toEqual([output]);
      expect(output.readAvailable()).toBe(endOfQueue);
    },
  );

  it.each([
    ['UTF-8', [0xef, 0xbb, 0xbf], [0x41], [0xc3, 0xa9]],
    ['UTF-16LE', [0xff, 0xfe], [0x41, 0], [0xe9, 0]],
    ['UTF-16BE', [0xfe, 0xff], [0, 0x41], [0, 0xe9]],
  ] as const)('sniffs a split %s BOM before falling back and exposes output before EOF', async (_encoding, bom, first, last) => {
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    const results: unknown[] = [];
    decodeQueue(input, 'replacement', output, createRuntime()).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    for (const byte of bom) {
      input.push(Uint8Array.of(byte));
      await nextTurn();
      expect(output.takeString()).toBe('');
    }
    input.push(Uint8Array.from(first));
    await nextTurn();
    expect(output.takeString()).toBe('A');
    expect(results).toEqual([]);
    input.push(Uint8Array.from(last));
    input.push(endOfQueue);
    await nextTurn();
    expect(results).toEqual([output]);
    expect(output.takeString()).toBe('é');
  });

  it('allocates default output and processes a short BOM-only input', async () => {
    const decoded: IOQueue<string>[] = [];
    const errors: unknown[] = [];
    decodeQueue(IOQueue.from(Uint8Array.of(0xff, 0xfe)), 'UTF-8', undefined, createRuntime())
      .observe((value) => { decoded.push(value); }, (error) => { errors.push(error); });
    const encoded: IOQueue<Uint8Array>[] = [];
    encodeQueue(IOQueue.from('😀'), 'x-user-defined', undefined, createRuntime())
      .observe((value) => { encoded.push(value); }, (error) => { errors.push(error); });
    await nextTurn();
    expect(errors).toEqual([]);
    expect(decoded[0]!.takeString()).toBe('');
    expect(Buffer.from(encoded[0]!.takeBytes()).toString('ascii')).toBe('&#128512;');
  });
});
