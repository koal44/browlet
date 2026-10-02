import { getImplementationRecord } from './platform-object';
import { isCallable, isConstructor, isObject } from '../js-engine/index';
import {
  getCallbackFunctionValue,
  type CallbackFunctionAdapter, type CallbackFunctionValue, type CallbackInterfaceRecord, type CallbackValue,
} from './callback-value';
import {
  createIDLConverter, createJavaScriptConverter, type ConversionContext, type ValueConverter,
} from './conversion';
import type { AssembledCallable, AssembledCallbackFunction } from './assembled';
import type { DefinitionAssembly } from './assembly';
import type { CallbackExceptionBehavior, OperationMember } from './core/types';
import { isIDLPromiseRecord, type IDLPromiseRecord } from './promise-record';
import { InternalError } from '../infra/internal-error';

// Web IDL §3.11 Callback interfaces — call a user object's operation.
export function callUserObjectOperation(
  value: CallbackInterfaceRecord,
  operationName: string,
  argumentsList: WebIDLArgumentsList,
  thisArgument?: unknown,
): unknown {
  const operation = value.assembled.getOperation(operationName);
  const callbackContext = { binding: value.conversionContext.binding, realm: value.realm };
  const converter = callbackContext.binding.getCallbackConverter(operation);

  try {
    return runCallback(value, () => {
      let function_: unknown = value.object;
      let receiver = projectCallbackReceiver(thisArgument);

      if (!isCallable(function_)) {
        function_ = (value.object as Record<string, unknown>)[operationName];
        if (!isCallable(function_)) {
          throw new value.realm.intrinsics.typeError(
            `${operationName} is not callable`,
          );
        }
        receiver = value.object;
      }

      const result = Reflect.apply(
        function_,
        receiver,
        converter.convertArguments(argumentsList, callbackContext),
      );
      return converter.convertReturn(result, callbackContext);
    });
  } catch (exception) {
    return converter.rejectPromiseReturn(exception, callbackContext);
  }
}

// Web IDL §3.12 Invoking callback functions — invoke a callback function.
export function invokeCallbackFunction(
  callable: CallbackFunctionValue,
  argumentsList: WebIDLArgumentsList,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  thisArgument?: unknown,
): unknown {
  return callable.conversionContext.binding.getCallbackConverter(callable.assembled)
    .invoke(callable, argumentsList, exceptionBehavior, thisArgument);
}

/** Construct a converted callback or its implementation adapter, returning the IDL result. */
// https://webidl.spec.whatwg.org/#construct-a-callback-function
export function constructCallbackFunction(
  callable: CallbackFunctionValue | CallbackFunctionAdapter,
  argumentsList: WebIDLArgumentsList,
): unknown {
  const value = typeof callable === 'function' ? getCallbackFunctionValue(callable) : callable;
  return value.conversionContext.binding.getCallbackConverter(value.assembled)
    .construct(value, argumentsList);
}

export type WebIDLArgumentsList = unknown[];

export const missingArgument: unique symbol = Symbol(
  'missing Web IDL argument',
);

/** Fixed callback conversions, reused with each callback's own allocation realm. */
export class CallbackConverter {
  convertReturn: ValueConverter;
  returnsPromise: boolean;
  canReportExceptions: boolean;
  #argumentConverters: ValueConverter[];
  #variadicConverter: ValueConverter | undefined;
  #primitiveArguments: boolean;

