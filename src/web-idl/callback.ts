import { getImplementationRecord } from './platform-object';
import { isCallable, isConstructor } from '../js-engine/index';
import type {
  CallbackFunctionValue, CallbackInterfaceRecord, CallbackValue,
} from './callback-value';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type { WebIDLType } from './core/index';
import type { AssembledCallable } from './assembled';
import type { CallbackExceptionBehavior } from './core/types';
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

  try {
    return runCallback(value, () => {
      let function_: unknown = value.object;
      let receiver = projectCallbackReceiver(thisArgument);

      if (!isCallable(function_)) {
        function_ = Reflect.get(value.object, operationName) as unknown;
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
        convertWebIDLArguments(
          argumentsList,
          operation,
          callbackContext,
        ),
      );
      return convertToIDL(result, operation.primary.returns, callbackContext);
    });
  } catch (exception) {
    return rejectPromiseReturn(
      operation.primary.returns,
      exception,
      callbackContext,
    );
  }
}

// Web IDL §3.12 Invoking callback functions — invoke a callback function.
export function invokeCallbackFunction(
  callable: CallbackFunctionValue,
  argumentsList: WebIDLArgumentsList,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  thisArgument?: unknown,
): unknown {
  const definition = callable.assembled.primary;
  const context = callable.conversionContext;
  validateExceptionBehavior(definition.returns, exceptionBehavior, context);
  const callbackContext = { binding: context.binding, realm: callable.realm };
  const function_ = callable.object;

  if (!isCallable(function_)) {
    return convertToIDL(undefined, definition.returns, callbackContext);
  }

  try {
    return runCallback(callable, () => {
      const result = Reflect.apply(
        function_,
        projectCallbackReceiver(thisArgument),
        convertWebIDLArguments(
          argumentsList,
          callable.assembled,
          callbackContext,
        ),
      );
      return convertToIDL(result, definition.returns, callbackContext);
    });
  } catch (exception) {
    if (getPromiseReturnType(definition.returns, callbackContext)) {
      return rejectPromiseReturn(
        definition.returns,
        exception,
        callbackContext,
      );
    }
    if (exceptionBehavior === 'rethrow') throw exception;
    callable.realm.reportException(exception);
    return undefined;
  }
}

// Web IDL §3.12 Invoking callback functions — construct a callback function.
export function constructCallbackFunction(
  callable: CallbackFunctionValue,
  argumentsList: WebIDLArgumentsList,
): unknown {
  const context = callable.conversionContext;
  const constructor = callable.object;
  if (!isConstructor(constructor)) {
    throw new context.realm.intrinsics.typeError(
      `${callable.assembled.primary.name} is not a constructor`,
    );
  }

  const callbackContext = { binding: context.binding, realm: callable.realm };
  return runCallback(callable, () => {
    const result = Reflect.construct(
      constructor,
      convertWebIDLArguments(
        argumentsList,
        callable.assembled,
        callbackContext,
      ),
    );
    return convertToIDL(
      result,
      callable.assembled.primary.returns,
      callbackContext,
    );
  });
}

// https://webidl.spec.whatwg.org/#js-user-objects
// Our argument values carry their IDL types through the assembled callable.
// SPEC_MISMATCH: (args) -> JavaScript arguments list
export function convertWebIDLArguments(
  argumentsList: WebIDLArgumentsList,
  assembled: AssembledCallable,
  context: ConversionContext,
): unknown[] {
  const result: unknown[] = [];
  let count = 0;

  for (let index = 0; index < argumentsList.length; index++) {
    const value = argumentsList[index];
    if (value === missingArgument) {
      result.push(undefined);
      continue;
    }

    const argument = assembled.getArgument(index);
    if (!argument) {
      throw new InternalError(`Web IDL argument ${index} has no declared type`);
    }
    result.push(convertToJavaScript(
      value,
      argument.type,
      context,
    ));
    count = index + 1;
  }

  result.length = count;
  return result;
}

export type WebIDLArgumentsList = unknown[];

export const missingArgument: unique symbol = Symbol(
  'missing Web IDL argument',
);

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

// Project validation of Web IDL §3.12 Invoking callback functions — invoke's exception-behavior requirements.
function validateExceptionBehavior(
  returnType: WebIDLType,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  context: ConversionContext,
): void {
  if (getPromiseReturnType(returnType, context)) {
    if (exceptionBehavior) {
      throw new InternalError('A promise callback cannot have exception behavior');
    }
    return;
  }
  if (!exceptionBehavior) {
    throw new InternalError('A non-promise callback requires exception behavior');
  }
  const type = context.binding.assembly.getUnannotatedType(returnType);
  const canReport = type.kind === 'simple' && (
    type.name === 'undefined' || type.name === 'any'
  );
  if (exceptionBehavior === 'report' && !canReport) {
    throw new InternalError(
      'Only undefined- and any-returning callbacks can report exceptions',
    );
  }
}

// Extracted exception-to-promise return steps from Web IDL §3.11 Callback interfaces
// and §3.12 Invoking callback functions.
function rejectPromiseReturn(
  returnType: WebIDLType,
  exception: unknown,
  context: ConversionContext,
): IDLPromiseRecord {
  const type = getPromiseReturnType(returnType, context);
  if (!type) throw exception;
  const rejected = Reflect.apply(
    context.realm.intrinsics.promise.reject,
    context.realm.intrinsics.promise.constructor,
    [exception],
  );
  const promise = convertToIDL(rejected, returnType, context);
  if (!isIDLPromiseRecord(promise)) {
    throw new InternalError('Promise callback did not produce an IDL promise');
  }
  return promise;
}

// Project helper: resolve whether a callback declares a Promise<T> return type.
function getPromiseReturnType(
  returnType: WebIDLType,
  context: ConversionContext,
): WebIDLType | undefined {
  const type = context.binding.assembly.getUnannotatedType(returnType);
  return type.kind === 'promise' ? type.type : undefined;
}
