import { assert, describe, expect, expectTypeOf, it } from 'vitest';

import * as JSEngine from '../../src/js-engine/index';

describe('Node/V8 built-in primitives', () => {
  it('recognizes and reads built-in state across realms', () => {
    const realm = new JSEngine.JSRealm();
    const values = realm.evaluate(`({
      bigint: Object(7n),
      boolean: Object(false),
      date: new Date(1234),
      error: new TypeError('failed'),
      map: new Map([['key', 3]]),
      number: Object(4.5),
      regexp: /source/dgimsuy,
      set: new Set(['entry']),
      string: Object('text'),
      symbol: Object(Symbol('symbol')),
    })`, 'built-in-primitives.js') as {
      bigint: unknown;
      boolean: unknown;
      date: unknown;
      error: unknown;
      map: unknown;
      number: unknown;
      regexp: unknown;
      set: unknown;
      string: unknown;
      symbol: unknown;
    };

    assert(JSEngine.hasBooleanData(values.boolean));
    expect(JSEngine.getBooleanData(values.boolean)).toBe(false);
    assert(JSEngine.hasNumberData(values.number));
    expect(JSEngine.getNumberData(values.number)).toBe(4.5);
    assert(JSEngine.hasBigIntData(values.bigint));
    expect(JSEngine.getBigIntData(values.bigint)).toBe(7n);
    assert(JSEngine.hasStringData(values.string));
    expect(JSEngine.getStringData(values.string)).toBe('text');
    assert(JSEngine.hasSymbolData(values.symbol));
    assert(JSEngine.hasDateValue(values.date));
    expect(JSEngine.getDateValue(values.date)).toBe(1234);
    assert(JSEngine.hasRegExpMatcher(values.regexp));
    expect(JSEngine.getRegExpData(values.regexp)).toEqual({
      flags: 'dgimsuy',
      source: 'source',
    });
    assert(JSEngine.hasMapData(values.map));
    expect(JSEngine.copyMapData(values.map))
      .toEqual([['key', 3]]);
    assert(JSEngine.hasSetData(values.set));
    expect(JSEngine.copySetData(values.set)).toEqual(['entry']);
    assert(JSEngine.hasErrorData(values.error));
  });

  it('reads and updates Map and Set data without author methods', () => {
    const map = new Map<string, string | number>([['key', 'value']]);
    const set = new Set<string>(['entry']);
    const fail = (): never => {
      throw new Error('author method was consulted');
    };
    Object.defineProperties(map, {
      entries: { get: fail },
      set: { get: fail },
      [Symbol.iterator]: { get: fail },
    });
    Object.defineProperties(set, {
      add: { get: fail },
      values: { get: fail },
      [Symbol.iterator]: { get: fail },
    });

    expectTypeOf(JSEngine.copyMapData(map)).toEqualTypeOf<[string, string | number][]>();
    expectTypeOf(JSEngine.copySetData(set)).toEqualTypeOf<string[]>();
    expect(JSEngine.copyMapData(map))
      .toEqual([['key', 'value']]);
    expect(JSEngine.copySetData(set)).toEqual(['entry']);
    JSEngine.appendMapData(map, 'second', 2);
    JSEngine.appendSetData(set, 'second');
    expect(JSEngine.copyMapData(map)).toEqual([
      ['key', 'value'],
      ['second', 2],
    ]);
    expect(JSEngine.copySetData(set)).toEqual(['entry', 'second']);
  });

  it('reads and restores V8 Error stacks without invoking author stack accessors', () => {
    const realm = new JSEngine.JSRealm();
    const error = realm.evaluate(
      "new Error('failed')",
      'structured-clone-error-stack.js',
    ) as object;

    expect(JSEngine.readErrorStack(error, realm)).toBeTypeOf('string');
    JSEngine.writeErrorStack(error, 'restored stack');
    expect(JSEngine.readErrorStack(error, realm)).toBe('restored stack');

    let authorGetterRan = false;
    Object.defineProperty(error, 'stack', {
      configurable: true,
      get() {
        authorGetterRan = true;
        return 'author stack';
      },
    });
    expect(JSEngine.readErrorStack(error, realm)).toBeUndefined();
    expect(authorGetterRan).toBe(false);
  });

  it('treats failed native stack formatting as unavailable stack data', () => {
    const realm = new JSEngine.JSRealm();
    const error = realm.evaluate("new Error('failed')", 'failed-stack-formatting.js') as object;
    Object.defineProperty(error, 'name', {
      get() { throw new Error('name formatting failed'); },
    });

    expect(JSEngine.readErrorStack(error, realm)).toBeUndefined();
  });

  it('recognizes known unsupported internal-slot objects without traps', () => {
    let trapRan = false;
    const proxy = new Proxy({}, {
      getPrototypeOf() {
        trapRan = true;
        return null;
      },
      ownKeys() {
        trapRan = true;
        return [];
      },
    });

    expect(JSEngine.isProxyObject(proxy)).toBe(true);
    expect(JSEngine.isPromiseObject(Promise.resolve())).toBe(true);
    expect(JSEngine.isWeakMapObject(new WeakMap())).toBe(true);
    expect(JSEngine.isWeakSetObject(new WeakSet())).toBe(true);
    expect(JSEngine.isMapIteratorObject(
      new Map().entries(),
    )).toBe(true);
    expect(JSEngine.isSetIteratorObject(
      new Set().values(),
    )).toBe(true);
    expect(JSEngine.isWeakRefObject(new WeakRef({}))).toBe(true);
    expect(JSEngine.isFinalizationRegistryObject(
      new FinalizationRegistry(() => {}),
    )).toBe(true);
    expect(trapRan).toBe(false);
  });

  it('keeps the native exotic probe narrow and non-consuming', () => {
    const iterator = [1, 2][Symbol.iterator]();
    expect(JSEngine.nativeCloneRejectsPropertylessObject(
      iterator,
    )).toBe(true);
    expect(iterator.next()).toEqual({ done: false, value: 1 });
    expect(JSEngine.nativeCloneRejectsPropertylessObject({}))
      .toBe(false);

    const decorated = Object.assign([][Symbol.iterator](), { marker: true });
    expect(JSEngine.nativeCloneRejectsPropertylessObject(
      decorated,
    )).toBe(false);
  });
});
