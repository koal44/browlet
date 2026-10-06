import { TypeError } from './exceptions';
import { InternalError } from './internal-error';

/** A typed view of one native Promise; its constructor selects creation and observation. */
export class InternalPromise<T> {
  backing: Promise<unknown>;
  type: PromiseResultType<T>;
  /** Native-value conversion, or the Promise retaining a private implementation value. */
  #read: ((value: unknown) => T) | InternalPromise<T>;
  /** Private fulfillment value; its native backing signals completion without adopting it. */
  #value: T | undefined;

  constructor(backing: Promise<unknown>, type: PromiseResultType<T>, read?: ((value: unknown) => T) | InternalPromise<T>) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- JavaScript callers must supply a descriptor.
    if (!type) throw new InternalError('A Promise result type is required');
    this.backing = backing;
    this.type = type;
    this.#read = read ?? this;
  }

  /** Whether the backing signals completion while an implementation value is stored separately. */
  get usesInternalStorage(): boolean { return typeof this.#read !== 'function'; }

  static withResolvers<T>(type: PromiseResultType<T>): InternalPromiseWithResolvers<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Detached resolvers retain their allocation constructor.
    const P = this;
    const backing = NativePromise.withResolvers<void>();
    const promise = new this(backing.promise, type);
    const result = {
      promise,
      isResolved: false,
      resolve(value: T | InternalPromise<T>) {
        if (result.isResolved) return;
        result.isResolved = true;
        if (value instanceof InternalPromise) {
          if (value === promise) backing.reject(new TypeError('Promise cannot resolve itself'));
          else P.fromInternal(value).observe((item) => { promise.#value = item; backing.resolve(); }, backing.reject);
        } else { promise.#value = value; backing.resolve(); }
      },
      reject(reason: unknown) {
        if (result.isResolved) return;
        result.isResolved = true;
        backing.reject(reason);
      },
    };
    return result;
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

  /** Change reaction ownership while retaining the backing, fulfillment conversion, and private storage. */
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
      try { item = typeof this.#read === 'function' ? this.#read(value) : this.#read.#value as T; }
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

/** Select implementation-only results using one shared marker; T is a compile-time contract. */
export function internalType<T>(): InternalType<T> {
  return internalResultType as InternalType<T>;
}

/** A result descriptor whose kind and contents are interpreted by its owner. */
export type PromiseResultType<T> = { kind: string; } & ResultValue<T>;
export type InternalType<T> = { kind: 'implementation'; } & ResultValue<T>;
export type ResultValue<T> = { [resultValue]: T; };

/** Derive the payload from the selected descriptor, including nested result types. */
export type PromiseResult<D> = D extends ResultValue<infer T> ? T : unknown;

declare const resultValue: unique symbol;
const internalResultType = { kind: 'implementation' } as InternalType<unknown>;

// eslint-disable-next-line no-restricted-syntax -- Native backing storage; the selected constructor owns observation.
const NativePromise = globalThis.Promise;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured intrinsic called with Reflect.apply.
const nativeThen = NativePromise.prototype.then;
