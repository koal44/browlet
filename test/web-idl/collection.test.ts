import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../test-runtime';

import { TestRealm as Realm } from './test-realm';
import { assembleDefinitions } from '../../src/web-idl/assembly';
import { RealmBinding } from '../../src/web-idl/binding';
import {
  defineInterface, idlType, sequence, type MaplikeMember, type OperationMember,
  type SetlikeMember,
} from '../../src/web-idl/declaration/index';
import { ImplementationRegistry } from '../../src/web-idl/registry';
import { PlatformObjectRegistry } from '../../src/web-idl/platform-object';

describe('Web IDL collection iterator overrides', () => {
  it.each(['map', 'set'] as const)('honors a replaced %s iterator prototype next', (kind) => {
    const { object, realm } = kind === 'map' ? createMaplikeBinding() : createSetlikeBinding();
    const prototype = kind === 'map'
      ? realm.intrinsics.iteration.mapIteratorPrototype
      : realm.intrinsics.iteration.setIteratorPrototype;
    const next = () => ({ value: 'replacement', done: true });
    Reflect.set(prototype, 'next', next);

    const iterator = call(object, 'entries') as object;
    expect(Reflect.get(iterator, 'next')).toBe(next);
    expect(callNext(iterator)).toEqual({ value: 'replacement', done: true });
  });

  it.each(['map', 'set'] as const)('does not read a %s prototype next getter during creation', (kind) => {
    const { object, realm } = kind === 'map' ? createMaplikeBinding() : createSetlikeBinding();
    const prototype = kind === 'map'
      ? realm.intrinsics.iteration.mapIteratorPrototype
      : realm.intrinsics.iteration.setIteratorPrototype;
    let reads = 0;
    const next = () => ({ value: 'replacement', done: true });
    Object.defineProperty(prototype, 'next', {
      configurable: true,
      get() { ++reads; return next; },
    });

    const iterator = call(object, 'entries') as object;
    expect(reads).toBe(0);
    expect(callNext(iterator)).toEqual({ value: 'replacement', done: true });
    expect(reads).toBe(1);
  });
});

