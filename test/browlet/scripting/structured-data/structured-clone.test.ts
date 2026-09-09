import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';

describe('HTML structuredClone()', () => {
  it('clones cyclic graphs while preserving repeated identity', () => {
    const browlet = createBrowlet();
    const source: Record<string, unknown> = {};
    source.self = source;
    source.repeated = [source, source];

    const clone = browlet.window.structuredClone(source);
    const repeated = clone.repeated as unknown[];

    expect(clone).not.toBe(source);
    expect(clone.self).toBe(clone);
    expect(repeated[0]).toBe(clone);
    expect(repeated[1]).toBe(clone);
  });

  it('clones Error cause through the public API with graph identity', () => {
    const browlet = createBrowlet();
    const cause: Record<string, unknown> = { marker: 'cause' };
    const error = new Error('failed', { cause });
    cause.error = error;

    const clone = browlet.window.structuredClone(error) as Error & {
      cause: Record<string, unknown>;
    };

    expect(clone).not.toBe(error);
    expect(clone.message).toBe('failed');
    expect(clone.cause.marker).toBe('cause');
    expect(clone.cause.error).toBe(clone);
  });

  it('realizes error-message conversion failures and preserves author exceptions', () => {
    const browlet = createBrowlet();
    const TypeError_ = getConstructor<typeof TypeError>(browlet, 'TypeError');
    const symbolMessage = Object.defineProperty(new Error(), 'message', {
      value: Symbol(),
    });
    expect(() => browlet.window.structuredClone(symbolMessage))
      .toThrow(TypeError_);

    const authorError = new TypeError('author conversion');
    const throwingMessage = Object.defineProperty(new Error(), 'message', {
      value: { toString() { throw authorError; } },
    });
    let caught: unknown;
    try {
      browlet.window.structuredClone(throwingMessage);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(authorError);
  });

  it('uses the receiver relevant realm when a method is borrowed', () => {
    const first = createBrowlet();
    const second = createBrowlet();
    const FirstArray = getConstructor<ArrayConstructor>(first, 'Array');
    const SecondArray = getConstructor<ArrayConstructor>(second, 'Array');
    const method = Reflect.get(
      first.window,
      'structuredClone',
    ) as CallableFunction;
    const source = new FirstArray('value');

    const clone = Reflect.apply(method, second.window, [source]) as unknown[];

    expect(clone).toBeInstanceOf(SecondArray);
    expect(clone).not.toBeInstanceOf(FirstArray);
    expect(clone).toEqual(['value']);
  });

  it('transfers ArrayBuffers and detaches the source', () => {
    const browlet = createBrowlet();
    const ArrayBuffer_ = getConstructor<ArrayBufferConstructor>(
      browlet,
      'ArrayBuffer',
    );
    const source = new ArrayBuffer_(4);

    const clone = browlet.window.structuredClone(source, {
      transfer: [source],
    });

    expect(source.byteLength).toBe(0);
    expect(clone).toBeInstanceOf(ArrayBuffer_);
    expect(clone.byteLength).toBe(4);
  });

  it('rejects duplicate transfers before detaching the source', () => {
    const browlet = createBrowlet();
    const ArrayBuffer_ = getConstructor<ArrayBufferConstructor>(
      browlet,
      'ArrayBuffer',
    );
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const source = new ArrayBuffer_(4);
    let exception: unknown;

    try {
      browlet.window.structuredClone(source, {
        transfer: [source, source],
      });
    } catch (error) {
      exception = error;
    }

    expect(exception).toBeInstanceOf(DOMException_);
    expect((exception as DOMException).name).toBe('DataCloneError');
    expect(source.byteLength).toBe(4);
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function getConstructor<TConstructor>(
  browlet: Browlet,
  name: string,
): TConstructor {
  const constructor: unknown = Reflect.get(browlet.window, name);
  if (typeof constructor !== 'function') {
    throw new Error(`${name} was not exposed`);
  }
  return constructor as TConstructor;
}