  constructor(assembled: CallbackCallable, assembly: DefinitionAssembly) {
    this.#argumentConverters = assembled.arguments.map((argument) => createJavaScriptConverter(argument.type, assembly));
    this.#variadicConverter = assembled.variadicArgument && this.#argumentConverters.at(-1);
    this.#primitiveArguments = assembled.arguments.every((argument) => {
      const type = assembly.getUnannotatedType(argument.type);
      return type.kind === 'simple' && (
        assembly.hasNumericCandidate(type) || assembly.hasStringCandidate(type) ||
        type.name === 'boolean' || type.name === 'bigint'
      );
    });
    this.convertReturn = createIDLConverter(assembled.primary.returns, assembly);
    const returns = assembly.getUnannotatedType(assembled.primary.returns);
    this.returnsPromise = returns.kind === 'promise';
    this.canReportExceptions = returns.kind === 'simple' && (returns.name === 'undefined' || returns.name === 'any');
  }

  /** Invoke a retained callback using this contract and the callback's own realm. */
  // https://webidl.spec.whatwg.org/#invoke-a-callback-function
  invoke(
    callable: CallbackFunctionValue,
    argumentsList: WebIDLArgumentsList,
    exceptionBehavior: CallbackExceptionBehavior | undefined,
    thisArgument?: unknown,
  ): unknown {
    this.validateExceptionBehavior(exceptionBehavior);
    const callbackContext = { binding: callable.conversionContext.binding, realm: callable.realm };
    const function_ = callable.object;
    if (!isCallable(function_)) return this.convertReturn(undefined, callbackContext);
    try {
      return runCallback(callable, () => {
        const result = Reflect.apply(
          function_, projectCallbackReceiver(thisArgument), this.convertArguments(argumentsList, callbackContext),
        );
        return this.convertReturn(result, callbackContext);
      });
    } catch (exception) {
      if (this.returnsPromise) return this.rejectPromiseReturn(exception, callbackContext);
      if (exceptionBehavior === 'rethrow') throw exception;
      callable.realm.reportException(exception);
      return undefined;
    }
  }

  /** Construct with a retained callback, converting its arguments and result. */
  // https://webidl.spec.whatwg.org/#construct-a-callback-function
  construct(callable: CallbackFunctionValue, argumentsList: WebIDLArgumentsList): unknown {
    const context = callable.conversionContext;
    const constructor = callable.object;
    if (!isConstructor(constructor)) {
      throw new context.realm.intrinsics.typeError(`${callable.assembled.primary.name} is not a constructor`);
    }
    const callbackContext = { binding: context.binding, realm: callable.realm };
    return runCallback(callable, () => {
      const result = Reflect.construct(constructor, this.convertArguments(argumentsList, callbackContext));
      return this.convertReturn(result, callbackContext);
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

  /** Project the supplied IDL arguments, omitting trailing missing arguments. */
  // https://webidl.spec.whatwg.org/#js-user-objects
  // Argument types come from the assembled callable used to prepare this converter.
  // SPEC_MISMATCH: (args) -> JavaScript arguments list
  convertArguments(argumentsList: WebIDLArgumentsList, context: ConversionContext): unknown[] {
    // These IDL values already are their JavaScript representation. Reuse the
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
      result.push(convert(value, context));
      count = index + 1;
    }
    result.length = count;
    return result;
  }

  /** Promise-returning callbacks reject in the callback realm; other failures propagate. */
  rejectPromiseReturn(exception: unknown, context: ConversionContext): IDLPromiseRecord {
    if (!this.returnsPromise) throw exception;
    const rejected = Reflect.apply(
      context.realm.intrinsics.promise.reject,
      context.realm.intrinsics.promise.constructor,
      [exception],
    );
    const promise = this.convertReturn(rejected, context);
    if (!isIDLPromiseRecord(promise)) throw new InternalError('Promise callback did not produce an IDL promise');
    return promise;
  }
}

export type CallbackCallable = AssembledCallbackFunction | AssembledCallable<OperationMember>;

// Project helper: map an implementation receiver to its platform object before calling author code.
function projectCallbackReceiver(
  value: unknown,
): unknown {
  return getImplementationRecord(value)?.platformObject ?? value;
}

// Extracted preparation and cleanup from Web IDL §3.11 Callback interfaces
// and §3.12 Invoking callback functions; delegates lifecycle hooks to the host.
// HTML §8.1.3.3 Realms, settings objects, and global objects; §8.1.4.4 Calling scripts.
function runCallback(
  value: CallbackValue,
  steps: () => unknown,
): unknown {
  const { callbacks } = value.realm;
  callbacks.prepareToRunScript();
  try {
    callbacks.prepareToRunCallback(value.callbackContext);
    try {
      return steps();
    } finally {
      callbacks.cleanUpAfterRunningCallback(value.callbackContext);
    }
  } finally {
    callbacks.cleanUpAfterRunningScript();
  }
}
