import type { AssembledInterface } from './assembly';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type {
  MaplikeMember, SetlikeMember, WebIDLType,
} from './declaration/index';

export class CollectionBinding {
  readonly #context: ConversionContext;
  readonly #mapIterators = new WeakMap<object, MaplikeIterator>();
  readonly #mapNativeNext: unknown;
  readonly #mapNext: JavaScriptFunction;
  readonly #setIterators = new WeakMap<object, SetlikeIterator>();
  readonly #setNativeNext: unknown;
  readonly #setNext: JavaScriptFunction;

  constructor(context: ConversionContext) {
    this.#context = context;
    this.#mapNativeNext = Reflect.get(
      context.realm.intrinsics.iteration.mapIteratorPrototype,
      'next',
    );
    this.#mapNext = context.realm.createFunction(
      (thisArgument) => this.#nextMapIterator(thisArgument),
      { length: 0, name: 'next' },
    );
    this.#setNativeNext = Reflect.get(
      context.realm.intrinsics.iteration.setIteratorPrototype,
      'next',
    );
    this.#setNext = context.realm.createFunction(
      (thisArgument) => this.#nextSetIterator(thisArgument),
      { length: 0, name: 'next' },
    );
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
  ): JavaScriptFunction {
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
    const iterator = this.#createIteratorShell(
      this.#context.realm.intrinsics.iteration.mapIteratorPrototype,
      this.#mapNext,
      this.#mapNativeNext,
    );
    this.#mapIterators.set(iterator, {
      declaration,
      iterator: entries.entries(),
      kind,
    });
    return iterator;
  }

  #createSetIterator(
    entries: IDLSetEntries,
    declaration: SetlikeMember,
    kind: SetIterationKind,
  ): object {
    const iterator = this.#createIteratorShell(
      this.#context.realm.intrinsics.iteration.setIteratorPrototype,
      this.#setNext,
      this.#setNativeNext,
    );
    this.#setIterators.set(iterator, {
      declaration,
      iterator: entries.values(),
      kind,
    });
    return iterator;
  }

  #createIteratorShell(
    prototype: object,
    next: JavaScriptFunction,
    nativeNext: unknown,
  ): object {
    const target = createRealmObject(this.#context, prototype);
    return new Proxy(target, {
      get(target_, property, receiver): unknown {
        const value: unknown = Reflect.get(target_, property, receiver);
        if (
          property === 'next' &&
          !Object.hasOwn(target_, property) &&
          value === nativeNext
        ) return next;
        return value;
      },
    });
  }

  #nextMapIterator(thisArgument: unknown): object {
    if (!isObject(thisArgument)) this.#throwTypeError('Illegal invocation');
    const record = this.#mapIterators.get(thisArgument);
    if (!record) this.#throwTypeError('Illegal invocation');
    const result = record.iterator.next();
    if (result.done) {
      return createIteratorResult(this.#context, undefined, true);
    }

    const [idlKey, idlValue] = result.value;
    const key = convertToJavaScript(
      idlKey,
      record.declaration.key,
      this.#context,
    );
    const value = convertToJavaScript(
      idlValue,
      record.declaration.value,
      this.#context,
    );
    return createIteratorResult(
      this.#context,
      record.kind === 'key'
        ? key
        : record.kind === 'value'
          ? value
          : createRealmArray(this.#context, [key, value]),
      false,
    );
  }

  #nextSetIterator(thisArgument: unknown): object {
    if (!isObject(thisArgument)) this.#throwTypeError('Illegal invocation');
    const record = this.#setIterators.get(thisArgument);
    if (!record) this.#throwTypeError('Illegal invocation');
    const result = record.iterator.next();
    if (result.done) {
      return createIteratorResult(this.#context, undefined, true);
    }

    const value = convertToJavaScript(
      result.value,
      record.declaration.value,
      this.#context,
    );
    return createIteratorResult(
      this.#context,
      record.kind === 'value'
        ? value
        : createRealmArray(this.#context, [value, value]),
      false,
    );
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
type JavaScriptFunction = ReturnType<
  ConversionContext['realm']['createFunction']
>;

type MaplikeIterator = {
  declaration: MaplikeMember;
  iterator: MapIterator<[unknown, unknown]>;
  kind: MapIterationKind;
};

type SetlikeIterator = {
  declaration: SetlikeMember;
  iterator: SetIterator<unknown>;
  kind: SetIterationKind;
};

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

function createIteratorResult(
  context: ConversionContext,
  value: unknown,
  done: boolean,
): object {
  const result = createRealmObject(
    context,
    context.realm.intrinsics.objectPrototype,
  );
  defineDataProperty(result, 'value', value);
  defineDataProperty(result, 'done', done);
  return result;
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

function createRealmObject(
  context: ConversionContext,
  prototype: object | null,
): object {
  const object = Reflect.construct(context.realm.intrinsics.object, []);
  if (!Reflect.setPrototypeOf(object, prototype)) {
    throw new Error('Could not set a Web IDL object prototype');
  }
  return object;
}

function defineMethod(
  target: object,
  key: PropertyKey,
  value: unknown,
  enumerable: boolean,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable,
    value,
    writable: true,
  });
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  defineMethod(target, key, value, true);
}

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
