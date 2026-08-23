import type {
  CallbackFunctionValue, CallbackInterfaceValue, CallbackValue,
} from './callback-value';
import {
  convertToIDL, convertToJavaScript, type ConversionContext,
} from './conversion';
import type {
  ArgumentDefinition, OperationMember, WebIDLType,
} from './definition';
import { isPromiseValue, type IDLPromise } from './promise-value';
import {
  getTypeWithApplicableExtendedAttributes, getUnannotatedType,
} from './types';

export function callUserObjectOperation(
  value: CallbackInterfaceValue,
  operationName: string,
  argumentsList: WebIDLArgumentsList,
  context: ConversionContext,
  thisArgument?: unknown,
): unknown {
  const operation = getCallbackOperation(value, operationName);
  const callbackContext = withCallbackRealm(context, value);

  try {
    return runCallback(value, () => {
      let function_: unknown = value.object;
      let receiver = thisArgument;

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

export function invokeCallbackFunction(
  callable: CallbackFunctionValue,
  argumentsList: WebIDLArgumentsList,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  context: ConversionContext,
  thisArgument?: unknown,
): unknown {
  const { definition } = callable;
  validateExceptionBehavior(definition.returns, exceptionBehavior, context);
  const callbackContext = withCallbackRealm(context, callable);
  const function_ = callable.object;

  if (!isCallable(function_)) {
    return convertToIDL(undefined, definition.returns, callbackContext);
  }

  try {
    return runCallback(callable, () => {
      const result = Reflect.apply(
        function_,
        thisArgument,
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

export function constructCallbackFunction(
  callable: CallbackFunctionValue,
  argumentsList: WebIDLArgumentsList,
  context: ConversionContext,
): unknown {
  const constructor = callable.object;
  if (!isConstructor(constructor)) {
    throw new context.realm.intrinsics.typeError(
      `${callable.definition.name} is not a constructor`,
    );
  }

  const callbackContext = withCallbackRealm(context, callable);
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

export type CallbackExceptionBehavior = 'report' | 'rethrow';
export type WebIDLArgumentsList = readonly unknown[];

export const missingArgument: unique symbol = Symbol(
  'missing Web IDL argument',
);

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

function getCallbackOperation(
  value: CallbackInterfaceValue,
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

function getArgumentDefinition(
  definitions: ArgumentDefinition[],
  index: number,
): ArgumentDefinition | undefined {
  const definition = definitions[index];
  if (definition) return definition;
  const variadic = definitions.at(-1);
  return variadic?.variadic ? variadic : undefined;
}

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
  const type = getUnannotatedType(returnType, context.definitions);
  const canReport = type.kind === 'simple' && (
    type.name === 'undefined' || type.name === 'any'
  );
  if (exceptionBehavior === 'report' && !canReport) {
    throw new Error(
      'Only undefined- and any-returning callbacks can report exceptions',
    );
  }
}

function rejectPromiseReturn(
  returnType: WebIDLType,
  exception: unknown,
  context: ConversionContext,
): IDLPromise {
  const type = getPromiseReturnType(returnType, context);
  if (!type) throw exception;
  const rejected = Reflect.apply(
    context.realm.intrinsics.promise.reject,
    context.realm.intrinsics.promise.constructor,
    [exception],
  );
  const promise = convertToIDL(rejected, returnType, context);
  if (!isPromiseValue(promise)) {
    throw new Error('Promise callback did not produce an IDL promise');
  }
  return promise;
}

function getPromiseReturnType(
  returnType: WebIDLType,
  context: ConversionContext,
): WebIDLType | undefined {
  const type = getUnannotatedType(returnType, context.definitions);
  return type.kind === 'promise' ? type.type : undefined;
}

function withCallbackRealm(
  context: ConversionContext,
  value: CallbackValue,
): ConversionContext {
  return {
    definitions: context.definitions,
    hostDefinedInterfaces: context.hostDefinedInterfaces,
    platformObjects: context.platformObjects,
    realm: value.realm,
  };
}

function isConstructor(value: object): value is new (...args: unknown[]) => object {
  const probe = new Proxy(value, {
    construct: () => ({}),
  });
  try {
    Reflect.construct(probe as CallableFunction, []);
    return true;
  } catch {
    return false;
  }
}

function isCallable(
  value: unknown,
): value is (...argumentsList: unknown[]) => unknown {
  return typeof value === 'function';
}
