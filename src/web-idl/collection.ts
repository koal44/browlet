import { isObject, type JSFunction, type JSRealm } from '../js-engine/index';
import type { AssembledInterface } from './assembled';
import { jsToIDL, idlToJS, type ValueConverter } from './conversion';
import type {
  MaplikeMember, SetlikeMember, WebIDLType,
} from './core/index';
import { getPlatformRecord, type PlatformRecord } from './platform-object';
import { defineDataProperty, defineMethod } from './property';
import type { RealmBinding } from './realm-binding';
import { InternalError } from '../infra/internal-error';

/** Share realm ownership, receiver validation, and errors for maplike and setlike bindings. */
abstract class CollectionBinding {
  /** Binding for the installed methods and their allocation realm. */
  protected binding: RealmBinding;

  constructor(binding: RealmBinding) {
    this.binding = binding;
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.11 Maplike declarations and §3.7.12
  // Setlike declarations.
  protected getReceiverRecord(
    value: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method',
  ): PlatformRecord {
    if (!isObject(value)) this.throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.world !== this.binding.world) {
      this.throwTypeError('Illegal invocation');
    }
    this.binding.realm.performSecurityCheck(value, identifier, type);
    if (!record.implements(assembled)) {
      this.throwTypeError('Illegal invocation');
    }
    return record;
  }

  // Project helper: throw a TypeError allocated in this binding's realm.
  protected throwTypeError(message: string): never {
    throw new this.binding.realm.intrinsics.typeError(message);
  }
}

/** Install maplike members and access their retained map entries. */
// https://webidl.spec.whatwg.org/#idl-maplike
export class MaplikeBinding extends CollectionBinding {
  /** Allocate backing entries once when the platform object is initialized. */
  initialize(record: PlatformRecord): void {
    record.mapEntries ??= new Map();
  }

  // Web IDL §3.7.11 Maplike declarations — install the declared properties.
  defineMembers(
    target: object,
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(assembled),
    });

    const entries = this.#createIteratorMethod(
      assembled,
      member,
      'key+value',
      'entries',
    );
    defineMethod(target, Symbol.iterator, entries, false);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(
      target,
      'keys',
      this.#createIteratorMethod(
        assembled, member, 'key', 'keys',
      ),
    );
    defineDataProperty(
      target,
      'values',
      this.#createIteratorMethod(
        assembled, member, 'value', 'values',
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createForEach(assembled, member),
    );
    defineDataProperty(
      target,
      'get',
      this.#createGet(assembled, member),
    );
    defineDataProperty(
      target,
      'has',
      this.#createHas(assembled, member),
    );

    if (member.readonly) return;
    if (!assembled.hasInstanceOperation('set')) {
      defineDataProperty(
        target,
        'set',
        this.#createSet(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createDelete(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('clear')) {
      defineDataProperty(target, 'clear', this.#createClear(assembled));
    }
  }

  // Project helper: retrieve map entries retained in the implementation's binding record.
  getEntries(record: PlatformRecord | undefined): IDLMapEntries {
    const entries = record?.mapEntries;
    if (!entries) throw new InternalError('Object does not have Web IDL map entries');
    return entries;
  }

  // Project factory for Web IDL §3.7.11.1 size getter.
  #createSizeGetter(
    assembled: AssembledInterface,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.getReceiverRecord(
          thisArgument,
          assembled,
          'size',
          'getter',
        );
        return this.getEntries(receiver).size;
      },
      { length: 0, name: 'get size' },
    );
  }

  // Project factory for Web IDL §3.7.11.3 entries, §3.7.11.4 keys, and §3.7.11.5 values.
  #createIteratorMethod(
    assembled: AssembledInterface,
    member: MaplikeMember,
    kind: MapIterationKind,
    name: string,
  ): JSFunction {
    // Reuse installed converters unless a borrowed method needs another receiver binding.
    const methodBinding = this.binding;
    const realm = methodBinding.realm;
    const convertKey = methodBinding.getConversionContext(member.key).getIDLToJSConverter();
    const convertValue = methodBinding.getConversionContext(member.value).getIDLToJSConverter();
    return realm.createFunction(
      (thisArgument) => {
        const receiver = this.getReceiverRecord(thisArgument, assembled, name, 'method');
        const receiverBinding = receiver.binding;
        const sameBinding = receiverBinding === methodBinding;
        const iterator = new MapIteratorRecord(
          this.getEntries(receiver), kind, realm,
          sameBinding ? convertKey : receiverBinding.getConversionContext(member.key, realm).getIDLToJSConverter(),
          sameBinding ? convertValue : receiverBinding.getConversionContext(member.value, realm).getIDLToJSConverter(),
        );
        return realm.createCollectionIterator('map', () => iterator.next());
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.11.6 forEach.
  #createForEach(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument,
          assembled,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.throwTypeError('Callback is not callable');
        }
        const binding = receiver.binding;
        this.getEntries(receiver).forEach((value, key) => {
          Reflect.apply(callback, argumentsList[1], [
            idlToJS(value, binding.getConversionContext(member.value, this.binding.realm)),
            idlToJS(key, binding.getConversionContext(member.key, this.binding.realm)),
            receiver.platformObject,
          ]);
        });
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project factory for Web IDL §3.7.11.7 get.
  #createGet(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'get', 'method',
        );
        const entries = this.getEntries(receiver);
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.binding,
        );
        if (!entries.has(key)) return undefined;
        return idlToJS(entries.get(key), receiver.binding.getConversionContext(member.value, this.binding.realm));
      },
      { length: 1, name: 'get' },
    );
  }

  // Project factory for Web IDL §3.7.11.8 has.
  #createHas(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'has', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.binding,
        );
        return this.getEntries(receiver).has(key);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.11.9 set.
  #createSet(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'set', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.binding,
        );
        const value = jsToIDL(argumentsList[1], this.binding.getConversionContext(member.value, this.binding.realm));
        this.getEntries(receiver).set(key, value);
        return receiver.platformObject;
      },
      { length: 2, name: 'set' },
    );
  }

  // Project factory for Web IDL §3.7.11.10 delete.
  #createDelete(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'delete', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.binding,
        );
        return this.getEntries(receiver).delete(key);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.11.11 clear.
  #createClear(
    assembled: AssembledInterface,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'clear', 'method',
        );
        this.getEntries(receiver).clear();
        return undefined;
      },
      { length: 0, name: 'clear' },
    );
  }
}

