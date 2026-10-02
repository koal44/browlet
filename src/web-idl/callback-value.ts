import { isObject } from '../js-engine/index';
import { Stamper } from '../infra/stamper';
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

/** Attach the converted callback to its implementation callable without exposing properties. */
export function stampCallbackFunction(adapter: CallableFunction, value: CallbackFunctionValue): CallbackFunctionAdapter {
  return CallbackFunctionStamper.stamp(adapter, value);
}

/** Read the retained callback contract when an implementation requests construction. */
export function getCallbackFunctionValue(adapter: CallbackFunctionAdapter): CallbackFunctionValue {
  return CallbackFunctionStamper.get(adapter);
}

/** Project a converted callback or its callable adapter to the original author object. */
export function getCallbackFunctionObject(value: unknown): object | undefined {
  if (typeof value === 'function') {
    return CallbackFunctionStamper.getObject(value);
  }
  return isCallbackFunctionValue(value) ? value.object : undefined;
}

export type CallbackFunctionValue = CallbackValueRecord & {
  adapter?: CallbackFunctionAdapter;
  assembled: AssembledCallbackFunction;
  kind: 'callback-function';
};

/** An implementation callable retaining its original callback's conversion and realm. */
export type CallbackFunctionAdapter = CallableFunction & CallbackFunctionStamper;

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

// Private fields stay on the adapter and do not invoke author Proxy traps.
class CallbackFunctionStamper extends Stamper {
  #value: CallbackFunctionValue;

  private constructor(adapter: CallableFunction, value: CallbackFunctionValue) {
    super(adapter);
    this.#value = value;
  }

  static stamp(adapter: CallableFunction, value: CallbackFunctionValue): CallbackFunctionAdapter {
    new CallbackFunctionStamper(adapter, value);
    return adapter as CallbackFunctionAdapter;
  }

  static get(adapter: CallbackFunctionAdapter): CallbackFunctionValue {
    return adapter.#value;
  }

  static getObject(callback: CallableFunction): object {
    return #value in callback ? callback.#value.object : callback;
  }
}
