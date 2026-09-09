import { describe, expect, it } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
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
