import { TypeError } from './exceptions';
import { InternalError } from './internal-error';

/** A typed view of one native Promise; its constructor selects creation and observation. */
export class InternalPromise<T> {
  backing: Promise<unknown>;
  type: PromiseResultType<T>;
  #read: (value: unknown) => T;

  constructor(backing: Promise<unknown>, type: PromiseResultType<T>, read: (value: unknown) => T) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JavaScript callers must supply a descriptor.
    if (!type) throw new InternalError('A Promise result type is required');
    this.backing = backing;
    this.type = type;
    this.#read = read;
  }

  static withResolvers<T>(type: PromiseResultType<T>): InternalPromiseWithResolvers<T> {
    const backing = NativePromise.withResolvers<Payload<T>>();
    const promise = new this(backing.promise, type, (value) => (value as Payload<T>).value);
    let isResolved = false;
    return {
      promise,
      get isResolved() { return isResolved; },
      resolve: (value) => {
        if (isResolved) return;
        isResolved = true;
        if (value instanceof InternalPromise) {
          if (value === promise) backing.reject(new TypeError('Promise cannot resolve itself'));
          else this.fromInternal(value).observe((item) => { backing.resolve(payload(item)); }, backing.reject);
        } else { backing.resolve(payload(value)); }
      },
      reject: (reason) => {
        if (isResolved) return;
        isResolved = true;
        backing.reject(reason);
      },
    };
  }

  static resolve<T>(value: NoInfer<T> | InternalPromise<NoInfer<T>>, type: PromiseResultType<T>): InternalPromise<T> {
    const result = this.withResolvers(type);
    result.resolve(value);
    return result.promise;
  }

  static reject<T>(reason: unknown, type: PromiseResultType<T>): InternalPromise<T> {
    const result = this.withResolvers(type);
    result.reject(reason);
    return result.promise;
  }

  static try<T>(steps: () => NoInfer<T> | InternalPromise<NoInfer<T>>, type: PromiseResultType<T>): InternalPromise<T> {
    try {
      const value = steps();
      return value instanceof InternalPromise ? this.fromInternal(value) : this.resolve(value, type);
    } catch (error) { return this.reject(error, type); }
  }

  /** Change reaction ownership while retaining the original backing and fulfillment conversion. */
  static fromInternal<T>(source: InternalPromise<T>): InternalPromise<T> {
    if (source.constructor === this) return source;
    return new this(source.backing, source.type, source.#read);
  }

  /** View an existing native Promise using the fulfillment conversion supplied by Binding. */
  static fromNative<T>(source: Promise<unknown>, read: (value: unknown) => NoInfer<T>, type: PromiseResultType<T>): InternalPromise<T> {
    return new this(source, type, read);
  }

  /** Turn a JavaScript value into an internal Promise using native Promise resolution. */
  static fromValue<T>(value: NoInfer<T> | PromiseLike<NoInfer<T>> | InternalPromise<NoInfer<T>>,
    native: PromiseConstructor, type: PromiseResultType<T>): InternalPromise<T>
  {
    if (value instanceof InternalPromise) return this.fromInternal(value);
    return this.fromNative(new native<T>((resolve) => { resolve(value); }), (item) => item as T, type);
  }

  /** Join results using the descriptor for the complete result array. */
  static all<T>(values: InternalPromise<NoInfer<T>>[], type: PromiseResultType<T[]>): InternalPromise<T[]> {
    const result = this.withResolvers(type);
    const items: T[] = [];
    let remaining = values.length;
    if (!remaining) result.resolve(items);
    values.forEach((value, index) => {
      this.fromInternal(value).observe((item) => {
        items[index] = item;
        if (--remaining === 0) result.resolve(items);
      }, result.reject);
    });
    return result.promise;
  }

  then(fulfill?: (value: T) => T | InternalPromise<T>,
    reject?: (reason: unknown) => T | InternalPromise<T>): InternalPromise<T>;
  then<R>(fulfill: (value: T) => NoInfer<R> | InternalPromise<NoInfer<R>>,
    reject: ((reason: unknown) => NoInfer<R> | InternalPromise<NoInfer<R>>) | undefined,
    type: PromiseResultType<R>): InternalPromise<R>;
  then(fulfill: (value: T) => unknown = (value) => value,
    reject?: (reason: unknown) => unknown, type: PromiseResultType<unknown> = this.type): InternalPromise<unknown>
  {
    const result = (this.constructor as typeof InternalPromise).withResolvers(type);
    this.observe((value) => {
      try { result.resolve(fulfill(value)); }
      catch (error) { result.reject(error); }
    }, (reason) => {
      if (!reject) { result.reject(reason); return; }
      try { result.resolve(reject(reason)); }
      catch (error) { result.reject(error); }
    }, result.reject);
    return result.promise;
  }

  catch(reject: (reason: unknown) => T | InternalPromise<T>): InternalPromise<T> {
    return this.then(undefined, reject);
  }

  /** Run completion steps without creating another internal Promise. */
  observe(fulfill: (value: T) => void, reject: (reason: unknown) => void, conversionFailed = reject): void {
    this.observeNative((value) => {
      let item: T;
      try { item = this.#read(value); }
      catch (error) { conversionFailed(error); return; }
      fulfill(item);
    }, reject);
  }

  /** Attach reactions to the backing Promise on this owner's queue. */
  protected observeNative(fulfill: (value: unknown) => void, reject: (reason: unknown) => void): void {
    void Reflect.apply(nativeThen, this.backing, [fulfill, reject]);
  }
}

export type InternalPromiseWithResolvers<T> = {
  promise: InternalPromise<T>;
  /** True once resolve or reject is accepted, even while waiting for another Promise. */
  readonly isResolved: boolean;
  resolve(this: void, value: T | InternalPromise<T>): void;
  reject: (reason: unknown) => void;
};

/** Name an implementation result that needs no binding conversion. */
export function internalType<T>(name: string): InternalType<T> {
  return { kind: 'implementation', name } as InternalType<T>;
}

/** A result descriptor whose kind and contents are interpreted by its owner. */
export type PromiseResultType<T> = { kind: string; } & ResultValue<T>;
export type InternalType<T> = { kind: 'implementation'; name: string; } & ResultValue<T>;
export type ResultValue<T> = { [resultValue]: T; };

/** Derive the payload from the selected descriptor, including nested result types. */
export type PromiseResult<D> = D extends ResultValue<infer T> ? T : unknown;

declare const resultValue: unique symbol;

type Payload<T> = { value: T; };
function payload<T>(value: T): Payload<T> {
  // Hide the value's then property, and prevent the carrier from inheriting one.
  return { __proto__: null, value } as Payload<T>;
}
// eslint-disable-next-line no-restricted-syntax -- Native backing storage; the selected constructor owns observation.
const NativePromise = globalThis.Promise;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured intrinsic called with Reflect.apply.
const nativeThen = NativePromise.prototype.then;
