import { Stamper } from '../../infra/index';
import { isObject } from '../../js-engine/index';
import type { CallbackExceptionBehavior } from '../core/index';

import type { WebIDLRealm } from '../environment';
import type { AssembledCallbackFunction, AssembledCallbackInterface } from '../assembly/index';
import type { CallbackBinding } from '../binding/realm/callback';

/** An author callback object with its declaration, realm, and captured callback context. */
export class IDLCallbackInterface<Realm extends WebIDLRealm = WebIDLRealm> {
  /** Declared operations and optional implementation adapter. */
  assembled: AssembledCallbackInterface;
  /** Host context captured at conversion and restored during invocation. */
  callbackContext: object;
  /** Original author object, preserved for identity and dynamic method lookup. */
  object: object;
  /** Callback realm, which owns argument allocation and return-conversion failures. */
  realm: Realm;
  /** Private identity tested without invoking author Proxy traps. */
  #brand = undefined;
  /** Shared binding that converts and invokes this value's operations. */
  #binding: CallbackBinding;

  constructor(
    assembled: AssembledCallbackInterface,
    object: object,
    realm: Realm,
    callbackContext: object,
    binding: CallbackBinding,
  ) {
    this.assembled = assembled;
    this.#binding = binding;
    this.callbackContext = callbackContext;
    this.object = object;
    this.realm = realm;
  }

  /** Recognize a converted callback-interface value. */
  static is(value: unknown): value is IDLCallbackInterface {
    return isObject(value) && #brand in value;
  }

  /** Invoke a declared operation with argument/result conversion and callback lifecycle handling. */
  // https://webidl.spec.whatwg.org/#call-a-user-objects-operation
  callUserObjectOperation(
    operationName: string,
    argumentsList: unknown[],
    thisArgument?: unknown,
  ): unknown {
    return this.#binding.callUserObjectOperation(this, operationName, argumentsList, thisArgument);
  }
}

/** An author function with its declaration, realm, and captured invocation context. */
export class IDLCallbackFunction {
  /** Declared argument and return conversions. */
  assembled: AssembledCallbackFunction;
  /** Host context captured at conversion and restored during invocation. */
  callbackContext: object;
  /** Original author object; legacy callbacks may be non-callable. */
  object: object;
  /** Callback realm, which owns argument allocation and return-conversion failures. */
  realm: WebIDLRealm;
  /** Reused implementation callable for this conversion's captured context. */
  boundCallback?: StampedCallbackFunction;
  /** Private identity tested without invoking author Proxy traps. */
  #brand = undefined;
  /** Shared binding that prepares and invokes this value's callback contract. */
  #binding: CallbackBinding;

  constructor(
    assembled: AssembledCallbackFunction,
    object: object,
    realm: WebIDLRealm,
    callbackContext: object,
    binding: CallbackBinding,
  ) {
    this.assembled = assembled;
    this.#binding = binding;
    this.callbackContext = callbackContext;
    this.object = object;
    this.realm = realm;
  }

  /** Recognize a converted callback-function value. */
  static is(value: unknown): value is IDLCallbackFunction {
    return isObject(value) && #brand in value;
  }

  /** Invoke this callback under its declared argument, result, and exception contract. */
  // https://webidl.spec.whatwg.org/#invoke-a-callback-function
  invoke(argumentsList: unknown[], exceptionBehavior: CallbackExceptionBehavior | undefined, thisArgument?: unknown): unknown {
    return this.#binding.getInvoker(this.assembled, this.realm).invoke(this, argumentsList, exceptionBehavior, thisArgument);
  }

  /** Construct with this callback, using the current realm for pre-entry failures. */
  // https://webidl.spec.whatwg.org/#construct-a-callback-function
  construct(argumentsList: unknown[], currentRealm: WebIDLRealm): unknown {
    return this.#binding.getInvoker(this.assembled, this.realm).construct(this, argumentsList, currentRealm);
  }
}

/** An implementation callable retaining its original callback's conversion and realm. */
export type StampedCallbackFunction = ((...args: unknown[]) => unknown) & CallbackFunctionStamper;

/** Retain a converted callback on its implementation callable without public properties. */
export class CallbackFunctionStamper extends Stamper {
  /** Original author object, callback realm, captured context, and declared conversions. */
  #callback: IDLCallbackFunction;

  private constructor(boundCallback: CallableFunction, cbValue: IDLCallbackFunction) {
    super(boundCallback);
    this.#callback = cbValue;
  }

  /** Stamp a newly created implementation callable. */
  static stamp(boundCallback: CallableFunction, cbValue: IDLCallbackFunction): StampedCallbackFunction {
    new CallbackFunctionStamper(boundCallback, cbValue);
    return boundCallback as StampedCallbackFunction;
  }

  /** Read the callback value when an implementation requests construction. */
  static get(boundCallback: StampedCallbackFunction): IDLCallbackFunction {
    return boundCallback.#callback;
  }

  /** Project a stamped callable to its author object; ordinary author functions keep their identity. */
  static getObject(callback: CallableFunction): object {
    // Private-brand checks do not invoke author Proxy traps.
    return #callback in callback ? callback.#callback.object : callback;
  }
}