/** Install setlike members and access their retained set entries. */
// https://webidl.spec.whatwg.org/#idl-setlike
export class SetlikeBinding extends CollectionBinding {
  /** Allocate backing entries once when the platform object is initialized. */
  initialize(record: PlatformRecord): void {
    record.setEntries ??= new Set();
  }

  // Web IDL §3.7.12 Setlike declarations — install the declared properties.
  defineMembers(
    target: object,
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(assembled),
    });

    const values = this.#createIteratorMethod(
      assembled,
      member,
      'value',
      'values',
    );
    defineMethod(target, Symbol.iterator, values, false);
    defineDataProperty(
      target,
      'entries',
      this.#createIteratorMethod(
        assembled, member, 'key+value', 'entries',
      ),
    );
    defineDataProperty(target, 'keys', values);
    defineDataProperty(target, 'values', values);
    defineDataProperty(
      target,
      'forEach',
      this.#createForEach(assembled, member),
    );
    defineDataProperty(
      target,
      'has',
      this.#createHas(assembled, member),
    );

    if (member.readonly) return;
    if (!assembled.hasInstanceOperation('add')) {
      defineDataProperty(
        target,
        'add',
        this.#createAdd(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createDelete(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('clear')) {
      defineDataProperty(target, 'clear', this.#createClear(assembled));
    }
  }

  // Project helper: retrieve set entries retained in the implementation's binding record.
  getEntries(record: PlatformRecord | undefined): IDLSetEntries {
    const entries = record?.setEntries;
    if (!entries) throw new InternalError('Object does not have Web IDL set entries');
    return entries;
  }

  // Project factory for Web IDL §3.7.12.1 size getter.
  #createSizeGetter(
    assembled: AssembledInterface,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.getReceiverRecord(
          thisArgument,
          assembled,
          'size',
          'getter',
        );
        return this.getEntries(receiver).size;
      },
      { length: 0, name: 'get size' },
    );
  }

  // Project factory for Web IDL §3.7.12.3 entries and §3.7.12.5 values.
  #createIteratorMethod(
    assembled: AssembledInterface,
    member: SetlikeMember,
    kind: SetIterationKind,
    name: string,
  ): JSFunction {
    // Reuse installed converters unless a borrowed method needs another receiver binding.
    const methodBinding = this.binding;
    const realm = methodBinding.realm;
    const convertValue = methodBinding.getConversionContext(member.value).getIDLToJSConverter();
    return realm.createFunction(
      (thisArgument) => {
        const receiver = this.getReceiverRecord(thisArgument, assembled, name, 'method');
        const receiverBinding = receiver.binding;
        const sameBinding = receiverBinding === methodBinding;
        const iterator = new SetIteratorRecord(
          this.getEntries(receiver), kind, realm,
          sameBinding ? convertValue : receiverBinding.getConversionContext(member.value, realm).getIDLToJSConverter(),
        );
        return realm.createCollectionIterator('set', () => iterator.next());
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.12.6 forEach.
  #createForEach(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument,
          assembled,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.throwTypeError('Callback is not callable');
        }
        const binding = receiver.binding;
        this.getEntries(receiver).forEach((value) => {
          const javaScriptValue = idlToJS(value, binding.getConversionContext(member.value, this.binding.realm));
          Reflect.apply(callback, argumentsList[1], [
            javaScriptValue,
            javaScriptValue,
            receiver.platformObject,
          ]);
        });
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project factory for Web IDL §3.7.12.7 has.
  #createHas(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'has', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], member.value, this.binding,
        );
        return this.getEntries(receiver).has(value);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.12.8 add.
  #createAdd(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'add', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], member.value, this.binding,
        );
        this.getEntries(receiver).add(value);
        return receiver.platformObject;
      },
      { length: 1, name: 'add' },
    );
  }

  // Project factory for Web IDL §3.7.12.9 delete.
  #createDelete(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'delete', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], member.value, this.binding,
        );
        return this.getEntries(receiver).delete(value);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.12.10 clear.
  #createClear(
    assembled: AssembledInterface,
  ): JSFunction {
    return this.binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.getReceiverRecord(
          thisArgument, assembled, 'clear', 'method',
        );
        this.getEntries(receiver).clear();
        return undefined;
      },
      { length: 0, name: 'clear' },
    );
  }
}

