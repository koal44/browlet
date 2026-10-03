import { InternalError, Stamper } from '../../../infra/index';

import { isCallable, isConstructor, isObject } from '../../../js-engine/index';

import type { CallbackExceptionBehavior, OperationMember } from '../../core/index';

import type { AssembledCallable, AssembledCallbackFunction } from '../../assembled';
import type { WebIDLRealm } from '../../environment';

import { getImplementationRecord } from '../platform';
import type { RealmBinding } from '../realm';

import { IDLPromise, type IDLCallbackFunction, type IDLCallbackInterface } from '../../values/index';

import type { ConversionSteps } from '../../converters/index';

/** Share callback invocation contracts without retaining individual author callback objects. */
export class CallbackBinding {
  /** Realm binding supplying conversion and platform identity services. */
  #binding: RealmBinding;
  /** Prepared conversions shared by callable declaration and callback realm. */
  #invokers = new WeakMap<WebIDLRealm, Map<CallbackCallable, CallbackInvoker>>();

  constructor(binding: RealmBinding) {
    this.#binding = binding;
  }

  /** Reuse a callback contract's conversions in the selected callback realm. */
  getInvoker(assembled: CallbackCallable, realm: WebIDLRealm): CallbackInvoker {
    let invokers = this.#invokers.get(realm);
    if (!invokers) this.#invokers.set(realm, invokers = new Map<CallbackCallable, CallbackInvoker>());
    let invoker = invokers.get(assembled);
    if (!invoker) {
      invoker = new CallbackInvoker(assembled, this.#binding, realm);
      invokers.set(assembled, invoker);
    }
    return invoker;
  }

  /** Resolve and invoke a callback object's operation under its declared conversion contract. */
  // https://webidl.spec.whatwg.org/#call-a-user-objects-operation
  callUserObjectOperation(
    cbValue: IDLCallbackInterface,
    operationName: string,
    argumentsList: unknown[],
    thisArgument?: unknown,
  ): unknown {
    const operation = cbValue.assembled.getOperation(operationName);
    const invoker = this.getInvoker(operation, cbValue.realm);

    try {
      return runCallback(cbValue.realm, cbValue.callbackContext, () => {
        let function_: unknown = cbValue.object;
        let receiver = projectCallbackReceiver(thisArgument);

        if (!isCallable(function_)) {
          function_ = (cbValue.object as Record<string, unknown>)[operationName];
          if (!isCallable(function_)) {
            throw new cbValue.realm.intrinsics.typeError(
              `${operationName} is not callable`,
            );
          }
          receiver = cbValue.object;
        }

        const result = Reflect.apply(
          function_,
          receiver,
          invoker.idlToJSArguments(argumentsList),
        );
        return invoker.jsToIDLResult(result);
      });
    } catch (exception) {
      return invoker.rejectPromiseReturn(exception);
    }
  }
}

/** An absent callback argument; trailing markers are omitted from the author's argument list. */
export const missingArgument: unique symbol = Symbol('missing Web IDL argument');

/** Invoke callbacks under a prepared argument, result, and exception contract. */
export class CallbackInvoker {
  /** Convert the author's return value to the callback's declared IDL result. */
  jsToIDLResult: ConversionSteps;
  /** Whether thrown exceptions become a rejected IDL Promise. */
  returnsPromise: boolean;
  /** Only any- and undefined-returning callbacks may report instead of rethrowing. */
  canReportExceptions: boolean;
  /** IDL-to-author argument converters prepared from the callable declaration. */
  #argumentConverters: ConversionSteps[];
  /** Converter reused for arguments beyond the declared variadic position. */
  #variadicConverter: ConversionSteps | undefined;
  /** Whether all argument types can reuse their primitive values without projection. */
  #primitiveArguments: boolean;
  /** Conversion realm shared by this invocation contract's arguments and return value. */
  #realm: WebIDLRealm;

