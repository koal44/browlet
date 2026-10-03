import { InternalError, Stamper } from '../../../infra/index';
import { defineDataProperty, defineMethod, isObject, type JSFunction } from '../../../js-engine/index';

import type { IDLIterable, AssembledInterface } from '../../assembly/index';
import { IDLCallbackFunction } from '../../values/index';
import {
  getImplementationRecord, getPlatformRecord, type StampedImplInstance,
} from '../platform';
import type { RealmBinding } from '../realm';

// Value pairs use the implementation's existing entry tuples.
export type ValuePair<Key = unknown, Value = unknown> = [key: Key, value: Value];

export class SynchronousIterableBinding {
  #binding: RealmBinding;

  // Project helper: retain the owning realm binding.
  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  // Web IDL §3.7.9 Iterable declarations — define the iteration methods.
  defineMethods(
    target: object,
    assembled: AssembledInterface,
    member: IDLIterable,
  ): void {
    if (member.key === undefined) {
      this.defineIndexedMethods(target, true);
      return;
    }

    this.#getIteratorPrototypeObject(assembled, member);
    this.#definePairIterationMethods(target, assembled, member);
  }

  // Extracted from Web IDL §3.7.9 Iterable declarations — install Array iteration methods for indexed
  // properties.
  defineIndexedMethods(target: object, valueIterable: boolean): void {
    const { iteration } = this.#binding.realm.intrinsics;
    defineMethod(target, Symbol.iterator, iteration.arrayValues);
    if (!valueIterable) return;

    defineDataProperty(target, 'entries', iteration.arrayEntries);
    defineDataProperty(target, 'keys', iteration.arrayKeys);
    defineDataProperty(target, 'values', iteration.arrayValues);
    defineDataProperty(target, 'forEach', iteration.arrayForEach);
  }

