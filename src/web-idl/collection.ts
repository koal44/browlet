import { isObject, type JSFunction } from '../js-engine/index';
import type { AssembledInterface } from './assembled';
import { jsToIDL, idlToJS } from './conversion';
import type {
  MaplikeMember, SetlikeMember, WebIDLType,
} from './core/index';
import { getPlatformRecord, type PlatformRecord } from './platform-object';
import { defineDataProperty, defineMethod } from './property';
import type { RealmBinding } from './realm-binding';
import type { WebIDLRealm } from './realm';
import { InternalError } from '../infra/internal-error';

export class CollectionBinding {
  #binding: RealmBinding;

  // Project helper: retain the realm binding used to install collection members.
  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  // Project storage for Web IDL §2.5.11 Maplike declarations and §2.5.12 Setlike declarations — map/set
  // entries.
  initialize(record: PlatformRecord): void {
    const member = record.assembled.getCollectionMember(true);
    if (member?.kind === 'maplike') record.mapEntries ??= new Map();
    else if (member?.kind === 'setlike') record.setEntries ??= new Set();
  }

  // Web IDL §3.7.11 Maplike declarations — install the declared properties.
  defineMaplike(
    target: object,
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(assembled, 'map'),
    });

    const entries = this.#createMapIteratorMethod(
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
      this.#createMapIteratorMethod(
        assembled, member, 'key', 'keys',
      ),
    );
    defineDataProperty(
      target,
      'values',
      this.#createMapIteratorMethod(
        assembled, member, 'value', 'values',
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createMapForEach(assembled, member),
    );
    defineDataProperty(
      target,
      'get',
      this.#createMapGet(assembled, member),
    );
    defineDataProperty(
      target,
      'has',
      this.#createMapHas(assembled, member),
    );

    if (member.readonly) return;
    if (!assembled.hasInstanceOperation('set')) {
      defineDataProperty(
        target,
        'set',
        this.#createMapSet(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createMapDelete(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('clear')) {
      defineDataProperty(target, 'clear', this.#createClear(assembled, 'map'));
    }
  }

  // Web IDL §3.7.12 Setlike declarations — install the declared properties.
  defineSetlike(
    target: object,
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(assembled, 'set'),
    });

    const values = this.#createSetIteratorMethod(
      assembled,
      member,
      'value',
      'values',
    );
    defineMethod(target, Symbol.iterator, values, false);
    defineDataProperty(
      target,
      'entries',
      this.#createSetIteratorMethod(
        assembled, member, 'key+value', 'entries',
      ),
    );
    defineDataProperty(target, 'keys', values);
    defineDataProperty(target, 'values', values);
    defineDataProperty(
      target,
      'forEach',
      this.#createSetForEach(assembled, member),
    );
    defineDataProperty(
      target,
      'has',
      this.#createSetHas(assembled, member),
    );

    if (member.readonly) return;
    if (!assembled.hasInstanceOperation('add')) {
      defineDataProperty(
        target,
        'add',
        this.#createSetAdd(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createSetDelete(assembled, member),
      );
    }
    if (!assembled.hasInstanceOperation('clear')) {
      defineDataProperty(target, 'clear', this.#createClear(assembled, 'set'));
    }
  }

  // Project helper: retrieve map entries retained in the implementation's binding record.
  getMapEntries(record: PlatformRecord | undefined): IDLMapEntries {
    const entries = record?.mapEntries;
    if (!entries) throw new InternalError('Object does not have Web IDL map entries');
    return entries;
  }

  // Project helper: retrieve set entries retained in the implementation's binding record.
  getSetEntries(record: PlatformRecord | undefined): IDLSetEntries {
    const entries = record?.setEntries;
    if (!entries) throw new InternalError('Object does not have Web IDL set entries');
    return entries;
  }

  // Project factory for Web IDL §3.7.11.1 size and §3.7.12.1 size getters.
  #createSizeGetter(
    assembled: AssembledInterface,
    kind: CollectionKind,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          assembled,
          'size',
          'getter',
        );
        return kind === 'map'
          ? this.getMapEntries(receiver).size
          : this.getSetEntries(receiver).size;
      },
      { length: 0, name: 'get size' },
    );
  }

  // Project factory for Web IDL §3.7.11.3 entries, §3.7.11.4 keys, and §3.7.11.5 values.
  #createMapIteratorMethod(
    assembled: AssembledInterface,
    member: MaplikeMember,
    kind: MapIterationKind,
    name: string,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          assembled,
          name,
          'method',
        );
        return this.#createMapIterator(
          this.getMapEntries(receiver),
          member,
          kind,
          receiver.binding,
        );
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.12.3 entries and §3.7.12.5 values.
  #createSetIteratorMethod(
    assembled: AssembledInterface,
    member: SetlikeMember,
    kind: SetIterationKind,
    name: string,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          assembled,
          name,
          'method',
        );
        return this.#createSetIterator(
          this.getSetEntries(receiver),
          member,
          kind,
          receiver.binding,
        );
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.11.6 forEach.
  #createMapForEach(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          assembled,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.#throwTypeError('Callback is not callable');
        }
        const binding = receiver.binding;
        this.getMapEntries(receiver).forEach((value, key) => {
          Reflect.apply(callback, argumentsList[1], [
            idlToJS(value, binding.getConversionContext(member.value, this.#binding.realm)),
            idlToJS(key, binding.getConversionContext(member.key, this.#binding.realm)),
            receiver.platformObject,
          ]);
        });
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project factory for Web IDL §3.7.12.6 forEach.
  #createSetForEach(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          assembled,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.#throwTypeError('Callback is not callable');
        }
        const binding = receiver.binding;
        this.getSetEntries(receiver).forEach((value) => {
          const javaScriptValue = idlToJS(value, binding.getConversionContext(member.value, this.#binding.realm));
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

  // Project factory for Web IDL §3.7.11.7 get.
  #createMapGet(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'get', 'method',
        );
        const entries = this.getMapEntries(receiver);
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.#binding,
        );
        if (!entries.has(key)) return undefined;
        return idlToJS(entries.get(key), receiver.binding.getConversionContext(member.value, this.#binding.realm));
      },
      { length: 1, name: 'get' },
    );
  }

  // Project factory for Web IDL §3.7.11.8 has.
  #createMapHas(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'has', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.#binding,
        );
        return this.getMapEntries(receiver).has(key);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.11.9 set.
  #createMapSet(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'set', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.#binding,
        );
        const value = jsToIDL(argumentsList[1], this.#binding.getConversionContext(member.value, this.#binding.realm));
        this.getMapEntries(receiver).set(key, value);
        return receiver.platformObject;
      },
      { length: 2, name: 'set' },
    );
  }

  // Project factory for Web IDL §3.7.11.10 delete.
  #createMapDelete(
    assembled: AssembledInterface,
    member: MaplikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'delete', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], member.key, this.#binding,
        );
        return this.getMapEntries(receiver).delete(key);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.12.7 has.
  #createSetHas(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'has', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], member.value, this.#binding,
        );
        return this.getSetEntries(receiver).has(value);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.12.8 add.
  #createSetAdd(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'add', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], member.value, this.#binding,
        );
        this.getSetEntries(receiver).add(value);
        return receiver.platformObject;
      },
      { length: 1, name: 'add' },
    );
  }

  // Project factory for Web IDL §3.7.12.9 delete.
  #createSetDelete(
    assembled: AssembledInterface,
    member: SetlikeMember,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'delete', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], member.value, this.#binding,
        );
        return this.getSetEntries(receiver).delete(value);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.11.11 clear and §3.7.12.10 clear.
  #createClear(
    assembled: AssembledInterface,
    kind: CollectionKind,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, assembled, 'clear', 'method',
        );
        if (kind === 'map') this.getMapEntries(receiver).clear();
        else this.getSetEntries(receiver).clear();
        return undefined;
      },
      { length: 0, name: 'clear' },
    );
  }

  // Project adapter for Web IDL §3.7.11.2 %Symbol.iterator% — create a map iterator.
  #createMapIterator(
    entries: IDLMapEntries,
    member: MaplikeMember,
    kind: MapIterationKind,
    binding: RealmBinding,
  ): object {
    const iterator = entries.entries();
    return this.#binding.realm.createCollectionIterator('map', () => {
      const result = iterator.next();
      if (result.done) {
        return this.#binding.realm.createIteratorResultObject(undefined, true);
      }

      const [idlKey, idlValue] = result.value;
      const key = idlToJS(idlKey, binding.getConversionContext(member.key, this.#binding.realm));
      const value = idlToJS(idlValue, binding.getConversionContext(member.value, this.#binding.realm));
      return this.#binding.realm.createIteratorResultObject(
        kind === 'key' ? key : kind === 'value' ? value :
          createRealmArray(this.#binding.realm, [key, value]),
        false,
      );
    });
  }

  // Project adapter for Web IDL §3.7.12.2 %Symbol.iterator% — create a set iterator.
  #createSetIterator(
    entries: IDLSetEntries,
    member: SetlikeMember,
    kind: SetIterationKind,
    binding: RealmBinding,
  ): object {
    const iterator = entries.values();
    return this.#binding.realm.createCollectionIterator('set', () => {
      const result = iterator.next();
      if (result.done) {
        return this.#binding.realm.createIteratorResultObject(undefined, true);
      }

      const value = idlToJS(result.value, binding.getConversionContext(member.value, this.#binding.realm));
      return this.#binding.realm.createIteratorResultObject(
        kind === 'value' ? value : createRealmArray(this.#binding.realm, [value, value]),
        false,
      );
    });
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.11 Maplike declarations and §3.7.12
  // Setlike declarations.
  #getReceiverRecord(
    value: unknown,
    assembled: AssembledInterface,
    identifier: string,
    type: 'getter' | 'method',
  ): PlatformRecord {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.world !== this.#binding.world) {
      this.#throwTypeError('Illegal invocation');
    }
    this.#binding.realm.performSecurityCheck(value, identifier, type);
    if (!record.implements(assembled)) {
      this.#throwTypeError('Illegal invocation');
    }
    return record;
  }

  // Project helper: throw a TypeError allocated in this binding's realm.
  #throwTypeError(message: string): never {
    throw new this.#binding.realm.intrinsics.typeError(message);
  }
}

export type IDLMapEntries = Map<unknown, unknown>;
export type IDLSetEntries = Set<unknown>;

type CollectionKind = 'map' | 'set';
type MapIterationKind = 'key' | 'key+value' | 'value';
type SetIterationKind = 'key+value' | 'value';

// Extracted from Web IDL §3.7.11 Maplike declarations and §3.7.12 Setlike declarations — convert keys/entries
// and replace -0 with +0.
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

// Project adapter to ECMAScript §7.3.17 CreateArrayFromList using the binding's realm.
function createRealmArray(
  realm: WebIDLRealm,
  values: unknown[],
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
