import { isObject } from '../js-engine/index';
import type { AssembledCallbackFunction, AssembledCallbackInterface } from './assembled';
import type { ConversionContext } from './conversion';
import type { WebIDLRealm } from './realm';

/** Callback identity, realm, and invocation supplied to a declaration's adapter. */
export type CallbackInterfaceValue<Realm extends WebIDLRealm = WebIDLRealm> = {
  object: object;
  realm: Realm;
  callUserObjectOperation(
    operationName: string,
    argumentsList: unknown[],
    thisArgument?: unknown,
  ): unknown;
};

// Retain a callback function with its assembled contract, realm, and captured context.
// Web IDL §3.2.19 Callback function types — callback value representation.
export function createCallbackFunctionValue(
  assembled: AssembledCallbackFunction,
  object: object,
  realm: WebIDLRealm,
  callbackContext: object,
  conversionContext: ConversionContext,
): CallbackFunctionValue {
  return {
    [callbackValueBrand]: true,
    callbackContext,
    conversionContext,
    assembled,
    kind: 'callback-function',
    object,
    realm,
  };
}

// Retain a callback interface with its assembled contract, realm, and captured context.
// Web IDL §3.2.16 Callback interface types — callback value representation.
export function createCallbackInterfaceRecord(
  assembled: AssembledCallbackInterface,
  object: object,
  realm: WebIDLRealm,
  callbackContext: object,
  conversionContext: ConversionContext,
): CallbackInterfaceRecord {
  return {
    [callbackValueBrand]: true,
    callbackContext,
    conversionContext,
    assembled,
    kind: 'callback-interface',
    object,
    realm,
  };
}

// Project helper: recognize our retained callback-function value.
export function isCallbackFunctionValue(
  value: unknown,
): value is CallbackFunctionValue {
  return isCallbackValue(value) && value.kind === 'callback-function';
}

// Project helper: recognize our retained callback-interface record.
export function isCallbackInterfaceRecord(
  value: unknown,
): value is CallbackInterfaceRecord {
  return isCallbackValue(value) && value.kind === 'callback-interface';
}

export type CallbackValue = CallbackFunctionValue | CallbackInterfaceRecord;

export type CallbackFunctionValue = CallbackValueRecord & {
  adapter?: CallableFunction;
  assembled: AssembledCallbackFunction;
  kind: 'callback-function';
};

export type CallbackInterfaceRecord = CallbackValueRecord & {
  assembled: AssembledCallbackInterface;
  kind: 'callback-interface';
};

type CallbackValueRecord = {
  [callbackValueBrand]: true;
  // Web IDL §3.2.16 Callback interface types; §3.2.19 Callback function types — callback context.
  callbackContext: object;
  conversionContext: ConversionContext;
  object: object;
  realm: WebIDLRealm;
};

// Project helper: check the private brand on a retained callback value.
function isCallbackValue(value: unknown): value is CallbackValue {
  return isObject(value) && callbackValueBrand in value;
}

const callbackValueBrand: unique symbol = Symbol('Web IDL callback value');
