import { describe, expect, it, vi } from 'vitest';

import { createObservableArray } from '../../../src/shared/observable-array';

describe('Web IDL observable array', () => {
  it('behaves as an Array whose indexed values come from its backing list', () => {
    const observable = createNumberArray();
    const array = observable.value;

    array.push(1, 2);

    expect(Array.isArray(array)).toBe(true);
    expect(array).toBeInstanceOf(Array);
    expect(array.constructor).toBe(Array);
    expect(array).toEqual([1, 2]);
    expect([...array]).toEqual([1, 2]);
    expect([0].concat(array)).toEqual([0, 1, 2]);
    expect(array.map((value) => value * 2)).toEqual([2, 4]);
    expect(JSON.stringify(array)).toBe('[1,2]');
    expect(Object.keys(array)).toEqual(['0', '1']);
  });

  it('runs deletion before setting when an indexed value is replaced', () => {
    const operations: string[] = [];
    const observable = createObservableArray({
      convert: Number,
      set: (value, index) => operations.push(`set ${index} ${value}`),
      delete: (value, index) => operations.push(`delete ${index} ${value}`),
    });

    observable.value.push(1);
    observable.value[0] = 2;

    expect(operations).toEqual([
      'set 0 1',
      'delete 0 1',
      'set 0 2',
    ]);
    expect(observable.value).toEqual([2]);
  });

  it('supports mutating Array methods through the indexed algorithms', () => {
    const deleted = vi.fn();
    const observable = createObservableArray({
      convert: Number,
      delete: deleted,
    });
    const array = observable.value;
    array.push(1, 3);

    array.splice(1, 0, 2);
    expect(array).toEqual([1, 2, 3]);

    array.reverse();
    expect(array).toEqual([3, 2, 1]);

    expect(array.shift()).toBe(3);
    expect(array).toEqual([2, 1]);
    expect(array.pop()).toBe(1);
    expect(array).toEqual([2]);
    expect(deleted).toHaveBeenCalled();
  });

  it('does not allow holes or length growth', () => {
    const array = createNumberArray().value;

    expect(Reflect.set(array, '1', 2)).toBe(false);
    expect(Reflect.set(array, 'length', 1)).toBe(false);
    expect(array).toHaveLength(0);

    expect(Reflect.set(array, '0', 1)).toBe(true);
    expect(Reflect.set(array, '2', 3)).toBe(false);
    expect(array).toEqual([1]);
  });

  it('only permits direct deletion of the last indexed value', () => {
    const array = createNumberArray().value;
    array.push(1, 2);

    expect(Reflect.deleteProperty(array, '0')).toBe(false);
    expect(Reflect.deleteProperty(array, '1')).toBe(true);
    expect(array).toEqual([1]);
  });

  it('shrinks through the delete algorithm and rejects invalid lengths', () => {
    const deleted: number[] = [];
    const array = createObservableArray({
      convert: Number,
      delete: (value) => deleted.push(value),
    }).value;
    array.push(1, 2, 3);

    array.length = 1;

    expect(array).toEqual([1]);
    expect(deleted).toEqual([3, 2]);
    expect(() => Reflect.set(array, 'length', 1.5)).toThrow(RangeError);
  });

  it('replaces contents without replacing the exposed Array', () => {
    const observable = createNumberArray();
    const array = observable.value;
    array.push(1);

    observable.replace(new Set(['2', '3']));

    expect(observable.value).toBe(array);
    expect(array).toEqual([2, 3]);
  });

  it('converts a whole replacement before modifying the backing list', () => {
    const observable = createObservableArray({
      convert(value) {
        if (typeof value !== 'number') throw new TypeError('Expected a number');
        return value;
      },
    });
    observable.value.push(1);

    expect(() => observable.replace([2, 'invalid']))
      .toThrow('Expected a number');
    expect(observable.value).toEqual([1]);
  });

  it('enforces the indexed and length property descriptors', () => {
    const array = createNumberArray().value;
    array.push(1);

    expect(Reflect.defineProperty(array, '0', { writable: false }))
      .toBe(false);
    expect(Reflect.defineProperty(array, 'length', { enumerable: true }))
      .toBe(false);
    expect(Object.getOwnPropertyDescriptor(array, '0')).toEqual({
      configurable: true,
      enumerable: true,
      writable: true,
      value: 1,
    });
    expect(Object.getOwnPropertyDescriptor(array, 'length')).toEqual({
      configurable: false,
      enumerable: false,
      writable: true,
      value: 1,
    });
  });

  it('cannot be made non-extensible', () => {
    const array = createNumberArray().value;

    expect(Reflect.preventExtensions(array)).toBe(false);
    expect(Object.isExtensible(array)).toBe(true);
  });

  it('forwards non-index properties to the inner Array', () => {
    const array = createNumberArray().value as number[] & { label?: string; };

    array.label = 'numbers';

    expect(array.label).toBe('numbers');
    expect(Reflect.ownKeys(array)).toEqual(['length', 'label']);
  });

  it('does not expose its backing list through Array prototype setters', () => {
    const observable = createNumberArray();
    let leakedBackingList: unknown = null;
    const captureBackingList = (value: unknown) => {
      leakedBackingList = value;
    };

    Object.defineProperty(Array.prototype, '1', {
      configurable: true,
      set() {
        captureBackingList(this);
      },
    });
    try {
      observable.replace([1, 2]);
    } finally {
      Reflect.deleteProperty(Array.prototype, '1');
    }

    expect(leakedBackingList).toBeNull();
    expect(observable.value).toEqual([1, 2]);
  });

  it('does not expose its Proxy target or handler', () => {
    const observable = createNumberArray().value;
    let leakedTarget: unknown = null;
    let leakedHandler: unknown = null;
    const captureHandler = (value: unknown) => {
      leakedHandler = value;
    };

    Object.defineProperty(Object.prototype, 'getPrototypeOf', {
      configurable: true,
      get() {
        captureHandler(this);
        return (target: unknown) => {
          leakedTarget = target;
          return null;
        };
      },
    });
    try {
      Object.getPrototypeOf(observable);
    } finally {
      Reflect.deleteProperty(Object.prototype, 'getPrototypeOf');
    }

    expect(leakedTarget).toBeNull();
    expect(leakedHandler).toBeNull();
  });
});

function createNumberArray() {
  return createObservableArray({ convert: Number });
}
