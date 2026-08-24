import type { WebIDLType } from './adapter/definition';
import type { WebIDLRealmHost } from './javascript-realm';

export function createPromiseValue(
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
  return {
    [promiseValueBrand]: true,
    promise,
    realm,
    reject: realizeException
      ? (reason) => reject_(realizeException(reason))
      : reject_,
    resolve,
    type,
  };
}

export function convertJavaScriptValueToPromise(
  value: unknown,
  type: WebIDLType,
  realm: WebIDLRealmHost,
  realizeException?: ExceptionRealizer,
): IDLPromise {
  const promise = createPromiseValue(type, realm, realizeException);
  promise.resolve(value);
  return promise;
}

export function convertPromiseToJavaScript(value: unknown): Promise<unknown> {
  if (!isPromiseValue(value)) {
    throw new Error('IDL promise value is not a PromiseCapability record');
  }
  return value.promise;
}

export function isPromiseValue(value: unknown): value is IDLPromise {
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
  type: WebIDLType;
};

type PromiseSettlement = (value?: unknown) => void;

type ExceptionRealizer = (value: unknown) => unknown;

const promiseValueBrand: unique symbol = Symbol('Web IDL promise value');
