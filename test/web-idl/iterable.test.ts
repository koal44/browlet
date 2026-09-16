import { describe, expect, it } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { RealmBinding } from '../../src/web-idl/realm-binding';
import { webIDLCommonDefinitions } from '../../src/web-idl/common-definitions';
import {
  BindingWorld, defineInterface, idlType, impl, iter, reference, type IterableMember,
} from '../../src/web-idl/index';
import type { ValuePair } from '../../src/web-idl/iterable';
import { getPlatformRecord } from '../../src/web-idl/platform-object';

describe('Web IDL synchronous iterable declarations', () => {
  it.each(['entries', 'keys', 'values', 'forEach'])(
    '%s reads each backing entry only once during a complete traversal',
    (method) => {
      let entryReads = 0;
      const pairs = new Proxy<[string, number][]>([['one', 1], ['two', 2], ['three', 3]], {
        get(target, key, receiver) {
          if (typeof key === 'string' && /^\d+$/.test(key)) entryReads++;
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      class PairsImpl {
        getEntryList(): readonly [string, number][] { return pairs; }
        entries(): IterableIterator<[string, number]> { return pairs.values(); }
      }
      const definition = defineInterface({
        name: 'Pairs',
        implementation: impl(PairsImpl),
        members: [iter(idlType.long, { key: idlType.DOMString })],
      });
      const context = new BindingWorld([...webIDLCommonDefinitions, definition]).register(new Realm());
      const object = context.project(PairsImpl, context.construct(PairsImpl));
      if (method === 'forEach') {
        const seen: unknown[][] = [];
        Reflect.apply(getMethod(object, method), object, [(value: unknown, key: unknown) => {
          seen.push([key, value]);
        }]);
        expect(seen).toEqual([['one', 1], ['two', 2], ['three', 3]]);
      } else {
        expect(readIterator(getMethod(object, method), object)).toEqual(method === 'entries'
          ? [['one', 1], ['two', 2], ['three', 3]]
          : method === 'keys' ? ['one', 'two', 'three'] : [1, 2, 3]);
      }
      expect(entryReads).toBe(3);
    },
  );

  it('defines realm-specific pair iteration methods and iterator objects', () => {
    const { binding, iterable, definition, realm } = createPairBinding();
    const pairs = new WeakMap<object, ValuePair[]>();
    binding.getDefinitionBinding(definition).getOrCreateMemberRecord(iterable).valuePairsSteps = function() {
      return pairs.get(this) ?? [];
    };
    const object = binding.createPlatformRecord(binding.resolveInterface('PairCollection')).platformObject!;
    pairs.set(getPlatformRecord(object)!.implInst, [
      ['one', 1],
      ['two', 2],
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
    const { binding, iterable, definition } = createPairBinding();
    const pairs: ValuePair[] = [['one', 1]];
    binding.getDefinitionBinding(definition).getOrCreateMemberRecord(iterable).valuePairsSteps = () => pairs;
    const object = binding.createPlatformRecord(binding.resolveInterface('PairCollection')).platformObject!;
    const entries = getMethod(object, 'entries');
    const iterator = Reflect.apply(entries, object, []) as object;

    expect(callNext(iterator).value).toEqual(['one', 1]);
    pairs.push(['two', 2]);
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
      if (seen.length === 1) pairs.push(['three', 3]);
    }, receiver]);

    expect(seen).toEqual([
      [1, 'one', object],
      [2, 'two', object],
      [3, 'three', object],
    ]);
    expect([forEach.name, forEach.length]).toEqual(['forEach', 1]);
  });

  it('converts pair keys and values before invoking forEach callbacks', () => {
    class PairCollectionImpl {}
    const iterable = {
      key: reference('PairValue'),
      kind: 'iterable',
      value: reference('PairValue'),
    } satisfies IterableMember;
    const valueInterface = defineInterface({
      name: 'PairValue',
      exposed: ['Window'], members: [],
    });
    const collectionInterface = defineInterface({
      name: 'InterfacePairCollection',
      exposed: ['Window'],
      members: [iterable],
    });

    const definitions = new DefinitionAssembly([
      ...webIDLCommonDefinitions,
      collectionInterface,
      valueInterface,
    ]);
    const binding = new RealmBinding(
      definitions,
      new Realm(),
      new BindingWorld([]),
    );
    binding.getDefinitionBinding(collectionInterface).createImplementation = () => new PairCollectionImpl();
    const assembledValue = definitions.getInterface('PairValue');
    if (!assembledValue) throw new Error('Missing PairValue interface');
    const createPairValue = (): [object, object] => {
      const implementation = Object.create(
        binding.getInterfacePrototypeObject(assembledValue),
      ) as object;
      const platformObject = new Proxy(implementation, {});
      binding.initializePlatformObject(
        platformObject,
        assembledValue,
        implementation,
      );
      return [implementation, platformObject];
    };
    const [keyImplementation, keyObject] = createPairValue();
    const [valueImplementation, valueObject] = createPairValue();
    binding.getDefinitionBinding(collectionInterface).getOrCreateMemberRecord(iterable).valuePairsSteps = () => [[keyImplementation, valueImplementation]];
    const collection = binding.createPlatformRecord(
      binding.resolveInterface('InterfacePairCollection'),
    ).platformObject!;
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
      name: 'HiddenIterable',
      exposed: ['Window'],
      members: [hiddenIterable],
    });
    const realm = new Realm();
    const binding = new RealmBinding(
      new DefinitionAssembly([...webIDLCommonDefinitions, hidden]),
      realm,
      new BindingWorld([]),
    );
    const hiddenPrototype = binding.getInterfacePrototypeObject(binding.resolveInterface(hidden.name));
    expect(Object.hasOwn(hiddenPrototype, 'entries')).toBe(false);

    const pair = createPairBinding();
    pair.binding.getDefinitionBinding(pair.definition).getOrCreateMemberRecord(pair.iterable).valuePairsSteps = () => [];
    const object = pair.binding.createPlatformRecord(pair.binding.resolveInterface('PairCollection')).platformObject!;
    const entries = getMethod(object, 'entries');
    const iterator = Reflect.apply(entries, object, []) as object;
    const next = getMethod(iterator, 'next');
    expect(() => { Reflect.apply(entries, {}, []); })
      .toThrow(pair.realm.intrinsics.typeError);
    expect(() => { Reflect.apply(next, {}, []); })
      .toThrow(pair.realm.intrinsics.typeError);
  });

  it('rejects an iterator from a separate binding world', () => {
    const { binding, iterable, definition } = createPairBinding();
    const otherRealm = new Realm();
    const otherBinding = new RealmBinding(
      binding.definitions, otherRealm, new BindingWorld([]),
    );
    binding.getDefinitionBinding(definition).getOrCreateMemberRecord(iterable).valuePairsSteps = () => [];
    const original = binding.getDefinitionBinding(definition);
    const other = otherBinding.getDefinitionBinding(definition);
    other.createImplementation = original.createImplementation;
    other.getOrCreateMemberRecord(iterable).valuePairsSteps = original.getOrCreateMemberRecord(iterable).valuePairsSteps;
    const object = binding.createPlatformRecord(binding.resolveInterface('PairCollection')).platformObject!;
    const otherObject = otherBinding.createPlatformRecord(otherBinding.resolveInterface('PairCollection')).platformObject!;
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;
    const otherIterator = Reflect.apply(getMethod(otherObject, 'entries'), otherObject, []) as object;

    expect(() => { Reflect.apply(getMethod(otherIterator, 'next'), iterator, []); })
      .toThrow(otherRealm.intrinsics.typeError);
  });

  it('keeps iterator state private and independent of author property changes', () => {
    const { binding, iterable, definition, realm } = createPairBinding();
    binding.getDefinitionBinding(definition).getOrCreateMemberRecord(iterable).valuePairsSteps = () => [['one', 1], ['two', 2]];
    const object = binding.createPlatformRecord(binding.resolveInterface('PairCollection')).platformObject!;
    const iterator = Reflect.apply(getMethod(object, 'entries'), object, []) as object;
    const next = getMethod(iterator, 'next');
    expect(Reflect.ownKeys(iterator)).toEqual([]);

    const forged: object = Object.create(Object.getPrototypeOf(iterator) as object) as object;
    expect(() => { Reflect.apply(next, forged, []); }).toThrow(realm.intrinsics.typeError);
    const traps: PropertyKey[] = [];
    const proxy = new Proxy(iterator, {
      get(target, key, receiver) {
        traps.push(key);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(() => { Reflect.apply(next, proxy, []); }).toThrow(realm.intrinsics.typeError);
    expect(traps).toEqual([]);

    Object.setPrototypeOf(iterator, null);
    Object.freeze(iterator);
    expect(Reflect.apply(next, iterator, [])).toEqual({ done: false, value: ['one', 1] });
    expect(Reflect.apply(next, iterator, [])).toEqual({ done: false, value: ['two', 2] });
    expect(Reflect.ownKeys(iterator)).toEqual([]);
  });
});

function createPairBinding(): {
  binding: RealmBinding;
  definition: ReturnType<typeof defineInterface>;
  iterable: IterableMember;
  realm: Realm;
} {
  class PairCollectionImpl {}
  const iterable = {
    key: idlType.DOMString,
    kind: 'iterable',
    value: idlType.long,
  } satisfies IterableMember;
  const definition = defineInterface({
    name: 'PairCollection',
    exposed: ['Window'],
    members: [iterable],
  });
  const realm = new Realm();
  const binding = new RealmBinding(
    new DefinitionAssembly([...webIDLCommonDefinitions, definition]), realm, new BindingWorld([]),
  );
  binding.getDefinitionBinding(definition).createImplementation = () => new PairCollectionImpl();
  return { binding, definition, iterable, realm };
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
