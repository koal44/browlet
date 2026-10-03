import { isObject } from '../../js-engine/index';
import type { CallbackExceptionBehavior } from '../core/index';

import type { WebIDLRealm } from '../environment';
import type { AssembledCallbackFunction, AssembledCallbackInterface } from '../assembly/index';
import type { CallbackBinding, StampedCallbackFunction } from '../binding/realm/callback';

/** An author callback object with its declaration, realm, and captured callback context. */
export class IDLCallbackInterface<Realm extends WebIDLRealm = WebIDLRealm> {
  /** Private identity tested without invoking author Proxy traps. */
  #brand = undefined;
  /** Declared operations and optional implementation adapter. */
  assembled: AssembledCallbackInterface;
  /** Shared binding that converts and invokes this value's operations. */
  #binding: CallbackBinding;
  /** Host context captured at conversion and restored during invocation. */
  callbackContext: object;
  /** Original author object, preserved for identity and dynamic method lookup. */
  object: object;
  /** Callback realm, which owns argument allocation and return-conversion failures. */
  realm: Realm;

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
  /** Private identity tested without invoking author Proxy traps. */
  #brand = undefined;
  /** Declared argument and return conversions. */
  assembled: AssembledCallbackFunction;
  /** Shared binding that prepares and invokes this value's callback contract. */
  #binding: CallbackBinding;
  /** Host context captured at conversion and restored during invocation. */
  callbackContext: object;
  /** Original author object; legacy callbacks may be non-callable. */
  object: object;
  /** Callback realm, which owns argument allocation and return-conversion failures. */
  realm: WebIDLRealm;
  /** Reused implementation callable for this conversion's captured context. */
  boundCallback?: StampedCallbackFunction;

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

