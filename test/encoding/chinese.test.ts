import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { decode, encode, encodeOrFail, getDecoder, getEncoder } from '../../src/encoding/encodings';
import { endOfQueue, IOQueue, processQueue } from '../../src/encoding/io-queue';
import { createRuntime } from '../js-engine/runtime-fixture';
import { chineseDecodeDigests } from './gen/chinese-vectors';

const encodings = ['GBK', 'gb18030', 'Big5'] as const;
type ChineseEncoding = typeof encodings[number];

// §10.2.2 encoder bytes, and the corresponding entries in the published
// 2022 decoding index. These deliberately are not round-trip expectations.
const compatibility = [
  [0xe78d, 0xa6d9, 0xfe10], [0xe78e, 0xa6da, 0xfe12], [0xe78f, 0xa6db, 0xfe11],
  [0xe790, 0xa6dc, 0xfe13], [0xe791, 0xa6dd, 0xfe14], [0xe792, 0xa6de, 0xfe15],
  [0xe793, 0xa6df, 0xfe16], [0xe794, 0xa6ec, 0xfe17], [0xe795, 0xa6ed, 0xfe18],
  [0xe796, 0xa6f3, 0xfe19], [0xe81e, 0xfe59, 0x9fb4], [0xe826, 0xfe61, 0x9fb5],
  [0xe82b, 0xfe66, 0x9fb6], [0xe82c, 0xfe67, 0x9fb7], [0xe832, 0xfe6d, 0x9fb8],
  [0xe843, 0xfe7e, 0x9fb9], [0xe854, 0xfe90, 0x9fba], [0xe864, 0xfea0, 0x9fbb],
] as const;

