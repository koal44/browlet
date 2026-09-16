import { isObject } from '../js-engine/index';
import type { AssembledInterfaceDefinition } from './assembly';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type {
  MaplikeMember, SetlikeMember, WebIDLType,
} from './core/index';
import { getPlatformRecord, type PlatformRecord } from './platform-object';
import { defineDataProperty, defineMethod } from './property';

export class CollectionBinding {
  readonly #context: ConversionContext;

  // Project helper: retain the conversion context for collection members.
  constructor(context: ConversionContext) {
    this.#context = context;
  }

  // Project storage for Web IDL §2.5.11 Maplike declarations and §2.5.12 Setlike declarations — map/set
  // entries.
  initialize(record: PlatformRecord): void {
    for (let current: AssembledInterfaceDefinition | undefined = record.primaryInterface;
      current;
      current = current.parent) {
      const declaration = current.members.find(({ member }) =>
        member.kind === 'maplike' || member.kind === 'setlike')?.member;
      if (declaration?.kind === 'maplike') {
        record.mapEntries ??= new Map();
        return;
      }
      if (declaration?.kind === 'setlike') {
        record.setEntries ??= new Set();
        return;
      }
    }
  }

  // Web IDL §3.7.11 Maplike declarations — install the declared properties.
  defineMaplike(
    target: object,
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(primaryInterface, 'map'),
    });

    const entries = this.#createMapIteratorMethod(
      primaryInterface,
      declaration,
      'key+value',
      'entries',
    );
    defineMethod(target, Symbol.iterator, entries, false);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(
      target,
      'keys',
      this.#createMapIteratorMethod(
        primaryInterface, declaration, 'key', 'keys',
      ),
    );
    defineDataProperty(
      target,
      'values',
      this.#createMapIteratorMethod(
        primaryInterface, declaration, 'value', 'values',
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createMapForEach(primaryInterface, declaration),
    );
    defineDataProperty(
      target,
      'get',
      this.#createMapGet(primaryInterface, declaration),
    );
    defineDataProperty(
      target,
      'has',
      this.#createMapHas(primaryInterface, declaration),
    );

    if (declaration.readonly) return;
    if (!hasRegularOperation(primaryInterface, 'set')) {
      defineDataProperty(
        target,
        'set',
        this.#createMapSet(primaryInterface, declaration),
      );
    }
    if (!hasRegularOperation(primaryInterface, 'delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createMapDelete(primaryInterface, declaration),
      );
    }
    if (!hasRegularOperation(primaryInterface, 'clear')) {
      defineDataProperty(target, 'clear', this.#createClear(primaryInterface, 'map'));
    }
  }

  // Web IDL §3.7.12 Setlike declarations — install the declared properties.
  defineSetlike(
    target: object,
    primaryInterface: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(primaryInterface, 'set'),
    });

    const values = this.#createSetIteratorMethod(
      primaryInterface,
      declaration,
      'value',
      'values',
    );
    defineMethod(target, Symbol.iterator, values, false);
    defineDataProperty(
      target,
      'entries',
      this.#createSetIteratorMethod(
        primaryInterface, declaration, 'key+value', 'entries',
      ),
    );
    defineDataProperty(target, 'keys', values);
    defineDataProperty(target, 'values', values);
    defineDataProperty(
      target,
      'forEach',
      this.#createSetForEach(primaryInterface, declaration),
    );
    defineDataProperty(
      target,
      'has',
      this.#createSetHas(primaryInterface, declaration),
    );

    if (declaration.readonly) return;
    if (!hasRegularOperation(primaryInterface, 'add')) {
      defineDataProperty(
        target,
        'add',
        this.#createSetAdd(primaryInterface, declaration),
      );
    }
    if (!hasRegularOperation(primaryInterface, 'delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createSetDelete(primaryInterface, declaration),
      );
    }
    if (!hasRegularOperation(primaryInterface, 'clear')) {
      defineDataProperty(target, 'clear', this.#createClear(primaryInterface, 'set'));
    }
  }

  // Project helper: retrieve map entries retained in the implementation's binding record.
  getMapEntries(record: PlatformRecord | undefined): IDLMapEntries {
    const entries = record?.mapEntries;
    if (!entries) throw new Error('Object does not have Web IDL map entries');
    return entries;
  }

  // Project helper: retrieve set entries retained in the implementation's binding record.
  getSetEntries(record: PlatformRecord | undefined): IDLSetEntries {
    const entries = record?.setEntries;
    if (!entries) throw new Error('Object does not have Web IDL set entries');
    return entries;
  }

  // Project factory for Web IDL §3.7.11.1 size and §3.7.12.1 size getters.
  #createSizeGetter(
    primaryInterface: AssembledInterfaceDefinition,
    kind: CollectionKind,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
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
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
    kind: MapIterationKind,
    name: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
          name,
          'method',
        );
        return this.#createMapIterator(
          this.getMapEntries(receiver),
          declaration,
          kind,
        );
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.12.3 entries and §3.7.12.5 values.
  #createSetIteratorMethod(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
    kind: SetIterationKind,
    name: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
          name,
          'method',
        );
        return this.#createSetIterator(
          this.getSetEntries(receiver),
          declaration,
          kind,
        );
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.11.6 forEach.
  #createMapForEach(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.#throwTypeError('Callback is not callable');
        }
        this.getMapEntries(receiver).forEach((value, key) => {
          Reflect.apply(callback, argumentsList[1], [
            convertToJavaScript(value, declaration.value, this.#context),
            convertToJavaScript(key, declaration.key, this.#context),
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
    primaryInterface: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.#throwTypeError('Callback is not callable');
        }
        this.getSetEntries(receiver).forEach((value) => {
          const javaScriptValue = convertToJavaScript(
            value,
            declaration.value,
            this.#context,
          );
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
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'get', 'method',
        );
        const entries = this.getMapEntries(receiver);
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        if (!entries.has(key)) return undefined;
        return convertToJavaScript(
          entries.get(key),
          declaration.value,
          this.#context,
        );
      },
      { length: 1, name: 'get' },
    );
  }

  // Project factory for Web IDL §3.7.11.8 has.
  #createMapHas(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'has', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        return this.getMapEntries(receiver).has(key);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.11.9 set.
  #createMapSet(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'set', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        const value = convertToIDL(
          argumentsList[1], declaration.value, this.#context,
        );
        this.getMapEntries(receiver).set(key, value);
        return receiver.platformObject;
      },
      { length: 2, name: 'set' },
    );
  }

  // Project factory for Web IDL §3.7.11.10 delete.
  #createMapDelete(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'delete', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        return this.getMapEntries(receiver).delete(key);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.12.7 has.
  #createSetHas(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'has', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], declaration.value, this.#context,
        );
        return this.getSetEntries(receiver).has(value);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.12.8 add.
  #createSetAdd(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'add', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], declaration.value, this.#context,
        );
        this.getSetEntries(receiver).add(value);
        return receiver.platformObject;
      },
      { length: 1, name: 'add' },
    );
  }

  // Project factory for Web IDL §3.7.12.9 delete.
  #createSetDelete(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'delete', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], declaration.value, this.#context,
        );
        return this.getSetEntries(receiver).delete(value);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.11.11 clear and §3.7.12.10 clear.
  #createClear(
    primaryInterface: AssembledInterfaceDefinition,
    kind: CollectionKind,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument, primaryInterface, 'clear', 'method',
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
    declaration: MaplikeMember,
    kind: MapIterationKind,
  ): object {
    const iterator = entries.entries();
    return this.#context.realm.createCollectionIterator('map', () => {
      const result = iterator.next();
      if (result.done) {
        return this.#context.realm.createIteratorResultObject(undefined, true);
      }

      const [idlKey, idlValue] = result.value;
      const key = convertToJavaScript(idlKey, declaration.key, this.#context);
      const value = convertToJavaScript(idlValue, declaration.value, this.#context);
      return this.#context.realm.createIteratorResultObject(
        kind === 'key' ? key : kind === 'value' ? value :
          createRealmArray(this.#context, [key, value]),
        false,
      );
    });
  }

  // Project adapter for Web IDL §3.7.12.2 %Symbol.iterator% — create a set iterator.
  #createSetIterator(
    entries: IDLSetEntries,
    declaration: SetlikeMember,
    kind: SetIterationKind,
  ): object {
    const iterator = entries.values();
    return this.#context.realm.createCollectionIterator('set', () => {
      const result = iterator.next();
      if (result.done) {
        return this.#context.realm.createIteratorResultObject(undefined, true);
      }

      const value = convertToJavaScript(result.value, declaration.value, this.#context);
      return this.#context.realm.createIteratorResultObject(
        kind === 'value' ? value : createRealmArray(this.#context, [value, value]),
        false,
      );
    });
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.11 Maplike declarations and §3.7.12
  // Setlike declarations.
  #getReceiverRecord(
    value: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
    type: 'getter' | 'method',
  ): PlatformRecord {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.world !== this.#context.world) {
      this.#throwTypeError('Illegal invocation');
    }
    this.#context.realm.performSecurityCheck(value, identifier, type);
    if (!record.implements(primaryInterface)) {
      this.#throwTypeError('Illegal invocation');
    }
    return record;
  }

  // Project helper: throw a TypeError allocated in this binding's realm.
  #throwTypeError(message: string): never {
    throw new this.#context.realm.intrinsics.typeError(message);
  }
}

