import { createRuntime } from '../js-engine/runtime-fixture';
import { observe } from '../browlet/streams/implementation-fixture';
import { describe, expect, it } from 'vitest';

import { TextDecoderStreamImpl } from '../../src/encoding/text-decoder-stream';
import { getSimpleExceptionRequest } from '../../src/js-engine/simple-exception';

describe('TextDecoderStream chunk conversion', () => {
  it.each([
    ['ArrayBuffer', () => Uint8Array.of(65).buffer],
    ['typed array', () => Uint8Array.of(0, 65, 0).subarray(1, 2)],
    ['DataView', () => new DataView(Uint8Array.of(0, 65, 0).buffer, 1, 1)],
    ['SharedArrayBuffer', () => {
      const buffer = new SharedArrayBuffer(1);
      new Uint8Array(buffer)[0] = 65;
      return buffer;
    }],
    ['shared view', () => {
      const view = new Uint8Array(new SharedArrayBuffer(3));
      view[1] = 65;
      return view.subarray(1, 2);
    }],
  ])('decodes a %s', async (_label, createChunk) => {
    const { reader, writer } = createDecoder();
    const read = observe(reader.read());
    await observe(writer.write(createChunk()));
    expect(await read).toEqual({ done: false, value: 'A' });
    await observe(writer.close());
    expect(await observe(reader.read())).toEqual({ done: true, value: undefined });
  });

  it.each([
    ['array', () => [65]],
    ['string', () => 'A'],
    ['undefined', () => undefined],
    ['lookalike', () => ({ buffer: new ArrayBuffer(1), byteOffset: 0, byteLength: 1 })],
    ['resizable buffer', () => new ArrayBuffer(1, { maxByteLength: 2 })],
    ['resizable view', () => new Uint8Array(new ArrayBuffer(1, { maxByteLength: 2 }))],
    ['growable shared buffer', () => new SharedArrayBuffer(1, { maxByteLength: 2 })],
    ['growable shared view', () => new Uint8Array(new SharedArrayBuffer(1, { maxByteLength: 2 }))],
  ])('rejects a %s', async (_label, createChunk) => {
    const { reader, writer } = createDecoder();
    const reading = observe(reader.read()).catch((error: unknown) => error);
    const writing = observe(writer.write(createChunk())).catch((error: unknown) => error);
    const error = await writing;
    expect(error).toMatchObject({ name: 'TypeError' });
    expect(getSimpleExceptionRequest(error)?.type).toBe('typeError');
    expect(await reading).toBe(error);
  });

  it('retains a split UTF-8 sequence while copying the consumed input', async () => {
    const { reader, writer } = createDecoder();
    const read = observe(reader.read());
    const first = Uint8Array.of(0xF0, 0x9F);
    await observe(writer.write(first));
    first.fill(0);
    await observe(writer.write(Uint8Array.of(0x98, 0x80)));
    expect(await read).toEqual({ done: false, value: '😀' });
    await observe(writer.close());
  });
});

function createDecoder() {
  const decoder = new TextDecoderStreamImpl(
    'utf-8', { fatal: false, ignoreBOM: false }, createRuntime(),
  );
  return { reader: decoder.readable.getReader(), writer: decoder.writable.getWriter() };
}
