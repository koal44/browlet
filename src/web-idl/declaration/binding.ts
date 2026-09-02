/**
 * Identify the implementation projected by an interface.
 *
 * Interface construction dependencies apply both when the binding creates an
 * implementation internally and when an automatically bound IDL constructor
 * constructs it. Constructor-level `constructWith()` metadata overrides them.
 */
export function impl(
  implementationClass: ImplementationClass,
  options: ImplementationOptions = {},
): ImplementationDeclaration {
  return { ...options, implementation: implementationClass };
}

/** Supply hidden arguments to an automatically bound implementation constructor. */
export function constructWith(
  ...dependencies: ImplementationDependency[]
): { readonly binding: ArgumentInjectionBinding; } {
  return { binding: { dependencies } };
}

/** Supply hidden arguments to an automatically bound operation. */
export function invokeWith(
  ...dependencies: ImplementationDependency[]
): { readonly binding: ArgumentInjectionBinding; } {
  return { binding: { dependencies } };
}

/**
 * Declare an indexed getter whose implementation supplies the supported
 * property indices while ordinary operation binding supplies invocation.
 */
export function indexedGetter<Implementation extends object>(
  getSupportedPropertyIndices: (
    implementation: Implementation,
  ) => ReadonlySet<number>,
): LegacyGetterOptions {
  return {
    binding: {
      getSupportedPropertyIndices() {
        return getSupportedPropertyIndices(this as Implementation);
      },
    },
    special: 'getter',
  };
}

/**
 * Declare a named getter whose implementation supplies the supported property
 * names while ordinary operation binding supplies invocation.
 */
export function namedGetter<Implementation extends object>(
  getSupportedPropertyNames: (
    implementation: Implementation,
  ) => ReadonlySet<string>,
): LegacyGetterOptions {
  return {
    binding: {
      getSupportedPropertyNames() {
        return getSupportedPropertyNames(this as Implementation);
      },
    },
    special: 'getter',
  };
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
 * Resolve an argument to one of the listed implementations, while
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
  readonly constructWith?: readonly ImplementationDependency[];
  readonly implementation: ImplementationClass;
};

export type ImplementationOptions = {
  readonly constructWith?: readonly ImplementationDependency[];
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

export type ArgumentInjectionBinding = {
  readonly dependencies: readonly ImplementationDependency[];
};

export type LegacyGetterHooks = {
  readonly getSupportedPropertyIndices?: SupportedPropertyIndicesSteps;
  readonly getSupportedPropertyNames?: SupportedPropertyNamesSteps;
};

export type LegacyGetterBinding =
  | LegacyGetterHooks & {
    readonly getSupportedPropertyIndices: SupportedPropertyIndicesSteps;
  }
  | LegacyGetterHooks & {
    readonly getSupportedPropertyNames: SupportedPropertyNamesSteps;
  };

type CallbackArgumentBinding = {
  readonly callbackExceptionBehavior: CallbackExceptionBehavior;
};

type ImplementationArgumentBinding = {
  readonly implementations: readonly ImplementationClass[];
};

export type CallbackExceptionBehavior = 'report' | 'rethrow';

type LegacyGetterOptions = {
  readonly binding: LegacyGetterBinding;
  readonly special: 'getter';
};

type SupportedPropertyIndicesSteps = (
  this: object,
  context: unknown,
) => ReadonlySet<number>;

type SupportedPropertyNamesSteps = (
  this: object,
  context: unknown,
) => ReadonlySet<string>;

/**
 * An implementation class known to the Web IDL binding.
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