  // Extracted from Web IDL §3.7.9 Iterable declarations — install pair iteration methods.
  #definePairIterationMethods(
    target: object,
    assembled: AssembledInterface,
    member: IDLIterable,
  ): void {
    const entries = this.#createIteratorMethod(
      assembled, member, 'key+value', 'entries', '%Symbol.iterator%'
    );
    defineMethod(target, Symbol.iterator, entries);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(
      target,
      'keys',
      this.#createIteratorMethod(assembled, member, 'key', 'keys', 'keys'),
    );
    defineDataProperty(
      target,
      'values',
      this.#createIteratorMethod(
        assembled, member, 'value', 'values', 'values'
      ),
    );
    defineDataProperty(
      target,
      'forEach',
      this.#createForEachMethod(assembled, member),
    );
  }

  // Project factory for the entries, keys, and values functions in Web IDL §3.7.9 Iterable declarations.
  #createIteratorMethod(
    assembled: AssembledInterface,
    member: IDLIterable,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JSFunction<StampedDefaultIterator> {
    return this.#binding.realm.createFunction(
      (thisArgument) => {
        const receiver = this.#binding.getDirectReceiverRecord(
          thisArgument, assembled, securityIdentifier, 'method',
        );
        const iterator = this.#binding.realm.createOrdinaryObject(
          this.#getIteratorPrototypeObject(assembled, member),
        );
        return DefaultIteratorStamper.stamp(iterator, {
          index: 0,
          assembled,
          kind,
          target: receiver.implInst,
        });
      },
      { length: 0, name },
    );
  }

  // Project factory for the forEach function in Web IDL §3.7.9 Iterable declarations.
  #createForEachMethod(
    assembled: AssembledInterface,
    member: IDLIterable,
  ): JSFunction {
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#binding.getDirectReceiverRecord(
          thisArgument, assembled, 'forEach', 'method',
        );
        const callback = this.#binding.getConverter(this.#binding.assembly.getNamedType('Function')).jsToIDL(argumentsList[0]);
        if (!IDLCallbackFunction.is(callback)) {
          throw new InternalError('Function conversion did not produce a callback');
        }
        const binding = receiver.binding;
        let pairs = this.#getValuePairs(receiver.implInst, assembled, member);
        for (let index = 0; index < pairs.length; index++) {
          const [key, value] = pairs[index]!;
          callback.invoke(
            [
              binding.getConverter(member.value, this.#binding.realm).idlToJS(value),
              binding.getConverter(member.key!, this.#binding.realm).idlToJS(key),
              receiver.platformObject,
            ],
            'rethrow',
            argumentsList[1],
          );
          pairs = this.#getValuePairs(receiver.implInst, assembled, member);
        }
        return undefined;
      },
      { length: 1, name: 'forEach' },
    );
  }

  // Project cache for Web IDL §3.7.9.2 Iterator prototype object.
  #getIteratorPrototypeObject(
    assembled: AssembledInterface,
    member: IDLIterable,
  ): object {
    const implementationBinding = this.#binding.getImplementationBinding(assembled);
    if (implementationBinding.iteratorPrototype) return implementationBinding.iteratorPrototype;

    const prototype = this.#binding.realm.createOrdinaryObject(
      this.#binding.realm.intrinsics.iteration.iteratorPrototype,
    );
    const next = this.#binding.realm.createFunction(
      (thisArgument) => this.#next(assembled, member, thisArgument),
      { length: 0, name: 'next' },
    );
    defineDataProperty(prototype, 'next', next);
    Object.defineProperty(prototype, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: `${assembled.primary.name} Iterator`,
      writable: false,
    });
    implementationBinding.iteratorPrototype = prototype;
    return prototype;
  }

  // Web IDL §3.7.9.2 Iterator prototype object — next steps.
  #next(
    assembled: AssembledInterface,
    member: IDLIterable,
    thisArgument: unknown,
  ): object {
    if (!isObject(thisArgument)) this.#throwTypeError('Illegal invocation');
    if (getPlatformRecord(thisArgument)?.binding.world === this.#binding.world) {
      this.#binding.realm.performSecurityCheck(
        thisArgument,
        'next',
        'method',
      );
    }
    const iterator = DefaultIteratorStamper.get(thisArgument);
    const receiver = iterator && getImplementationRecord(iterator.target);
    if (!iterator || iterator.assembled !== assembled ||
      receiver?.binding.world !== this.#binding.world) {
      this.#throwTypeError('Illegal invocation');
    }

    const pairs = this.#getValuePairs(
      iterator.target,
      assembled,
      member,
    );
    if (iterator.index >= pairs.length) {
      return this.#binding.realm.createIteratorResultObject(
        undefined,
        true,
      );
    }

    const pair = pairs[iterator.index]!;
    iterator.index++;
    // The collection owns unprojected interface values. Iterator result allocation
    // still belongs to the next method's realm, independently of those identities.
    const binding = receiver.binding;
    return this.#binding.realm.createIteratorResultObject(
      this.#convertPairResult(pair, member, iterator.kind, binding),
      false,
    );
  }

  // Extracted from Web IDL §3.7.9.2 Iterator prototype object — iterator result: select and convert the value.
  #convertPairResult(
    [key, value]: ValuePair,
    member: IDLIterable,
    kind: IterationKind,
    binding: RealmBinding,
  ): unknown {
    const convertedKey = kind === 'value'
      ? undefined
      : binding.getConverter(member.key!, this.#binding.realm).idlToJS(key);
    const convertedValue = kind === 'key'
      ? undefined
      : binding.getConverter(member.value, this.#binding.realm).idlToJS(value);

    if (kind === 'key') return convertedKey;
    if (kind === 'value') return convertedValue;

    const result = Reflect.construct(this.#binding.realm.intrinsics.array, [2]);
    defineDataProperty(result, '0', convertedKey);
    defineDataProperty(result, '1', convertedValue);
    return result;
  }

  // Project delegate to Web IDL §2.5.9 Iterable declarations — the interface's value pairs to iterate over.
  #getValuePairs(
    implInst: StampedImplInstance,
    assembled: AssembledInterface,
    member: IDLIterable,
  ): ValuePair[] {
    const steps = this.#binding.getMemberBinding(assembled, member)?.valuePairsSteps;
    if (!steps) {
      throw new InternalError(
        `Missing ${assembled.primary.name} value-pairs implementation`,
      );
    }
    return Reflect.apply(steps, implInst, []);
  }

  // Project helper: throw a TypeError allocated in this binding's realm.
  #throwTypeError(message: string): never {
    throw new this.#binding.realm.intrinsics.typeError(message);
  }
}

/** Read the implementation's current key/value pairs for default iteration. */
export type ValuePairsSteps = (
  this: StampedImplInstance,
) => ValuePair[];

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
  assembled: AssembledInterface;
  kind: IterationKind;
  target: StampedImplInstance;
};

type IterationKind = 'key' | 'key+value' | 'value';