  constructor(assembled: CallbackCallable, binding: RealmBinding, realm: WebIDLRealm) {
    const assembly = binding.assembly;
    this.#realm = realm;
    this.#argumentConverters = assembled.arguments.map((argument) =>
      binding.getConverter(argument.type, realm).getIDLToJSSteps());
    this.#variadicConverter = assembled.variadicArgument && this.#argumentConverters.at(-1);
    this.#primitiveArguments = assembled.arguments.every((argument) => {
      const type = assembly.getUnannotatedType(argument.type);
      // The undefined type discards a supplied value instead of preserving it.
      return type.kind === 'simple' && type.name !== 'undefined' && assembly.isPrimitiveType(type);
    });
    this.jsToIDLResult = binding.getConverter(assembled.primary.returns, realm).getJSToIDLSteps();
    const returns = assembly.getUnannotatedType(assembled.primary.returns);
    this.returnsPromise = returns.kind === 'promise';
    this.canReportExceptions = returns.kind === 'simple' && (returns.name === 'undefined' || returns.name === 'any');
  }

  /** Invoke the callback's author function using its associated realm and captured context. */
  // https://webidl.spec.whatwg.org/#invoke-a-callback-function
  invoke(
    cbValue: IDLCallbackFunction,
    argumentsList: unknown[],
    exceptionBehavior: CallbackExceptionBehavior | undefined,
    thisArgument?: unknown,
  ): unknown {
    this.#validateExceptionBehavior(exceptionBehavior);
    const function_ = cbValue.object;
    if (!isCallable(function_)) return this.jsToIDLResult(undefined);
    try {
      return runCallback(cbValue.realm, cbValue.callbackContext, () => {
        const result = Reflect.apply(
          function_, projectCallbackReceiver(thisArgument), this.idlToJSArguments(argumentsList),
        );
        return this.jsToIDLResult(result);
      });
    } catch (exception) {
      if (this.returnsPromise) return this.rejectPromiseReturn(exception);
      if (exceptionBehavior === 'rethrow') throw exception;
      cbValue.realm.reportException(exception);
      return undefined;
    }
  }

  /** Construct with the callback's author function, converting its arguments and result. */
  // https://webidl.spec.whatwg.org/#construct-a-callback-function
  construct(cbValue: IDLCallbackFunction, argumentsList: unknown[], currentRealm: WebIDLRealm): unknown {
    const constructor = cbValue.object;
    if (!isConstructor(constructor)) {
      // IsConstructor runs before preparing to enter the callback's realm.
      throw new currentRealm.intrinsics.typeError(`${cbValue.assembled.primary.name} is not a constructor`);
    }
    return runCallback(cbValue.realm, cbValue.callbackContext, () => {
      const result = Reflect.construct(constructor, this.idlToJSArguments(argumentsList));
      return this.jsToIDLResult(result);
    });
  }

  // https://webidl.spec.whatwg.org/#es-invoking-callback-functions
  #validateExceptionBehavior(exceptionBehavior: CallbackExceptionBehavior | undefined): void {
    if (this.returnsPromise) {
      if (exceptionBehavior) throw new InternalError('A promise callback cannot have exception behavior');
    } else if (!exceptionBehavior) {
      throw new InternalError('A non-promise callback requires exception behavior');
    } else if (exceptionBehavior === 'report' && !this.canReportExceptions) {
      throw new InternalError('Only undefined- and any-returning callbacks can report exceptions');
    }
  }

  /** Convert IDL arguments to author values, omitting trailing missing arguments. */
  // https://webidl.spec.whatwg.org/#js-user-objects
  // Argument types come from the assembled callable used to prepare this invoker.
  // SPEC_MISMATCH: (args) -> JavaScript arguments list
  idlToJSArguments(argumentsList: unknown[]): unknown[] {
    // These IDL values already have their author-facing representation. Reuse the
    // internal argument list; missing values and exception requests still convert.
    if (this.#primitiveArguments &&
      (this.#variadicConverter || argumentsList.length <= this.#argumentConverters.length) &&
      argumentsList.every((value) => value !== missingArgument && !isObject(value))) {
      return argumentsList;
    }
    const result: unknown[] = [];
    let count = 0;
    for (let index = 0; index < argumentsList.length; index++) {
      const value = argumentsList[index];
      if (value === missingArgument) {
        result.push(undefined);
        continue;
      }
      const convert = this.#argumentConverters[index] ?? this.#variadicConverter;
      if (!convert) throw new InternalError(`Web IDL argument ${index} has no declared type`);
      result.push(convert(value));
      count = index + 1;
    }
    result.length = count;
    return result;
  }

  /** Promise-returning callbacks reject in the callback realm; other failures propagate. */
  rejectPromiseReturn(exception: unknown): IDLPromise {
    if (!this.returnsPromise) throw exception;
    const rejected = Reflect.apply(
      this.#realm.intrinsics.promise.reject,
      this.#realm.intrinsics.promise.constructor,
      [exception],
    );
    const promise = this.jsToIDLResult(rejected);
    if (!IDLPromise.is(promise)) throw new InternalError('Promise callback did not produce an IDL promise');
    return promise;
  }
}

export type CallbackCallable = AssembledCallbackFunction | AssembledCallable<OperationMember>;

/** An implementation callable retaining its original callback's conversion and realm. */
export type StampedCallbackFunction = CallableFunction & CallbackFunctionStamper;

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

// Project the receiver before calling author code.
function projectCallbackReceiver(
  value: unknown,
): unknown {
  return getImplementationRecord(value)?.platformObject ?? value;
}

// Shared preparation and cleanup for callback functions and interface operations.
// https://webidl.spec.whatwg.org/#invoke-a-callback-function
// https://webidl.spec.whatwg.org/#call-a-user-objects-operation
function runCallback<Result>(
  realm: WebIDLRealm,
  callbackContext: object,
  steps: () => Result,
): Result {
  const { callbacks } = realm;
  callbacks.prepareToRunScript();
  try {
    callbacks.prepareToRunCallback(callbackContext);
    try {
      return steps();
    } finally {
      callbacks.cleanUpAfterRunningCallback(callbackContext);
    }
  } finally {
    callbacks.cleanUpAfterRunningScript();
  }
}
