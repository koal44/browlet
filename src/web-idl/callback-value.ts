import { isObject } from '../js-engine/index';
import type {
  CallbackFunctionDefinition, CallbackInterfaceDefinition,
} from './declaration/index';
import type { ConversionContext } from './conversion';
import type { WebIDLRealmHost } from './js-realm';

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

export function createCallbackInterfaceValue(
  definition: CallbackInterfaceDefinition,
  object: object,
  realm: WebIDLRealmHost,
  callbackContext: object,
  conversionContext: ConversionContext,
): CallbackInterfaceValue {
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

export function isCallbackFunctionValue(
  value: unknown,
): value is CallbackFunctionValue {
  return isCallbackValue(value) && value.kind === 'callback-function';
}

export function isCallbackInterfaceValue(
  value: unknown,
): value is CallbackInterfaceValue {
  return isCallbackValue(value) && value.kind === 'callback-interface';
}

export type CallbackValue = CallbackFunctionValue | CallbackInterfaceValue;

export type CallbackFunctionValue = CallbackValueRecord & {
  definition: CallbackFunctionDefinition;
  kind: 'callback-function';
};

export type CallbackInterfaceValue = CallbackValueRecord & {
  definition: CallbackInterfaceDefinition;
  kind: 'callback-interface';
};

type CallbackValueRecord = {
  [callbackValueBrand]: true;
  /* Web IDL §§3.2.16 and 3.2.19 — Callback context. */
  callbackContext: object;
  conversionContext: ConversionContext;
  object: object;
  realm: WebIDLRealmHost;
};

function isCallbackValue(value: unknown): value is CallbackValue {
  return isObject(value) && callbackValueBrand in value;
}

const callbackValueBrand: unique symbol = Symbol('Web IDL callback value');
