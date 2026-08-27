/**
 * Identify the semantic implementation projected by an interface.
 *
 * Interface construction dependencies apply both when the binding creates an
 * implementation internally and when an automatically bound IDL constructor
 * constructs it. Constructor-level `withArgs()` metadata overrides them.
 */
export function impl(
  implementationClass: ImplementationClass,
  options: ImplementationOptions = {},
): ImplementationDeclaration {
  return { ...options, implementation: implementationClass };
}

/** Supply hidden arguments to this automatically bound implementation constructor. */
export function withArgs(
  ...dependencies: ImplementationDependency[]
): { readonly binding: ConstructorDependencyBinding; } {
  return { binding: { dependencies } };
}

/**
 * Prepend newly created semantic platform-object implementations to an
 * automatically bound operation.
 */
export function withNew(
  ...dependencies: ImplementationDependency[]
): { readonly binding: OperationDependencyBinding; } {
  return { binding: { dependencies } };
}

/** Resolve a semantic constructor dependency from the active binding context. */
export function contextValue<Context, Value>(
  resolve: (context: Context) => Value,
): ContextValue<Value> {
  return {
    resolve: resolve as (context: unknown) => Value,
  };
}

/** Place a contextual constructor dependency at an exact argument index. */
export function atArg<Value>(
  index: number,
  value: Value,
): PositionedArgument<Value> {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('A constructor argument index must be nonnegative');
  }
  return { index, value };
}

/**
 * Select the Web IDL exception behavior for a callback passed to an
 * automatically bound implementation member.
 */
export function callback(
  exceptionBehavior: CallbackExceptionBehavior,
): { readonly binding: CallbackArgumentBinding; } {
  return { binding: { callbackExceptionBehavior: exceptionBehavior } };
}

/**
 * Resolve an argument to one of the listed semantic implementations, while
 * preserving values which implement none of them.
 */
export function resolveArgs(
  ...implementations: ImplementationClass[]
): { readonly binding: ImplementationArgumentBinding; } {
  return { binding: { implementations } };
}

export type ArgumentBinding =
  | CallbackArgumentBinding
  | ImplementationArgumentBinding;

export type ImplementationDeclaration = {
  readonly withArgs?: readonly ImplementationDependency[];
  readonly implementation: ImplementationClass;
};

export type ImplementationOptions = {
  readonly withArgs?: readonly ImplementationDependency[];
};

export type ImplementationDependency =
  | ImplementationDependencyValue
  | PositionedArgument<ImplementationDependencyValue>;

export type ImplementationDependencyValue =
  | 'current-global'
  | ContextValue
  | ImplementationClass;

export type PositionedArgument<Value> = {
  readonly index: number;
  readonly value: Value;
};

export type ContextValue<Value = unknown> = {
  readonly resolve: (context: unknown) => Value;
};

export type ConstructorDependencyBinding = {
  readonly dependencies: readonly ImplementationDependency[];
};

export type OperationDependencyBinding = {
  readonly dependencies: readonly ImplementationDependency[];
};

type CallbackArgumentBinding = {
  readonly callbackExceptionBehavior: CallbackExceptionBehavior;
};

type ImplementationArgumentBinding = {
  readonly implementations: readonly ImplementationClass[];
};

export type CallbackExceptionBehavior = 'report' | 'rethrow';

/**
 * A semantic implementation class known to the Web IDL binding.
 *
 * Declarations need only its identity and prototype. Its concrete constructor
 * signature belongs to the implementation and can vary by platform object.
 */
export type ImplementationClass<T extends object = object> = {
  readonly prototype: T;
};

declare module './definition' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface LanguageBindingDefinitions {
    argument: ArgumentBinding;
    'dictionary-member': CallbackArgumentBinding;
  }
}
