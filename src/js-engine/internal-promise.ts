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
