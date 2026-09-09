import { describe, expect, it, vi } from 'vitest';

import { TextEncoderStreamImpl } from '../../src/encoding/text-encoder-stream';
import { getSimpleExceptionRequest } from '../../src/js-engine/simple-exception';
import { createAbortController } from '../browlet/streams/implementation-fixture';

describe('TextEncoderStream byte production', () => {
  it.each([
    [123, '123'],
    [null, 'null'],
    [undefined, 'undefined'],
    [true, 'true'],
  ])('coerces %s to a DOMString', async (chunk, expected) => {
    const { reader, writer } = createEncoder();
    const read = reader.read();
    await writer.write(chunk);
    expect((await read).value).toEqual(new TextEncoder().encode(expected));
    await writer.close();
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

    const read = reader.read();
    await write;
    expect((await read).value).toEqual(Uint8Array.of(65));
    expect(convert).toHaveBeenCalledOnce();
    await writer.close();
  });

  it.each([
    ['symbol', Symbol('chunk')],
    ['non-callable conversion', { [Symbol.toPrimitive]: 1 }],
    ['object conversion result', { [Symbol.toPrimitive]: () => ({}) }],
    ['symbol conversion result', { [Symbol.toPrimitive]: () => Symbol('chunk') }],
    ['no primitive result', { toString: () => ({}), valueOf: () => ({}) }],
  ])('rejects %s', async (_label, chunk) => {
    const { reader, writer } = createEncoder();
    const failure = reader.read().catch((error: unknown) => error);
    const writing = writer.write(chunk).catch((error: unknown) => error);
    const error = await writing;
    expect(error).toMatchObject({ name: 'TypeError' });
    expect(getSimpleExceptionRequest(error)?.type).toBe('typeError');
    expect(await failure).toBe(error);
  });

  it('preserves an exception thrown by author conversion', async () => {
    const { reader, writer } = createEncoder();
    const error = new TypeError('author failure');
    const failure = reader.read().catch((reason: unknown) => reason);
    await expect(writer.write({ toString() { throw error; } })).rejects.toBe(error);
    expect(await failure).toBe(error);
  });

  it('rejoins split surrogate pairs and keeps earlier chunk storage independent', async () => {
    const { reader, writer } = createEncoder();
    const firstRead = reader.read();
    await writer.write('A\uD83D');
    const first = await firstRead;
    expect(first).toEqual({ done: false, value: Uint8Array.of(65) });

    const secondRead = reader.read();
    await writer.write('\uDE00');
    const second = await secondRead;
    expect(second).toEqual({ done: false, value: Uint8Array.of(240, 159, 152, 128) });

    (first.value as Uint8Array).fill(0);
    expect(second.value).toEqual(Uint8Array.of(240, 159, 152, 128));
    await writer.close();
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });

  it('flushes a trailing surrogate into replacement-character bytes', async () => {
    const { reader, writer } = createEncoder();
    const read = reader.read();
    await writer.write('\uD83D');
    await writer.close();

    expect(await read).toEqual({ done: false, value: Uint8Array.of(239, 191, 189) });
    expect(await reader.read()).toEqual({ done: true, value: undefined });
  });
});

function createEncoder() {
  const encoder = new TextEncoderStreamImpl(createAbortController());
  return { reader: encoder.readable.getReader(), writer: encoder.writable.getWriter() };
}