describe('Encoding §§10–11: Chinese codecs', () => {
  it.each(encodings)('decodes every %s two-byte pair against the published index', (encoding) => {
    const bytes = allPairs(encoding);
    for (const chunkSize of [bytes.length, 1, 7, 257]) {
      const text = decodeChunks(encoding, bytes, chunkSize);
      const digest = createHash('sha256').update(Buffer.from(text, 'utf16le')).digest('hex');
      expect(digest, `chunk size ${chunkSize}`).toBe(chineseDecodeDigests[encoding === 'GBK' ? 'gb18030' : encoding]);
    }
  });

  it.each(encodings)('encodes the %s two-byte repertoire using its preferred pointers', (encoding) => {
    // The preceding source digest verifies this complete decoding table.
    // Reverse that observable mapping, excluding Big5's decoder-only region.
    const mapping = new Map<string, number[]>();
    const last = new Set(['═', '╞', '╡', '╪', '十', '卅']);
    const bytes = allPairs(encoding);
    for (let i = 0; i < bytes.length; i += 2) {
      if (encoding === 'Big5' && bytes[i]! < 0xa1) continue;
      const pair = bytes.subarray(i, i + 2);
      const text = decode(pair, encoding);
      if (text === '\ufffd' || [...text].length !== 1) continue;
      if (!mapping.has(text) || encoding === 'Big5' && last.has(text)) mapping.set(text, [...pair]);
    }
    if (encoding === 'GBK') mapping.set('€', [0x80]);
    const output = new IOQueue<Uint8Array>();
    expect(getEncoder(encoding).encode(IOQueue.from([...mapping.keys()].join('')), output, 'fatal')).toBe('finished');
    expect(output.takeBytes()).toEqual(Uint8Array.from([...mapping.values()].flat()));
    expect(output.readAvailable()).toBe(endOfQueue);
  });

  it.each(['GBK', 'gb18030'] as const)('%s decodes four-byte sequences and recovers at every partition', (encoding) => {
    const cases: [number[], string][] = [
      [[0x41, 0xd6, 0xd0, 0xce, 0xc4, 0x80], 'A中文€'],
      [[0x81, 0x30, 0x81, 0x30], '\u0080'],
      [[0x94, 0x39, 0xfc, 0x36], '😀'],
      [[0x81], '\ufffd'], [[0x81, 0x30], '\ufffd'], [[0x81, 0x30, 0x81], '\ufffd'],
      [[0x81, 0x22, 0x41], '\ufffd"A'], [[0x81, 0x7f], '\ufffd\x7f'],
      [[0x81, 0xff, 0x41], '\ufffdA'], [[0xff, 0x80], '\ufffd€'],
      [[0x81, 0x30, 0x22, 0x41], '\ufffd0"A'],
      [[0x81, 0x30, 0x80, 0x41], '\ufffd0€A'],
      [[0x81, 0x30, 0x81, 0x22, 0x41], '\ufffd0\ufffd"A'],
      [[0x81, 0x30, 0x81, 0x40, 0x41], '\ufffd0丂A'],
      [[0x81, 0x30, 0x81, 0xff, 0x41], '\ufffd0\ufffdA'],
    ];
    for (const [bytes, expected] of cases) checkPartitions(encoding, bytes, expected);
  });

  it('Big5 emits two scalars or an astral scalar without losing following input', () => {
    const cases: [number[], string][] = [
      [[0xa4, 0xa4, 0xa4, 0xe5], '中文'],
      [[0x88, 0x62, 0x41], '\u00ca\u0304A'], [[0x88, 0x64, 0x41], '\u00ca\u030cA'],
      [[0x88, 0xa3, 0x41], '\u00ea\u0304A'], [[0x88, 0xa5, 0x41], '\u00ea\u030cA'],
      [[0x9c, 0x71, 0x41], '\u{20021}A'], [[0x87, 0x40], '\u43f0'],
      [[0xa4], '\ufffd'], [[0xa4, 0x22], '\ufffd"'],
      [[0x81, 0x40, 0x41], '\ufffd@A'], [[0xa4, 0x80, 0x41], '\ufffdA'],
      [[0x80, 0xff, 0x41], '\ufffd\ufffdA'],
    ];
    for (const [bytes, expected] of cases) checkPartitions('Big5', bytes, expected);
  });

  it.each([
    [0, 0x80], [7457, 0xe7c7], [39419, 0xffff], [39420, null],
    [188999, null], [189000, 0x10000], [1237575, 0x10ffff], [1237576, null], [1587599, null],
  ])('decodes GB18030 range pointer %s', (pointer, point) => {
    const bytes = fourBytes(pointer);
    checkPartitions('gb18030', bytes, point === null ? '\ufffd' : String.fromCodePoint(point));
    const output = new IOQueue<string>();
    expect(getDecoder('gb18030').decode(IOQueue.from(Uint8Array.from(bytes)), output, 'fatal'))
      .toEqual(point === null ? { error: null } : 'finished');
  });

  it.each(['GBK', 'gb18030'] as const)('%s preserves all 18 asymmetric compatibility mappings', (encoding) => {
    for (const [point, bytes, decoded] of compatibility) {
      const expected = Uint8Array.of(bytes >> 8, bytes & 0xff);
      expect(encode(String.fromCodePoint(point), encoding)).toEqual(expected);
      expect(decode(expected, encoding)).toBe(String.fromCodePoint(decoded));
    }
    expect(decode(Uint8Array.of(0xa3, 0xa0), encoding)).toBe('\u3000');
    expect(encode('\u3000', encoding)).toEqual(Uint8Array.of(0xa1, 0xa1));
    expect(Buffer.from(encode('\ue5e5', encoding)).toString('latin1')).toBe('&#58853;');
  });

  it('restricts GBK encoding while retaining GB18030 supplementary output', () => {
    expect(encode('€', 'GBK')).toEqual(Uint8Array.of(0x80));
    expect(encode('€', 'gb18030')).toEqual(Uint8Array.of(0xa2, 0xe3));
    expect(encode('😀', 'gb18030')).toEqual(Uint8Array.of(0x94, 0x39, 0xfc, 0x36));
    expect(Buffer.from(encode('😀%80', 'GBK')).toString('latin1')).toBe('&#128512;%80');
  });

  it('Big5 chooses the six last pointers and does not encode its decoder-only extensions', () => {
    expect(encode('═╞╡╪十卅', 'Big5')).toEqual(Uint8Array.of(
      0xf9, 0xf9, 0xf9, 0xe9, 0xf9, 0xeb, 0xf9, 0xea, 0xa4, 0x51, 0xa4, 0xca,
    ));
    expect(Buffer.from(encode('\u43f0\u{20021}\u00ca\u0304', 'Big5')).toString('latin1'))
      .toBe('&#17392;&#131105;&#202;&#772;');
  });

  it('round-trips every GB18030 scalar except the specified asymmetric mappings', () => {
    const excluded = new Set<number>([0xe5e5, ...compatibility.map(([point]) => point)]);
    for (let start = 0; start <= 0x10ffff; start += 4096) {
      const points: number[] = [];
      for (let point = start; point < Math.min(start + 4096, 0x110000); point++) {
        if (point >= 0xd800 && point <= 0xdfff || excluded.has(point)) continue;
        points.push(point);
      }
      const text = String.fromCodePoint(...points);
      const bytes = new IOQueue<Uint8Array>();
      expect(getEncoder('gb18030').encode(IOQueue.from(text), bytes, 'fatal')).toBe('finished');
      const output = new IOQueue<string>();
      expect(getDecoder('gb18030').decode(bytes, output, 'fatal')).toBe('finished');
      expect(output.takeString(), `scalar block ${start.toString(16)}`).toBe(text);
    }
  });

  it.each([
    ['gb18030', [0x81, 0x30], [0x22, 0x42], [0x30, 0x22, 0x42]],
    ['gb18030', [0x81, 0x30, 0x81], [0x22, 0x42], [0x30, 0x81, 0x22, 0x42]],
    ['Big5', [0x81], [0x40, 0x42], [0x40, 0x42]],
  ] as const)('%s fatal decoding preserves restored bytes from preceding chunks', (encoding, first, second, unread) => {
    const decoder = getDecoder(encoding);
    const input = new IOQueue<Uint8Array>();
    const output = IOQueue.from('prefix:');
    input.push(Uint8Array.from(first));
    expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
    input.push(Uint8Array.from(second));
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('prefix:');
    expect(input.takeBytes()).toEqual(Uint8Array.from(unread));
  });

  it.each(encodings)('%s consumes only the failing scalar and can resume into a new output', async (encoding) => {
    const encoder = getEncoder(encoding);
    const input = IOQueue.from('A\ue5e5中文');
    const output = new IOQueue<Uint8Array>();
    const completed: unknown[] = [];
    const runtime = createRuntime();
    encodeOrFail(input, encoder, output, runtime)
      .observe((value) => { completed.push(value); }, (error) => { completed.push(error); });
    await nextTurn();
    expect(completed).toEqual([0xe5e5]);
    expect(output.takeBytes()).toEqual(Uint8Array.of(0x41));
    expect(output.readAvailable()).toBe(endOfQueue);
    const remaining = new IOQueue<Uint8Array>();
    expect(encoder.encode(input, remaining, 'fatal')).toBe('finished');
    expect(decode(remaining.takeBytes(), encoding)).toBe('中文');
  });

  it.each(encodings)('%s accepts scalar chunks, foreign byte views, and bounded expanding outputs', (encoding) => {
    const input = new IOQueue<string>();
    input.push('\0A中');
    input.push('\ue5e5'.repeat(2000));
    input.push(endOfQueue);
    const output = new IOQueue<Uint8Array>();
    expect(getEncoder(encoding).encode(input, output, 'html')).toBe('finished');
    const expected = '\0A中' + '&#58853;'.repeat(2000);
    expect(decode(output.takeBytes(), encoding)).toBe(expected);
    const foreign = runInNewContext('Uint8Array.of(99, 65, 0, 66, 99).subarray(1, 4)') as Uint8Array;
    expect(decodeChunks(encoding, foreign, foreign.length)).toBe('A\0B');
    const ascii = 'abc\0'.repeat(20000);
    expect(decode(encode(ascii, encoding), encoding)).toBe(ascii);
  });

  it('makes streaming output available while a GB18030 sequence is incomplete', async () => {
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    const decoder = getDecoder('gb18030');
    const completed: unknown[] = [];
    processQueue(input, () => decoder.decode(input, output, 'replacement'), createRuntime())
      .observe((value) => { completed.push(value); }, (error) => { completed.push(error); });
    input.push(Uint8Array.of(0x41, 0x94, 0x39));
    await nextTurn();
    expect(output.takeString()).toBe('A');
    expect(completed).toEqual([]);
    input.push(Uint8Array.of(0xfc, 0x36));
    await nextTurn();
    expect(output.takeString()).toBe('😀');
    expect(completed).toEqual([]);
    input.push(endOfQueue);
    await nextTurn();
    expect(completed).toEqual(['finished']);
    expect(output.readAvailable()).toBe(endOfQueue);
  });
});

