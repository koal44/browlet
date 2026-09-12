import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import type { Encoding } from '../../src/encoding/encodings';
import { endOfQueue, IOQueue, processQueue } from '../../src/encoding/io-queue';
import { getSingleByteCodec } from '../../src/encoding/codecs/single-byte';
import { createRuntime } from '../js-engine/runtime-fixture';
import { singleByteDecodeDigests } from './gen/single-byte-vectors';

const encodings = Object.keys(singleByteDecodeDigests) as (keyof typeof singleByteDecodeDigests)[];

describe('Encoding §9: shared single-byte codec', () => {
  it.each(encodings)('decodes every byte according to the normative %s index', (encoding) => {
    const input = Uint8Array.from({ length: 256 }, (_, byte) => byte);
    const output = new IOQueue<string>();
    const codec = getSingleByteCodec(encoding)!;
    expect(codec.decode(IOQueue.from(input), output)).toBe('finished');
    const decoded = output.takeString();
    const digest = createHash('sha256').update(Buffer.from(decoded, 'utf16le')).digest('hex');
    expect(digest).toBe(singleByteDecodeDigests[encoding]);
    expect(output.readAvailable()).toBe(endOfQueue);

    const repeated = Uint8Array.from({ length: 4096 }, (_, byte) => byte & 255);
    const repeatedOutput = new IOQueue<string>();
    expect(codec.decode(IOQueue.from(repeated), repeatedOutput)).toBe('finished');
    expect(repeatedOutput.takeString()).toBe(decoded.repeat(16));
    expect(repeatedOutput.readAvailable()).toBe(endOfQueue);
  });

  it.each(encodings)('encodes every mapped scalar to its first %s byte', (encoding) => {
    const codec = getSingleByteCodec(encoding)!;
    const decoded = new IOQueue<string>();
    codec.decode(IOQueue.from(Uint8Array.from({ length: 256 }, (_, byte) => byte)), decoded);
    // The preceding digest test checks this complete mapping independently.
    // Round-trip only mapped values; U+FFFD represents a missing pointer.
    const mapping = decoded.takeString();
    const points = [...new Set(mapping)].filter((point) => point !== '\ufffd').join('');
    const output = new IOQueue<Uint8Array>();
    expect(codec.encode(IOQueue.from(points), output)).toBe('finished');
    expect(output.takeBytes()).toEqual(Uint8Array.from(points, (point) => mapping.indexOf(point)));
  });

  it.each(['UTF-8', 'UTF-16LE', 'replacement', 'Big5', 'x-user-defined'] satisfies Encoding[])(
    'leaves %s for another codec family', (encoding) => { expect(getSingleByteCodec(encoding)).toBeNull(); },
  );

  it('appends to an existing output and preserves a byte view offset', () => {
    const input = Uint8Array.of(0x11, 0x41, 0x80, 0xe9, 0x22).subarray(1, 4);
    const output = IOQueue.from('prefix:');
    expect(getSingleByteCodec('windows-1252')!.decode(IOQueue.from(input), output)).toBe('finished');
    expect(output.takeString()).toBe('prefix:A€é');
    expect(input).toEqual(Uint8Array.of(0x41, 0x80, 0xe9));
  });

  it('accepts byte chunks from another realm', () => {
    const bytes = runInNewContext('Uint8Array.of(0, 65, 0x80).subarray(1)') as Uint8Array;
    const input = new IOQueue<Uint8Array>();
    input.push(bytes);
    input.push(Uint8Array.of(0, 0x42));
    input.push(Uint8Array.of(0xe9));
    input.push(endOfQueue);
    const output = new IOQueue<string>();
    getSingleByteCodec('windows-1252')!.decode(input, output);
    expect(output.takeString()).toBe('A€\0Bé');
  });

  it('produces the same output at every byte split, including replacement errors', () => {
    const bytes = Uint8Array.of(0, 0x41, 0xa5, 0xa9, 0xff);
    const codec = getSingleByteCodec('ISO-8859-3')!;
    for (let split = 0; split <= bytes.length; split++) {
      const input = new IOQueue<Uint8Array>();
      const output = new IOQueue<string>();
      input.push(bytes.subarray(0, split));
      expect(codec.decode(input, output)).toBe('waiting');
      const prefix = output.takeString();
      expect(output.readAvailable()).toBeUndefined();
      input.push(bytes.subarray(split));
      input.push(endOfQueue);
      expect(codec.decode(input, output)).toBe('finished');
      expect(prefix + output.takeString()).toBe('\0A\ufffdİ˙');
    }
  });

  it('preserves partial output and unread input when fatal decoding fails', () => {
    const input = IOQueue.from(Uint8Array.of(0x41, 0xa5, 0x42));
    input.push(Uint8Array.of(0x43));
    const output = new IOQueue<string>();
    expect(getSingleByteCodec('ISO-8859-3')!.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('A');
    expect(output.readAvailable()).toBeUndefined();
    expect(input.takeBytes()).toEqual(Uint8Array.of(0x42, 0x43));
  });

  it('keeps replacement and fatal decoding independent while resuming shared offset input', () => {
    const block = Uint8Array.of(0x41, 0xa5, 0xa9, 0xa5, 0x42, 0);
    const bytes = new Uint8Array(new SharedArrayBuffer(block.length * 512 + 2), 1, block.length * 512);
    for (let offset = 0; offset < bytes.length; offset += block.length) bytes.set(block, offset);
    const original = bytes.slice();
    const expected = 'A\ufffdİ\ufffdB\0'.repeat(512);
    const input = IOQueue.from(bytes);
    const output = new IOQueue<string>();
    const codec = getSingleByteCodec('ISO-8859-3')!;

    expect(codec.decode(input, output, 'fatal')).toEqual({ error: null });
    expect(output.takeString()).toBe('A');
    expect(output.readAvailable()).toBeUndefined();

    const separateOutput = new IOQueue<string>();
    expect(codec.decode(IOQueue.from(bytes), separateOutput)).toBe('finished');
    expect(separateOutput.takeString()).toBe(expected);

    expect(codec.decode(input, output)).toBe('finished');
    expect(output.takeString()).toBe(expected.slice(2));
    expect(output.readAvailable()).toBe(endOfQueue);

    const fatalOutput = new IOQueue<string>();
    expect(codec.decode(IOQueue.from(bytes), fatalOutput, 'fatal')).toEqual({ error: null });
    expect(fatalOutput.takeString()).toBe('A');
    expect(bytes).toEqual(original);
  });

  it('reports the offending scalar and restores the correct suffix on an encoding error', () => {
    const input = IOQueue.from('a€💩é');
    const output = new IOQueue<Uint8Array>();
    expect(getSingleByteCodec('windows-1252')!.encode(input, output)).toEqual({ error: 0x1f4a9 });
    expect(output.takeBytes()).toEqual(Uint8Array.of(0x61, 0x80));
    expect(output.readAvailable()).toBeUndefined();
    expect(input.takeString()).toBe('é');
  });

  it('emits HTML references directly at every scalar split without interpreting literal escapes', () => {
    const points = [...'é💩%80\0漢'];
    const codec = getSingleByteCodec('windows-1252')!;
    for (let split = 0; split <= points.length; split++) {
      const input = new IOQueue<string>();
      const output = IOQueue.from(Uint8Array.of(0x3e));
      input.push(points.slice(0, split).join(''));
      expect(codec.encode(input, output, 'html')).toBe('waiting');
      input.push(points.slice(split).join(''));
      input.push(endOfQueue);
      expect(codec.encode(input, output, 'html')).toBe('finished');
      expect(Buffer.from(output.takeBytes()).toString('latin1')).toBe('>é&#128169;%80\0&#28450;');
    }
  });

  it('handles scalar chunks and output expansion across many blocks', () => {
    const input = new IOQueue<string>();
    input.push('💩€');
    input.push('漢'.repeat(9000));
    input.push(endOfQueue);
    const output = new IOQueue<Uint8Array>();
    getSingleByteCodec('windows-1252')!.encode(input, output, 'html');
    expect(Buffer.from(output.takeBytes()).toString('latin1')).toBe(`&#128169;\x80${'&#28450;'.repeat(9000)}`);
  });

  it('decodes and encodes large ASCII chunks including NUL', () => {
    const text = 'abc\0'.repeat(20000);
    const codec = getSingleByteCodec('windows-1252')!;
    const bytes = new IOQueue<Uint8Array>();
    codec.encode(IOQueue.from(text), bytes);
    const output = new IOQueue<string>();
    codec.decode(bytes, output);
    expect(output.takeString()).toBe(text);
  });

  it('allows output consumption before streaming input finishes', async () => {
    const input = new IOQueue<Uint8Array>();
    const output = new IOQueue<string>();
    const codec = getSingleByteCodec('windows-1252')!;
    const completed: unknown[] = [];
    processQueue(input, () => codec.decode(input, output), createRuntime())
      .observe((value) => { completed.push(value); }, (error) => { completed.push(error); });
    input.push(Uint8Array.of(0x41, 0x80));
    await nextTurn();
    expect(output.takeString()).toBe('A€');
    expect(output.readAvailable()).toBeUndefined();
    expect(completed).toEqual([]);
    input.push(Uint8Array.of(0xe9));
    await nextTurn();
    expect(output.takeString()).toBe('é');
    expect(completed).toEqual([]);
    input.push(endOfQueue);
    await nextTurn();
    expect(completed).toEqual(['finished']);
    expect(output.readAvailable()).toBe(endOfQueue);
  });

  it('stops streaming processing at a fatal error without awaiting end of input', async () => {
    const input = new IOQueue<string>();
    const output = new IOQueue<Uint8Array>();
    const completed: unknown[] = [];
    const codec = getSingleByteCodec('windows-1252')!;
    processQueue(input, () => codec.encode(input, output), createRuntime())
      .observe((value) => { completed.push(value); }, (error) => { completed.push(error); });
    input.push('a💩b');
    await nextTurn();
    expect(completed).toEqual([{ error: 0x1f4a9 }]);
    expect(output.takeBytes()).toEqual(Uint8Array.of(0x61));
    expect(output.readAvailable()).toBeUndefined();
    expect(input.takeString()).toBe('b');
  });
});
