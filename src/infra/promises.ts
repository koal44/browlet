import { TypeError } from './exceptions';

/** Promise allocation, adoption, and observation in one supplied destination. */
export class Promises {
  #Promise: PromiseConstructor;
  observeNative: NativePromiseObserver;

  constructor(promiseConstructor: PromiseConstructor, observeNative: NativePromiseObserver) {
    this.#Promise = promiseConstructor;
    this.observeNative = observeNative;
  }

  /** Settle an internal value without JavaScript thenable adoption. */
  withResolvers<T>(): InternalPromiseCapability<T> {
    const { promise, resolve, reject } = NativePromise.withResolvers<Payload<T>>();
    let pending = true;
    return {
      promise: new InternalPromise(promise, this),
      get pending() { return pending; },
      resolve(value: T) {
        const payload = Object.create(null) as Payload<T>;
        payload.value = value;
        pending = false;
        resolve(payload);
      },
      reject(reason: unknown) {
        pending = false;
        reject(reason);
      },
    };
  }

  /** JavaScript resolution where an algorithm explicitly adopts an author value. */
  resolve(): InternalPromise<void>;
  resolve<T>(value: InternalPromise<T>): InternalPromise<T>;
  resolve<T>(value: T): InternalPromise<Awaited<T>>;
  resolve<T>(value?: T): InternalPromise<Awaited<T> | undefined> {
    if (value instanceof InternalPromise) return this.import(value);
    const source = new this.#Promise<Awaited<T>>((resolve) => { resolve(value as Awaited<T>); });
    return this.import(source, (value) => value as Awaited<T>);
  }

  reject(reason: unknown): InternalPromise<never> {
    const result = this.withResolvers<never>();
    result.reject(reason);
    return result.promise;
  }

  try<T>(steps: () => T | InternalPromise<T>): InternalPromise<T> {
    try {
      const value = steps();
      if (value instanceof InternalPromise) return this.import(value);
      const result = this.withResolvers<T>();
      result.resolve(value);
      return result.promise;
    } catch (error) { return this.reject(error); }
  }

  all<T>(values: InternalPromise<T>[]): InternalPromise<T[]> {
    const result = this.withResolvers<T[]>();
    const items: T[] = [];
    let remaining = values.length;
    if (remaining === 0) result.resolve(items);
    values.forEach((value, index) => {
      this.import(value).observe((item) => {
        items[index] = item;
        if (--remaining === 0) result.resolve(items);
      }, result.reject);
    });
    return result.promise;
  }

  /** Import a native result; Binding supplies any declared fulfillment conversion. */
  import<T>(source: InternalPromise<T>): InternalPromise<T>;
  import<T>(source: Promise<unknown> | InternalPromise<unknown>, convert: (value: unknown) => T): InternalPromise<T>;
  import(source: Promise<unknown> | InternalPromise<unknown>, convert?: (value: unknown) => unknown): InternalPromise<unknown> {
    return InternalPromise.import(source, this, convert);
  }
}

/** The host selects where native settlement callbacks execute. */
export type NativePromiseObserver = (
  promise: Promise<unknown>, fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void,
) => void;

/** Internal chains retain their destination. Native async/await is not an internal consumer. */
export class InternalPromise<T> {
  #backing: Promise<Payload<T>>;
  #promises: Promises;

  constructor(backing: Promise<Payload<T>>, promises: Promises) {
    this.#backing = backing;
    this.#promises = promises;
  }

  /** Import settlement into a destination, unwrapping internal payloads. */
  static import<T>(
    source: Promise<unknown> | InternalPromise<T>, promises: Promises,
    convert?: (value: unknown) => unknown,
  ): InternalPromise<unknown> {
    if (source instanceof InternalPromise && source.#promises === promises && !convert) return source;
    const result = promises.withResolvers<unknown>();
    promises.observeNative(source instanceof InternalPromise ? source.#backing : source, (value) => {
      try {
        const item = source instanceof InternalPromise ? (value as Payload<T>).value : value;
        result.resolve(convert ? convert(item) : item);
      } catch (error) { result.reject(error); }
    }, result.reject);
    return result.promise;
  }

  /** Adopt internal Promise results while leaving ordinary payloads untouched. */
  then<F = T, R = never>(
    fulfilled?: (value: T) => F | InternalPromise<F>,
    rejected?: (reason: unknown) => R | InternalPromise<R>,
  ): InternalPromise<F | R> {
    const result = this.#promises.withResolvers<F | R>();
    const settle = (value: F | R | InternalPromise<F | R>): void => {
      if (value === result.promise) {
        result.reject(new TypeError('Promise cannot resolve itself'));
      } else if (value instanceof InternalPromise) {
        this.#promises.observeNative(value.#backing,
          (payload) => { result.resolve((payload as Payload<F | R>).value); }, result.reject);
      } else { result.resolve(value); }
    };
    this.observe((value) => {
      try { settle(fulfilled ? fulfilled(value) : value as unknown as F); }
      catch (error) { result.reject(error); }
    }, (reason) => {
      if (!rejected) { result.reject(reason); return; }
      try { settle(rejected(reason)); }
      catch (error) { result.reject(error); }
    });
    return result.promise;
  }

  catch<R>(rejected: (reason: unknown) => R | InternalPromise<R>): InternalPromise<T | R> {
    return this.then(undefined, rejected);
  }

  observe(fulfilled: (value: T) => void, rejected: (reason: unknown) => void): void {
    this.#promises.observeNative(this.#backing,
      (payload) => { fulfilled((payload as Payload<T>).value); }, rejected);
  }
}

type Payload<T> = { value: T; };

export type InternalPromiseCapability<T> = {
  promise: InternalPromise<T>;
  /** Settlement is synchronous: internal payloads never undergo thenable adoption. */
  readonly pending: boolean;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

// eslint-disable-next-line no-restricted-syntax -- Native backing storage; Promises routes observation through the selected realm.
const NativePromise = globalThis.Promise;
