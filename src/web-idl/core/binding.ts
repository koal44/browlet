import type {
  ArgumentOptions, AttributeOptions, OperationOptions, DeclarationCallback,
} from './definition';

/** Project helper: supply hidden arguments to an automatically bound operation. */
export function invokeWith<Realm = unknown>(
  ...argumentsList: InjectedArgument<Realm>[]
): Pick<OperationOptions<Realm>, 'invokeWith'> {
  return { invokeWith: argumentsList };
}

/**
 * Project helper: allocate a fresh buffer or view from returned or promised bytes in the result realm.
 * Without this declaration, buffer results retain their JavaScript identity.
 */
export function newBufferResult(): Pick<OperationOptions, 'newBufferResult'> {
  return { newBufferResult: true };
}

/**
 * Project helper: return one built-in function per attribute and receiver realm, named after the attribute.
 * The factory receives the owning binding context; its callback supplies the function's length.
 */
export function attrFn<Realm = unknown>(
  createCallback: NonNullable<AttributeOptions<Realm>['attributeFunction']>,
): Pick<AttributeOptions<Realm>, 'attributeFunction'> {
  return { attributeFunction: createCallback };
}

/** Project helper: supply an injected value at a final constructor or operation argument index. */
export function atArg<Realm = unknown>(
  index: number,
  resolve: InjectedArgument<Realm>['resolve'],
): InjectedArgument<Realm> {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('An injected argument index must be a nonnegative integer');
  }
  return { index, resolve };
}

/**
 * Project helper: select the Web IDL exception behavior for a callback passed to an
 * automatically bound implementation member.
 *
 * Web IDL §3.12 Invoking callback functions.
 */
export function onError(
  exceptionBehavior: CallbackExceptionBehavior,
): Pick<ArgumentOptions, 'callbackExceptionBehavior'> {
  return {
    callbackExceptionBehavior: exceptionBehavior,
  };
}

/**
 * Project helper: convert an object argument to a dictionary after ordinary IDL argument conversion.
 * Its callback-function members use the original input object as their receiver.
 */
export function callbackDictionary(name: string): Pick<ArgumentOptions, 'callbackDictionary'> {
  return { callbackDictionary: name };
}

/**
 * Project helper: unwrap an argument as one of the listed implementations, while
 * preserving values which implement none of them.
 */
export function unwrapArg(
  ...implementations: ImplementationClass[]
): Pick<ArgumentOptions, 'implementations'> {
  return { implementations };
}

export type InjectedArgument<Realm = unknown> = {
  index: number;
  resolve: DeclarationCallback<'argument-resolve', Realm>;
};

export type CallbackExceptionBehavior = 'report' | 'rethrow';

/**
 * An implementation class known to the Web IDL binding.
 *
 * Declarations need only its identity and prototype. Its concrete constructor
 * signature belongs to the implementation and can vary by platform object.
 */
export type ImplementationClass<T extends object = object> = {
  prototype: T;
};
