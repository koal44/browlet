import { isObject, type JSFunction } from '../js-engine/index';
import { InternalPromise } from '../infra/promises';
import { Stamper } from '../infra/stamper';
import type { AssembledArgument, AssembledCallable, AssembledInterface } from './assembled';
import { endOfIteration } from './async-sequence';
import { jsToIDL, idlToJS } from './conversion';
import { idlType, type AsyncIterableMember } from './core/index';
import type { AsyncIteratorSteps } from './definition-binding';
import { missingArgument } from './overload';
import { getPlatformRecord, type PlatformRecord } from './platform-object';
import { PromiseCarrier } from './promise';
import { defineDataProperty, defineMethod } from './property';
import type { RealmBinding } from './realm-binding';
import { InternalError } from '../infra/internal-error';

/** Install async iterator methods and prototypes in one realm. */
export class AsyncIterableBinding {
  /** Binding for the installed methods and their realm-owned results. */
  #binding: RealmBinding;

  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  /** Install the exposed interface's async iteration methods using its prepared arguments. */
  // https://webidl.spec.whatwg.org/#js-asynchronous-iterable
  defineMethods(
    target: object,
    assembled: AssembledInterface,
    callable: AssembledCallable<AsyncIterableMember>,
  ): void {
    if (callable.primary.key === undefined) {
      const values = this.#createIteratorMethod(
        assembled, callable, 'value', 'values', 'values',
      );
      defineDataProperty(target, 'values', values);
      defineMethod(target, Symbol.asyncIterator, values, false);
      return;
    }

    const entries = this.#createIteratorMethod(
      assembled, callable, 'key+value', 'entries', '%Symbol.asyncIterator%',
    );
    defineMethod(target, Symbol.asyncIterator, entries, false);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(target, 'keys',
      this.#createIteratorMethod(assembled, callable, 'key', 'keys', 'keys'));
    defineDataProperty(target, 'values',
      this.#createIteratorMethod(assembled, callable, 'value', 'values', 'values'));
  }

  // https://webidl.spec.whatwg.org/#js-asynchronous-iterable
  #createIteratorMethod(
    assembled: AssembledInterface,
    callable: AssembledCallable<AsyncIterableMember>,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JSFunction<StampedAsyncIterator> {
    const member = callable.primary;
    const prototype = this.#getIteratorPrototypeObject(assembled, member);
    return this.#binding.realm.createFunction(
      (thisArgument, argumentsList) => {
        const receiver = this.#getReceiverRecord(thisArgument, assembled, securityIdentifier);
        const iterator = this.#binding.realm.createOrdinaryObject(prototype);
        const steps = getAsyncIteratorSteps(assembled, member, this.#binding);
        const implementationIterator = steps.create(
          receiver.implInst, this.#convertArguments(callable.arguments, argumentsList),
        );
        return AsyncIteratorStamper.stamp(iterator, new AsyncIteratorRecord(
          implementationIterator, assembled, member, kind, receiver.binding,
        ));
      },
      { length: 0, name },
    );
  }

  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #getIteratorPrototypeObject(assembled: AssembledInterface, member: AsyncIterableMember): object {
    const definitionBinding = this.#binding.getDefinitionBinding(assembled);
    if (definitionBinding.asyncIteratorPrototype) return definitionBinding.asyncIteratorPrototype;

    const prototype = this.#binding.realm.createOrdinaryObject(
      this.#binding.realm.intrinsics.iteration.asyncIteratorPrototype,
    );
    defineDataProperty(prototype, 'next', this.#binding.realm.createFunction(
      (thisArgument) => this.#next(assembled, thisArgument),
      { length: 0, name: 'next' },
    ));

    const steps = this.#binding.getMemberBinding(assembled, member)?.asyncIteratorSteps;
    if (steps?.return) {
      defineDataProperty(prototype, 'return', this.#binding.realm.createFunction(
        (thisArgument, [value]) => this.#return(assembled, thisArgument, value),
        { length: 1, name: 'return' },
      ));
    }
    Object.defineProperty(prototype, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      value: `${assembled.primary.name} AsyncIterator`,
      writable: false,
    });
    definitionBinding.asyncIteratorPrototype = prototype;
    return prototype;
  }

  // Receiver checks precede the iterator's own next/return steps.
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #next(assembled: AssembledInterface, thisArgument: unknown): Promise<unknown> {
    let state: AsyncIteratorRecord;
    try {
      state = this.#getIteratorState(thisArgument, assembled, 'next');
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, this.#binding.realm, this.#binding.realizeException).promise;
    }
    return state.next(this.#binding);
  }

  #return(assembled: AssembledInterface, thisArgument: unknown, value: unknown): Promise<unknown> {
    let state: AsyncIteratorRecord;
    try {
      state = this.#getIteratorState(thisArgument, assembled, 'return');
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, this.#binding.realm, this.#binding.realizeException).promise;
    }
    return state.return(value, this.#binding);
  }

  // https://webidl.spec.whatwg.org/#js-asynchronous-iterable
  #convertArguments(arguments_: AssembledArgument[], argumentsList: unknown[]): unknown[] {
    return arguments_.map((argument, index) => {
      const value = argumentsList[index];
      if (index >= argumentsList.length || value === undefined) {
        return argument.primary.default === undefined
          ? missingArgument
          : this.#binding.getConversionContext(argument.type).createDefault(argument.primary.default);
      }
      return jsToIDL(value, this.#binding.getConversionContext(argument.type));
    });
  }

  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #getIteratorState(value: unknown, assembled: AssembledInterface, identifier: string): AsyncIteratorRecord {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    if (getPlatformRecord(value)?.binding.world === this.#binding.world) {
      this.#binding.realm.performSecurityCheck(value, identifier, 'method');
    }
    const state = AsyncIteratorStamper.get(value);
    if (!state || state.assembled !== assembled || state.receiverBinding.world !== this.#binding.world) {
      this.#throwTypeError('Illegal invocation');
    }
    return state;
  }

  // https://webidl.spec.whatwg.org/#js-asynchronous-iterable
  #getReceiverRecord(value: unknown, assembled: AssembledInterface, identifier: string): PlatformRecord {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.world !== this.#binding.world) this.#throwTypeError('Illegal invocation');
    this.#binding.realm.performSecurityCheck(value, identifier, 'method');
    if (!record.implements(assembled)) this.#throwTypeError('Illegal invocation');
    return record;
  }

  #throwTypeError(message: string): never {
    throw new this.#binding.realm.intrinsics.typeError(message);
  }
}