/** Advance one live map cursor and convert its entries for the platform iterator. */
// https://webidl.spec.whatwg.org/#js-map-iterator
class MapIteratorRecord {
  /** Backing cursor observes changes to the collection between next calls. */
  #iterator: MapIterator<[unknown, unknown]>;
  /** Whether to yield the converted key, value, or pair. */
  #kind: MapIterationKind;
  /** Realm of the iterator-creation method, used for result objects and pairs. */
  #realm: JSRealm;
  /** Key conversion retaining the collection owner's binding and result realm. */
  #convertKey: ValueConverter;
  /** Value conversion retaining the collection owner's binding and result realm. */
  #convertValue: ValueConverter;

  constructor(
    entries: IDLMapEntries,
    kind: MapIterationKind,
    realm: JSRealm,
    convertKey: ValueConverter,
    convertValue: ValueConverter,
  ) {
    this.#iterator = entries.entries();
    this.#kind = kind;
    this.#realm = realm;
    this.#convertKey = convertKey;
    this.#convertValue = convertValue;
  }

  /** Convert both sides before selecting the yielded value, as required for map iterators. */
  next(): object {
    const result = this.#iterator.next();
    if (result.done) return this.#realm.createIteratorResultObject(undefined, true);

    const [idlKey, idlValue] = result.value;
    const key = this.#convertKey(idlKey);
    const value = this.#convertValue(idlValue);
    return this.#realm.createIteratorResultObject(
      this.#kind === 'key' ? key : this.#kind === 'value' ? value :
        createRealmArray([key, value], this.#realm),
      false,
    );
  }
}

/** Advance one live set cursor and convert its entries for the platform iterator. */
// https://webidl.spec.whatwg.org/#js-set-iterator
class SetIteratorRecord {
  /** Backing cursor observes changes to the collection between next calls. */
  #iterator: SetIterator<unknown>;
  /** Whether to yield the converted value or a pair containing it twice. */
  #kind: SetIterationKind;
  /** Realm of the iterator-creation method, used for result objects and pairs. */
  #realm: JSRealm;
  /** Value conversion retaining the collection owner's binding and result realm. */
  #convertValue: ValueConverter;

  constructor(
    entries: IDLSetEntries,
    kind: SetIterationKind,
    realm: JSRealm,
    convertValue: ValueConverter,
  ) {
    this.#iterator = entries.values();
    this.#kind = kind;
    this.#realm = realm;
    this.#convertValue = convertValue;
  }

  /** Convert each entry once, sharing that converted value between both sides of a pair. */
  next(): object {
    const result = this.#iterator.next();
    if (result.done) return this.#realm.createIteratorResultObject(undefined, true);

    const value = this.#convertValue(result.value);
    return this.#realm.createIteratorResultObject(
      this.#kind === 'value' ? value : createRealmArray([value, value], this.#realm),
      false,
    );
  }
}

export type IDLMapEntries = Map<unknown, unknown>;
export type IDLSetEntries = Set<unknown>;

type MapIterationKind = 'key' | 'key+value' | 'value';
type SetIterationKind = 'key+value' | 'value';

/** Convert a map key or set entry, replacing -0 with +0 for collection equality. */
// Floating-point conversion preserves -0; only keys and set entries normalize it here.
// https://webidl.spec.whatwg.org/#js-map-set
// https://webidl.spec.whatwg.org/#js-set-add
function convertCollectionValue(
  value: unknown,
  type: WebIDLType,
  binding: RealmBinding,
): unknown {
  const converted = jsToIDL(value, binding.getConversionContext(type));
  return typeof converted === 'number' && Object.is(converted, -0)
    ? 0
    : converted;
}

/** Allocate an array in the supplied realm containing already-converted values. */
// https://tc39.es/ecma262/#sec-createarrayfromlist
function createRealmArray(
  values: unknown[],
  realm: JSRealm,
): unknown[] {
  const result = Reflect.construct(
    realm.intrinsics.array,
    [values.length],
  );
  values.forEach((value, index) => {
    defineDataProperty(result, String(index), value);
  });
  return result;
}
