import type { AssembledInterface } from './assembly';
import { endOfIteration } from './async-sequence';
import {
  convertToIDL, convertToJavaScript, materializeDefaultValue,
  type ConversionContext,
} from './conversion';
import {
  idlType, type ArgumentDefinition, type AsyncIterableMember,
} from './definition';
import type {
  AsyncIteratorSteps, ImplementationRegistry,
} from './implementation';
import { missingArgument } from './overload';
import {
  createPromiseValue, isPromiseValue, type IDLPromise,
} from './promise-value';
import { getTypeWithApplicableExtendedAttributes } from './types';

export class AsynchronousIterableBinding {
  readonly #context: ConversionContext;
  readonly #getIteratorPrototype: IteratorPrototypeFactory;
  readonly #implementations: ImplementationRegistry;
  readonly #iterators = new WeakMap<object, DefaultAsyncIterator>();

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
    declaration: AsyncIterableMember,
  ): void {
    this.initializePrototype(interface_, declaration);
    if (declaration.key === undefined) {
      const values = this.#createIteratorMethod(
        interface_, declaration, 'value', 'values', 'values',
      );
      defineDataProperty(target, 'values', values);
      defineMethod(target, Symbol.asyncIterator, values, false);
      return;
    }

    const entries = this.#createIteratorMethod(
      interface_, declaration, 'key+value', 'entries',
      '%Symbol.asyncIterator%',
    );
    defineMethod(target, Symbol.asyncIterator, entries, false);
    defineDataProperty(target, 'entries', entries);
    defineDataProperty(
      target,
      'keys',
      this.#createIteratorMethod(
        interface_, declaration, 'key', 'keys', 'keys',
      ),
    );
    defineDataProperty(
      target,
      'values',
      this.#createIteratorMethod(
        interface_, declaration, 'value', 'values', 'values',
      ),
    );
  }

  initializePrototype(
    interface_: AssembledInterface,
    declaration: AsyncIterableMember,
  ): void {
    this.#getIteratorPrototypeObject(interface_, declaration);
  }

  #createIteratorMethod(
    interface_: AssembledInterface,
    declaration: AsyncIterableMember,
    kind: IterationKind,
    name: string,
    securityIdentifier: string,
  ): JavaScriptFunction {
    return this.#context.realm.createFunction(
      (thisArgument, argumentsList) => {
        const target = this.#implementationObject(
          thisArgument,
          interface_,
          securityIdentifier,
        );
        const iterator = createRealmObject(
          this.#context,
          this.#getIteratorPrototypeObject(interface_, declaration),
        );
        const state: DefaultAsyncIterator = {
          finished: false,
          interface: interface_,
          iterator,
          kind,
          ongoing: null,
          target,
        };
        this.#iterators.set(iterator, state);

        const steps = this.#implementations.getAsyncIteratorSteps(declaration);
        steps?.initialize?.(
          target,
          iterator,
          this.#convertArguments(declaration.arguments ?? [], argumentsList),
        );
        return iterator;
      },
      { length: 0, name },
    );
  }

  #getIteratorPrototypeObject(
    interface_: AssembledInterface,
    declaration: AsyncIterableMember,
  ): object {
    return this.#getIteratorPrototype(interface_, () => {
      const prototype = createRealmObject(
        this.#context,
        this.#context.realm.intrinsics.iteration.asyncIteratorPrototype,
      );
      defineDataProperty(
        prototype,
        'next',
        this.#context.realm.createFunction(
          (thisArgument) => this.#next(interface_, declaration, thisArgument),
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
              interface_,
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
        value: `${interface_.definition.name} AsyncIterator`,
        writable: false,
      });
      return prototype;
    });
  }

  #next(
    interface_: AssembledInterface,
    declaration: AsyncIterableMember,
    thisArgument: unknown,
  ): Promise<unknown> {
    let state: DefaultAsyncIterator;
    try {
      state = this.#getIteratorState(thisArgument, interface_, 'next');
    } catch (exception) {
      return this.#rejectedPromise(exception);
    }

    return this.#enqueue(state, () =>
      this.#runNext(state, declaration)).promise;
  }

  #return(
    interface_: AssembledInterface,
    declaration: AsyncIterableMember,
    thisArgument: unknown,
    value: unknown,
  ): Promise<unknown> {
    let state: DefaultAsyncIterator;
    try {
      state = this.#getIteratorState(thisArgument, interface_, 'return');
    } catch (exception) {
      return this.#rejectedPromise(exception);
    }

    const ongoing = this.#enqueue(
      state,
      () => this.#runReturn(state, declaration, value),
    );
    return this.#react(
      ongoing,
      () => createIteratorResult(this.#context, value, true),
    ).promise;
  }

  #runNext(
    state: DefaultAsyncIterator,
    declaration: AsyncIterableMember,
  ): IDLPromise {
    if (state.finished) {
      return this.#resolvedPromise(
        createIteratorResult(this.#context, undefined, true),
      );
    }

    const steps = this.#requireSteps(state, declaration);
    let nextPromise: IDLPromise;
    try {
      nextPromise = steps.getNext(state.target, state.iterator);
      if (!isPromiseValue(nextPromise)) {
        throw new Error('Asynchronous iterator next steps did not return a promise');
      }
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
          return createIteratorResult(this.#context, undefined, true);
        }
        return createIteratorResult(
          this.#context,
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

  #runReturn(
    state: DefaultAsyncIterator,
    declaration: AsyncIterableMember,
    value: unknown,
  ): IDLPromise {
    if (state.finished) return this.#resolvedPromise(value);
    state.finished = true;

    const steps = this.#requireSteps(state, declaration);
    if (!steps.return) {
      return this.#rejectedCapability(
        new Error('Asynchronous iterator return steps are missing'),
      );
    }
    try {
      const promise = steps.return(
        state.target,
        state.iterator,
        value,
      );
      return isPromiseValue(promise)
        ? promise
        : this.#rejectedCapability(
          new Error('Asynchronous iterator return steps did not return a promise'),
        );
    } catch (exception) {
      return this.#rejectedCapability(exception);
    }
  }

  #enqueue(
    state: DefaultAsyncIterator,
    action: () => IDLPromise,
  ): IDLPromise {
    const ongoing = state.ongoing;
    if (!ongoing) {
      state.ongoing = action();
      return state.ongoing;
    }

    const afterOngoing = createPromiseValue(idlType.any, this.#context.realm);
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
    Reflect.apply(
      this.#context.realm.intrinsics.promise.then,
      ongoing.promise,
      [onSettled, onSettled],
    );
    state.ongoing = afterOngoing;
    return afterOngoing;
  }

  #react(
    promise: IDLPromise,
    fulfilled: (value: unknown) => unknown,
    rejected?: (reason: unknown) => unknown,
  ): IDLPromise {
    const result = createPromiseValue(idlType.any, this.#context.realm);
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
    Reflect.apply(
      this.#context.realm.intrinsics.promise.then,
      promise.promise,
      [onFulfilled, onRejected],
    );
    return result;
  }

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

  #getIteratorState(
    value: unknown,
    interface_: AssembledInterface,
    identifier: string,
  ): DefaultAsyncIterator {
    if (!isObject(value)) this.#throwTypeError('Illegal invocation');
    if (this.#context.platformObjects.isPlatformObject(value)) {
      this.#context.realm.performSecurityCheck(value, identifier, 'method');
    }
    const state = this.#iterators.get(value);
    if (!state || state.interface !== interface_) {
      this.#throwTypeError('Illegal invocation');
    }
    return state;
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

  #requireSteps(
    state: DefaultAsyncIterator,
    declaration: AsyncIterableMember,
  ): AsyncIteratorSteps {
    const steps = this.#implementations.getAsyncIteratorSteps(declaration);
    if (!steps) {
      throw new Error(
        `Missing ${state.interface.definition.name} asynchronous iterator implementation`,
      );
    }
    return steps;
  }

  #resolvedPromise(value: unknown): IDLPromise {
    const promise = createPromiseValue(idlType.any, this.#context.realm);
    promise.resolve(value);
    return promise;
  }

  #rejectedCapability(reason: unknown): IDLPromise {
    const promise = createPromiseValue(idlType.any, this.#context.realm);
    promise.reject(reason);
    return promise;
  }

  #rejectedPromise(reason: unknown): Promise<unknown> {
    return this.#rejectedCapability(reason).promise;
  }

  #throwTypeError(message: string): never {
    throw new this.#context.realm.intrinsics.typeError(message);
  }
}

type IteratorPrototypeFactory = (
  interface_: AssembledInterface,
  create: () => object,
) => object;

type DefaultAsyncIterator = {
  finished: boolean;
  interface: AssembledInterface;
  iterator: object;
  kind: IterationKind;
  ongoing: IDLPromise | null;
  target: object;
};

type IterationKind = 'key' | 'key+value' | 'value';
type JavaScriptFunction = ReturnType<
  ConversionContext['realm']['createFunction']
>;

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
