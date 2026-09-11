import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { extractHighWaterMark } from '../../../src/streams/index';
import { RangeError } from '../../../src/js-engine/simple-exception';

describe('Streams queuing strategies', () => {
  it('extracts high-water marks and requests internal RangeErrors', () => {
    expect(extractHighWaterMark({}, 1)).toBe(1);
    expect(extractHighWaterMark({ highWaterMark: 0 }, 1)).toBe(0);
    expect(extractHighWaterMark({ highWaterMark: Infinity }, 1)).toBe(Infinity);
    expect(() => extractHighWaterMark({ highWaterMark: -1 }, 1))
      .toThrow(RangeError);
    expect(() => extractHighWaterMark({ highWaterMark: NaN }, 1))
      .toThrow(RangeError);
  });

  it('installs the strategy interfaces on Window', () => {
    const window = createBrowlet().window;

    expect(Reflect.get(window, 'ByteLengthQueuingStrategy')).toEqual(
      expect.any(Function),
    );
    expect(Reflect.get(window, 'CountQueuingStrategy')).toEqual(
      expect.any(Function),
    );
  });

  it('measures byte lengths through the public interface', () => {
    const window = createBrowlet().window;
    const Strategy = getConstructor(window, 'ByteLengthQueuingStrategy');
    const strategy = Reflect.construct(
      Strategy,
      [{ highWaterMark: 16 }],
    ) as unknown as object;

    expect(Reflect.get(strategy, 'highWaterMark')).toBe(16);
    const size = Reflect.get(strategy, 'size') as CallableFunction;
    expect(Reflect.apply(size, undefined, [new Uint8Array(7)])).toBe(7);
    expect(size.length).toBe(1);
    expect(size.name).toBe('size');
    expect(Reflect.has(size, 'prototype')).toBe(false);
    expect(() => {
      Reflect.construct(size, []);
    }).toThrow();
  });

  it('counts chunks through the public interface', () => {
    const window = createBrowlet().window;
    const Strategy = getConstructor(window, 'CountQueuingStrategy');
    const strategy = Reflect.construct(
      Strategy,
      [{ highWaterMark: 3 }],
    ) as unknown as object;

    expect(Reflect.get(strategy, 'highWaterMark')).toBe(3);
    const size = Reflect.get(strategy, 'size') as CallableFunction;
    expect(Reflect.apply(size, undefined, ['chunk'])).toBe(1);
    expect(size.length).toBe(0);
    expect(size.name).toBe('size');
  });

  it('reads primitive byteLength in the receiver realm even when its getter is borrowed first', () => {
    const firstWindow = createBrowlet().window;
    const secondWindow = createBrowlet().window;
    const FirstStrategy = getConstructor(firstWindow, 'ByteLengthQueuingStrategy');
    const SecondStrategy = getConstructor(secondWindow, 'ByteLengthQueuingStrategy');
    const first = Reflect.construct(FirstStrategy, [{ highWaterMark: 1 }]) as object;
    const second = Reflect.construct(SecondStrategy, [{ highWaterMark: 1 }]) as object;
    const getter = Reflect.getOwnPropertyDescriptor(SecondStrategy.prototype as object, 'size')?.get;
    if (!getter) throw new Error('Missing size getter');
    const firstSize = Reflect.apply(getter, first, []) as CallableFunction;
    const secondSize = Reflect.get(second, 'size') as CallableFunction;
    Object.defineProperty(Reflect.get(getConstructor(firstWindow, 'Number'), 'prototype'), 'byteLength', {
      get(this: unknown) {
        expect(this).toBe(7);
        return 19;
      },
    });
    Object.defineProperty(Reflect.get(getConstructor(secondWindow, 'Number'), 'prototype'), 'byteLength', {
      get(this: unknown) {
        expect(this).toBe(7);
        return 23;
      },
    });

    expect(Reflect.apply(firstSize, undefined, [7])).toBe(19);
    expect(Reflect.apply(secondSize, undefined, [7])).toBe(23);
    expect(Reflect.get(first, 'size')).toBe(firstSize);
    expect(() => {
      Reflect.apply(firstSize, undefined, [null]);
    }).toThrow(getConstructor(firstWindow, 'TypeError'));
    expect(() => {
      Reflect.apply(secondSize, undefined, [undefined]);
    }).toThrow(getConstructor(secondWindow, 'TypeError'));
  });

  it.each(['ByteLengthQueuingStrategy', 'CountQueuingStrategy'])(
    '%s keeps the receiver realm size function when its getter is borrowed', (name) => {
      const firstWindow = createBrowlet().window;
      const secondWindow = createBrowlet().window;
      const FirstStrategy = getConstructor(
        firstWindow,
        name,
      );
      const SecondStrategy = getConstructor(
        secondWindow,
        name,
      );
      const first = Reflect.construct(
        FirstStrategy,
        [{ highWaterMark: 1 }],
      ) as unknown as object;
      const sameRealm = Reflect.construct(
        FirstStrategy,
        [{ highWaterMark: 2 }],
      ) as unknown as object;
      const otherRealm = Reflect.construct(
        SecondStrategy,
        [{ highWaterMark: 1 }],
      ) as unknown as object;

      expect(Reflect.get(first, 'size')).toBe(Reflect.get(sameRealm, 'size'));
      expect(Reflect.get(first, 'size')).not.toBe(Reflect.get(otherRealm, 'size'));
      const getter = Reflect.getOwnPropertyDescriptor(
        Reflect.get(SecondStrategy, 'prototype') as object,
        'size',
      )?.get;
      if (!getter) throw new Error('Missing size getter');
      const size = Reflect.apply(getter, first, []) as object;
      expect(size).toBe(Reflect.get(first, 'size'));
      expect(Object.getPrototypeOf(size)).toBe(
        Reflect.get(getConstructor(firstWindow, 'Function'), 'prototype'),
      );
    },
  );

  it('requires the initialization dictionary and its high water mark', () => {
    const window = createBrowlet().window;
    const Strategy = getConstructor(window, 'CountQueuingStrategy');

    expect(() => {
      Reflect.construct(Strategy, []);
    }).toThrow();
    expect(() => {
      Reflect.construct(Strategy, [{}]);
    }).toThrow();
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function getConstructor(window: Window, name: string): CallableFunction {
  const constructor = Reflect.get(window, name) as unknown;
  if (typeof constructor !== 'function') {
    throw new TypeError(`${name} is not installed`);
  }
  return constructor;
}
