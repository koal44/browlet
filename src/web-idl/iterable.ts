import { isObject } from '../js-engine/index';
import type { AssembledInterfaceDefinition } from './assembly';
import { isCallbackFunctionValue } from './callback-value';
import { invokeCallbackFunction } from './callback';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import { reference, type IterableMember } from './core/index';
import { defineDataProperty, defineMethod } from './property';
import type { ImplementationRegistry } from './registry';

export type ValuePair<Key = unknown, Value = unknown> = {
  key: Key;
  value: Value;
};

export class SynchronousIterableBinding {
  readonly #context: ConversionContext;
  readonly #getIteratorPrototype: IteratorPrototypeFactory;
  readonly #implementations: ImplementationRegistry;
  readonly #iterators = new WeakMap<object, DefaultIterator>();

  // Project helper: retain the conversion context, implementations, and iterator-prototype factory.
  constructor(
    context: ConversionContext,
    implementations: ImplementationRegistry,
    getIteratorPrototype: IteratorPrototypeFactory,
  ) {
    this.#context = context;
    this.#getIteratorPrototype = getIteratorPrototype;
    this.#implementations = implementations;
  }

  // Web IDL §3.7.9 Iterable declarations — define the iteration methods.
  defineMethods(
    target: object,
    interface_: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): void {
    if (iterable.key === undefined) {
      this.defineIndexedMethods(target, true);
      return;
    }

    this.initializePrototype(interface_, iterable);
    this.#definePairIterationMethods(target, interface_, iterable);
  }

  // Project helper: initialize the pair iterator's prototype before installing methods.
  initializePrototype(
    interface_: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): void {
    if (iterable.key !== undefined) {
      this.#getIteratorPrototypeObject(interface_, iterable);
    }
  }

  // Extracted from Web IDL §3.7.9 Iterable declarations — install Array iteration methods for indexed
  // properties.
  defineIndexedMethods(target: object, valueIterable: boolean): void {
    const { iteration } = this.#context.realm.intrinsics;
    defineMethod(target, Symbol.iterator, iteration.arrayValues, false);
    if (!valueIterable) return;

    defineDataProperty(target, 'entries', iteration.arrayEntries);
    defineDataProperty(target, 'keys', iteration.arrayKeys);
    defineDataProperty(target, 'values', iteration.arrayValues);
    defineDataProperty(target, 'forEach', iteration.arrayForEach);
  }

  // Extracted from Web IDL §3.7.9 Iterable declarations — install pair iteration methods.
  #definePairIterationMethods(
    target: object,
    interface_: AssembledInterfaceDefinition,
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

  // Project factory for the entries, keys, and values functions in Web IDL §3.7.9 Iterable declarations.
  #createIteratorMethod(
    interface_: AssembledInterfaceDefinition,
    iterable: IterableMember,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const target = this.#unwrapReceiver(
          thisArgument,
          interface_,
          securityIdentifier,
        );
        const iterator = this.#context.realm.createOrdinaryObject(
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

  // Project factory for the forEach function in Web IDL §3.7.9 Iterable declarations.
  #createForEachMethod(
    interface_: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const object = this.#unwrapReceiver(
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
            [
              convertToJavaScript(
                pair.value,
                iterable.value,
                this.#context,
              ),
              convertToJavaScript(
                pair.key,
                iterable.key!,
                this.#context,
              ),
              platformObject,
            ],
            'rethrow',
            argumentsList[1],
          );
          pairs = this.#getValuePairs(object, interface_, iterable);
        }
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project cache for Web IDL §3.7.9.2 Iterator prototype object.
  #getIteratorPrototypeObject(
    interface_: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): object {
    return this.#getIteratorPrototype(interface_, () => {
      const prototype = this.#context.realm.createOrdinaryObject(
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

  // Web IDL §3.7.9.2 Iterator prototype object — next steps.
  #next(
    interface_: AssembledInterfaceDefinition,
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
      return this.#context.realm.createIteratorResultObject(
        undefined,
        true,
      );
    }

    const pair = pairs[iterator.index]!;
    iterator.index++;
    return this.#context.realm.createIteratorResultObject(
      this.#convertPairResult(pair, iterable, iterator.kind),
      false,
    );
  }

  // Extracted from Web IDL §3.7.9.2 Iterator prototype object — iterator result: select and convert the value.
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

  // Project delegate to Web IDL §2.5.9 Iterable declarations — the interface's value pairs to iterate over.
  #getValuePairs(
    object: object,
    interface_: AssembledInterfaceDefinition,
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

  // Project adapter for the receiver and security checks in Web IDL §3.7.9 Iterable declarations.
  #unwrapReceiver(
    value: unknown,
    interface_: AssembledInterfaceDefinition,
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

  // Project helper: throw a TypeError allocated in this binding's realm.
  #throwTypeError(message: string): never {
    throw new this.#context.realm.intrinsics.typeError(message);
  }
}

type IteratorPrototypeFactory = (
  interface_: AssembledInterfaceDefinition,
  create: () => object,
) => object;

type DefaultIterator = {
  index: number;
  interface: AssembledInterfaceDefinition;
  kind: IterationKind;
  target: object;
};

type IterationKind = 'key' | 'key+value' | 'value';
type JSFunction = ReturnType<
  ConversionContext['realm']['createFunction']
>;

const functionType = reference('Function');