describe('Web IDL maplike declarations', () => {
  it('projects querying, mutation, descriptors, and realm iterators', () => {
    const { binding, object, realm } = createMaplikeBinding();
    const prototype = Object.getPrototypeOf(object) as object;
    const entries = getMethod(prototype, 'entries');
    const set = getMethod(prototype, 'set');

    expect(Reflect.get(object, 'size')).toBe(0);
    expect(Reflect.apply(set, object, [1.8, 42])).toBe(object);
    expect(call(object, 'get', [1.2])).toBe('42');
    expect(call(object, 'has', [1.9])).toBe(true);
    expect(Reflect.get(object, 'size')).toBe(1);
    expect(binding.getMapEntries(object).get(1)).toBe('42');

    expect(Object.getOwnPropertyDescriptor(prototype, 'size'))
      .toMatchObject({ configurable: true, enumerable: true, set: undefined });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- descriptor function is inspected, not invoked
    const sizeGetter = Object.getOwnPropertyDescriptor(prototype, 'size')?.get;
    expect([sizeGetter?.name, sizeGetter?.length]).toEqual(['get size', 0]);
    expect(Object.getOwnPropertyDescriptor(prototype, Symbol.iterator))
      .toMatchObject({ configurable: true, enumerable: false, writable: true });
    expect(getMethod(prototype, Symbol.iterator)).toBe(entries);
    expect([
      [entries.name, entries.length],
      [getMethod(prototype, 'get').name, getMethod(prototype, 'get').length],
      [getMethod(prototype, 'set').name, getMethod(prototype, 'set').length],
    ]).toEqual([
      ['entries', 0],
      ['get', 1],
      ['set', 2],
    ]);

    const iterator = Reflect.apply(entries, object, []) as object;
    expect(Object.getPrototypeOf(iterator))
      .toBe(realm.intrinsics.iteration.mapIteratorPrototype);
    expect(Object.prototype.toString.call(iterator)).toBe('[object Map Iterator]');
    expect(Object.hasOwn(iterator, 'next')).toBe(false);
    expect(Reflect.apply(getMethod(iterator, Symbol.iterator), iterator, []))
      .toBe(iterator);

    binding.getMapEntries(object).set(2, 'two');
    const first = callNext(iterator);
    const second = callNext(iterator);
    expect(first.value).toBeInstanceOf(realm.intrinsics.array);
    expect(first.value).not.toBeInstanceOf(Array);
    expect(first.value).toEqual([1, '42']);
    expect(second.value).toEqual([2, 'two']);
    expect(Object.getPrototypeOf(first)).toBe(realm.intrinsics.objectPrototype);
    expect(callNext(iterator)).toEqual({ done: true, value: undefined });

    expect(readIterator(getMethod(object, 'keys'), object)).toEqual([1, 2]);
    expect(readIterator(getMethod(object, 'values'), object))
      .toEqual(['42', 'two']);
    expect([...(object as Iterable<unknown>)]).toEqual([
      [1, '42'],
      [2, 'two'],
    ]);
    expect(() => { Reflect.apply(entries, {}, []); })
      .toThrow(realm.intrinsics.typeError);
  });

  itPassesWith('collectionIterators')('accepts native Map iterator next', () => {
    const { object, realm } = createMaplikeBinding();
    call(object, 'set', [1, 'one']);
    const iterator = call(object, 'entries') as object;
    const nativeNext = getMethod(
      realm.intrinsics.iteration.mapIteratorPrototype,
      'next',
    );

    expect(Reflect.apply(nativeNext, iterator, []))
      .toEqual({ done: false, value: [1, 'one'] });
    expect(Reflect.get(iterator, 'next')).toBe(nativeNext);
    call(object, 'set', [2, 'two']);
    const foreignRealm = new Realm();
    const foreignNext = getMethod(foreignRealm.intrinsics.iteration.mapIteratorPrototype, 'next');
    const result = Reflect.apply(foreignNext, iterator, []) as IteratorResult<unknown>;
    expect(result.value).toEqual([2, 'two']);
    expect(result.value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.getPrototypeOf(result)).toBe(realm.intrinsics.objectPrototype);
  });

  it('converts sequence values for each live iteration', () => {
    const declaration = {
      key: idlType.DOMString,
      kind: 'maplike',
      value: sequence(idlType.long),
    } satisfies MaplikeMember;
    const interface_ = defineInterface({
      name: 'SequenceMaplike',
      exposed: ['Window'],
      members: [declaration],
    });
    const realm = new Realm();
    const binding = createBinding(interface_, undefined, realm);
    const object = binding.createPlatformObject(interface_.name);
    call(object, 'set', ['first', [1, 2]]);
    const firstIterator = call(object, 'values') as object;
    const secondIterator = call(object, 'values') as object;

    const first = callNext(firstIterator).value as number[];
    first.push(99);
    const second = callNext(secondIterator).value as number[];
    expect(second).toEqual([1, 2]);
    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(realm.intrinsics.array);
    expect(call(object, 'get', ['first'])).toEqual([1, 2]);

    call(object, 'set', ['later', [3]]);
    expect(callNext(firstIterator).value).toEqual([3]);
    expect(callNext(secondIterator).value).toEqual([3]);
  });

  it('keeps iteration and forEach live while preserving the entries object', () => {
    const { binding, object } = createMaplikeBinding();
    call(object, 'set', [1, 'one']);
    call(object, 'set', [2, 'two']);
    const entriesObject = binding.getMapEntries(object);
    const iterator = call(object, 'entries') as object;
    expect(callNext(iterator).value).toEqual([1, 'one']);

    call(object, 'clear');
    expect(binding.getMapEntries(object)).toBe(entriesObject);
    call(object, 'set', [3, 'three']);
    expect(callNext(iterator).value).toEqual([3, 'three']);

    const seen: unknown[][] = [];
    const receiver = {};
    call(object, 'forEach', [function(
      this: unknown,
      value: unknown,
      key: unknown,
      source: unknown,
    ) {
      expect(this).toBe(receiver);
      seen.push([value, key, source]);
      if (key === 3) call(object, 'set', [4, 'four']);
    }, receiver]);
    expect(seen).toEqual([
      ['three', 3, object],
      ['four', 4, object],
    ]);
    expect(call(object, 'delete', [3])).toBe(true);
    expect(call(object, 'delete', [3])).toBe(false);
  });

  it('keeps collection state on a separate implementation target', () => {
    const declaration = {
      key: idlType.long,
      kind: 'maplike',
      value: idlType.DOMString,
    } satisfies MaplikeMember;
    const interfaceIDL = defineInterface({
      name: 'SeparatedMaplike',
      exposed: ['Window'],
      members: [declaration],
    });
    const definitions = assembleDefinitions([interfaceIDL]);
    const interface_ = definitions.getInterface('SeparatedMaplike');
    if (!interface_) throw new Error('Missing assembled interface');

    const binding = new RealmBinding(
      definitions,
      new Realm(),
      new PlatformObjectRegistry(),
    );
    class CollectionImplementation {}
    const implementation = new CollectionImplementation();
    const { platformObject: object } = binding.projectPlatformObject(
      implementation,
      interface_,
    );

    expect(call(object, 'set', [1, 'one'])).toBe(object);
    expect(Object.getPrototypeOf(implementation))
      .toBe(CollectionImplementation.prototype);
    expect(binding.getMapEntries(object).get(1)).toBe('one');
    const seen: unknown[] = [];
    call(object, 'forEach', [(
      _value: unknown,
      _key: unknown,
      source: unknown,
    ) => seen.push(source)]);
    expect(seen).toEqual([object]);
  });

  it('lets declared mutation operations replace their defaults', () => {
    const clear = {
      arguments: [],
      kind: 'operation',
      name: 'clear',
      returns: idlType.undefined,
    } satisfies OperationMember;
    const declaration = {
      key: idlType.DOMString,
      kind: 'maplike',
      value: idlType.long,
    } satisfies MaplikeMember;
    const interface_ = defineInterface({
      name: 'CustomMaplike',
      exposed: ['Window'],
      members: [clear, declaration],
    });
    const implementations = new ImplementationRegistry();
    let calls = 0;
    implementations.setOperationSteps(clear, () => { calls++; });
    const binding = createBinding(interface_, implementations);
    const object = binding.createPlatformObject(interface_.name);

    call(object, 'clear');
    expect(calls).toBe(1);
  });

  it('keeps defaults when a static operation has the same name', () => {
    const staticSet = {
      arguments: [],
      kind: 'operation',
      name: 'set',
      returns: idlType.undefined,
      static: true,
    } satisfies OperationMember;
    const declaration = {
      key: idlType.DOMString,
      kind: 'maplike',
      value: idlType.long,
    } satisfies MaplikeMember;
    const interface_ = defineInterface({
      name: 'StaticMaplike',
      exposed: ['Window'],
      members: [staticSet, declaration],
    });
    const implementations = new ImplementationRegistry();
    let staticCalls = 0;
    implementations.setOperationSteps(staticSet, () => { staticCalls++; });
    const binding = createBinding(interface_, implementations);
    const object = binding.createPlatformObject(interface_.name);
    const Interface = binding.getInterfaceObject(interface_.name);

    Reflect.apply(getMethod(Interface, 'set'), Interface, []);
    expect(staticCalls).toBe(1);
    expect(call(object, 'set', ['key', 1])).toBe(object);
    expect(call(object, 'get', ['key'])).toBe(1);
  });
});

