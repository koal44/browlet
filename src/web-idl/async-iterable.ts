import { isObject, PromiseValue, type JSFunction } from '../js-engine/index';
import { Stamper } from '../infra/stamper';
import type { AssembledInterfaceDefinition } from './assembly';
import { endOfIteration } from './async-sequence';
import {
  convertToIDL, convertToJavaScript, materializeDefaultValue,
  type ConversionContext,
} from './conversion';
import {
  idlType, type ArgumentDefinition, type AsyncIterableMember,
} from './core/index';
import type {
  AsyncIteratorSteps, ImplementationRegistry,
} from './implementation-registry';
import { missingArgument } from './overload';
import {
  getPlatformRecord, type StampedImplInstance, type PlatformObjectRegistry,
} from './platform-object';
import {
  createIDLPromiseRecord, type IDLPromiseRecord,
} from './promise-record';
import { defineDataProperty, defineMethod } from './property';
import { getTypeWithApplicableExtendedAttributes } from './types';

export class AsynchronousIterableBinding {
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

  // Web IDL §3.7.10 Asynchronous iterable declarations — define the asynchronous iteration methods.
  defineMethods(
    target: object,
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
  ): void {
    this.initializePrototype(primaryInterface, declaration);
    if (declaration.key === undefined) {
      const values = this.#createIteratorMethod(
        primaryInterface, declaration, 'value', 'values', 'values',
      );
      defineDataProperty(target, 'values', values);
      defineMethod(target, Symbol.asyncIterator, values, false);
      return;
    }

