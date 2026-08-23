import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import { webIDLCommonDefinitions } from '../../../src/web-idl/common-definitions';
import {
  defineInterface, idlType, reference, type IterableMember,
} from '../../../src/web-idl/definition';
import {
  ImplementationRegistry, type ValuePair,
} from '../../../src/web-idl/implementation';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';

describe('Web IDL synchronous iterable declarations', () => {
  it('defines realm-specific pair iteration methods and iterator objects', () => {
    const { binding, iterable, implementations, realm } = createPairBinding();
    const pairs = new WeakMap<object, ValuePair[]>();
    implementations.setValuePairsSteps(iterable, function() {
      return pairs.get(this) ?? [];
    });
    const object = binding.createPlatformObject('PairCollection');
    pairs.set(object, [
      { key: 'one', value: 1 },
      { key: 'two', value: 2 },
    ]);
    const prototype = Object.getPrototypeOf(object) as object;
    const entries = getMethod(prototype, 'entries');
    const keys = getMethod(prototype, 'keys');
    const values = getMethod(prototype, 'values');
    const iteratorMethod = getMethod(prototype, Symbol.iterator);

    expect(iteratorMethod).toBe(entries);
    expect({
      entries: [entries.name, entries.length],
      keys: [keys.name, keys.length],
      values: [values.name, values.length],
    }).toEqual({
      entries: ['entries', 0],
      keys: ['keys', 0],
      values: ['values', 0],
    });
    expect(Object.getOwnPropertyDescriptor(prototype, Symbol.iterator))
      .toMatchObject({ configurable: true, enumerable: false, writable: true });
    for (const name of ['entries', 'keys', 'values', 'forEach']) {
      expect(Object.getOwnPropertyDescriptor(prototype, name))
        .toMatchObject({ configurable: true, enumerable: true, writable: true });
    }

    const iterator = Reflect.apply(entries, object, []) as object;
    const iteratorPrototype = Object.getPrototypeOf(iterator) as object;
    const next = getMethod(iteratorPrototype, 'next');
    expect(Object.getPrototypeOf(iteratorPrototype))
      .toBe(realm.intrinsics.iteration.iteratorPrototype);
    expect(Object.prototype.toString.call(iterator))
      .toBe('[object PairCollection Iterator]');
    expect([next.name, next.length]).toEqual(['next', 0]);
    expect(Object.getOwnPropertyDescriptor(iteratorPrototype, 'next'))
      .toMatchObject({ configurable: true, enumerable: true, writable: true });
    expect(Reflect.apply(getMethod(iterator, Symbol.iterator), iterator, []))
      .toBe(iterator);

    const first = callNext(iterator);
    expect(first.done).toBe(false);
    expect(first.value).toBeInstanceOf(realm.intrinsics.array);
    expect(first.value).not.toBeInstanceOf(Array);
    expect(Array.from(first.value as ArrayLike<unknown>)).toEqual(['one', 1]);
    expect(Object.getPrototypeOf(first)).toBe(realm.intrinsics.objectPrototype);
    expect(callNext(iterator)).toMatchObject({ done: false });
    expect(callNext(iterator)).toEqual({ done: true, value: undefined });
    expect(callNext(iterator)).toEqual({ done: true, value: undefined });

    expect(readIterator(keys, object)).toEqual(['one', 'two']);
    expect(readIterator(values, object)).toEqual([1, 2]);
  });

  it('consults the current value-pair list for next and after each callback', () => {
    const { binding, iterable, implementations } = createPairBinding();
    const pairs: ValuePair[] = [{ key: 'one', value: 1 }];
    implementations.setValuePairsSteps(iterable, () => pairs);
    const object = binding.createPlatformObject('PairCollection');
    const entries = getMethod(object, 'entries');
    const iterator = Reflect.apply(entries, object, []) as object;

    expect(callNext(iterator).value).toEqual(['one', 1]);
    pairs.push({ key: 'two', value: 2 });
    expect(callNext(iterator).value).toEqual(['two', 2]);

    const seen: unknown[][] = [];
    const receiver = {};
    const forEach = getMethod(object, 'forEach');
    Reflect.apply(forEach, object, [function(
      this: unknown,
      value: unknown,
      key: unknown,
      source: unknown,
    ) {
      expect(this).toBe(receiver);
      seen.push([value, key, source]);
      if (seen.length === 1) pairs.push({ key: 'three', value: 3 });
    }, receiver]);

    expect(seen).toEqual([
      [1, 'one', object],
      [2, 'two', object],
      [3, 'three', object],
    ]);
    expect([forEach.name, forEach.length]).toEqual(['forEach', 1]);
  });

  it('converts pair keys and values before invoking forEach callbacks', () => {
    const iterable = {
      key: reference('PairValue'),
      kind: 'iterable',
      value: reference('PairValue'),
    } satisfies IterableMember;
    const valueInterface = defineInterface({
      exposed: ['Window'], members: [], name: 'PairValue',
    });
    const collectionInterface = defineInterface({
      exposed: ['Window'],
      members: [iterable],
      name: 'InterfacePairCollection',
    });
    const implementations = new ImplementationRegistry();
    const definitions = assembleDefinitions([
      ...webIDLCommonDefinitions,
      collectionInterface,
      valueInterface,
    ]);
    const binding = new JavaScriptBinding(
      definitions,
      new Realm(),
      new PlatformObjectRegistry(),
      implementations,
    );
    const assembledValue = definitions.getInterface('PairValue');
    if (!assembledValue) throw new Error('Missing PairValue interface');
    const createPairValue = (): [object, object] => {
      const implementation = Object.create(
        binding.getInterfacePrototypeObject(assembledValue),
      ) as object;
      const platformObject = new Proxy(implementation, {});
      binding.associatePlatformObject(
        platformObject,
        assembledValue,
        implementation,
      );
      return [implementation, platformObject];
    };
    const [keyImplementation, keyObject] = createPairValue();
    const [valueImplementation, valueObject] = createPairValue();
    implementations.setValuePairsSteps(iterable, () => [{
      key: keyImplementation,
      value: valueImplementation,
    }]);
    const collection = binding.createPlatformObject(
      'InterfacePairCollection',
    );
    const seen: unknown[][] = [];

    Reflect.apply(getMethod(collection, 'forEach'), collection, [
      (value: unknown, key: unknown, source: unknown) => {
        seen.push([value, key, source]);
      },
    ]);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.[0]).toBe(valueObject);
    expect(seen[0]?.[1]).toBe(keyObject);
    expect(seen[0]?.[2]).toBe(collection);
  });

  it('brands methods and honors iterable exposure modifiers', () => {
    const hiddenIterable = {
      extendedAttributes: [{ kind: 'no-arguments', name: 'SecureContext' }],
      key: idlType.DOMString,
      kind: 'iterable',
      value: idlType.long,
    } satisfies IterableMember;
    const hidden = defineInterface({
      exposed: ['Window'],
      members: [hiddenIterable],
      name: 'HiddenIterable',
    });
    const realm = new Realm();
    const binding = new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, hidden]),
      realm,
      new PlatformObjectRegistry(),
    );
    const hiddenPrototype = binding.getInterfacePrototypeObject(hidden.name);
    expect(Object.hasOwn(hiddenPrototype, 'entries')).toBe(false);

    const pair = createPairBinding();
    pair.implementations.setValuePairsSteps(pair.iterable, () => []);
    const object = pair.binding.createPlatformObject('PairCollection');
    const entries = getMethod(object, 'entries');
    const iterator = Reflect.apply(entries, object, []) as object;
    const next = getMethod(iterator, 'next');
    expect(() => { Reflect.apply(entries, {}, []); })
      .toThrow(pair.realm.intrinsics.typeError);
    expect(() => { Reflect.apply(next, {}, []); })
      .toThrow(pair.realm.intrinsics.typeError);
  });
});

