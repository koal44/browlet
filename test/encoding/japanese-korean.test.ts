import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { decode, encode, encodeOrFail, getDecoder, getEncoder } from '../../src/encoding/encodings';
import { endOfQueue, IOQueue, processQueue } from '../../src/encoding/io-queue';
import { createRuntime } from '../js-engine/runtime-fixture';
import { japaneseKoreanDigests } from './gen/japanese-korean-vectors';

const encodings = ['EUC-JP', 'ISO-2022-JP', 'Shift_JIS', 'EUC-KR'] as const;
type JapaneseKoreanEncoding = typeof encodings[number];
type Mapping = JapaneseKoreanEncoding | 'EUC-JP JIS0212';
const mappings: Mapping[] = [...encodings, 'EUC-JP JIS0212'];

describe('Encoding §§12–13: Japanese and Korean codecs', () => {
  it.each(mappings)('decodes every %s pointer according to the published index', (name) => {
    const encoding = name === 'EUC-JP JIS0212' ? 'EUC-JP' : name;
    const bytes = mappingBytes(name);
    for (const size of [bytes.length, 1, 7, 257]) {
      expect(hash(decodeChunks(encoding, bytes, size)), `chunk size ${size}`).toBe(japaneseKoreanDigests[name]);
    }
  });

  it.each(encodings)('encodes the complete %s repertoire using the preferred pointers', (encoding) => {
    // The source digest above independently verifies the decoded mapping.
    const bytes = mappingBytes(encoding);
    const mapping = new Map<string, number[]>();
    const start = encoding === 'ISO-2022-JP' ? 3 : 0;
    const end = bytes.length - start;
    for (let i = start; i < end; i += 2) {
      const pointer = (i - start) / 2;
      if (encoding === 'Shift_JIS' && pointer >= 8272 && pointer <= 10715) continue;
      const pair = [...bytes.subarray(i, i + 2)];
      const input = encoding === 'ISO-2022-JP' ? [0x1b, 0x24, 0x42, ...pair] : pair;
      const point = decode(Uint8Array.from(input), encoding);
      if ([...point].length !== 1 || point === '\ufffd') continue;
      if (!mapping.has(point)) mapping.set(point, pair);
    }
    const expected = [...mapping.values()].flat();
    if (encoding === 'ISO-2022-JP') {
      expected.unshift(0x1b, 0x24, 0x42);
      expected.push(0x1b, 0x28, 0x42);
    }
    const output = new IOQueue<Uint8Array>();
    expect(getEncoder(encoding).encode(IOQueue.from([...mapping.keys()].join('')), output, 'fatal')).toBe('finished');
    expect(output.takeBytes()).toEqual(Uint8Array.from(expected));
    expect(output.readAvailable()).toBe(endOfQueue);
  });

  it.each([
    ['EUC-JP', [0xc6, 0xfc, 0xcb, 0xdc], '日本'],
    ['EUC-JP', [0x8e, 0xa1, 0x8e, 0xdf], '｡ﾟ'],
    ['EUC-JP', [0x8f, 0xa2, 0xaf], '\u02d8'],
    ['EUC-JP', [0x8f, 0xb0, 0xa1], '\u4e02'],
    ['EUC-JP', [0x8f, 0xa2, 0x22, 0xa4, 0xa2], '\ufffd"あ'],
    ['EUC-JP', [0x8e, 0xe0, 0x41], '\ufffdA'],
    ['EUC-JP', [0x8f, 0x22, 0x41], '\ufffd"A'],
    ['EUC-JP', [0x8f], '\ufffd'], ['EUC-JP', [0x8f, 0xa2], '\ufffd'],
    ['Shift_JIS', [0x93, 0xfa, 0x96, 0x7b], '日本'],
    ['Shift_JIS', [0x80, 0xa1, 0xdf], '\u0080｡ﾟ'],
    ['Shift_JIS', [0xf0, 0x40, 0xf9, 0xfc], '\ue000\ue757'],
    ['Shift_JIS', [0x82, 0x22, 0x41], '\ufffd"A'],
    ['Shift_JIS', [0x82, 0x7f], '\ufffd\x7f'],
    ['Shift_JIS', [0x82, 0xff, 0x41], '\ufffdA'], ['Shift_JIS', [0x82], '\ufffd'],
    ['EUC-KR', [0xc7, 0xd1, 0xb1, 0xdb], '한글'],
    ['EUC-KR', [0x81, 0x41], '갂'],
    ['EUC-KR', [0x81, 0x22, 0x41], '\ufffd"A'],
    ['EUC-KR', [0x81, 0x5b, 0x41], '\ufffd[A'],
    ['EUC-KR', [0x81, 0xff, 0x41], '\ufffdA'], ['EUC-KR', [0x81], '\ufffd'],
  ] as const)('%s decodes %j at every partition', (encoding, bytes, expected) => {
    checkPartitions(encoding, [...bytes], expected);
  });

  it('uses Japanese encoder aliases without extending their repertoires', () => {
    expect(encode('¥‾−｡ﾟ', 'EUC-JP')).toEqual(Uint8Array.of(0x5c, 0x7e, 0xa1, 0xdd, 0x8e, 0xa1, 0x8e, 0xdf));
    expect(encode('¥‾−\u0080｡ﾟ', 'Shift_JIS')).toEqual(Uint8Array.of(0x5c, 0x7e, 0x81, 0x7c, 0x80, 0xa1, 0xdf));
    expect(Buffer.from(encode('\u4e02\u02d8', 'EUC-JP')).toString('latin1')).toBe('&#19970;&#728;');
    expect(Buffer.from(encode('\ue000\ue757', 'Shift_JIS')).toString('latin1')).toBe('&#57344;&#59223;');
  });

  it.each(encodings)('%s appends supplied output and preserves unread input on a fatal encoding error', (encoding) => {
    const encoder = getEncoder(encoding);
    const input = IOQueue.from('A😀日本');
    const output = new IOQueue<Uint8Array>();
    output.push(Uint8Array.of(0x3e));
    expect(encoder.encode(input, output, 'fatal')).toEqual({ error: 0x1f600 });
    expect([...output.takeBytes()]).toEqual([0x3e, 0x41]);
    expect(output.readAvailable()).toBeUndefined();
    expect(input.peek(2)).toEqual([0x65e5, 0x672c]);
    const rest = new IOQueue<Uint8Array>();
    expect(encoder.encode(input, rest, 'fatal')).toBe('finished');
    expect(decode(rest.takeBytes(), encoding)).toBe('日本');
  });

  it.each(encodings)('%s supports scalar chunks and HTML expansion across output blocks', (encoding) => {
    const input = new IOQueue<string>();
    input.push('日本');
    input.push('😀%80\0'.repeat(2000));
    input.push(endOfQueue);
    const output = new IOQueue<Uint8Array>();
    expect(getEncoder(encoding).encode(input, output, 'html')).toBe('finished');
    expect(decode(output.takeBytes(), encoding)).toBe('日本' + '&#128512;%80\0'.repeat(2000));
    const ascii = 'abc\0'.repeat(20000);
    expect(decode(encode(ascii, encoding), encoding)).toBe(ascii);
  });

  it.each([
    ['EUC-JP', [0x41, 0x8f, 0xa2], [0x22, 0xa4, 0xa2], '"あ'],
    ['Shift_JIS', [0x41, 0x82], [0x22, 0x82, 0xa0], '"あ'],
    ['EUC-KR', [0x41, 0x81], [0x5b, 0x81, 0x41], '[갂'],
  ] as const)('%s retains the prefix and restored ASCII on fatal decoding', (encoding, first, second, remaining) => {
    const decoder = getDecoder(encoding);
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    input.push(Uint8Array.from(first));
    expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
    input.push(Uint8Array.from(second));
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('A');
    expect(output.readAvailable()).toBeUndefined();
    input.push(endOfQueue);
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe(remaining);
  });
});

