import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';

describe('Streams queuing strategies', () => {
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

  it('reuses size functions within a realm but not across realms', () => {
    const firstWindow = createBrowlet().window;
    const secondWindow = createBrowlet().window;
    const FirstStrategy = getConstructor(
      firstWindow,
      'ByteLengthQueuingStrategy',
    );
    const SecondStrategy = getConstructor(
      secondWindow,
      'ByteLengthQueuingStrategy',
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
  });

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
