import { describe, expect, it } from 'vitest';

import * as JSEngine from '../../src/js-engine/index';

describe('Node/V8 built-in primitives', () => {
  it('recognizes and reads built-in state across realms', () => {
    const realm = new JSEngine.NodeRealm();
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
      bigint: object;
      boolean: object;
      date: object;
      error: object;
      map: object;
      number: object;
      regexp: object;
      set: object;
      string: object;
      symbol: object;
    };

    expect(JSEngine.hasBooleanData(values.boolean)).toBe(true);
    expect(JSEngine.getBooleanData(values.boolean)).toBe(false);
    expect(JSEngine.hasNumberData(values.number)).toBe(true);
    expect(JSEngine.getNumberData(values.number)).toBe(4.5);
    expect(JSEngine.hasBigIntData(values.bigint)).toBe(true);
    expect(JSEngine.getBigIntData(values.bigint)).toBe(7n);
    expect(JSEngine.hasStringData(values.string)).toBe(true);
    expect(JSEngine.getStringData(values.string)).toBe('text');
    expect(JSEngine.hasSymbolData(values.symbol)).toBe(true);
    expect(JSEngine.hasDateValue(values.date)).toBe(true);
    expect(JSEngine.getDateValue(values.date)).toBe(1234);
    expect(JSEngine.hasRegExpMatcher(values.regexp)).toBe(true);
    expect(JSEngine.getRegExpData(values.regexp)).toEqual({
      flags: 'dgimsuy',
      source: 'source',
    });
    expect(JSEngine.hasMapData(values.map)).toBe(true);
    expect(JSEngine.copyMapData(values.map))
      .toEqual([['key', 3]]);
    expect(JSEngine.hasSetData(values.set)).toBe(true);
    expect(JSEngine.copySetData(values.set)).toEqual(['entry']);
    expect(JSEngine.hasErrorData(values.error)).toBe(true);
  });

  it('reads and updates Map and Set data without author methods', () => {
    const map = new Map<unknown, unknown>([['key', 'value']]);
    const set = new Set<unknown>(['entry']);
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

  it('reads and restores V8 Error stacks without author accessors', () => {
    const realm = new JSEngine.NodeRealm();
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
