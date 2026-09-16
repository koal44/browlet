import { getImplementationRecord } from './platform-object';
import { isCallable, isConstructor } from '../js-engine/index';
import type {
  CallbackFunctionValue, CallbackInterfaceRecord, CallbackValue,
} from './callback-value';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type {
  ArgumentDefinition, OperationMember, WebIDLType,
} from './core/index';
import type { CallbackExceptionBehavior } from './core/types';
import { isIDLPromiseRecord, type IDLPromiseRecord } from './promise-record';
import { getArgumentDefinition } from './overload';
import {
  getTypeWithApplicableExtendedAttributes, getUnannotatedType,
} from './types';

// Web IDL §3.11 Callback interfaces — call a user object's operation.
export function callUserObjectOperation(
  value: CallbackInterfaceRecord,
  operationName: string,
  argumentsList: WebIDLArgumentsList,
  thisArgument?: unknown,
): unknown {
  const operation = getCallbackOperation(value, operationName);
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
          operation.arguments,
          callbackContext,
        ),
      );
      return convertToIDL(result, operation.returns, callbackContext);
    });
  } catch (exception) {
    return rejectPromiseReturn(
      operation.returns,
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
  const { definition } = callable;
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
          definition.arguments,
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
    callable.realm.callbacks.reportException(exception);
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
      `${callable.definition.name} is not a constructor`,
    );
  }

  const callbackContext = { binding: context.binding, realm: callable.realm };
  return runCallback(callable, () => {
    const result = Reflect.construct(
      constructor,
      convertWebIDLArguments(
        argumentsList,
        callable.definition.arguments,
        callbackContext,
      ),
    );
    return convertToIDL(
      result,
      callable.definition.returns,
      callbackContext,
    );
  });
}

// Web IDL §3.11 Callback interfaces — convert a Web IDL arguments list to a JavaScript arguments list.
export function convertWebIDLArguments(
  argumentsList: WebIDLArgumentsList,
  definitions: ArgumentDefinition[],
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

    const definition = getArgumentDefinition(definitions, index);
    if (!definition) {
      throw new Error(`Web IDL argument ${index} has no declared type`);
    }
    result.push(convertToJavaScript(
      value,
      getTypeWithApplicableExtendedAttributes(
        definition.type,
        definition.extendedAttributes,
      ),
      context,
    ));
    count = index + 1;
  }

  result.length = count;
  return result;
}

export type WebIDLArgumentsList = readonly unknown[];

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

// Project helper: find the callback-interface operation's declaration.
function getCallbackOperation(
  value: CallbackInterfaceRecord,
  operationName: string,
): OperationMember {
  const operation = value.definition.members.find((member) =>
    member.kind === 'operation' && member.name === operationName);
  if (!operation || operation.kind !== 'operation') {
    throw new Error(
      `Callback interface ${value.definition.name} has no ${operationName} operation`,
    );
  }
  return operation;
}

// Project validation of Web IDL §3.12 Invoking callback functions — invoke's exception-behavior requirements.
function validateExceptionBehavior(
  returnType: WebIDLType,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  context: ConversionContext,
): void {
  if (getPromiseReturnType(returnType, context)) {
    if (exceptionBehavior) {
      throw new Error('A promise callback cannot have exception behavior');
    }
    return;
  }
  if (!exceptionBehavior) {
    throw new Error('A non-promise callback requires exception behavior');
  }
  const type = getUnannotatedType(returnType, context.binding.definitions);
  const canReport = type.kind === 'simple' && (
    type.name === 'undefined' || type.name === 'any'
  );
  if (exceptionBehavior === 'report' && !canReport) {
    throw new Error(
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
    throw new Error('Promise callback did not produce an IDL promise');
  }
  return promise;
}

// Project helper: resolve whether a callback declares a Promise<T> return type.
function getPromiseReturnType(
  returnType: WebIDLType,
  context: ConversionContext,
): WebIDLType | undefined {
  const type = getUnannotatedType(returnType, context.binding.definitions);
  return type.kind === 'promise' ? type.type : undefined;
}
