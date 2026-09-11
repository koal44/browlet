import { isObject } from '../js-engine/index';
import type { AssembledInterface } from './assembly';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type {
  MaplikeMember, SetlikeMember, WebIDLType,
} from './declaration/index';
import { defineDataProperty, defineMethod } from './property';

export class CollectionBinding {
  readonly #context: ConversionContext;

  constructor(context: ConversionContext) {
    this.#context = context;
  }

  initialize(object: object, interface_: AssembledInterface): void {
    const record = this.#context.platformObjects.getImplementationRecord(
      object,
    );
    if (!record) throw new Error('Collection object is not associated');

    for (let current: AssembledInterface | undefined = interface_;
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

  defineMaplike(
    target: object,
    interface_: AssembledInterface,
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

  defineSetlike(
    target: object,
    interface_: AssembledInterface,
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

  getMapEntries(object: object): IDLMapEntries {
    const entries = this.#context.platformObjects
      .getImplementationRecord(object)?.mapEntries;
    if (!entries) throw new Error('Object does not have Web IDL map entries');
    return entries;
  }

  getSetEntries(object: object): IDLSetEntries {
    const entries = this.#context.platformObjects
      .getImplementationRecord(object)?.setEntries;
    if (!entries) throw new Error('Object does not have Web IDL set entries');
    return entries;
  }

  #createSizeGetter(
    interface_: AssembledInterface,
    kind: CollectionKind,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#implementationObject(
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

  #createMapIteratorMethod(
    interface_: AssembledInterface,
    declaration: MaplikeMember,
    kind: MapIterationKind,
    name: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#implementationObject(
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

  #createSetIteratorMethod(
    interface_: AssembledInterface,
    declaration: SetlikeMember,
    kind: SetIterationKind,
    name: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#implementationObject(
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

  #createMapForEach(
    interface_: AssembledInterface,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createSetForEach(
    interface_: AssembledInterface,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createMapGet(
    interface_: AssembledInterface,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createMapHas(
    interface_: AssembledInterface,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createMapSet(
    interface_: AssembledInterface,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createMapDelete(
    interface_: AssembledInterface,
    declaration: MaplikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createSetHas(
    interface_: AssembledInterface,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createSetAdd(
    interface_: AssembledInterface,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createSetDelete(
    interface_: AssembledInterface,
    declaration: SetlikeMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
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

  #createClear(
    interface_: AssembledInterface,
    kind: CollectionKind,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const object = this.#implementationObject(
          thisArgument, interface_, 'clear', 'method',
        );
        if (kind === 'map') this.getMapEntries(object).clear();
        else this.getSetEntries(object).clear();
        return undefined;
      },
      { length: 0, name: 'clear' },
    );
  }

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

  #implementationObject(
    value: unknown,
    interface_: AssembledInterface,
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

function hasRegularOperation(
  interface_: AssembledInterface,
  name: string,
): boolean {
  return interface_.members.some(({ member }) =>
    member.kind === 'operation' &&
    member.name === name &&
    member.static !== true);
}

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
