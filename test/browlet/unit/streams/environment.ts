import type {
  StreamAbortController, StreamEnvironment, StreamPromise,
} from '../../../../src/streams/environment';

export function createTestEnvironment(
  options: TestEnvironmentOptions = {},
): StreamEnvironment {
  const capabilities = new WeakMap<object, PromiseCapability>();
  const endOfIteration = Symbol('test stream end of iteration');
  const environment: StreamEnvironment = {
    abort: {
      createController: options.createAbortController ?? (() => ({
        abort() {},
        signal: {},
      })),
    },
    buffers: {
      clone: (buffer, byteOffset, byteLength) =>
        (buffer as ArrayBuffer).slice(byteOffset, byteOffset + byteLength),
      copy(destination, destinationOffset, source, sourceOffset, byteLength) {
        new Uint8Array(destination as ArrayBuffer).set(
          new Uint8Array(source as ArrayBuffer, sourceOffset, byteLength),
          destinationOffset,
        );
      },
      copyBytes(value) {
        if (ArrayBuffer.isView(value)) {
          return new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          ).slice();
        }
        return new Uint8Array(value as ArrayBuffer).slice();
      },
      create: (byteLength) => new ArrayBuffer(byteLength),
      createView: (type, buffer, byteOffset, length) => {
        const constructor = globalThis[type] as unknown as new (
          buffer: ArrayBuffer,
          byteOffset: number,
          length: number,
        ) => object;
        return new constructor(buffer as ArrayBuffer, byteOffset, length);
      },
      getBuffer: (view) => (view as ArrayBufferView).buffer,
      getByteLength: (value) => (
        value as ArrayBuffer | ArrayBufferView
      ).byteLength,
      getByteOffset: (view) => (view as ArrayBufferView).byteOffset,
      getViewType: (view) => view.constructor.name as 'Uint8Array',
      isDetached(value) {
        const buffer = ArrayBuffer.isView(value)
          ? value.buffer as ArrayBuffer
          : value as ArrayBuffer;
        return buffer.detached;
      },
      transfer: (buffer) =>
        (buffer as ArrayBuffer).transferToFixedLength(),
    },
    callbacks: {
      createFunction: (steps, settings) => Object.defineProperties(
        (...argumentsList: unknown[]) => steps(
          undefined,
          argumentsList,
          undefined,
        ),
        {
          length: { value: settings.length },
          name: { value: settings.name },
        },
      ),
      invoke: (value, argumentsList, _behavior, thisArgument) => {
        if (typeof value !== 'function') {
          throw new TypeError('Test callback is not callable');
        }
        return Reflect.apply(value, thisArgument, argumentsList) as unknown;
      },
    },
    dictionaries: {
      convert: (value) => value ?? {},
      create: (entries) => Object.fromEntries(entries),
    },
    exceptions: {
      createTypeError: (message) => new TypeError(message),
    },
    structuredData: {
      clone: options.structuredClone ?? structuredClone,
    },
    iteration: {
      end: endOfIteration,
      close(iterator, reason) {
        let returned: unknown;
        try {
          returned = callOptionalIteratorReturn(iterator, [reason]);
        } catch (exception) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- iterators may throw any JavaScript value
          return Promise.reject(exception);
        }
        return Promise.resolve(returned).then(
          (result) => {
            if (typeof result !== 'object' || result === null) {
              throw new TypeError('Iterator return result is not an object');
            }
            return undefined;
          },
        );
      },
      getNext(iterator) {
        return callIteratorMethod(iterator, 'next').then((result) => {
          if (typeof result !== 'object' || result === null) {
            throw new TypeError('Iterator result is not an object');
          }
          const done = Boolean(Reflect.get(result, 'done'));
          const value = Reflect.get(result, 'value') as unknown;
          return done ? endOfIteration : value;
        });
      },
      open(iterable) {
        const asyncMethod = Reflect.get(iterable, Symbol.asyncIterator) as unknown;
        if (asyncMethod !== undefined && asyncMethod !== null) {
          return callIteratorFactory(iterable, asyncMethod);
        }
        const syncMethod = Reflect.get(iterable, Symbol.iterator) as unknown;
        const syncIterator = callIteratorFactory(iterable, syncMethod);
        return {
          next: (...values: unknown[]) => adaptSyncIteratorResult(
            callIteratorMethodDirect(syncIterator, 'next', values),
          ),
          return: (...values: unknown[]) => adaptSyncIteratorResult(
            callOptionalIteratorReturn(syncIterator, values),
          ),
        };
      },
    },
    objects: {
      construct<Value extends object>(
        implementation: TestImplementationConstructor<Value>,
        argumentsList: readonly unknown[],
      ): Value {
        return Reflect.construct(
          implementation as unknown as CallableFunction,
          [environment, ...argumentsList],
        ) as Value;
      },
      create<Value extends object>(
        implementation: TestImplementationConstructor<Value>,
      ): Value {
        return Reflect.construct(
          implementation as unknown as CallableFunction,
          [environment],
        ) as Value;
      },
    },
    promises: {
      create: () => createPromise(capabilities),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Web IDL promises may reject with any JavaScript value
      createRejected: (reason) => Promise.reject(reason),
      createResolved: (value) => Promise.resolve(value),
      isPending: (value) => capabilities.get(value)?.resolved === false,
      markHandled: (value) => {
        void (value as Promise<unknown>).catch(() => undefined);
      },
      react: (value, _resultType, steps) =>
        (value as Promise<unknown>).then(
          (result) => steps.fulfilled?.(result),
          (reason: unknown) => steps.rejected?.(reason),
        ),
      reject(value, reason) {
        requireCapability(capabilities, value).reject(reason);
      },
      resolve(value, result) {
        requireCapability(capabilities, value).resolve(result);
      },
      waitForAll: (values) => Promise.all(
        values as readonly PromiseLike<unknown>[],
      ),
    },
    queueMicrotask,
  };
  return environment;
}

