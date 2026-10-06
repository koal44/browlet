import { createEnvironment } from '../js-engine/execution-fixture';
import { observe } from '../browlet/streams/implementation-fixture';
import { assert, describe, expect, it, vi } from 'vitest';

import { TextEncoderStreamImpl } from '../../src/encoding/text-encoder-stream';
import { TestRealm } from '../support/web-idl-realm';
import { getBufferSourceCopy, isUint8Array } from '../../src/js-engine/buffers';

describe('TextEncoderStream byte production', () => {
  it.each([
    [123, '123'],
    [null, 'null'],
    [undefined, 'undefined'],
    [true, 'true'],
  ])('coerces %s to a DOMString', async (chunk, expected) => {
    const { reader, writer, env } = createEncoder();
    const read = observe(reader.read(env));
    await observe(writer.write(chunk, env));
    expect(copyBytes((await read).value)).toEqual(new TextEncoder().encode(expected));
    await observe(writer.close());
  });

  it('converts at transformation time with the string hint and original receiver', async () => {
    const { reader, writer, env } = createEncoder();
    const convert = vi.fn(function(this: object, hint: string) {
      expect(this).toBe(chunk);
      expect(hint).toBe('string');
      return 'A';
    });
    const chunk = { [Symbol.toPrimitive]: convert };
    const write = writer.write(chunk, env);
    await Promise.resolve();
    expect(convert).not.toHaveBeenCalled();

    const read = observe(reader.read(env));
    await observe(write);
    expect(copyBytes((await read).value)).toEqual(Uint8Array.of(65));
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
    const { reader, writer, realm, env } = createEncoder();
    const failure = observe(reader.read(env)).catch((error: unknown) => error);
    const writing = observe(writer.write(chunk, env)).catch((error: unknown) => error);
    const error = await writing;
    expect(error).toMatchObject({ name: 'TypeError' });
    expect(error).toBeInstanceOf(realm.intrinsics.typeError);
    expect(await failure).toBe(error);
  });

  it('preserves an exception thrown by author conversion', async () => {
    const { reader, writer, env } = createEncoder();
    const error = new TypeError('author failure');
    const failure = observe(reader.read(env)).catch((reason: unknown) => reason);
    await expect(observe(writer.write({ toString() { throw error; } }, env))).rejects.toBe(error);
    expect(await failure).toBe(error);
  });

  it('rejoins split surrogate pairs and keeps earlier chunk storage independent', async () => {
    const { reader, writer, env } = createEncoder();
    const firstRead = observe(reader.read(env));
    await observe(writer.write('A\uD83D', env));
    const first = await firstRead;
    expect(first.done).toBe(false);
    expect(copyBytes(first.value)).toEqual(Uint8Array.of(65));

    const secondRead = observe(reader.read(env));
    await observe(writer.write('\uDE00', env));
    const second = await secondRead;
    expect(second.done).toBe(false);
    expect(copyBytes(second.value)).toEqual(Uint8Array.of(240, 159, 152, 128));

    assert(isUint8Array(first.value));
    first.value.fill(0);
    expect(copyBytes(second.value)).toEqual(Uint8Array.of(240, 159, 152, 128));
    await observe(writer.close());
    expect(await observe(reader.read(env))).toEqual({ done: true, value: undefined });
  });

  it('flushes a trailing surrogate into replacement-character bytes', async () => {
    const { reader, writer, env } = createEncoder();
    const read = observe(reader.read(env));
    await observe(writer.write('\uD83D', env));
    await observe(writer.close());

    const result = await read;
    expect(result.done).toBe(false);
    expect(copyBytes(result.value)).toEqual(Uint8Array.of(239, 191, 189));
    expect(await observe(reader.read(env))).toEqual({ done: true, value: undefined });
  });

  it.each([
    [['\uD83D', '', '\uDE00'], '😀'],
    [['\uD83D', '', 'A'], '\ufffdA'],
    [['\uDC00', '\uD800', '\uD800', '\uDC00'], '\ufffd\ufffd\u{10000}'],
    [['A\uD800', ''], 'A\ufffd'],
  ] as const)('encodes code-unit chunks %j with replacement and flush handling', async (chunks, text) => {
    const { reader, writer, env } = createEncoder();
    const bytes: number[] = [];
    const reading = (async () => {
      for (;;) {
        const result = await observe(reader.read(env));
        if (result.done) return;
        bytes.push(...copyBytes(result.value));
      }
    })();
    for (const chunk of chunks) await observe(writer.write(chunk, env));
    await observe(writer.close());
    await reading;
    expect(bytes).toEqual(Array.from(new TextEncoder().encode(text)));
  });
});

function createEncoder() {
  const realm = new TestRealm();
  const env = createEnvironment(realm);
  const encoder = new TextEncoderStreamImpl(env);
  return { realm, env, reader: encoder.readable.getReader(), writer: encoder.writable.getWriter() };
}

function copyBytes(value: unknown): Uint8Array {
  assert(isUint8Array(value));
  return getBufferSourceCopy(value);
}