    const entries = this.#createIteratorMethod(
      primaryInterface, declaration, 'key+value', 'entries',
      '%Symbol.asyncIterator%',
    );
    defineMethod(target, Symbol.asyncIterator, entries, false);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(
      target,
      'keys',
      this.#createIteratorMethod(
        primaryInterface, declaration, 'key', 'keys', 'keys',
      ),
    );
    defineDataProperty(
      target,
      'values',
      this.#createIteratorMethod(
        primaryInterface, declaration, 'value', 'values', 'values',
      ),
    );
  }

  // Project helper: initialize the asynchronous iterator's prototype before installing methods.
  initializePrototype(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
  ): void {
    this.#getIteratorPrototypeObject(primaryInterface, declaration);
  }

  // Project factory for the entries, keys, and values functions in Web IDL §3.7.10 Asynchronous iterable
  // declarations.
  #createIteratorMethod(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JSFunction<StampedAsyncIterator> {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const target = this.#unwrapReceiver(
          thisArgument,
          primaryInterface,
          securityIdentifier,
        );
        const iterator = this.#context.realm.createOrdinaryObject(
          this.#getIteratorPrototypeObject(primaryInterface, declaration),
        );
        const steps = this.#requireSteps(primaryInterface, declaration);
        const implementation = steps.create(
          target,
          this.#convertArguments(declaration.arguments ?? [], argumentsList),
        );
        return AsyncIteratorStamper.stamp(iterator, {
          finished: false,
          implementation,
          primaryInterface,
          kind,
          ongoing: null,
          platformObjects: this.#context.platformObjects,
        });
      },
      { length: 0, name },
    );
  }

  // Project cache for Web IDL §3.7.10.2 Asynchronous iterator prototype object.
  #getIteratorPrototypeObject(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
  ): object {
    return this.#getIteratorPrototype(primaryInterface, () => {
      const prototype = this.#context.realm.createOrdinaryObject(
        this.#context.realm.intrinsics.iteration.asyncIteratorPrototype,
      );
      defineDataProperty(
        prototype,
        'next',
        this.#context.realm.createFunction(
          (thisArgument) => this.#next(primaryInterface, declaration, thisArgument),
          { length: 0, name: 'next' },
        ),
      );

      const steps = this.#implementations.getAsyncIteratorSteps(declaration);
      if (steps?.return) {
        defineDataProperty(
          prototype,
          'return',
          this.#context.realm.createFunction(
            (thisArgument, [value]) => this.#return(
              primaryInterface,
              declaration,
              thisArgument,
              value,
            ),
            { length: 1, name: 'return' },
          ),
        );
      }
      Object.defineProperty(prototype, Symbol.toStringTag, {
        configurable: true,
        enumerable: false,
        value: `${primaryInterface.definition.name} AsyncIterator`,
        writable: false,
      });
      return prototype;
    });
  }

  // Web IDL §3.7.10.2 Asynchronous iterator prototype object — next steps.
  #next(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
    thisArgument: unknown,
  ): Promise<unknown> {
    let state: AsyncIteratorRecord;
    try {
      state = this.#getIteratorState(thisArgument, primaryInterface, 'next');
    } catch (exception) {
      return this.#rejectedPromise(exception);
    }

    return this.#enqueue(state, () =>
      this.#runNext(state, declaration)).promise;
  }

  // Web IDL §3.7.10.2 Asynchronous iterator prototype object — return steps.
  #return(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
    thisArgument: unknown,
    value: unknown,
  ): Promise<unknown> {
    let state: AsyncIteratorRecord;
    try {
      state = this.#getIteratorState(thisArgument, primaryInterface, 'return');
    } catch (exception) {
      return this.#rejectedPromise(exception);
    }

    const ongoing = this.#enqueue(
      state,
      () => this.#runReturn(state, declaration, value),
    );
    return this.#react(
      ongoing.promise,
      () => this.#context.realm.createIteratorResultObject(value, true),
    ).promise;
  }

  // Extracted from Web IDL §3.7.10.2 Asynchronous iterator prototype object — nextSteps and its
  // fulfillment/rejection steps.
  #runNext(
    state: AsyncIteratorRecord,
    declaration: AsyncIterableMember,
  ): IDLPromiseRecord {
    if (state.finished) {
      return this.#resolvedPromise(
        this.#context.realm.createIteratorResultObject(undefined, true),
      );
    }

    const steps = this.#requireSteps(state.primaryInterface, declaration);
    let nextPromise: Promise<unknown> | PromiseValue<unknown>;
    try {
      nextPromise = steps.next(state.implementation);
    } catch (exception) {
      state.finished = true;
      return this.#rejectedCapability(exception);
    }

    return this.#react(
      nextPromise,
      (next) => {
        state.ongoing = null;
        if (next === endOfIteration) {
          state.finished = true;
          return this.#context.realm.createIteratorResultObject(
            undefined,
            true,
          );
        }
        return this.#context.realm.createIteratorResultObject(
          this.#convertResult(next, declaration, state.kind),
          false,
        );
      },
      (reason) => {
        state.ongoing = null;
        state.finished = true;
        throw reason;
      },
    );
  }

  // Extracted from Web IDL §3.7.10.2 Asynchronous iterator prototype object — returnSteps.
  #runReturn(
    state: AsyncIteratorRecord,
    declaration: AsyncIterableMember,
    value: unknown,
  ): IDLPromiseRecord {
    if (state.finished) return this.#resolvedPromise(value);
    state.finished = true;

    const steps = this.#requireSteps(state.primaryInterface, declaration);
    if (!steps.return) {
      return this.#rejectedCapability(
        new Error('Asynchronous iterator return steps are missing'),
      );
    }
    try {
      return this.#react(steps.return(state.implementation, value), () => undefined);
    } catch (exception) {
      return this.#rejectedCapability(exception);
    }
  }

  // Extracted from Web IDL §3.7.10.2 Asynchronous iterator prototype object — serialize next/return using the
  // ongoing promise.
  #enqueue(
    state: AsyncIteratorRecord,
    action: () => IDLPromiseRecord,
  ): IDLPromiseRecord {
    const ongoing = state.ongoing;
    if (!ongoing) {
      state.ongoing = action();
      return state.ongoing;
    }

    const afterOngoing = this.#promiseCapability();
    const onSettled = this.#context.realm.createFunction(
      () => {
        try {
          afterOngoing.resolve(action().promise);
        } catch (exception) {
          afterOngoing.reject(exception);
        }
      },
      { length: 0, name: '' },
    );
    this.#context.realm.observePromise(
      ongoing.promise,
      onSettled,
      onSettled,
    );
    state.ongoing = afterOngoing;
    return afterOngoing;
  }

  // Project helper: convert an iteration completion before resolving its realm-owned result promise.
  #react(
    promise: Promise<unknown> | PromiseValue<unknown>,
    fulfilled: (value: unknown) => unknown,
    rejected?: (reason: unknown) => unknown,
  ): IDLPromiseRecord {
    const result = this.#promiseCapability();
    const onFulfilled = this.#context.realm.createFunction(
      (_thisArgument, [value]) => {
        try {
          result.resolve(fulfilled(value));
        } catch (exception) {
          result.reject(exception);
        }
      },
      { length: 1, name: '' },
    );
    const onRejected = this.#context.realm.createFunction(
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
      if (promise instanceof PromiseValue) {
        this.#context.realm.promises.import(promise).observe(onFulfilled, onRejected);
      } else {
        this.#context.realm.observePromise(promise, onFulfilled, onRejected);
      }
    } catch (exception) {
      onRejected(exception);
    }
    return result;
  }

  // Web IDL §3.7.10 Asynchronous iterable declarations — convert arguments for an asynchronous iterator method.
  #convertArguments(
    definitions: ArgumentDefinition[],
    argumentsList: unknown[],
  ): unknown[] {
    return definitions.map((argument, index) => {
      const argumentType = getTypeWithApplicableExtendedAttributes(
        argument.type,
        argument.extendedAttributes,
      );
      const value = argumentsList[index];
      if (index >= argumentsList.length || value === undefined) {
        return argument.default === undefined
          ? missingArgument
          : materializeDefaultValue(
            argument.default,
            argumentType,
            this.#context,
          );
      }
      return convertToIDL(value, argumentType, this.#context);
    });
  }

  // Extracted from Web IDL §3.7.10.2 Asynchronous iterator prototype object — next fulfillment value
  // conversion.
  // Pair values use the iterator result steps in §3.7.9.2 Iterator prototype object.
  #convertResult(
    next: unknown,
    declaration: AsyncIterableMember,
    kind: IterationKind,
  ): unknown {
    if (declaration.key === undefined) {
      return convertToJavaScript(next, declaration.value, this.#context);
    }
    if (!Array.isArray(next) || next.length < 2) {
      throw new Error('Pair asynchronous iterator produced a non-pair value');
    }

    const key = kind === 'value'
      ? undefined
      : convertToJavaScript(next[0], declaration.key, this.#context);
    const value = kind === 'key'
      ? undefined
      : convertToJavaScript(next[1], declaration.value, this.#context);
    if (kind === 'key') return key;
    if (kind === 'value') return value;

    const pair = Reflect.construct(this.#context.realm.intrinsics.array, [2]);
    defineDataProperty(pair, '0', key);
    defineDataProperty(pair, '1', value);
    return pair;
  }

  // Project adapter for the iterator receiver and security checks in Web IDL §3.7.10.2 Asynchronous iterator
  // prototype object.
  #getIteratorState(
    value: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
  ): AsyncIteratorRecord {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    if (getPlatformRecord(value)?.binding.platformObjects === this.#context.platformObjects) {
      this.#context.realm.performSecurityCheck(value, identifier, 'method');
    }
    const state = AsyncIteratorStamper.get(value);
    if (!state || state.primaryInterface !== primaryInterface ||
      state.platformObjects !== this.#context.platformObjects) {
      this.#throwTypeError('Illegal invocation');
    }
    return state;
  }

  // Project adapter for the receiver and security checks in Web IDL §3.7.10 Asynchronous iterable declarations.
  #unwrapReceiver(
    value: unknown,
    primaryInterface: AssembledInterfaceDefinition,
    identifier: string,
  ): StampedImplInstance {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    const record = getPlatformRecord(value);
    if (record?.binding.platformObjects !== this.#context.platformObjects) {
      this.#throwTypeError('Illegal invocation');
    }
    this.#context.realm.performSecurityCheck(value, identifier, 'method');
    if (!record.implements(primaryInterface)) {
      this.#throwTypeError('Illegal invocation');
    }
    return record.implInst;
  }

  // Project helper: retrieve the declared asynchronous iterator implementation steps.
  #requireSteps(
    primaryInterface: AssembledInterfaceDefinition,
    declaration: AsyncIterableMember,
  ): AsyncIteratorSteps {
    const steps = this.#implementations.getAsyncIteratorSteps(declaration);
    if (!steps) {
      throw new Error(
        `Missing ${primaryInterface.definition.name} asynchronous iterator implementation`,
      );
    }
    return steps;
  }

  // Project helper: resolve a fresh realm-owned IDLPromiseRecord.
  #resolvedPromise(value: unknown): IDLPromiseRecord {
    const promise = this.#promiseCapability();
    promise.resolve(value);
    return promise;
  }

  // Project helper: reject a fresh realm-owned IDLPromiseRecord.
  #rejectedCapability(reason: unknown): IDLPromiseRecord {
    const promise = this.#promiseCapability();
    promise.reject(reason);
    return promise;
  }

  // Project helper: allocate an IDLPromiseRecord using this binding's realm and exception realization.
  #promiseCapability(): IDLPromiseRecord {
    return createIDLPromiseRecord(
      idlType.any,
      this.#context.realm,
      this.#context.realizeException,
    );
  }

  // Project helper: expose a rejected IDLPromiseRecord as its JavaScript promise.
  #rejectedPromise(reason: unknown): Promise<unknown> {
    return this.#rejectedCapability(reason).promise;
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

type StampedAsyncIterator<T extends object = object> = T & AsyncIteratorStamper;

class AsyncIteratorStamper extends Stamper {
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

type AsyncIteratorRecord = {
  finished: boolean;
  implementation: object;
  primaryInterface: AssembledInterfaceDefinition;
  kind: IterationKind;
  ongoing: IDLPromiseRecord | null;
  platformObjects: PlatformObjectRegistry;
};

type IterationKind = 'key' | 'key+value' | 'value';
