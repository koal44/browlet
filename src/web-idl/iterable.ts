import type { AssembledInterface } from './assembly';
import { isCallbackFunctionValue } from './callback-value';
import { invokeCallbackFunction } from './callback';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import { reference, type IterableMember } from './definition';
import type {
  ImplementationRegistry, ValuePair,
} from './implementation';

export class SynchronousIterableBinding {
  readonly #context: ConversionContext;
  readonly #getIteratorPrototype: IteratorPrototypeFactory;
  readonly #implementations: ImplementationRegistry;
  readonly #iterators = new WeakMap<object, DefaultIterator>();

  constructor(
    context: ConversionContext,
    implementations: ImplementationRegistry,
    getIteratorPrototype: IteratorPrototypeFactory,
  ) {
    this.#context = context;
    this.#getIteratorPrototype = getIteratorPrototype;
    this.#implementations = implementations;
  }

  defineMethods(
    target: object,
    interface_: AssembledInterface,
    iterable: IterableMember,
  ): void {
    if (iterable.key === undefined) {
      this.defineIndexedMethods(target, true);
      return;
    }

    this.initializePrototype(interface_, iterable);
    this.#definePairIterationMethods(target, interface_, iterable);
  }

  initializePrototype(
    interface_: AssembledInterface,
    iterable: IterableMember,
  ): void {
    if (iterable.key !== undefined) {
      this.#getIteratorPrototypeObject(interface_, iterable);
    }
  }

  defineIndexedMethods(target: object, valueIterable: boolean): void {
    const { iteration } = this.#context.realm.intrinsics;
    defineMethod(target, Symbol.iterator, iteration.arrayValues, false);
    if (!valueIterable) return;

    defineDataProperty(target, 'entries', iteration.arrayEntries);
    defineDataProperty(target, 'keys', iteration.arrayKeys);
    defineDataProperty(target, 'values', iteration.arrayValues);
    defineDataProperty(target, 'forEach', iteration.arrayForEach);
  }

  #definePairIterationMethods(
    target: object,
    interface_: AssembledInterface,
    iterable: IterableMember,
  ): void {
    const entries = this.#createIteratorMethod(
      interface_,
      iterable,
      'key+value',
      'entries',
      '%Symbol.iterator%',
    );
    defineMethod(target, Symbol.iterator, entries, false);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(
      target,
      'keys',
      this.#createIteratorMethod(interface_, iterable, 'key', 'keys', 'keys'),
    );
    defineDataProperty(
      target,
      'values',
      this.#createIteratorMethod(
        interface_,
        iterable,
        'value',
        'values',
        'values',
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createForEachMethod(interface_, iterable),
    );
  }

  #createIteratorMethod(
    interface_: AssembledInterface,
    iterable: IterableMember,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JavaScriptFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const target = this.#implementationObject(
          thisArgument,
          interface_,
          securityIdentifier,
        );
        const iterator = createRealmObject(
          this.#context,
          this.#getIteratorPrototypeObject(interface_, iterable),
        );
        this.#iterators.set(iterator, {
          index: 0,
          interface: interface_,
          kind,
          target,
        });
        return iterator;
      },
      { length: 0, name },
    );
  }

  #createForEachMethod(
    interface_: AssembledInterface,
    iterable: IterableMember,
  ): JavaScriptFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#implementationObject(
          thisArgument,
          interface_,
          'forEach',
        );
        const callback = convertToIDL(
          argumentsList[0],
          functionType,
          this.#context,
        );
        if (!isCallbackFunctionValue(callback)) {
          throw new Error('Function conversion did not produce a callback');
        }
        const platformObject = this.#context.platformObjects
          .getPlatformObject(object);
        if (!platformObject) {
          throw new Error('Iterable implementation has no platform object');
        }

        let pairs = this.#getValuePairs(object, interface_, iterable);
        for (let index = 0; index < pairs.length; index++) {
          const pair = pairs[index]!;
          invokeCallbackFunction(
            callback,
            [pair.value, pair.key, platformObject],
            'rethrow',
            this.#context,
            argumentsList[1],
          );
          pairs = this.#getValuePairs(object, interface_, iterable);
        }
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  #getIteratorPrototypeObject(
    interface_: AssembledInterface,
    iterable: IterableMember,
  ): object {
    return this.#getIteratorPrototype(interface_, () => {
      const prototype = createRealmObject(
        this.#context,
        this.#context.realm.intrinsics.iteration.iteratorPrototype,
      );
      const next = this.#context.realm.createFunction(
        (thisArgument) => this.#next(interface_, iterable, thisArgument),
        { length: 0, name: 'next' },
      );
      defineDataProperty(prototype, 'next', next);
      Object.defineProperty(prototype, Symbol.toStringTag, {
        configurable: true,
        enumerable: false,
        value: `${interface_.definition.name} Iterator`,
        writable: false,
      });
      return prototype;
    });
  }

  #next(
    interface_: AssembledInterface,
    iterable: IterableMember,
    thisArgument: unknown,
  ): object {
    if (!isObject(thisArgument)) this.#throwTypeError('Illegal invocation');
    if (this.#context.platformObjects.isPlatformObject(thisArgument)) {
      this.#context.realm.performSecurityCheck(
        thisArgument,
        'next',
        'method',
      );
    }
    const iterator = this.#iterators.get(thisArgument);
    if (!iterator || iterator.interface !== interface_) {
      this.#throwTypeError('Illegal invocation');
    }

    const pairs = this.#getValuePairs(
      iterator.target,
      interface_,
      iterable,
    );
    if (iterator.index >= pairs.length) {
      return createIteratorResult(this.#context, undefined, true);
    }

    const pair = pairs[iterator.index]!;
    iterator.index++;
    return createIteratorResult(
      this.#context,
      this.#convertPairResult(pair, iterable, iterator.kind),
      false,
    );
  }

  #convertPairResult(
    pair: ValuePair,
    iterable: IterableMember,
    kind: IterationKind,
  ): unknown {
    const key = kind === 'value'
      ? undefined
      : convertToJavaScript(pair.key, iterable.key!, this.#context);
    const value = kind === 'key'
      ? undefined
      : convertToJavaScript(pair.value, iterable.value, this.#context);

    if (kind === 'key') return key;
    if (kind === 'value') return value;

    const result = Reflect.construct(this.#context.realm.intrinsics.array, [2]);
    defineDataProperty(result, '0', key);
    defineDataProperty(result, '1', value);
    return result;
  }

  #getValuePairs(
    object: object,
    interface_: AssembledInterface,
    iterable: IterableMember,
  ): readonly ValuePair[] {
    const steps = this.#implementations.getValuePairsSteps(iterable);
    if (!steps) {
      throw new Error(
        `Missing ${interface_.definition.name} value-pairs implementation`,
      );
    }
    return Reflect.apply(steps, object, []);
  }

  #implementationObject(
    value: unknown,
    interface_: AssembledInterface,
    identifier: string,
  ): object {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = this.#context.platformObjects.getRecord(value);
    if (record) {
      this.#context.realm.performSecurityCheck(value, identifier, 'method');
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

type IteratorPrototypeFactory = (
  interface_: AssembledInterface,
  create: () => object,
) => object;

type DefaultIterator = {
  index: number;
  interface: AssembledInterface;
  kind: IterationKind;
  target: object;
};

type IterationKind = 'key' | 'key+value' | 'value';
type JavaScriptFunction = ReturnType<
  ConversionContext['realm']['createFunction']
>;

const functionType = reference('Function');

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
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
