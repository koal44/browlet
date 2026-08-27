import { describe, expect, it, vi } from 'vitest';
import {
  type StreamEnvironment, type StreamPromise,
} from '../../../../src/streams/environment';
import type {
  ReadableStreamDefaultControllerImpl,
} from '../../../../src/streams/readable-stream-default-controller';
import { ReadableStreamImpl } from '../../../../src/streams/readable-stream';

describe('ordinary readable-stream implementation', () => {
  it('delivers enqueued chunks and then observes close', async () => {
    const { controller, stream } = createReadableStream();
    const reader = stream.getReader({});

    const chunk = reader.read() as Promise<unknown>;
    controller.enqueue('chunk');
    await expect(chunk).resolves.toEqual({ done: false, value: 'chunk' });

    controller.close();
    await expect(reader.read() as Promise<unknown>).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await expect(reader.closed as Promise<unknown>).resolves.toBeUndefined();
  });

  it('locks a stream until its reader is released', () => {
    const { stream } = createReadableStream();
    const reader = stream.getReader({});

    expect(stream.locked).toBe(true);
    expect(() => stream.getReader({})).toThrow(/already been locked/u);

    reader.releaseLock();
    expect(stream.locked).toBe(false);
    expect(() => stream.getReader({})).not.toThrow();
  });

  it('forwards cancellation to the underlying source', async () => {
    const cancel = vi.fn(() => Promise.resolve(undefined));
    const { stream } = createReadableStream({ cancel });

    await expect(stream.cancel('finished') as Promise<unknown>).resolves
      .toBeUndefined();
    expect(cancel).toHaveBeenCalledWith('finished');
  });
});

function createReadableStream(
  source: { cancel?(reason: unknown): Promise<undefined>; } = {},
): {
  controller: ReadableStreamDefaultControllerImpl;
  stream: ReadableStreamImpl;
} {
  const environment = createTestEnvironment();
  const stream = new ReadableStreamImpl(environment, source);
  const controller = ReadableStreamImpl.getState(stream).controller;
  if (!controller) throw new Error('Readable stream has no controller');
  return { controller, stream };
}

function createTestEnvironment(): StreamEnvironment {
  const capabilities = new WeakMap<object, PromiseCapability>();
  const environment: StreamEnvironment = {
    callbacks: {
      createFunction: (steps, options) => Object.defineProperties(
        (...argumentsList: unknown[]) => steps(
          undefined,
          argumentsList,
          undefined,
        ),
        {
          length: { value: options.length },
          name: { value: options.name },
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
      convert: (value) => value,
    },
    objects: {
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
    },
  };
  return environment;
}

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
  capabilities.set(promise, { reject, resolve });
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
};

type TestImplementationConstructor<Value extends object> = {
  readonly prototype: Value;
};