export type IDLMapEntries = Map<unknown, unknown>;
export type IDLSetEntries = Set<unknown>;

type CollectionKind = 'map' | 'set';
type MapIterationKind = 'key' | 'key+value' | 'value';
type SetIterationKind = 'key+value' | 'value';
type JSFunction = ReturnType<
  ConversionContext['realm']['createFunction']
>;

// Extracted from Web IDL §3.7.11 Maplike declarations and §3.7.12 Setlike declarations — convert keys/entries
// and replace -0 with +0.
function convertCollectionValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): unknown {
  const converted = convertToIDL(value, type, context);
  return typeof converted === 'number' && Object.is(converted, -0)
    ? 0
    : converted;
}

// Project predicate for Web IDL §3.7.11 Maplike declarations and §3.7.12 Setlike declarations — explicit
// operation overrides.
function hasRegularOperation(
  primaryInterface: AssembledInterfaceDefinition,
  name: string,
): boolean {
  return primaryInterface.members.some(({ member }) =>
    member.kind === 'operation' &&
    member.name === name &&
    member.static !== true);
}

// Project adapter to ECMAScript §7.3.17 CreateArrayFromList using the binding's realm.
function createRealmArray(
  context: ConversionContext,
  values: unknown[],
): unknown[] {
  const result = Reflect.construct(
    context.realm.intrinsics.array,
    [values.length],
  );
  values.forEach((value, index) => {
    defineDataProperty(result, String(index), value);
  });
  return result;
}