function createPairBinding(): {
  binding: JavaScriptBinding;
  implementations: ImplementationRegistry;
  iterable: IterableMember;
  realm: Realm;
} {
  const iterable = {
    key: idlType.DOMString,
    kind: 'iterable',
    value: idlType.long,
  } satisfies IterableMember;
  const interface_ = defineInterface({
    exposed: ['Window'],
    members: [iterable],
    name: 'PairCollection',
  });
  const implementations = new ImplementationRegistry();
  const realm = new Realm();
  return {
    binding: new JavaScriptBinding(
      assembleDefinitions([...webIDLCommonDefinitions, interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    ),
    implementations,
    iterable,
    realm,
  };
}

function getMethod(object: object, key: PropertyKey): CallableFunction {
  const method = Reflect.get(object, key) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(key)} is not callable`);
  return method;
}

function callNext(iterator: object): { done: boolean; value: unknown; } {
  return Reflect.apply(getMethod(iterator, 'next'), iterator, []) as {
    done: boolean;
    value: unknown;
  };
}

function readIterator(method: CallableFunction, object: object): unknown[] {
  const iterator = Reflect.apply(method, object, []) as object;
  const values: unknown[] = [];
  while (true) {
    const result = callNext(iterator);
    if (result.done) return values;
    values.push(result.value);
  }
}
