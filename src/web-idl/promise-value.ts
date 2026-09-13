import type { WebIDLType } from './core/index';
import type { WebIDLRealmHost } from './js-realm';

// Project helper: retain a PromiseCapability with its type, realm, and settlement state.
// Web IDL §3.2.24 Promise types — Promise<T>.
export function createIDLPromise(
  type: WebIDLType,
  realm: WebIDLRealmHost,
  realizeException?: ExceptionRealizer,
): IDLPromise {
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
  const value: IDLPromise = {
    [promiseValueBrand]: true,
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
): IDLPromise {
  const promise = createIDLPromise(type, realm, realizeException);
  promise.resolve(value);
  return promise;
}

// Web IDL §3.2.24 Promise types — IDL-to-JavaScript conversion uses the capability's Promise field.
export function convertPromiseToJavaScript(value: unknown): Promise<unknown> {
  if (!isIDLPromise(value)) {
    throw new Error('IDL promise value is not a PromiseCapability record');
  }
  return value.promise;
}

// Project helper: recognize our retained PromiseCapability value.
export function isIDLPromise(value: unknown): value is IDLPromise {
  return typeof value === 'object' &&
    value !== null &&
    promiseValueBrand in value;
}

export type IDLPromise = {
  [promiseValueBrand]: true;
  promise: Promise<unknown>;
  realm: WebIDLRealmHost;
  reject: PromiseSettlement;
  resolve: PromiseSettlement;
  // True once either resolving function has been accepted.
  resolved: boolean;
  type: WebIDLType;
};

type PromiseSettlement = (value?: unknown) => void;

type ExceptionRealizer = (value: unknown) => unknown;

const promiseValueBrand: unique symbol = Symbol('Web IDL promise value');