describe('Encoding §12.2: ISO-2022-JP modes and recovery', () => {
  it.each([
    [[0x1b, 0x28, 0x42], ''],
    [[0x1b, 0x28, 0x4a, 0x5c, 0x7e], '¥‾'],
    [[0x1b, 0x28, 0x49, 0x21, 0x5f], '｡ﾟ'],
    [[0x1b, 0x24, 0x40, 0x24, 0x22], 'あ'],
    [[0x1b, 0x24, 0x42, 0x24, 0x22], 'あ'],
    [[0x1b, 0x28, 0x42, 0x1b, 0x28, 0x4a, 0x5c], '\ufffd¥'],
    [[0x1b, 0x28, 0x42, 0x41, 0x1b, 0x28, 0x42], 'A'],
    [[0x0e, 0x0f, 0x80, 0x41], '\ufffd\ufffd\ufffdA'],
    [[0x1b, 0x24, 0x42, 0x24, 0x0a, 0x24, 0x22], '\ufffdあ'],
    [[0x1b, 0x24, 0x42, 0x24, 0x1b, 0x28, 0x42, 0x41], '\ufffdA'],
    [[0x1b, 0x41], '\ufffdA'], [[0x1b, 0x24, 0x41], '\ufffd$A'],
    [[0x1b], '\ufffd'], [[0x1b, 0x24], '\ufffd$'],
    [[0x1b, 0x24, 0x42, 0x24], '\ufffd'],
    [[0x1b, 0x24, 0x42, 0x1b, 0x24], '\ufffd\ufffd'],
  ] as const)('decodes %j at every partition', (bytes, expected) => {
    checkPartitions('ISO-2022-JP', [...bytes], expected);
  });

  it('uses Roman and JIS0208 modes, returning to ASCII only when required', () => {
    const text = '¥A‾\\~ああ−ｶﾞ';
    const expected = Uint8Array.of(
      0x1b, 0x28, 0x4a, 0x5c, 0x41, 0x7e, 0x1b, 0x28, 0x42, 0x5c, 0x7e,
      0x1b, 0x24, 0x42, 0x24, 0x22, 0x24, 0x22, 0x21, 0x5d, 0x25, 0x2b, 0x21, 0x2b,
      0x1b, 0x28, 0x42,
    );
    const points = [...text];
    for (let split = 0; split <= points.length; split++) {
      const encoder = getEncoder('ISO-2022-JP');
      const input = new IOQueue<string>();
      const output = new IOQueue<Uint8Array>();
      input.push(points.slice(0, split).join(''));
      expect(encoder.encode(input, output, 'fatal')).toBe('waiting');
      const prefix = output.takeBytes();
      input.push(points.slice(split).join(''));
      input.push(endOfQueue);
      expect(encoder.encode(input, output, 'fatal')).toBe('finished');
      expect(Uint8Array.from([...prefix, ...output.takeBytes()])).toEqual(expected);
    }
    expect(decode(expected, 'ISO-2022-JP')).toBe('¥A‾\\~ああ－カ゛');
  });

  it('maps every half-width katakana through the published encoder table', () => {
    const text = String.fromCodePoint(...Array.from({ length: 63 }, (_, i) => 0xff61 + i));
    expect(hash(decode(encode(text, 'ISO-2022-JP'), 'ISO-2022-JP'))).toBe(japaneseKoreanDigests['ISO-2022-JP katakana']);
  });

  it('preserves the specified error when concatenating independent encoded outputs', () => {
    const bytes = encode('¥', 'ISO-2022-JP');
    expect([...bytes]).toEqual([0x1b, 0x28, 0x4a, 0x5c, 0x1b, 0x28, 0x42]);
    expect(decode(Uint8Array.from([...bytes, ...bytes]), 'ISO-2022-JP')).toBe('¥\ufffd¥');
    expect(decode(encode('¥¥', 'ISO-2022-JP'), 'ISO-2022-JP')).toBe('¥¥');
  });

  it.each(['', '¥', 'あ'])('reports U+FFFD for forbidden controls after %j, including in HTML references', (prefix) => {
    for (const control of ['\x0e', '\x0f', '\x1b']) {
      const input = IOQueue.from(prefix + control + 'Z');
      const output = new IOQueue<Uint8Array>();
      const encoder = getEncoder('ISO-2022-JP');
      expect(encoder.encode(input, output, 'fatal')).toEqual({ error: 0xfffd });
      expect(input.takeString()).toBe('Z');
      expect(output.readAvailable()).not.toBe(endOfQueue);
      const encoded = encode(prefix + control + 'Z', 'ISO-2022-JP');
      expect(decode(encoded, 'ISO-2022-JP')).toBe(prefix + '&#65533;Z');
    }
  });

  it.each(['¥', 'あ'])('retains the correct mode when encodeOrFail stops after %s', async (prefix) => {
    const encoder = getEncoder('ISO-2022-JP');
    const input = IOQueue.from(prefix + '😀' + prefix);
    const output = new IOQueue<Uint8Array>();
    const completed: unknown[] = [];
    encodeOrFail(input, encoder, output, createRuntime())
      .observe((value) => { completed.push(value); }, (error) => { completed.push(error); });
    await nextTurn();
    expect(completed).toEqual([0x1f600]);
    const first = output.takeBytes();
    expect([...first]).toEqual(prefix === '¥' ? [0x1b, 0x28, 0x4a, 0x5c] :
      [0x1b, 0x24, 0x42, 0x24, 0x22, 0x1b, 0x28, 0x42]);
    expect(output.readAvailable()).toBe(endOfQueue);
    // The caller supplies a replacement, then resumes the same encoder.
    input.restore('&#128512;');
    const rest = new IOQueue<Uint8Array>();
    expect(encoder.encode(input, rest, 'fatal')).toBe('finished');
    const bytes = Uint8Array.from([...first, ...rest.takeBytes()]);
    expect(bytes).toEqual(encode(prefix + '😀' + prefix, 'ISO-2022-JP'));
    expect(decode(bytes, 'ISO-2022-JP')).toBe(prefix + '&#128512;' + prefix);
  });

  it('restores a split invalid escape in front of unread input on fatal error', () => {
    const decoder = getDecoder('ISO-2022-JP');
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    input.push(Uint8Array.of(0x41, 0x1b, 0x24));
    expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
    input.push(Uint8Array.of(0x58, 0x42));
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('A');
    expect(input.peek(3)).toEqual([0x24, 0x58, 0x42]);
    input.push(endOfQueue);
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('$XB');
  });

  it('restores an incomplete escape at EOF and can consume the restored JIS lead', () => {
    const decoder = getDecoder('ISO-2022-JP');
    const input = IOQueue.from(Uint8Array.of(0x1b, 0x24, 0x42, 0x1b, 0x24));
    const output = new IOQueue<string>();
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(input.peek(1)).toEqual([0x24]);
    input.push(Uint8Array.of(0x22));
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('あ');
  });

  it('adopts a repeated escape mode before returning its fatal error', () => {
    const decoder = getDecoder('ISO-2022-JP');
    const input = IOQueue.from(Uint8Array.of(0x1b, 0x24, 0x42, 0x1b, 0x28, 0x4a, 0x5c));
    const output = new IOQueue<string>();
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe('¥');
  });

  it('emits output before an open input ends, without resetting modes between chunks', async () => {
    const encoder = getEncoder('ISO-2022-JP');
    const input = new IOQueue<string>();
    const output = new IOQueue<Uint8Array>();
    const completed: unknown[] = [];
    processQueue(input, () => encoder.encode(input, output, 'fatal'), createRuntime())
      .observe((value) => { completed.push(value); }, (error) => { completed.push(error); });
    input.push('¥');
    await nextTurn();
    expect([...output.takeBytes()]).toEqual([0x1b, 0x28, 0x4a, 0x5c]);
    input.push('¥');
    await nextTurn();
    expect([...output.takeBytes()]).toEqual([0x5c]);
    expect(completed).toEqual([]);
    input.push(endOfQueue);
    await nextTurn();
    expect([...output.takeBytes()]).toEqual([0x1b, 0x28, 0x42]);
    expect(completed).toEqual(['finished']);
    expect(output.readAvailable()).toBe(endOfQueue);
  });
});

