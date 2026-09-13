import { isObject } from '../js-engine/index';
import type {
  CallbackFunctionDefinition, CallbackInterfaceDefinition,
} from './core/index';
import type { ConversionContext } from './conversion';
import type { WebIDLRealmHost } from './js-realm';

/** Callback identity, realm, and invocation supplied to a declaration's adapter. */
export type CallbackInterfaceValue = {
  object: object;
  realm: WebIDLRealmHost;
  callUserObjectOperation(
    operationName: string,
    argumentsList: unknown[],
    thisArgument?: unknown,
  ): unknown;
};

// Project helper: retain a callback function with its definition, realm, and captured context.
// Web IDL §3.2.19 Callback function types — callback value representation.
export function createCallbackFunctionValue(
  definition: CallbackFunctionDefinition,
  object: object,
  realm: WebIDLRealmHost,
  callbackContext: object,
  conversionContext: ConversionContext,
): CallbackFunctionValue {
  return {
    [callbackValueBrand]: true,
    callbackContext,
    conversionContext,
    definition,
    kind: 'callback-function',
    object,
    realm,
  };
}

// Project helper: retain a callback interface with its definition, realm, and captured context.
// Web IDL §3.2.16 Callback interface types — callback value representation.
export function createCallbackInterfaceRecord(
  definition: CallbackInterfaceDefinition,
  object: object,
  realm: WebIDLRealmHost,
  callbackContext: object,
  conversionContext: ConversionContext,
): CallbackInterfaceRecord {
  return {
    [callbackValueBrand]: true,
    callbackContext,
    conversionContext,
    definition,
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
  definition: CallbackFunctionDefinition;
  kind: 'callback-function';
};

export type CallbackInterfaceRecord = CallbackValueRecord & {
  definition: CallbackInterfaceDefinition;
  kind: 'callback-interface';
};

type CallbackValueRecord = {
  [callbackValueBrand]: true;
  // Web IDL §3.2.16 Callback interface types; §3.2.19 Callback function types — callback context.
  callbackContext: object;
  conversionContext: ConversionContext;
  object: object;
  realm: WebIDLRealmHost;
};

// Project helper: check the private brand on a retained callback value.
function isCallbackValue(value: unknown): value is CallbackValue {
  return isObject(value) && callbackValueBrand in value;
}

const callbackValueBrand: unique symbol = Symbol('Web IDL callback value');
