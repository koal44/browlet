import { installPromiseReactions } from './promise-operations';
import type { JavaScriptFunction, JavaScriptRealm } from './realm';

/** An internal result; its payload is not subject to JavaScript thenable adoption. */
export class InternalPromise<T> {
  readonly #backing: Promise<Payload<T>>;

  private constructor(backing: Promise<Payload<T>>) {
    this.#backing = backing;
  }

  static withResolvers<T>(): InternalPromiseCapability<T> {
    const { promise, resolve, reject } = NativePromise.withResolvers<Payload<T>>();
    return {
      promise: new InternalPromise(promise),
      resolve(value) {
        const payload = Object.create(null) as Payload<T>;
        payload.value = value;
        resolve(payload);
      },
      reject,
    };
  }

  static resolve(): InternalPromise<void>;
  static resolve<T>(value: T | InternalPromise<T>): InternalPromise<T>;
  static resolve<T>(value?: T | InternalPromise<T>): InternalPromise<T | undefined> {
    if (value instanceof InternalPromise) return value;
    const result = InternalPromise.withResolvers<T | undefined>();
    result.resolve(value);
    return result.promise;
  }

  static reject<T = never>(reason: unknown): InternalPromise<T> {
    const result = InternalPromise.withResolvers<T>();
    result.reject(reason);
    return result.promise;
  }

  /** Run internal steps, preserving internal results and capturing synchronous failure. */
  static try<T>(steps: () => T | InternalPromise<T>): InternalPromise<T> {
    try { return InternalPromise.resolve(steps()); }
    catch (error) { return InternalPromise.reject(error); }
  }

  static all<T>(values: readonly InternalPromise<T>[], reactions: PromiseReactions): InternalPromise<T[]> {
    const result = InternalPromise.withResolvers<T[]>();
    const results: T[] = [];
    let remaining = values.length;
    if (remaining === 0) result.resolve(results);
    values.forEach((value, index) => {
      value.observe((item) => {
        results[index] = item;
        if (--remaining === 0) result.resolve(results);
      }, result.reject, reactions);
    });
    return result.promise;
  }

  /** Chain internal steps; only InternalPromise results are adopted. */
  chain<F = T, R = never>(
    fulfilled: ((value: T) => F | InternalPromise<F>) | undefined,
    rejected: ((reason: unknown) => R | InternalPromise<R>) | undefined,
    reactions: PromiseReactions,
  ): InternalPromise<F | R> {
    const result = InternalPromise.withResolvers<F | R>();
    const settle = (value: F | R | InternalPromise<F | R>): void => {
      if (value instanceof InternalPromise) value.observe(result.resolve, result.reject, reactions);
      else result.resolve(value);
    };
    this.observe((value) => {
      try { settle(fulfilled ? fulfilled(value) : value as unknown as F); }
      catch (error) { result.reject(error); }
    }, (reason) => {
      if (!rejected) { result.reject(reason); return; }
      try { settle(rejected(reason)); }
      catch (error) { result.reject(error); }
    }, reactions);
    return result.promise;
  }

  /** Map an implementation value in the explicitly selected destination. */
  map<U>(steps: (value: T) => U, reactions: PromiseReactions): InternalPromise<U> {
    const result = InternalPromise.withResolvers<U>();
    this.observe((value) => {
      try { result.resolve(steps(value)); }
      catch (error) { result.reject(error); }
    }, result.reject, reactions);
    return result.promise;
  }

  observe(
    fulfilled: (value: T) => void,
    rejected: (reason: unknown) => void,
    reactions: PromiseReactions,
  ): void {
    reactions(this.#backing, (payload) => {
      fulfilled((payload as Payload<T>).value);
    }, rejected);
  }
}

export type InternalPromiseCapability<T> = {
  readonly promise: InternalPromise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

/** A runtime operation for attaching reactions in one explicit destination. */
export type PromiseReactions = (
  promise: Promise<unknown>,
  fulfilled: JavaScriptFunction,
  rejected: JavaScriptFunction,
) => void;

export function createPromiseReactions(realm: JavaScriptRealm): PromiseReactions {
  return (promise, fulfilled, rejected) => {
    installPromiseReactions(realm, promise, fulfilled, rejected);
  };
}

type Payload<T> = { value: T; };

const NativePromise = globalThis.Promise;