describe('Web IDL setlike declarations', () => {
  it('projects ordered-set querying, mutation, and Set-shaped iterators', () => {
    const { binding, object, realm } = createSetlikeBinding();

    expect(call(object, 'add', [1.8])).toBe(object);
    binding.getSetEntries(object).add(2);
    expect(Reflect.get(object, 'size')).toBe(2);
    expect(call(object, 'has', [1.2])).toBe(true);
    expect(getMethod(object, Symbol.iterator)).toBe(getMethod(object, 'values'));
    expect(getMethod(object, 'keys')).toBe(getMethod(object, 'values'));
    expect(readIterator(getMethod(object, 'values'), object)).toEqual([1, 2]);
    expect([...(object as Iterable<unknown>)]).toEqual([1, 2]);

    const entries = call(object, 'entries') as object;
    expect(Object.getPrototypeOf(entries))
      .toBe(realm.intrinsics.iteration.setIteratorPrototype);
    expect(Object.prototype.toString.call(entries)).toBe('[object Set Iterator]');
    expect(callNext(entries).value).toEqual([1, 1]);
    expect(callNext(entries).value).toEqual([2, 2]);

    const seen: unknown[][] = [];
    call(object, 'forEach', [(value: unknown, key: unknown, source: unknown) => {
      seen.push([value, key, source]);
      if (value === 1) call(object, 'add', [3]);
    }]);
    expect(seen).toEqual([
      [1, 1, object],
      [2, 2, object],
      [3, 3, object],
    ]);
    expect(call(object, 'delete', [2])).toBe(true);
    const entriesObject = binding.getSetEntries(object);
    call(object, 'clear');
    expect(binding.getSetEntries(object)).toBe(entriesObject);
    expect(Reflect.get(object, 'size')).toBe(0);
  });

  itPassesWith('collectionIterators')('accepts native Set iterator next', () => {
    const { object, realm } = createSetlikeBinding();
    call(object, 'add', [1]);
    const iterator = call(object, 'values') as object;
    const nativeNext = getMethod(
      realm.intrinsics.iteration.setIteratorPrototype,
      'next',
    );

    expect(Reflect.apply(nativeNext, iterator, []))
      .toEqual({ done: false, value: 1 });
    expect(Reflect.get(iterator, 'next')).toBe(nativeNext);
    call(object, 'add', [2]);
    const foreignRealm = new Realm();
    const foreignNext = getMethod(foreignRealm.intrinsics.iteration.setIteratorPrototype, 'next');
    const result = Reflect.apply(foreignNext, iterator, []) as IteratorResult<unknown>;
    expect(result.value).toBe(2);
    expect(Object.getPrototypeOf(result)).toBe(realm.intrinsics.objectPrototype);
  });

  it('omits mutation methods from readonly maplike and setlike interfaces', () => {
    const readonlyMap = defineInterface({
      name: 'ReadonlyMaplike',
      exposed: ['Window'],
      members: [{
        key: idlType.DOMString,
        kind: 'maplike',
        readonly: true,
        value: idlType.long,
      }],
    });
    const readonlySet = defineInterface({
      name: 'ReadonlySetlike',
      exposed: ['Window'],
      members: [{ kind: 'setlike', readonly: true, value: idlType.long }],
    });
    const binding = new RealmBinding(
      assembleDefinitions([readonlyMap, readonlySet]),
      new Realm(),
      new PlatformObjectRegistry(),
    );
    const map = binding.createPlatformObject(readonlyMap.name);
    const set = binding.createPlatformObject(readonlySet.name);

    for (const name of ['clear', 'delete', 'set']) {
      expect(name in map).toBe(false);
    }
    for (const name of ['add', 'clear', 'delete']) {
      expect(name in set).toBe(false);
    }
    binding.getMapEntries(map).set('specification', 1);
    binding.getSetEntries(set).add(2);
    expect(call(map, 'get', ['specification'])).toBe(1);
    expect(call(set, 'has', [2])).toBe(true);
  });

  it('keeps defaults when a static operation has the same name', () => {
    const staticAdd = {
      arguments: [],
      kind: 'operation',
      name: 'add',
      returns: idlType.undefined,
      static: true,
    } satisfies OperationMember;
    const declaration = {
      kind: 'setlike',
      value: idlType.long,
    } satisfies SetlikeMember;
    const interface_ = defineInterface({
      name: 'StaticSetlike',
      exposed: ['Window'],
      members: [staticAdd, declaration],
    });
    const implementations = new ImplementationRegistry();
    let staticCalls = 0;
    implementations.setOperationSteps(staticAdd, () => { staticCalls++; });
    const binding = createBinding(interface_, implementations);
    const object = binding.createPlatformObject(interface_.name);
    const Interface = binding.getInterfaceObject(interface_.name);

    Reflect.apply(getMethod(Interface, 'add'), Interface, []);
    expect(staticCalls).toBe(1);
    expect(call(object, 'add', [1])).toBe(object);
    expect(call(object, 'has', [1])).toBe(true);
  });
});

