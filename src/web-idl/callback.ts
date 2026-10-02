import { getImplementationRecord } from './platform-object';
import { isCallable, isConstructor, isObject } from '../js-engine/index';
import { Stamper } from '../infra/stamper';
import type { ValueConverter } from './conversion';
import type { AssembledCallable, AssembledCallbackFunction, AssembledCallbackInterface } from './assembled';
import type { RealmBinding } from './realm-binding';
import type { WebIDLRealm } from './realm';
import type { CallbackExceptionBehavior, OperationMember } from './core/types';
import { PromiseCarrier } from './promise';
import { InternalError } from '../infra/internal-error';

/** An author callback object with the state and conversions used to invoke its operations. */
export class CallbackInterfaceCarrier<Realm extends WebIDLRealm = WebIDLRealm> {
  /** Private identity tested without invoking author Proxy traps. */
  #brand = undefined;
  /** Declared operations and optional implementation adapter. */
  assembled: AssembledCallbackInterface;
  /** Binding machinery used for argument and result conversion. */
  binding: RealmBinding;
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
    binding: RealmBinding,
  ) {
    this.assembled = assembled;
    this.binding = binding;
    this.callbackContext = callbackContext;
    this.object = object;
    this.realm = realm;
  }

  /** Recognize a converted callback-interface value. */
  static is(value: unknown): value is CallbackInterfaceCarrier {
    return isObject(value) && #brand in value;
  }

  /** Invoke a declared operation with argument/result conversion and callback lifecycle handling. */
  // https://webidl.spec.whatwg.org/#call-a-user-objects-operation
  callUserObjectOperation(
    operationName: string,
    argumentsList: WebIDLArgumentsList,
    thisArgument?: unknown,
  ): unknown {
    const operation = this.assembled.getOperation(operationName);
    const invoker = this.binding.getCallbackInvoker(operation, this.realm);

    try {
      return runCallback(this.realm, this.callbackContext, () => {
        let function_: unknown = this.object;
        let receiver = projectCallbackReceiver(thisArgument);

        if (!isCallable(function_)) {
          function_ = (this.object as Record<string, unknown>)[operationName];
          if (!isCallable(function_)) {
            throw new this.realm.intrinsics.typeError(
              `${operationName} is not callable`,
            );
          }
          receiver = this.object;
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

/** An author function with its declaration, realm, and captured invocation context. */
export class CallbackFunctionCarrier {
  /** Private identity tested without invoking author Proxy traps. */
  #brand = undefined;
  /** Declared argument and return conversions. */
  assembled: AssembledCallbackFunction;
  /** Binding machinery used for conversion and implementation identity. */
  binding: RealmBinding;
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
    binding: RealmBinding,
  ) {
    this.assembled = assembled;
    this.binding = binding;
    this.callbackContext = callbackContext;
    this.object = object;
    this.realm = realm;
  }

  /** Recognize a converted callback-function value. */
  static is(value: unknown): value is CallbackFunctionCarrier {
    return isObject(value) && #brand in value;
  }

  /** Invoke this callback under its declared argument, result, and exception contract. */
  // https://webidl.spec.whatwg.org/#invoke-a-callback-function
  invoke(argumentsList: WebIDLArgumentsList, exceptionBehavior: CallbackExceptionBehavior | undefined, thisArgument?: unknown): unknown {
    return this.binding.getCallbackInvoker(this.assembled, this.realm).invoke(this, argumentsList, exceptionBehavior, thisArgument);
  }

  /** Construct with this callback, using the current realm for pre-entry failures. */
  // https://webidl.spec.whatwg.org/#construct-a-callback-function
  construct(argumentsList: WebIDLArgumentsList, realm: WebIDLRealm): unknown {
    return this.binding.getCallbackInvoker(this.assembled, this.realm).construct(this, argumentsList, realm);
  }
}

/** Construct a callback, using the current realm for failures before entering the callback realm. */
// https://webidl.spec.whatwg.org/#construct-a-callback-function
// SPEC_MISMATCH: construct(callable, args) -> IDL value
export function constructCallbackFunction(
  callback: StampedCallbackFunction,
  argumentsList: WebIDLArgumentsList,
  realm: WebIDLRealm,
): unknown {
  return CallbackFunctionStamper.get(callback).construct(argumentsList, realm);
}

export type WebIDLArgumentsList = unknown[];

export const missingArgument: unique symbol = Symbol(
  'missing Web IDL argument',
);

/** Invoke callbacks under a prepared argument, result, and exception contract. */
export class CallbackInvoker {
  /** Convert the author's return value to the callback's declared IDL result. */
  jsToIDLResult: ValueConverter;
  /** Whether thrown exceptions become a rejected IDL Promise. */
  returnsPromise: boolean;
  /** Only any- and undefined-returning callbacks may report instead of rethrowing. */
  canReportExceptions: boolean;
  /** IDL-to-author argument converters prepared from the callable declaration. */
  #argumentConverters: ValueConverter[];
  /** Converter reused for arguments beyond the declared variadic position. */
  #variadicConverter: ValueConverter | undefined;
  /** Whether all argument types can reuse their primitive values without projection. */
  #primitiveArguments: boolean;
  /** Conversion realm shared by this invocation contract's arguments and return value. */
  #realm: WebIDLRealm;

  constructor(assembled: CallbackCallable, binding: RealmBinding, realm: WebIDLRealm) {
    const assembly = binding.assembly;
    this.#realm = realm;
    this.#argumentConverters = assembled.arguments.map((argument) =>
      binding.getConversionContext(argument.type, realm).getIDLToJSConverter());
    this.#variadicConverter = assembled.variadicArgument && this.#argumentConverters.at(-1);
    this.#primitiveArguments = assembled.arguments.every((argument) => {
      const type = assembly.getUnannotatedType(argument.type);
      // The undefined type discards a supplied value instead of preserving it.
      return type.kind === 'simple' && type.name !== 'undefined' && assembly.isPrimitiveType(type);
    });
    this.jsToIDLResult = binding.getConversionContext(assembled.primary.returns, realm).getJSToIDLConverter();
    const returns = assembly.getUnannotatedType(assembled.primary.returns);
    this.returnsPromise = returns.kind === 'promise';
    this.canReportExceptions = returns.kind === 'simple' && (returns.name === 'undefined' || returns.name === 'any');
  }

  /** Invoke the carrier's author function using its associated realm and captured context. */
  // https://webidl.spec.whatwg.org/#invoke-a-callback-function
  invoke(
    cbCarrier: CallbackFunctionCarrier,
    argumentsList: WebIDLArgumentsList,
    exceptionBehavior: CallbackExceptionBehavior | undefined,
    thisArgument?: unknown,
  ): unknown {
    this.validateExceptionBehavior(exceptionBehavior);
    const function_ = cbCarrier.object;
    if (!isCallable(function_)) return this.jsToIDLResult(undefined);
    try {
      return runCallback(cbCarrier.realm, cbCarrier.callbackContext, () => {
        const result = Reflect.apply(
          function_, projectCallbackReceiver(thisArgument), this.idlToJSArguments(argumentsList),
        );
        return this.jsToIDLResult(result);
      });
    } catch (exception) {
      if (this.returnsPromise) return this.rejectPromiseReturn(exception);
      if (exceptionBehavior === 'rethrow') throw exception;
      cbCarrier.realm.reportException(exception);
      return undefined;
    }
  }

  /** Construct with the carrier's author function, converting its arguments and result. */
  // https://webidl.spec.whatwg.org/#construct-a-callback-function
  construct(cbCarrier: CallbackFunctionCarrier, argumentsList: WebIDLArgumentsList, realm: WebIDLRealm): unknown {
    const constructor = cbCarrier.object;
    if (!isConstructor(constructor)) {
      // IsConstructor runs before preparing to enter the callback's realm.
      throw new realm.intrinsics.typeError(`${cbCarrier.assembled.primary.name} is not a constructor`);
    }
    return runCallback(cbCarrier.realm, cbCarrier.callbackContext, () => {
      const result = Reflect.construct(constructor, this.idlToJSArguments(argumentsList));
      return this.jsToIDLResult(result);
    });
  }

  // https://webidl.spec.whatwg.org/#es-invoking-callback-functions
  validateExceptionBehavior(exceptionBehavior: CallbackExceptionBehavior | undefined): void {
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
  idlToJSArguments(argumentsList: WebIDLArgumentsList): unknown[] {
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
  rejectPromiseReturn(exception: unknown): PromiseCarrier {
    if (!this.returnsPromise) throw exception;
    const rejected = Reflect.apply(
      this.#realm.intrinsics.promise.reject,
      this.#realm.intrinsics.promise.constructor,
      [exception],
    );
    const promise = this.jsToIDLResult(rejected);
    if (!PromiseCarrier.is(promise)) throw new InternalError('Promise callback did not produce an IDL promise');
    return promise;
  }
}

export type CallbackCallable = AssembledCallbackFunction | AssembledCallable<OperationMember>;

/** An implementation callable retaining its original callback's conversion and realm. */
export type StampedCallbackFunction = CallableFunction & CallbackFunctionStamper;

/** Retain a converted callback on its implementation callable without public properties. */
export class CallbackFunctionStamper extends Stamper {
  /** Original author object, callback realm, captured context, and declared conversions. */
  #carrier: CallbackFunctionCarrier;

  private constructor(boundCallback: CallableFunction, cbCarrier: CallbackFunctionCarrier) {
    super(boundCallback);
    this.#carrier = cbCarrier;
  }

  /** Stamp a newly created implementation callable. */
  static stamp(boundCallback: CallableFunction, cbCarrier: CallbackFunctionCarrier): StampedCallbackFunction {
    new CallbackFunctionStamper(boundCallback, cbCarrier);
    return boundCallback as StampedCallbackFunction;
  }

  /** Read the callback carrier when an implementation requests construction. */
  static get(boundCallback: StampedCallbackFunction): CallbackFunctionCarrier {
    return boundCallback.#carrier;
  }

  /** Project a stamped callable to its author object; ordinary author functions keep their identity. */
  static getObject(callback: CallableFunction): object {
    // Private-brand checks do not invoke author Proxy traps.
    return #carrier in callback ? callback.#carrier.object : callback;
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
