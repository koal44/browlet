import { isObject } from '../js-engine/index';
import type { AssembledInterfaceDefinition } from './assembly';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type {
  MaplikeMember, SetlikeMember, WebIDLType,
} from './core/index';
import { defineDataProperty, defineMethod } from './property';

export class CollectionBinding {
  readonly #context: ConversionContext;

  // Project helper: retain the conversion context for collection members.
  constructor(context: ConversionContext) {
    this.#context = context;
  }

  // Project storage for Web IDL §2.5.11 Maplike declarations and §2.5.12 Setlike declarations — map/set
  // entries.
  initialize(object: object, interface_: AssembledInterfaceDefinition): void {
    const record = this.#context.platformObjects.getImplementationRecord(
      object,
    );
    if (!record) throw new Error('Collection object is not associated');

    for (let current: AssembledInterfaceDefinition | undefined = interface_;
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
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(interface_, 'map'),
    });

    const entries = this.#createMapIteratorMethod(
      interface_,
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
        interface_, declaration, 'key', 'keys',
      ),
    );
    defineDataProperty(
      target,
      'values',
      this.#createMapIteratorMethod(
        interface_, declaration, 'value', 'values',
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createMapForEach(interface_, declaration),
    );
    defineDataProperty(
      target,
      'get',
      this.#createMapGet(interface_, declaration),
    );
    defineDataProperty(
      target,
      'has',
      this.#createMapHas(interface_, declaration),
    );

    if (declaration.readonly) return;
    if (!hasRegularOperation(interface_, 'set')) {
      defineDataProperty(
        target,
        'set',
        this.#createMapSet(interface_, declaration),
      );
    }
    if (!hasRegularOperation(interface_, 'delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createMapDelete(interface_, declaration),
      );
    }
    if (!hasRegularOperation(interface_, 'clear')) {
      defineDataProperty(target, 'clear', this.#createClear(interface_, 'map'));
    }
  }

  // Web IDL §3.7.12 Setlike declarations — install the declared properties.
  defineSetlike(
    target: object,
    interface_: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): void {
    Object.defineProperty(target, 'size', {
      configurable: true,
      enumerable: true,
      get: this.#createSizeGetter(interface_, 'set'),
    });

    const values = this.#createSetIteratorMethod(
      interface_,
      declaration,
      'value',
      'values',
    );
    defineMethod(target, Symbol.iterator, values, false);
    defineDataProperty(
      target,
      'entries',
      this.#createSetIteratorMethod(
        interface_, declaration, 'key+value', 'entries',
      ),
    );
    defineDataProperty(target, 'keys', values);
    defineDataProperty(target, 'values', values);
    defineDataProperty(
      target,
      'forEach',
      this.#createSetForEach(interface_, declaration),
    );
    defineDataProperty(
      target,
      'has',
      this.#createSetHas(interface_, declaration),
    );

    if (declaration.readonly) return;
    if (!hasRegularOperation(interface_, 'add')) {
      defineDataProperty(
        target,
        'add',
        this.#createSetAdd(interface_, declaration),
      );
    }
    if (!hasRegularOperation(interface_, 'delete')) {
      defineDataProperty(
        target,
        'delete',
        this.#createSetDelete(interface_, declaration),
      );
    }
    if (!hasRegularOperation(interface_, 'clear')) {
      defineDataProperty(target, 'clear', this.#createClear(interface_, 'set'));
    }
  }

  // Project helper: retrieve map entries retained in the implementation's binding record.
  getMapEntries(object: object): IDLMapEntries {
    const entries = this.#context.platformObjects
      .getImplementationRecord(object)?.mapEntries;
    if (!entries) throw new Error('Object does not have Web IDL map entries');
    return entries;
  }

  // Project helper: retrieve set entries retained in the implementation's binding record.
  getSetEntries(object: object): IDLSetEntries {
    const entries = this.#context.platformObjects
      .getImplementationRecord(object)?.setEntries;
    if (!entries) throw new Error('Object does not have Web IDL set entries');
    return entries;
  }

  // Project factory for Web IDL §3.7.11.1 size and §3.7.12.1 size getters.
  #createSizeGetter(
    interface_: AssembledInterfaceDefinition,
    kind: CollectionKind,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#unwrapReceiver(
          thisArgument,
          interface_,
          'size',
          'getter',
        );
        return kind === 'map'
          ? this.getMapEntries(object).size
          : this.getSetEntries(object).size;
      },
      { length: 0, name: 'get size' },
    );
  }

  // Project factory for Web IDL §3.7.11.3 entries, §3.7.11.4 keys, and §3.7.11.5 values.
  #createMapIteratorMethod(
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
    kind: MapIterationKind,
    name: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#unwrapReceiver(
          thisArgument,
          interface_,
          name,
          'method',
        );
        return this.#createMapIterator(
          this.getMapEntries(object),
          declaration,
          kind,
        );
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.12.3 entries and §3.7.12.5 values.
  #createSetIteratorMethod(
    interface_: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
    kind: SetIterationKind,
    name: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#unwrapReceiver(
          thisArgument,
          interface_,
          name,
          'method',
        );
        return this.#createSetIterator(
          this.getSetEntries(object),
          declaration,
          kind,
        );
      },
      { length: 0, name },
    );
  }

  // Project factory for Web IDL §3.7.11.6 forEach.
  #createMapForEach(
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument,
          interface_,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.#throwTypeError('Callback is not callable');
        }
        const platformObject = this.#context.platformObjects
          .getPlatformObject(object);
        if (!platformObject) {
          throw new Error('Collection implementation has no platform object');
        }
        this.getMapEntries(object).forEach((value, key) => {
          Reflect.apply(callback, argumentsList[1], [
            convertToJavaScript(value, declaration.value, this.#context),
            convertToJavaScript(key, declaration.key, this.#context),
            platformObject,
          ]);
        });
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project factory for Web IDL §3.7.12.6 forEach.
  #createSetForEach(
    interface_: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument,
          interface_,
          'forEach',
          'method',
        );
        const callback = argumentsList[0];
        if (typeof callback !== 'function') {
          this.#throwTypeError('Callback is not callable');
        }
        const platformObject = this.#context.platformObjects
          .getPlatformObject(object);
        if (!platformObject) {
          throw new Error('Collection implementation has no platform object');
        }
        this.getSetEntries(object).forEach((value) => {
          const javaScriptValue = convertToJavaScript(
            value,
            declaration.value,
            this.#context,
          );
          Reflect.apply(callback, argumentsList[1], [
            javaScriptValue,
            javaScriptValue,
            platformObject,
          ]);
        });
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project factory for Web IDL §3.7.11.7 get.
  #createMapGet(
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'get', 'method',
        );
        const entries = this.getMapEntries(object);
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
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'has', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        return this.getMapEntries(object).has(key);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.11.9 set.
  #createMapSet(
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'set', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        const value = convertToIDL(
          argumentsList[1], declaration.value, this.#context,
        );
        this.getMapEntries(object).set(key, value);
        const platformObject = this.#context.platformObjects
          .getPlatformObject(object);
        if (!platformObject) {
          throw new Error('Collection implementation has no platform object');
        }
        return platformObject;
      },
      { length: 2, name: 'set' },
    );
  }

  // Project factory for Web IDL §3.7.11.10 delete.
  #createMapDelete(
    interface_: AssembledInterfaceDefinition,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'delete', 'method',
        );
        const key = convertCollectionValue(
          argumentsList[0], declaration.key, this.#context,
        );
        return this.getMapEntries(object).delete(key);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.12.7 has.
  #createSetHas(
    interface_: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'has', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], declaration.value, this.#context,
        );
        return this.getSetEntries(object).has(value);
      },
      { length: 1, name: 'has' },
    );
  }

  // Project factory for Web IDL §3.7.12.8 add.
  #createSetAdd(
    interface_: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'add', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], declaration.value, this.#context,
        );
        this.getSetEntries(object).add(value);
        const platformObject = this.#context.platformObjects
          .getPlatformObject(object);
        if (!platformObject) {
          throw new Error('Collection implementation has no platform object');
        }
        return platformObject;
      },
      { length: 1, name: 'add' },
    );
  }

  // Project factory for Web IDL §3.7.12.9 delete.
  #createSetDelete(
    interface_: AssembledInterfaceDefinition,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'delete', 'method',
        );
        const value = convertCollectionValue(
          argumentsList[0], declaration.value, this.#context,
        );
        return this.getSetEntries(object).delete(value);
      },
      { length: 1, name: 'delete' },
    );
  }

  // Project factory for Web IDL §3.7.11.11 clear and §3.7.12.10 clear.
  #createClear(
    interface_: AssembledInterfaceDefinition,
    kind: CollectionKind,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#unwrapReceiver(
          thisArgument, interface_, 'clear', 'method',
        );
        if (kind === 'map') this.getMapEntries(object).clear();
        else this.getSetEntries(object).clear();
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
  #unwrapReceiver(
    value: unknown,
    interface_: AssembledInterfaceDefinition,
    identifier: string,
    type: 'getter' | 'method',
  ): object {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = this.#context.platformObjects.getRecord(value);
    if (record) {
      this.#context.realm.performSecurityCheck(value, identifier, type);
    }
    if (
      !record ||
      !this.#context.platformObjects.recordImplements(record, interface_)
    ) {
      this.#throwTypeError('Illegal invocation');
    }
    return record.implementation;
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
  interface_: AssembledInterfaceDefinition,
  name: string,
): boolean {
  return interface_.members.some(({ member }) =>
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