function createMaplikeBinding(): {
  binding: RealmBinding;
  object: object;
  realm: Realm;
} {
  const declaration = {
    key: idlType.long,
    kind: 'maplike',
    value: idlType.DOMString,
  } satisfies MaplikeMember;
  const interface_ = defineInterface({
    name: 'NumberMaplike',
    exposed: ['Window'],
    members: [declaration],
  });
  const realm = new Realm();
  const binding = createBinding(interface_, undefined, realm);
  return {
    binding,
    object: binding.createPlatformObject(interface_.name),
    realm,
  };
}

function createSetlikeBinding(): {
  binding: RealmBinding;
  object: object;
  realm: Realm;
} {
  const declaration = {
    kind: 'setlike',
    value: idlType.long,
  } satisfies SetlikeMember;
  const interface_ = defineInterface({
    name: 'NumberSetlike',
    exposed: ['Window'],
    members: [declaration],
  });
  const realm = new Realm();
  const binding = createBinding(interface_, undefined, realm);
  return {
    binding,
    object: binding.createPlatformObject(interface_.name),
    realm,
  };
}

function createBinding(
  interface_: ReturnType<typeof defineInterface>,
  implementations?: ImplementationRegistry,
  realm = new Realm(),
): RealmBinding {
  return new RealmBinding(
    assembleDefinitions([interface_]),
    realm,
    new PlatformObjectRegistry(),
    implementations,
  );
}

function call(
  object: object,
  name: PropertyKey,
  argumentsList: unknown[] = [],
): unknown {
  return Reflect.apply(getMethod(object, name), object, argumentsList);
}

function getMethod(object: object, key: PropertyKey): CallableFunction {
  const method = Reflect.get(object, key) as unknown;
  if (typeof method !== 'function') throw new Error(`${String(key)} is not callable`);
  return method;
}

function callNext(iterator: object): { done: boolean; value: unknown; } {
  return call(iterator, 'next') as { done: boolean; value: unknown; };
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
