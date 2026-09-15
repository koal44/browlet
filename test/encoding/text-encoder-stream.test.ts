import { createRuntime } from '../js-engine/runtime-fixture';
import { observe } from '../browlet/streams/implementation-fixture';
import { describe, expect, it, vi } from 'vitest';

import { TextEncoderStreamImpl } from '../../src/encoding/text-encoder-stream';
import { TypeError as InternalTypeError } from '../../src/js-engine/exceptions';
import { getBufferSourceCopy } from '../../src/js-engine/buffers';

describe('TextEncoderStream byte production', () => {
  it.each([
    [123, '123'],
    [null, 'null'],
    [undefined, 'undefined'],
    [true, 'true'],
  ])('coerces %s to a DOMString', async (chunk, expected) => {
    const { reader, writer } = createEncoder();
    const read = observe(reader.read());
    await observe(writer.write(chunk));
    expect(getBufferSourceCopy((await read).value as object)).toEqual(new TextEncoder().encode(expected));
    await observe(writer.close());
  });

  it('converts at transformation time with the string hint and original receiver', async () => {
    const { reader, writer } = createEncoder();
    const convert = vi.fn(function(this: object, hint: string) {
      expect(this).toBe(chunk);
      expect(hint).toBe('string');
      return 'A';
    });
    const chunk = { [Symbol.toPrimitive]: convert };
    const write = writer.write(chunk);
    await Promise.resolve();
    expect(convert).not.toHaveBeenCalled();

    const read = observe(reader.read());
    await observe(write);
    expect(getBufferSourceCopy((await read).value as object)).toEqual(Uint8Array.of(65));
    expect(convert).toHaveBeenCalledOnce();
    await observe(writer.close());
  });

  it.each([
    ['symbol', Symbol('chunk')],
    ['non-callable conversion', { [Symbol.toPrimitive]: 1 }],
    ['object conversion result', { [Symbol.toPrimitive]: () => ({}) }],
    ['symbol conversion result', { [Symbol.toPrimitive]: () => Symbol('chunk') }],
    ['no primitive result', { toString: () => ({}), valueOf: () => ({}) }],
  ])('rejects %s', async (_label, chunk) => {
    const { reader, writer } = createEncoder();
    const failure = observe(reader.read()).catch((error: unknown) => error);
    const writing = observe(writer.write(chunk)).catch((error: unknown) => error);
    const error = await writing;
    expect(error).toMatchObject({ name: 'TypeError' });
    expect(InternalTypeError.is(error)).toBe(true);
    expect(await failure).toBe(error);
  });

  it('preserves an exception thrown by author conversion', async () => {
    const { reader, writer } = createEncoder();
    const error = new TypeError('author failure');
    const failure = observe(reader.read()).catch((reason: unknown) => reason);
    await expect(observe(writer.write({ toString() { throw error; } }))).rejects.toBe(error);
    expect(await failure).toBe(error);
  });

  it('rejoins split surrogate pairs and keeps earlier chunk storage independent', async () => {
    const { reader, writer } = createEncoder();
    const firstRead = observe(reader.read());
    await observe(writer.write('A\uD83D'));
    const first = await firstRead;
    expect(first.done).toBe(false);
    expect(getBufferSourceCopy(first.value as object)).toEqual(Uint8Array.of(65));

    const secondRead = observe(reader.read());
    await observe(writer.write('\uDE00'));
    const second = await secondRead;
    expect(second.done).toBe(false);
    expect(getBufferSourceCopy(second.value as object)).toEqual(Uint8Array.of(240, 159, 152, 128));

    (first.value as Uint8Array).fill(0);
    expect(getBufferSourceCopy(second.value as object)).toEqual(Uint8Array.of(240, 159, 152, 128));
    await observe(writer.close());
    expect(await observe(reader.read())).toEqual({ done: true, value: undefined });
  });

  it('flushes a trailing surrogate into replacement-character bytes', async () => {
    const { reader, writer } = createEncoder();
    const read = observe(reader.read());
    await observe(writer.write('\uD83D'));
    await observe(writer.close());

    const result = await read;
    expect(result.done).toBe(false);
    expect(getBufferSourceCopy(result.value as object)).toEqual(Uint8Array.of(239, 191, 189));
    expect(await observe(reader.read())).toEqual({ done: true, value: undefined });
  });

  it.each([
    [['\uD83D', '', '\uDE00'], '😀'],
    [['\uD83D', '', 'A'], '\ufffdA'],
    [['\uDC00', '\uD800', '\uD800', '\uDC00'], '\ufffd\ufffd\u{10000}'],
    [['A\uD800', ''], 'A\ufffd'],
  ] as const)('encodes code-unit chunks %j with replacement and flush handling', async (chunks, text) => {
    const { reader, writer } = createEncoder();
    const bytes: number[] = [];
    const reading = (async () => {
      for (;;) {
        const result = await observe(reader.read());
        if (result.done) return;
        bytes.push(...getBufferSourceCopy(result.value as object));
      }
    })();
    for (const chunk of chunks) await observe(writer.write(chunk));
    await observe(writer.close());
    await reading;
    expect(bytes).toEqual(Array.from(new TextEncoder().encode(text)));
  });
});

function createEncoder() {
  const encoder = new TextEncoderStreamImpl(createRuntime());
  return { reader: encoder.readable.getReader(), writer: encoder.writable.getWriter() };
}
