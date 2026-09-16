import { Stamper } from '../infra/stamper';
import type { PromiseValue } from '../js-engine/index';
import type { BindingWorld } from './binding-world';
import type { WebIDLType } from './core/index';
import type { WebIDLRealmHost } from './realm-host';

// Project helper: retain a PromiseCapability with its type, realm, and settlement state.
// Web IDL §3.2.24 Promise types — Promise<T>.
export function createIDLPromiseRecord(
  type: WebIDLType,
  realm: WebIDLRealmHost,
  realizeException?: ExceptionRealizer,
): IDLPromiseRecord {
  let resolve: PromiseSettlement | undefined;
  let reject: PromiseSettlement | undefined;
  const promise = new realm.intrinsics.promise.constructor((resolve_, reject_) => {
    resolve = resolve_;
    reject = reject_;
  });
  if (!resolve || !reject) {
    throw new Error('Promise constructor did not initialize its capability');
  }
  const reject_ = reject;
  const resolve_ = resolve;
  const value: IDLPromiseRecord = {
    [promiseRecordBrand]: true,
    promise,
    realm,
    // Project helper: record settlement and realize a rejection before calling the native capability.
    reject(reason) {
      if (value.resolved) return;
      value.resolved = true;
      reject_(realizeException ? realizeException(reason) : reason);
    },
    // Project helper: record settlement before calling the native capability.
    resolve(result) {
      if (value.resolved) return;
      value.resolved = true;
      resolve_(result);
    },
    resolved: false,
    type,
  };
  return value;
}

// Web IDL §3.2.24 Promise types — convert a JavaScript value to a promise.
export function convertJavaScriptValueToPromise(
  value: unknown,
  type: WebIDLType,
  realm: WebIDLRealmHost,
  realizeException?: ExceptionRealizer,
): IDLPromiseRecord {
  const promise = createIDLPromiseRecord(type, realm, realizeException);
  promise.resolve(value);
  return promise;
}

// Project helper: recognize our retained PromiseCapability value.
export function isIDLPromiseRecord(value: unknown): value is IDLPromiseRecord {
  return typeof value === 'object' &&
    value !== null &&
    promiseRecordBrand in value;
}

export type IDLPromiseRecord = {
  [promiseRecordBrand]: true;
  promise: Promise<unknown>;
  realm: WebIDLRealmHost;
  reject: PromiseSettlement;
  resolve: PromiseSettlement;
  // True once either resolving function has been accepted.
  resolved: boolean;
  type: WebIDLType;
};

/** The projection retained for one source, world, realm, type, and allocation policy. */
export type PromiseProjectionRecord = {
  world: BindingWorld;
  record: IDLPromiseRecord;
  newBufferResult: boolean;
};

/** Privately retain the source promise's author-facing projections. */
export class PromiseProjectionStamper extends Stamper {
  #projections: PromiseProjectionRecord[];

  private constructor(source: PromiseSource, projections: PromiseProjectionRecord[]) {
    super(source);
    this.#projections = projections;
  }

  static stamp<T extends PromiseSource>(
    source: T,
    projections: PromiseProjectionRecord[],
  ): T & PromiseProjectionStamper {
    new PromiseProjectionStamper(source, projections);
    return source as T & PromiseProjectionStamper;
  }

  static get(source: PromiseSource): PromiseProjectionRecord[] | undefined {
    return #projections in source ? source.#projections : undefined;
  }
}

export type PromiseSource = Promise<unknown> | PromiseValue<unknown>;

type PromiseSettlement = (value?: unknown) => void;

type ExceptionRealizer = (value: unknown) => unknown;

const promiseRecordBrand: unique symbol = Symbol('Web IDL promise record');