/** Track one platform async iterator and convert the implementation's results for author code. */
class AsyncIteratorRecord {
  /** Iterator supplied by the implementation's factory. */
  implementationIterator: object;
  /** Interface identity required when checking an iterator receiver. */
  assembled: AssembledInterface;
  /** Declaration supplying the key and value conversion types. */
  member: AsyncIterableMember;
  /** Whether this iterator yields keys, values, or key/value pairs. */
  kind: IterationKind;
  /** Original receiver's binding, used to project yielded implementations. */
  receiverBinding: RealmBinding;
  /** Whether completion, closing, or failure has ended implementation iteration. */
  #finished = false;
  /** Last queued operation, used to serialize overlapping next and return calls. */
  #ongoing: PromiseCarrier | null = null;

  constructor(
    implementationIterator: object,
    assembled: AssembledInterface,
    member: AsyncIterableMember,
    kind: IterationKind,
    receiverBinding: RealmBinding,
  ) {
    this.implementationIterator = implementationIterator;
    this.assembled = assembled;
    this.member = member;
    this.kind = kind;
    this.receiverBinding = receiverBinding;
  }

  /** Queue an advance, allocating its promise and result in the invoked method's realm. */
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  next(methodBinding: RealmBinding): Promise<unknown> {
    return this.#enqueue(() => this.#runNext(methodBinding), methodBinding).promise;
  }

