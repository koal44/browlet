import type { WebIDLType } from '../web-idl/declaration/index';

export type StreamEnvironment = {
  readonly callbacks: {
    createFunction(
      steps: StreamFunctionSteps,
      options: StreamFunctionOptions,
    ): CallableFunction;
    createFunctionValue(name: string, object: object): unknown;
    invoke(
      value: unknown,
      argumentsList: readonly unknown[],
      exceptionBehavior?: 'report' | 'rethrow',
      thisArgument?: unknown,
    ): unknown;
  };
  readonly dictionaries: {
    convert(value: unknown, type: WebIDLType): unknown;
  };
  readonly objects: {
    create<Value extends object>(
      implementation: StreamImplementationConstructor<Value>,
    ): Value;
  };
  readonly promises: {
    create(type: WebIDLType): StreamPromise;
    createRejected(reason: unknown, type: WebIDLType): StreamPromise;
    createResolved(value: unknown, type: WebIDLType): StreamPromise;
    markHandled(value: StreamPromise): void;
    react(
      value: StreamPromise,
      resultType: WebIDLType,
      steps: StreamPromiseReactionSteps,
    ): StreamPromise;
    reject(value: StreamPromise, reason: unknown): void;
    resolve(value: StreamPromise, result: unknown): void;
  };
};

export type StreamPromise = object;

export type StreamPromiseReactionSteps = {
  fulfilled?(value: unknown): unknown;
  rejected?(reason: unknown): unknown;
};

export function getStreamEnvironment(
  context: StreamBindingContext,
): StreamEnvironment {
  let environment = environments.get(context.callbacks);
  if (!environment) {
    environment = {
      callbacks: {
        createFunction: (steps, options) =>
          context.realm.createFunction(steps, options),
        createFunctionValue: (name, object) =>
          context.callbacks.createFunctionValue(name, object),
        invoke: (value, argumentsList, exceptionBehavior, thisArgument) =>
          context.callbacks.invokeFunction(
            value,
            argumentsList,
            exceptionBehavior,
            thisArgument,
          ),
      },
      dictionaries: {
        convert: (value, type) => context.conversions.toIDL(value, type),
      },
      objects: {
        create: (implementation) => context.objects.create(implementation),
      },
      promises: {
        create: (type) => requireObject(context.promises.create(type)),
        createRejected: (reason, type) =>
          requireObject(context.promises.createRejected(reason, type)),
        createResolved: (value, type) =>
          requireObject(context.promises.createResolved(value, type)),
        markHandled: (value) => context.promises.markHandled(value),
        react: (value, resultType, steps) => requireObject(
          context.promises.react(value, resultType, steps),
        ),
        reject: (value, reason) => context.promises.reject(value, reason),
        resolve: (value, result) => context.promises.resolve(value, result),
      },
    };
    environments.set(context.callbacks, environment);
  }
  return environment;
}

type StreamBindingContext = {
  readonly callbacks: object & {
    createFunctionValue(name: string, object: object): unknown;
    invokeFunction(
      value: unknown,
      argumentsList: readonly unknown[],
      exceptionBehavior?: 'report' | 'rethrow',
      thisArgument?: unknown,
    ): unknown;
  };
  readonly conversions: {
    toIDL(value: unknown, type: WebIDLType): unknown;
  };
  readonly objects: {
    create<Value extends object>(
      implementation: StreamImplementationConstructor<Value>,
    ): Value;
  };
  readonly promises: {
    create(type: WebIDLType): unknown;
    createRejected(reason: unknown, type: WebIDLType): unknown;
    createResolved(value: unknown, type: WebIDLType): unknown;
    markHandled(value: unknown): void;
    react(
      value: unknown,
      resultType: WebIDLType,
      steps: StreamPromiseReactionSteps,
    ): unknown;
    reject(value: unknown, reason: unknown): void;
    resolve(value: unknown, result: unknown): void;
  };
  readonly realm: {
    createFunction(
      steps: StreamFunctionSteps,
      options: StreamFunctionOptions,
    ): CallableFunction;
  };
};

type StreamFunctionSteps = (
  thisArgument: unknown,
  argumentsList: unknown[],
  newTarget: CallableFunction | undefined,
) => unknown;

type StreamFunctionOptions = {
  readonly constructible?: boolean;
  readonly length: number;
  readonly name: string;
};

type StreamImplementationConstructor<Value extends object> = {
  readonly prototype: Value;
} & (abstract new (...argumentsList: never[]) => Value);

function requireObject(value: unknown): object {
  if ((typeof value !== 'object' || value === null) &&
    typeof value !== 'function') {
    throw new TypeError('Expected a Web IDL object value');
  }
  return value;
}

const environments = new WeakMap<object, StreamEnvironment>();