function mappingBytes(name: Mapping): Uint8Array {
  const bytes: number[] = [];
  if (name === 'EUC-JP' || name === 'EUC-JP JIS0212' || name === 'ISO-2022-JP') {
    const base = name === 'ISO-2022-JP' ? 0x21 : 0xa1;
    if (name === 'ISO-2022-JP') bytes.push(0x1b, 0x24, 0x42);
    for (let pointer = 0; pointer < 94 * 94; pointer++) {
      if (name === 'EUC-JP JIS0212') bytes.push(0x8f);
      bytes.push(Math.floor(pointer / 94) + base, pointer % 94 + base);
    }
    if (name === 'ISO-2022-JP') bytes.push(0x1b, 0x28, 0x42);
  } else if (name === 'Shift_JIS') {
    for (let pointer = 0; pointer < 60 * 188; pointer++) {
      const leading = Math.floor(pointer / 188);
      const trailing = pointer % 188;
      bytes.push(leading + (leading < 31 ? 0x81 : 0xc1), trailing + (trailing < 63 ? 0x40 : 0x41));
    }
  } else {
    for (let pointer = 0; pointer < 126 * 190; pointer++) bytes.push(Math.floor(pointer / 190) + 0x81, pointer % 190 + 0x41);
  }
  return Uint8Array.from(bytes);
}

function decodeChunks(encoding: JapaneseKoreanEncoding, bytes: Uint8Array, size: number): string {
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

function checkPartitions(encoding: JapaneseKoreanEncoding, bytes: number[], expected: string): void {
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
    expect(output.takeString(), `partition ${mask}`).toBe('prefix:' + expected);
  }
}

function hash(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf16le')).digest('hex');
}