function allPairs(encoding: ChineseEncoding): Uint8Array {
  const stride = encoding === 'Big5' ? 157 : 190;
  return Uint8Array.from({ length: 126 * stride * 2 }, (_, i) => {
    const pointer = i >> 1;
    const trailing = pointer % stride;
    return i % 2 === 0 ? Math.floor(pointer / stride) + 0x81
      : trailing + (trailing < 63 ? 0x40 : encoding === 'Big5' ? 0x62 : 0x41);
  });
}

function fourBytes(pointer: number): number[] {
  return [Math.floor(pointer / 12600) + 0x81, Math.floor(pointer % 12600 / 1260) + 0x30,
    Math.floor(pointer % 1260 / 10) + 0x81, pointer % 10 + 0x30];
}

function decodeChunks(encoding: ChineseEncoding, bytes: Uint8Array, size: number): string {
  const decoder = getDecoder(encoding);
  const input = new IOQueue<Uint8Array>();
  const output = new IOQueue<string>();
  for (let offset = 0; offset < bytes.length; offset += size) {
    input.push(bytes.subarray(offset, offset + size));
    decoder.decode(input, output, 'replacement');
  }
  input.push(endOfQueue);
  expect(decoder.decode(input, output, 'replacement')).toBe('finished');
  return output.takeString();
}

function checkPartitions(encoding: ChineseEncoding, bytes: number[], expected: string): void {
  // Every boundary can independently split the input, including one-byte chunks.
  for (let mask = 0; mask < 1 << (bytes.length - 1); mask++) {
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
    expect(output.takeString(), `${encoding}: ${bytes.join(',')}, partition ${mask}`).toBe('prefix:' + expected);
  }
}
