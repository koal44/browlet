import { isObject, type JSFunction } from '../js-engine/index';
import { Stamper } from '../infra/stamper';
import type { AssembledInterfaceDefinition } from './assembly';
import { isCallbackFunctionValue } from './callback-value';
import { invokeCallbackFunction } from './callback';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import { reference, type IterableMember } from './core/index';
import {
  getImplementationRecord, getPlatformRecord, type StampedImplInstance,
  type PlatformRecord,
} from './platform-object';
import { defineDataProperty, defineMethod } from './property';
import type { ImplementationRegistry } from './implementation-registry';

// Value pairs use the implementation's existing entry tuples.
// SPEC_MISMATCH: value pair { key, value }
export type ValuePair<Key = unknown, Value = unknown> = readonly [key: Key, value: Value];

export class SynchronousIterableBinding {
  readonly #context: ConversionContext;
  readonly #getIteratorPrototype: IteratorPrototypeFactory;
  readonly #implementations: ImplementationRegistry;

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
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): void {
    if (iterable.key === undefined) {
      this.defineIndexedMethods(target, true);
      return;
    }

    this.initializePrototype(primaryInterface, iterable);
    this.#definePairIterationMethods(target, primaryInterface, iterable);
  }

  // Project helper: initialize the pair iterator's prototype before installing methods.
  initializePrototype(
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): void {
    if (iterable.key !== undefined) {
      this.#getIteratorPrototypeObject(primaryInterface, iterable);
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
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): void {
    const entries = this.#createIteratorMethod(
      primaryInterface,
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
      this.#createIteratorMethod(primaryInterface, iterable, 'key', 'keys', 'keys'),
    );
    defineDataProperty(
      target,
      'values',
      this.#createIteratorMethod(
        primaryInterface,
        iterable,
        'value',
        'values',
        'values',
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createForEachMethod(primaryInterface, iterable),
    );
  }

  // Project factory for the entries, keys, and values functions in Web IDL §3.7.9 Iterable declarations.
  #createIteratorMethod(
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JSFunction<StampedDefaultIterator> {
    return this.#context.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
          securityIdentifier,
        );
        const iterator = this.#context.realm.createOrdinaryObject(
          this.#getIteratorPrototypeObject(primaryInterface, iterable),
        );
        return DefaultIteratorStamper.stamp(iterator, {
          index: 0,
          primaryInterface,
          kind,
          target: receiver.implInst,
        });
      },
      { length: 0, name },
    );
  }

  // Project factory for the forEach function in Web IDL §3.7.9 Iterable declarations.
  #createForEachMethod(
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): JSFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(
          thisArgument,
          primaryInterface,
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
        let pairs = this.#getValuePairs(receiver.implInst, primaryInterface, iterable);
        for (let index = 0; index < pairs.length; index++) {
          const [key, value] = pairs[index]!;
          invokeCallbackFunction(
            callback,
            [
              convertToJavaScript(
                value,
                iterable.value,
                this.#context,
              ),
              convertToJavaScript(
                key,
                iterable.key!,
                this.#context,
              ),
              receiver.platformObject,
            ],
            'rethrow',
            argumentsList[1],
          );
          pairs = this.#getValuePairs(receiver.implInst, primaryInterface, iterable);
        }
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project cache for Web IDL §3.7.9.2 Iterator prototype object.
  #getIteratorPrototypeObject(
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): object {
    return this.#getIteratorPrototype(primaryInterface, () => {
      const prototype = this.#context.realm.createOrdinaryObject(
        this.#context.realm.intrinsics.iteration.iteratorPrototype,
      );
      const next = this.#context.realm.createFunction(
        (thisArgument) => this.#next(primaryInterface, iterable, thisArgument),
        { length: 0, name: 'next' },
      );
      defineDataProperty(prototype, 'next', next);
      Object.defineProperty(prototype, Symbol.toStringTag, {
        configurable: true,
        enumerable: false,
        value: `${primaryInterface.definition.name} Iterator`,
        writable: false,
      });
      return prototype;
    });
  }

  // Web IDL §3.7.9.2 Iterator prototype object — next steps.
  #next(
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
    thisArgument: unknown,
  ): object {
    if (!isObject(thisArgument)) this.#throwTypeError('Illegal invocation');
    if (getPlatformRecord(thisArgument)?.binding.world === this.#context.world) {
      this.#context.realm.performSecurityCheck(
        thisArgument,
        'next',
        'method',
      );
    }
    const iterator = DefaultIteratorStamper.get(thisArgument);
    if (!iterator || iterator.primaryInterface !== primaryInterface ||
      getImplementationRecord(iterator.target)?.binding.world !== this.#context.world) {
      this.#throwTypeError('Illegal invocation');
    }

    const pairs = this.#getValuePairs(
      iterator.target,
      primaryInterface,
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
    [key, value]: ValuePair,
    iterable: IterableMember,
    kind: IterationKind,
  ): unknown {
    const convertedKey = kind === 'value'
      ? undefined
      : convertToJavaScript(key, iterable.key!, this.#context);
    const convertedValue = kind === 'key'
      ? undefined
      : convertToJavaScript(value, iterable.value, this.#context);

    if (kind === 'key') return convertedKey;
    if (kind === 'value') return convertedValue;

    const result = Reflect.construct(this.#context.realm.intrinsics.array, [2]);
    defineDataProperty(result, '0', convertedKey);
    defineDataProperty(result, '1', convertedValue);
    return result;
  }

  // Project delegate to Web IDL §2.5.9 Iterable declarations — the interface's value pairs to iterate over.
  #getValuePairs(
    implInst: StampedImplInstance,
    primaryInterface: AssembledInterfaceDefinition,
    iterable: IterableMember,
  ): readonly ValuePair[] {
    const steps = this.#implementations.getValuePairsSteps(iterable);
    if (!steps) {
      throw new Error(
        `Missing ${primaryInterface.definition.name} value-pairs implementation`,
      );
    }
    return Reflect.apply(steps, implInst, []);
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.9 Iterable declarations.
  #getReceiverRecord(
    value: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
  ): PlatformRecord {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.world !== this.#context.world) {
      this.#throwTypeError('Illegal invocation');
    }
    this.#context.realm.performSecurityCheck(value, identifier, 'method');
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

type IteratorPrototypeFactory = (
  primaryInterface: AssembledInterfaceDefinition,
  create: () => object,
) => object;

type StampedDefaultIterator<T extends object = object> = T & DefaultIteratorStamper;

class DefaultIteratorStamper extends Stamper {
  #state: DefaultIterator;

  private constructor(iterator: object, state: DefaultIterator) {
    super(iterator);
    this.#state = state;
  }

  static stamp<T extends object>(iterator: T, state: DefaultIterator): StampedDefaultIterator<T> {
    new DefaultIteratorStamper(iterator, state);
    return iterator as StampedDefaultIterator<T>;
  }

  static get(value: object): DefaultIterator | undefined {
    return #state in value ? value.#state : undefined;
  }
}

type DefaultIterator = {
  index: number;
  primaryInterface: AssembledInterfaceDefinition;
  kind: IterationKind;
  target: StampedImplInstance;
};

type IterationKind = 'key' | 'key+value' | 'value';

const functionType = reference('Function');