function adaptSyncIteratorResult(result: unknown): Promise<object> {
  if (typeof result !== 'object' || result === null) {
    return Promise.reject(new TypeError('Iterator result is not an object'));
  }
  const done = Boolean(Reflect.get(result, 'done'));
  const resultValue = Reflect.get(result, 'value') as unknown;
  return Promise.resolve(resultValue).then((value) => ({
    done,
    value,
  }));
}

function callIteratorFactory(iterable: object, method: unknown): object {
  if (typeof method !== 'function') {
    throw new TypeError('Value is not asynchronously iterable');
  }
  const iterator = Reflect.apply(method, iterable, []) as unknown;
  if (typeof iterator !== 'object' || iterator === null) {
    throw new TypeError('Iterator method did not return an object');
  }
  return iterator;
}

function callIteratorMethod(
  iterator: object,
  name: 'next' | 'return',
  values: unknown[] = [],
): Promise<unknown> {
  try {
    return Promise.resolve(callIteratorMethodDirect(iterator, name, values));
  } catch (exception) {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- iterators may throw any JavaScript value
    return Promise.reject(exception);
  }
}

function callIteratorMethodDirect(
  iterator: object,
  name: 'next' | 'return',
  values: unknown[],
): unknown {
  const method = Reflect.get(iterator, name) as unknown;
  if (typeof method !== 'function') {
    throw new TypeError(`Iterator ${name} is not callable`);
  }
  return Reflect.apply(method, iterator, values) as unknown;
}

function callOptionalIteratorReturn(
  iterator: object,
  values: unknown[],
): unknown {
  const method = Reflect.get(iterator, 'return') as unknown;
  if (method === undefined || method === null) {
    return { done: true, value: values[0] };
  }
  if (typeof method !== 'function') {
    throw new TypeError('Iterator return is not callable');
  }
  return Reflect.apply(method, iterator, values) as unknown;
}

type TestEnvironmentOptions = {
  readonly createAbortController?: () => StreamAbortController;
  readonly structuredClone?: (value: unknown) => unknown;
};

function createPromise(
  capabilities: WeakMap<object, PromiseCapability>,
): StreamPromise {
  let resolve: PromiseCapability['resolve'] | undefined;
  let reject: PromiseCapability['reject'] | undefined;
  const promise = new Promise<unknown>((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  if (!resolve || !reject) throw new Error('Promise was not initialized');
  const capability: PromiseCapability = {
    reject(reason) {
      capability.resolved = true;
      reject?.(reason);
    },
    resolve(value) {
      capability.resolved = true;
      resolve?.(value);
    },
    resolved: false,
  };
  capabilities.set(promise, capability);
  return promise;
}

function requireCapability(
  capabilities: WeakMap<object, PromiseCapability>,
  promise: StreamPromise,
): PromiseCapability {
  const capability = capabilities.get(promise);
  if (!capability) throw new Error('Unknown stream promise');
  return capability;
}

type PromiseCapability = {
  reject(reason?: unknown): void;
  resolve(value?: unknown): void;
  resolved: boolean;
};

type TestImplementationConstructor<Value extends object> = {
  readonly prototype: Value;
};
