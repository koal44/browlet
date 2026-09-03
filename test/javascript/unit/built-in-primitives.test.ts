import { describe, expect, it } from 'vitest';

import * as JavaScript from '../../../src/javascript/index';

describe('Node/V8 built-in primitives', () => {
  it('recognizes and reads built-in state across realms', () => {
    const realm = new JavaScript.NodeRealm();
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

    expect(JavaScript.hasBooleanData(values.boolean)).toBe(true);
    expect(JavaScript.getBooleanData(values.boolean)).toBe(false);
    expect(JavaScript.hasNumberData(values.number)).toBe(true);
    expect(JavaScript.getNumberData(values.number)).toBe(4.5);
    expect(JavaScript.hasBigIntData(values.bigint)).toBe(true);
    expect(JavaScript.getBigIntData(values.bigint)).toBe(7n);
    expect(JavaScript.hasStringData(values.string)).toBe(true);
    expect(JavaScript.getStringData(values.string)).toBe('text');
    expect(JavaScript.hasSymbolData(values.symbol)).toBe(true);
    expect(JavaScript.hasDateValue(values.date)).toBe(true);
    expect(JavaScript.getDateValue(values.date)).toBe(1234);
    expect(JavaScript.hasRegExpMatcher(values.regexp)).toBe(true);
    expect(JavaScript.getRegExpData(values.regexp)).toEqual({
      flags: 'dgimsuy',
      source: 'source',
    });
    expect(JavaScript.hasMapData(values.map)).toBe(true);
    expect(JavaScript.copyMapData(values.map))
      .toEqual([['key', 3]]);
    expect(JavaScript.hasSetData(values.set)).toBe(true);
    expect(JavaScript.copySetData(values.set)).toEqual(['entry']);
    expect(JavaScript.hasErrorData(values.error)).toBe(true);
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

    expect(JavaScript.copyMapData(map))
      .toEqual([['key', 'value']]);
    expect(JavaScript.copySetData(set)).toEqual(['entry']);
    JavaScript.appendMapData(map, 'second', 2);
    JavaScript.appendSetData(set, 'second');
    expect(JavaScript.copyMapData(map)).toEqual([
      ['key', 'value'],
      ['second', 2],
    ]);
    expect(JavaScript.copySetData(set)).toEqual(['entry', 'second']);
  });

  it('reads and restores V8 Error stacks without author accessors', () => {
    const realm = new JavaScript.NodeRealm();
    const error = realm.evaluate(
      "new Error('failed')",
      'structured-clone-error-stack.js',
    ) as object;

    expect(JavaScript.readErrorStack(error, realm)).toBeTypeOf('string');
    JavaScript.writeErrorStack(error, 'restored stack');
    expect(JavaScript.readErrorStack(error, realm)).toBe('restored stack');

    let authorGetterRan = false;
    Object.defineProperty(error, 'stack', {
      configurable: true,
      get() {
        authorGetterRan = true;
        return 'author stack';
      },
    });
    expect(JavaScript.readErrorStack(error, realm)).toBeUndefined();
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

    expect(JavaScript.isProxyObject(proxy)).toBe(true);
    expect(JavaScript.isPromiseObject(Promise.resolve())).toBe(true);
    expect(JavaScript.isWeakMapObject(new WeakMap())).toBe(true);
    expect(JavaScript.isWeakSetObject(new WeakSet())).toBe(true);
    expect(JavaScript.isMapIteratorObject(
      new Map().entries(),
    )).toBe(true);
    expect(JavaScript.isSetIteratorObject(
      new Set().values(),
    )).toBe(true);
    expect(JavaScript.isWeakRefObject(new WeakRef({}))).toBe(true);
    expect(JavaScript.isFinalizationRegistryObject(
      new FinalizationRegistry(() => {}),
    )).toBe(true);
    expect(trapRan).toBe(false);
  });

  it('keeps the native exotic probe narrow and non-consuming', () => {
    const iterator = [1, 2][Symbol.iterator]();
    expect(JavaScript.nativeCloneRejectsPropertylessObject(
      iterator,
    )).toBe(true);
    expect(iterator.next()).toEqual({ done: false, value: 1 });
    expect(JavaScript.nativeCloneRejectsPropertylessObject({}))
      .toBe(false);

    const decorated = Object.assign([][Symbol.iterator](), { marker: true });
    expect(JavaScript.nativeCloneRejectsPropertylessObject(
      decorated,
    )).toBe(false);
  });
});