  /** Queue closing and return a completed result in the invoked method's realm. */
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  return(value: unknown, methodBinding: RealmBinding): Promise<unknown> {
    const ongoing = this.#enqueue(() => this.#runReturn(value, methodBinding), methodBinding);
    return this.#react(ongoing.promise,
      () => methodBinding.realm.createIteratorResultObject(value, true),
      undefined, methodBinding,
    ).promise;
  }

  // nextSteps and its fulfillment/rejection steps.
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #runNext(methodBinding: RealmBinding): PromiseCarrier {
    const { realm, realizeException } = methodBinding;
    if (this.#finished) {
      return PromiseCarrier.fromJS(realm.createIteratorResultObject(undefined, true), idlType.any, realm, realizeException);
    }

    const steps = getAsyncIteratorSteps(this.assembled, this.member, methodBinding);
    let nextPromise: Promise<unknown> | InternalPromise<unknown>;
    try {
      nextPromise = steps.next(this.implementationIterator);
    } catch (exception) {
      this.#finished = true;
      return PromiseCarrier.rejected(exception, idlType.any, realm, realizeException);
    }

    return this.#react(nextPromise,
      (next) => {
        this.#ongoing = null;
        if (next === endOfIteration) {
          this.#finished = true;
          return realm.createIteratorResultObject(undefined, true);
        }
        return realm.createIteratorResultObject(this.#convertResult(next, methodBinding), false);
      },
      (reason) => {
        this.#ongoing = null;
        this.#finished = true;
        throw reason;
      },
      methodBinding,
    );
  }

  // returnSteps.
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #runReturn(value: unknown, methodBinding: RealmBinding): PromiseCarrier {
    const { realm, realizeException } = methodBinding;
    if (this.#finished) return PromiseCarrier.fromJS(value, idlType.any, realm, realizeException);
    this.#finished = true;

    const steps = getAsyncIteratorSteps(this.assembled, this.member, methodBinding);
    if (!steps.return) {
      return PromiseCarrier.rejected(
        new InternalError('Asynchronous iterator return steps are missing'), idlType.any, realm, realizeException,
      );
    }
    try {
      return this.#react(steps.return(this.implementationIterator, value), () => undefined, undefined, methodBinding);
    } catch (exception) {
      return PromiseCarrier.rejected(exception, idlType.any, realm, realizeException);
    }
  }

  // Serialize next/return using the ongoing promise, including after closing.
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #enqueue(action: () => PromiseCarrier, methodBinding: RealmBinding): PromiseCarrier {
    const ongoing = this.#ongoing;
    if (!ongoing) return this.#ongoing = action();

    const afterOngoing = new PromiseCarrier(idlType.any, methodBinding.realm, methodBinding.realizeException);
    const onSettled = methodBinding.realm.createFunction(
      () => {
        try {
          afterOngoing.resolve(action().promise);
        } catch (exception) {
          afterOngoing.reject(exception);
        }
      },
      { length: 0, name: '' },
    );
    methodBinding.realm.observePromise(ongoing.promise, onSettled, onSettled);
    this.#ongoing = afterOngoing;
    return afterOngoing;
  }

  // Observe the implementation promise directly so conversion adds no adoption step.
  #react(
    promise: Promise<unknown> | InternalPromise<unknown>,
    fulfilled: (value: unknown) => unknown,
    rejected: ((reason: unknown) => unknown) | undefined,
    methodBinding: RealmBinding,
  ): PromiseCarrier {
    const result = new PromiseCarrier(idlType.any, methodBinding.realm, methodBinding.realizeException);
    const onFulfilled = methodBinding.realm.createFunction(
      (_thisArgument, [value]) => {
        try {
          result.resolve(fulfilled(value));
        } catch (exception) {
          result.reject(exception);
        }
      },
      { length: 1, name: '' },
    );
    const onRejected = methodBinding.realm.createFunction(
      (_thisArgument, [reason]) => {
        if (!rejected) {
          result.reject(reason);
          return;
        }
        try {
          result.resolve(rejected(reason));
        } catch (exception) {
          result.reject(exception);
        }
      },
      { length: 1, name: '' },
    );
    try {
      if (promise instanceof InternalPromise) {
        methodBinding.realm.Promise.fromInternal(promise).observe(onFulfilled, onRejected);
      } else {
        methodBinding.realm.observePromise(promise, onFulfilled, onRejected);
      }
    } catch (exception) {
      onRejected(exception);
    }
    return result;
  }

  // Select and convert the yielded value before resolving the result promise.
  // https://webidl.spec.whatwg.org/#dfn-asynchronous-iterator-prototype-object
  #convertResult(next: unknown, methodBinding: RealmBinding): unknown {
    const member = this.member;
    if (member.key === undefined) {
      return idlToJS(next, this.receiverBinding.getConversionContext(member.value, methodBinding.realm));
    }
    if (!Array.isArray(next) || next.length < 2) {
      throw new InternalError('Pair asynchronous iterator produced a non-pair value');
    }

    const key = this.kind === 'value' ? undefined
      : idlToJS(next[0], this.receiverBinding.getConversionContext(member.key, methodBinding.realm));
    const value = this.kind === 'key' ? undefined
      : idlToJS(next[1], this.receiverBinding.getConversionContext(member.value, methodBinding.realm));
    if (this.kind === 'key') return key;
    if (this.kind === 'value') return value;

    const pair = Reflect.construct(methodBinding.realm.intrinsics.array, [2]);
    defineDataProperty(pair, '0', key);
    defineDataProperty(pair, '1', value);
    return pair;
  }
}

type StampedAsyncIterator<T extends object = object> = T & AsyncIteratorStamper;

/** Attach iteration state without exposing properties or accepting proxied receivers. */
class AsyncIteratorStamper extends Stamper {
  /** State retained by this platform iterator. */
  #state: AsyncIteratorRecord;

  private constructor(iterator: object, state: AsyncIteratorRecord) {
    super(iterator);
    this.#state = state;
  }

  static stamp<T extends object>(iterator: T, state: AsyncIteratorRecord): StampedAsyncIterator<T> {
    new AsyncIteratorStamper(iterator, state);
    return iterator as StampedAsyncIterator<T>;
  }

  static get(value: object): AsyncIteratorRecord | undefined {
    return #state in value ? value.#state : undefined;
  }
}

type IterationKind = 'key' | 'key+value' | 'value';

/** Get the invoked realm's implementation steps for creating or advancing an iterator. */
function getAsyncIteratorSteps(
  assembled: AssembledInterface, member: AsyncIterableMember, binding: RealmBinding,
): AsyncIteratorSteps {
  const steps = binding.getMemberBinding(assembled, member)?.asyncIteratorSteps;
  if (!steps) throw new InternalError(`Missing ${assembled.primary.name} asynchronous iterator implementation`);
  return steps;
}
