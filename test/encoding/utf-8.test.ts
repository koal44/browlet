import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { setImmediate as nextTurn } from 'node:timers/promises';
import {
  utf8Decode, utf8DecodeWithoutBOM, utf8DecodeWithoutBOMOrFail, utf8Encode,
  UTF8Decoder, UTF8Encoder, utf8EncodeInto, utf8DecodeQueue,
  utf8DecodeWithoutBOMQueue, utf8DecodeWithoutBOMOrFailQueue, utf8EncodeQueue,
} from '../../src/encoding/codecs/utf-8';
import { endOfQueue, IOQueue } from '../../src/encoding/io-queue';
import { createRuntime } from '../js-engine/runtime-fixture';

describe('Encoding Standard UTF-8 hooks', () => {
  it('encodes and decodes scalar values', () => {
    expect(Array.from(utf8Encode('A😀')))
      .toEqual([65, 240, 159, 152, 128]);
    expect(utf8Decode(Uint8Array.of(65, 240, 159, 152, 128)))
      .toBe('A😀');
  });

  it('distinguishes BOM handling', () => {
    const bytes = Uint8Array.of(0xEF, 0xBB, 0xBF, 65);
    expect(utf8Decode(bytes)).toBe('A');
    expect(utf8DecodeWithoutBOM(bytes)).toBe('\uFEFFA');
  });

  it('returns failure for malformed input in fatal mode', () => {
    expect(utf8DecodeWithoutBOMOrFail(Uint8Array.of(0xFF))).toBeNull();
    expect(utf8DecodeWithoutBOMOrFail(Uint8Array.of(65))).toBe('A');
  });

  it('replaces malformed prefixes without hiding following ASCII (§2)', () => {
    expect(utf8DecodeWithoutBOM(Uint8Array.of(0x61, 0xe2, 0x22, 0x62))).toBe('a\ufffd"b');
    expect(utf8DecodeWithoutBOMOrFail(Uint8Array.of(0x61, 0xe2, 0x22, 0x62))).toBeNull();
  });

  it('removes only one initial BOM and preserves a BOM in fatal identifier decoding', () => {
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61);
    expect(utf8Decode(bytes)).toBe('\ufeffa');
    expect(utf8DecodeWithoutBOM(bytes)).toBe('\ufeff\ufeffa');
    expect(utf8DecodeWithoutBOMOrFail(bytes)).toBe('\ufeff\ufeffa');
  });

  it.each(['ordinary', 'shared'])('limits complete decoding to the supplied %s byte view', (kind) => {
    const storage = kind === 'shared' ? new SharedArrayBuffer(12) : new ArrayBuffer(12);
    const bytes = new Uint8Array(storage).fill(0xff);
    bytes.set([0xef, 0xbb, 0xbf, 0x61, 0xf0, 0x9f], 3);
    const original = bytes.slice();
    const view = bytes.subarray(3, 9);
    expect(utf8Decode(view)).toBe('a\ufffd');
    expect(utf8DecodeWithoutBOM(view)).toBe('\ufeffa\ufffd');
    expect(utf8DecodeWithoutBOMOrFail(view)).toBeNull();
    expect(utf8DecodeWithoutBOMOrFail(view.subarray(0, 4))).toBe('\ufeffa');
    for (const decode of [utf8Decode, utf8DecodeWithoutBOM, utf8DecodeWithoutBOMOrFail]) {
      expect(decode(view.subarray(0, 0))).toBe('');
    }
    expect(bytes).toEqual(original);
  });

  it('treats a transferred-away byte view as an empty input sequence', () => {
    const bytes = Uint8Array.of(0x61);
    bytes.buffer.transfer();
    for (const decode of [utf8Decode, utf8DecodeWithoutBOM, utf8DecodeWithoutBOMOrFail]) {
      expect(decode(bytes)).toBe('');
    }
  });
});

describe('Encoding §8: native UTF-8', () => {
  it.each([
    [[0, 0x7f, 0xc2, 0x80, 0xdf, 0xbf], '\0\x7f\u0080\u07ff'],
    [[0xe0, 0xa0, 0x80, 0xed, 0x9f, 0xbf], '\u0800\ud7ff'],
    [[0xee, 0x80, 0x80, 0xef, 0xbf, 0xbf], '\ue000\uffff'],
    [[0xf0, 0x90, 0x80, 0x80, 0xf4, 0x8f, 0xbf, 0xbf], '\u{10000}\u{10ffff}'],
    [[0xc0, 0xaf], '\ufffd\ufffd'],
    [[0x80, 0xff], '\ufffd\ufffd'],
    [[0xe0, 0x80, 0x80], '\ufffd\ufffd\ufffd'],
    [[0xed, 0xa0, 0x80], '\ufffd\ufffd\ufffd'],
    [[0xf0, 0x80, 0x80, 0x80], '\ufffd\ufffd\ufffd\ufffd'],
    [[0xf4, 0x90, 0x80, 0x80], '\ufffd\ufffd\ufffd\ufffd'],
    [[0xf5, 0x80, 0x80, 0x80], '\ufffd\ufffd\ufffd\ufffd'],
    [[0xc2], '\ufffd'],
    [[0xe2, 0x82], '\ufffd'],
    [[0xf0, 0x9f, 0x92], '\ufffd'],
    [[0xe2, 0x82, 0x22, 0x61], '\ufffd"a'],
    [[0xf0, 0xe2, 0x82, 0xac], '\ufffd€'],
  ] as const)('decodes %j identically across every chunk partition', (bytes, expected) => {
    for (let partition = 0; partition < 2 ** (bytes.length - 1); partition++) {
      const decoder = new UTF8Decoder();
      const input = new IOQueue<Uint8Array>();
      const output = new IOQueue<string>();
      let start = 0;
      let text = '';
      for (let end = 1; end <= bytes.length; end++) {
        if (end !== bytes.length && (partition & (1 << (end - 1))) === 0) continue;
        input.push(Uint8Array.from(bytes.slice(start, end)));
        expect(decoder.decode(input, output)).toBe('waiting');
        text += output.takeString();
        start = end;
      }
      input.push(endOfQueue);
      expect(decoder.decode(input, output)).toBe('finished');
      expect(text + output.takeString()).toBe(expected);
      expect(output.readAvailable()).toBe(endOfQueue);
    }
  });

  it('matches native UTF-8 bytes and round trips every Unicode scalar', () => {
    for (let start = 0; start < 0x110000; start += 4096) {
      const points = Array.from({ length: 4096 }, (_, i) => start + i)
        .filter((point) => point < 0xd800 || point > 0xdfff);
      const text = String.fromCodePoint(...points);
      const bytes = utf8Encode(text);
      expect(Buffer.from(bytes).equals(Buffer.from(text, 'utf8'))).toBe(true);
      expect(bytes.buffer.byteLength).toBe(bytes.byteLength);
      expect(utf8DecodeWithoutBOMOrFail(bytes)).toBe(text);
      const output = new IOQueue<Uint8Array>();
      expect(new UTF8Encoder().encode(IOQueue.from(text), output)).toBe('finished');
      expect(Buffer.from(output.takeBytes()).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it.each(['replacement', 'fatal'] as const)('emits the complete middle between split characters in %s mode', (mode) => {
    const middle = 'A日本\ufeff'.repeat(256);
    for (const character of ['é', '€', '😀']) {
      const scalar = Buffer.from(character);
      const bytes = Buffer.from(character + middle + character);
      for (let split = 1; split < scalar.length; split++) {
        const decoder = new UTF8Decoder();
        const input = new IOQueue<Uint8Array>();
        const output = new IOQueue<string>();
        input.push(bytes.subarray(0, split));
        expect(decoder.decode(input, output, mode)).toBe('waiting');
        expect(output.takeString()).toBe('');
        const tail = bytes.length - scalar.length + split;
        input.push(bytes.subarray(split, tail));
        expect(decoder.decode(input, output, mode)).toBe('waiting');
        expect(output.takeString()).toBe(character + middle);
        input.push(bytes.subarray(tail));
        input.push(endOfQueue);
        expect(decoder.decode(input, output, mode)).toBe('finished');
        expect(output.takeString()).toBe(character);
        expect(output.readAvailable()).toBe(endOfQueue);
      }
    }
  });

  it.each([
    [[0xe0, 0x80, 0x80], '\ufffd\ufffd\ufffd'],
    [[0xed, 0xa0, 0x80], '\ufffd\ufffd\ufffd'],
    [[0xf4, 0x90, 0x80, 0x80], '\ufffd\ufffd\ufffd\ufffd'],
    [[0xe2, 0x22], '\ufffd"'],
    [[0xf0, 0xe2, 0x82, 0xac], '\ufffd€'],
  ] as const)('replaces malformed middle %j while retaining an incomplete final character', (bad, replacement) => {
    const decoder = new UTF8Decoder();
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    const prefix = 'A日本'.repeat(64);
    const suffix = 'Bé'.repeat(64);
    input.push(Buffer.concat([Buffer.from(prefix), Buffer.from(bad), Buffer.from(suffix), Buffer.from([0xe2, 0x82])]));
    expect(decoder.decode(input, output)).toBe('waiting');
    expect(output.takeString()).toBe(prefix + replacement + suffix);
    input.push(Uint8Array.of(0xac));
    input.push(endOfQueue);
    expect(decoder.decode(input, output)).toBe('finished');
    expect(output.takeString()).toBe('€');
  });

  it('never writes a partial scalar and counts UTF-16 code units', () => {
    const text = 'A\u0080\u0800😀Z';
    const oracle = new TextEncoder();
    for (let length = 0; length < 15; length++) {
      const actual = new Uint8Array(length).fill(0xaa);
      const expected = new Uint8Array(length).fill(0xaa);
      expect(utf8EncodeInto(text, actual)).toEqual(oracle.encodeInto(text, expected));
      expect(actual).toEqual(expected);
    }
  });

  it.each([1, 128])('retains fatal prefix output and restores a non-continuation byte before %i following bytes', (length) => {
    const decoder = new UTF8Decoder();
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    const suffix = '"' + 'b'.repeat(length);
    input.push(Uint8Array.of(0x61, 0xe2));
    expect(decoder.decode(input, output, 'fatal')).toBe('waiting');
    input.push(Buffer.from(suffix));
    expect(decoder.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('a');
    expect(output.readAvailable()).toBeUndefined();
    expect(input.peek(suffix.length)).toEqual([...Buffer.from(suffix)]);
    input.push(endOfQueue);
    expect(decoder.decode(input, output, 'fatal')).toBe('finished');
    expect(output.takeString()).toBe(suffix);
  });
});

describe('Encoding §6: UTF-8 queue hooks', () => {
  it('waits for a split BOM, then makes output available before completion', async () => {
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    const results: unknown[] = [];
    output.push('prefix:');
    utf8DecodeQueue(input, output, createRuntime()).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    input.push(Uint8Array.of(0xef));
    await nextTurn();
    expect(output.takeString()).toBe('prefix:');
    input.push(Uint8Array.of(0xbb));
    await nextTurn();
    expect(output.takeString()).toBe('');
    input.push(Uint8Array.of(0xbf, 0x61, 0xf0, 0x9f));
    await nextTurn();
    expect(output.takeString()).toBe('a');
    expect(results).toEqual([]);
    input.push(Uint8Array.of(0x98, 0x80));
    input.push(endOfQueue);
    await nextTurn();
    expect(results).toEqual([output]);
    expect(output.takeString()).toBe('😀');
    expect(output.readAvailable()).toBe(endOfQueue);
  });

  it.each([[[]], [[0xef]], [[0xef, 0xbb]]])('finishes a short input %j during BOM lookahead', async (bytes) => {
    const output = new IOQueue<string>();
    const results: unknown[] = [];
    utf8DecodeQueue(IOQueue.from(Uint8Array.from(bytes)), output, createRuntime()).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    await nextTurn();
    expect(results).toEqual([output]);
    expect(output.takeString()).toBe(bytes.length ? '\ufffd' : '');
  });

  it('preserves a BOM without sniffing and keeps fatal output open', async () => {
    const runtime = createRuntime();
    const output = new IOQueue<string>();
    const results: unknown[] = [];
    utf8DecodeWithoutBOMQueue(IOQueue.from(Uint8Array.of(0xef, 0xbb, 0xbf)), output, runtime).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    await nextTurn();
    expect(results).toEqual([output]);
    expect(output.takeString()).toBe('\ufeff');

    const input = IOQueue.from(Uint8Array.of(0x61, 0xff, 0x62));
    const prefix = new IOQueue<string>();
    utf8DecodeWithoutBOMOrFailQueue(input, prefix, runtime).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    await nextTurn();
    expect(results).toEqual([output, null]);
    expect(prefix.takeString()).toBe('a');
    expect(prefix.readAvailable()).toBeUndefined();
    expect(input.takeList()).toEqual([0x62]);
  });

  it('encodes scalar chunks into supplied output before input ends', async () => {
    const input = new IOQueue<string>();
    const output = new IOQueue<Uint8Array>();
    const results: unknown[] = [];
    input.push('A');
    utf8EncodeQueue(input, output, createRuntime()).observe(
      (value) => { results.push(value); }, (error) => { results.push(error); },
    );
    expect(output.takeBytes()).toEqual(Uint8Array.of(65));
    input.push('😀');
    await nextTurn();
    expect(output.takeBytes()).toEqual(Uint8Array.of(240, 159, 152, 128));
    expect(results).toEqual([]);
    input.push(endOfQueue);
    await nextTurn();
    expect(results).toEqual([output]);
    expect(output.readAvailable()).toBe(endOfQueue);
  });
});
