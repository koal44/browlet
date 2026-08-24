import type { AssembledInterface } from './assembly';
import type { JavaScriptBinding } from './binding';
import { callUserObjectOperation } from './callback';
import { isCallbackInterfaceValue } from './callback-value';
import type { AttributeMember, OperationMember } from './declaration/definition';
import type {
  AttributeSteps, ConstructorSteps, ImplementationConstructor,
  ImplementationRegistry, OperationSteps, StringificationBehavior,
  ValuePairsSteps,
} from './registry';
import type { ValuePair } from './iterable';
import type { WebIDLRealmHost } from './javascript-realm';
import { missingArgument } from './overload';

export type InterfaceBindingContext = {
  readonly objects: PlatformObjectAdapter;
  readonly realm: WebIDLRealmHost;
};

export type PlatformObjectAdapter = {
  construct<T extends object>(
    implementation: ImplementationConstructor<T>,
    argumentsList: readonly unknown[],
  ): T;
  create<T extends object>(
    implementation: ImplementationConstructor<T>,
  ): T;
  getImplementation<T extends object>(
    value: unknown,
    implementation: ImplementationConstructor<T>,
  ): T | undefined;
  project<T extends object>(
    implementation: ImplementationConstructor<T>,
    value: T,
  ): T;
};

export type InterfaceBindingDefinition = {
  implementation?: ImplementationConstructor;
  create?: InterfaceObjectCreationSteps;
  initialize?: (context: InterfaceBindingContext, value: object) => void;
};

export type CallbackInterfaceBindingDefinition = {
  adapt: ContextualSteps<
    undefined,
    [value: CallbackInterfaceBindingValue],
    unknown
  >;
};

export type CallbackInterfaceBindingValue = {
  readonly object: object;
  readonly realm: WebIDLRealmHost;
  callUserObjectOperation(
    operationName: string,
    argumentsList: readonly unknown[],
    thisArgument?: unknown,
  ): unknown;
};

type InterfaceBindingOptions = Omit<
  InterfaceBindingDefinition,
  'implementation'
>;

export function bind(
  implementation: ImplementationConstructor,
  options?: InterfaceBindingOptions,
): InterfaceBindingDefinition;
export function bind(
  definition: InterfaceBindingDefinition,
): InterfaceBindingDefinition;
export function bind(
  definition: CallbackInterfaceBindingDefinition,
): CallbackInterfaceBindingDefinition;
export function bind<
  const Binding extends MemberBindingDefinition,
  const Options extends object = object,
>(
  definition: Binding,
  options?: Options,
): Options & { binding: Binding; };
export function bind(
  implementationOrDefinition:
    | ImplementationConstructor
    | InterfaceBindingDefinition
    | CallbackInterfaceBindingDefinition
    | MemberBindingDefinition,
  options: object = {},
):
  | InterfaceBindingDefinition
  | CallbackInterfaceBindingDefinition
  | (object & { binding: MemberBindingDefinition; }) {
  if (typeof implementationOrDefinition === 'function') {
    return {
      ...(options as InterfaceBindingOptions),
      implementation: implementationOrDefinition,
    };
  }
  if (isMemberBindingDefinition(implementationOrDefinition)) {
    return { ...options, binding: implementationOrDefinition };
  }
  return implementationOrDefinition;
}

export type InterfaceObjectCreationSteps = (
  context: InterfaceBindingContext,
  newTarget: object | undefined,
) => object;

type ContextualSteps<This, Values extends unknown[], Result> = (
  this: This,
  context: InterfaceBindingContext,
  ...values: Values
) => Result;

export type AttributeBindingDefinition = {
  get?: ContextualSteps<object | null, [], unknown>;
  set?: ContextualSteps<object | null, [value: unknown], void>;
};

export type ConstructorBindingDefinition = {
  invoke: ContextualSteps<object, unknown[], void>;
};

export type OperationBindingDefinition = {
  getSupportedPropertyNames?: ContextualSteps<
    object,
    [],
    ReadonlySet<string>
  >;
  invoke: ContextualSteps<object | null, unknown[], unknown>;
};

export type StringifierBindingDefinition = {
  invoke: ContextualSteps<object, [], unknown>;
};

export type IterableBindingDefinition = {
  invoke: ContextualSteps<object, [], readonly ValuePair[]>;
};

declare module './declaration/definition' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface LanguageBindingDefinitions {
    attribute: AttributeBindingDefinition;
    'callback-interface': CallbackInterfaceBindingDefinition;
    constructor: ConstructorBindingDefinition;
    interface: InterfaceBindingDefinition;
    iterable: IterableBindingDefinition;
    operation: OperationBindingDefinition;
    stringifier: StringifierBindingDefinition;
  }
}

type MemberBindingDefinition =
  | AttributeBindingDefinition
  | ConstructorBindingDefinition
  | OperationBindingDefinition
  | StringifierBindingDefinition
  | IterableBindingDefinition;

export function createPlatformObjectAdapter(
  binding: JavaScriptBinding,
): PlatformObjectAdapter {
  function getInterface<T extends object>(
    implementation: ImplementationConstructor<T>,
  ): AssembledInterface {
    const interface_ = binding.implementations.getInterfaceForImplementation(
      implementation,
    );
    if (!interface_) {
      throw new Error(
        'No Web IDL interface is registered for this implementation',
      );
    }
    return interface_;
  }

  function requireImplementation<T extends object>(
    object: object,
  ): T {
    const implementation = binding.platformObjects.getImplementationObject(
      object,
    );
    if (!implementation) {
      throw new Error('Platform object has no implementation target');
    }
    return implementation as T;
  }

  return {
    construct<T extends object>(
      implementation: ImplementationConstructor<T>,
      argumentsList: readonly unknown[],
    ): T {
      return requireImplementation<T>(
        binding.construct(implementation, argumentsList),
      );
    },

    create<T extends object>(
      implementation: ImplementationConstructor<T>,
    ): T {
      return requireImplementation<T>(
        binding.createPlatformObject(getInterface(implementation)),
      );
    },

    getImplementation<T extends object>(
      value: unknown,
      implementation: ImplementationConstructor<T>,
    ): T | undefined {
      const interface_ = getInterface(implementation);
      const record = binding.getPlatformObjectRecord(value);
      return record && binding.platformObjects.recordImplements(
        record,
        interface_,
      )
        ? record.implementation as T
        : undefined;
    },

    project<T extends object>(
      implementation: ImplementationConstructor<T>,
      value: T,
    ): T {
      const interface_ = getInterface(implementation);
      const existing = binding.platformObjects.getImplementationRecord(value);
      if (existing) {
        if (!binding.platformObjects.recordImplements(existing, interface_)) {
          throw new TypeError(
            'Implementation target is associated with another interface',
          );
        }
        return value;
      }
      if (binding.getPlatformObjectRecord(value)) {
        throw new TypeError('Expected an implementation target');
      }

      const prototype = binding.getInterfacePrototypeObject(interface_);
      if (!Reflect.setPrototypeOf(value, prototype)) {
        throw new TypeError('Could not project platform-object prototype');
      }
      binding.projectPlatformObject(value, interface_);
      return value;
    },
  };
}

export function registerDefinitionBindings(binding: JavaScriptBinding): void {
  const objects = createPlatformObjectAdapter(binding);
  for (const interface_ of binding.definitions.getInterfaces()) {
    const { definition } = interface_;
    if (!definition.binding) continue;

    const context: InterfaceBindingContext = {
      objects,
      realm: binding.realm,
    };
    registerDefinedInterface(
      binding,
      binding.implementations,
      interface_,
      definition.binding,
      context,
    );
  }
}

function registerDefinedInterface(
  javaScriptBinding: JavaScriptBinding,
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  interfaceBinding: InterfaceBindingDefinition,
  context: InterfaceBindingContext,
): void {
  const implementation = interfaceBinding.implementation;
  if (implementation) {
    registry.setInterfaceForImplementation(implementation, interface_);
  }

  for (const { member } of interface_.members) {
    switch (member.kind) {
      case 'attribute':
        if (member.binding) {
          registerDefinedAttribute(
            registry,
            member,
            member.binding,
            context,
            javaScriptBinding,
          );
        } else {
          if (!implementation) {
            throw missingMemberBinding(interface_, member);
          }
          registerAttribute(
            registry,
            member,
            member.static ? implementation : implementation.prototype,
            context,
            javaScriptBinding,
          );
        }
        break;
      case 'constructor':
        if (member.binding) {
          registry.setConstructorSteps(
            member,
            createDefinedConstructorSteps(
              member.binding,
              context,
              javaScriptBinding,
            ),
          );
        } else if (!implementation) {
          throw missingMemberBinding(interface_, member);
        }
        break;
      case 'operation':
        if (member.binding) {
          registry.setOperationSteps(
            member,
            createDefinedOperationSteps(
              member.binding,
              context,
              javaScriptBinding,
            ),
          );
          const getSupportedPropertyNames =
            member.binding.getSupportedPropertyNames;
          if (getSupportedPropertyNames) {
            registry.setNamedPropertySteps(member, {
              getSupportedPropertyNames() {
                return callImplementation(
                  getSupportedPropertyNames,
                  this,
                  [context],
                  javaScriptBinding,
                );
              },
            });
          }
        } else {
          if (!implementation) {
            throw missingMemberBinding(interface_, member);
          }
          registerOperation(
            registry,
            member,
            member.static ? implementation : implementation.prototype,
            context,
            javaScriptBinding,
          );
        }
        break;
      case 'iterable':
        if (member.binding) {
          registry.setValuePairsSteps(
            member,
            createDefinedValuePairsSteps(
              member.binding,
              context,
              javaScriptBinding,
            ),
          );
        } else if (!implementation) {
          throw missingMemberBinding(interface_, member);
        }
        break;
      case 'stringifier':
        if (member.binding) {
          registry.setStringificationBehavior(
            member,
            createDefinedStringifierSteps(
              member.binding,
              context,
              javaScriptBinding,
            ),
          );
        } else if (!implementation) {
          throw missingMemberBinding(interface_, member);
        }
        break;
    }
  }

  const create = interfaceBinding.create;
  if (create) {
    registry.setObjectCreationSteps(
      interface_.definition,
      (newTarget) => callImplementation(
        create,
        undefined,
        [context, newTarget],
        javaScriptBinding,
      ),
    );
  } else if (implementation) {
    registry.setObjectCreationSteps(
      interface_.definition,
      (newTarget) => callImplementation(
        createDefaultImplementationObject,
        undefined,
        [interface_, implementation, newTarget],
        javaScriptBinding,
      ),
    );
  } else {
    throw new TypeError(
      `Web IDL ${interface_.definition.name} has no object creation binding`,
    );
  }
  const initialize = interfaceBinding.initialize;
  if (initialize) {
    registry.setObjectInitializationSteps(
      interface_.definition,
      (value) => callImplementation(
        initialize,
        undefined,
        [context, value],
        javaScriptBinding,
      ),
    );
  }
}

function createDefaultImplementationObject(
  interface_: AssembledInterface,
  implementation: ImplementationConstructor<object>,
  newTarget: object | undefined,
): object {
  if (!newTarget) {
    throw new Error(
      `${interface_.definition.name} implementation creation requires newTarget`,
    );
  }
  return Reflect.construct(
    implementation,
    [],
    newTarget as ImplementationConstructor<object>,
  ) as object;
}

function missingMemberBinding(
  interface_: AssembledInterface,
  member: { readonly kind: string; readonly name?: string; },
): TypeError {
  return new TypeError(
    `Web IDL ${interface_.definition.name}.${member.name ?? member.kind} has no binding`,
  );
}

function registerDefinedAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  binding: AttributeBindingDefinition,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): void {
  const steps: AttributeSteps = {
    get() {
      if (!binding.get) {
        throw new TypeError(
          `Web IDL attribute ${member.name} has no getter binding`,
        );
      }
      return callImplementation(
        binding.get,
        this,
        [context],
        javaScriptBinding,
      );
    },
  };
  const set = binding.set;
  if (set && !member.readonly) {
    steps.set = function(value) {
      callImplementation(
        set,
        this,
        [context, toImplementationValue(value, context, javaScriptBinding)],
        javaScriptBinding,
      );
    };
  }
  registry.setAttributeSteps(member, steps);
}

function createDefinedConstructorSteps(
  binding: ConstructorBindingDefinition,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): ConstructorSteps {
  return function(...values) {
    callImplementation(
      binding.invoke,
      this,
      [
        context,
        ...values.map((value) =>
          toImplementationValue(value, context, javaScriptBinding)),
      ],
      javaScriptBinding,
    );
  };
}

function createDefinedOperationSteps(
  binding: OperationBindingDefinition,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): OperationSteps {
  return function(...values) {
    return callImplementation(
      binding.invoke,
      this,
      [
        context,
        ...values.map((value) =>
          toImplementationValue(value, context, javaScriptBinding)),
      ],
      javaScriptBinding,
    );
  };
}

function createDefinedStringifierSteps(
  binding: StringifierBindingDefinition,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): StringificationBehavior {
  return function() {
    return callImplementation(
      binding.invoke,
      this,
      [context],
      javaScriptBinding,
    );
  };
}

function createDefinedValuePairsSteps(
  binding: IterableBindingDefinition,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): ValuePairsSteps {
  return function() {
    return callImplementation(
      binding.invoke,
      this,
      [context],
      javaScriptBinding,
    );
  };
}

function registerAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  target: object,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): void {
  const descriptor = findDescriptor(target, member.name);
  if (!descriptor?.get) {
    throw new TypeError(`Web IDL attribute ${member.name} has no implementation`);
  }

  const getterValue: unknown = Reflect.get(descriptor, 'get');
  const setterValue: unknown = Reflect.get(descriptor, 'set');
  const get = getterValue as (this: object | null) => unknown;
  const set = setterValue as
    ((this: object | null, value: unknown) => void) | undefined;
  registry.setAttributeSteps(member, {
    get() {
      return callImplementation(get, this, [], javaScriptBinding);
    },
    ...(set && !member.readonly
      ? {
        set(value: unknown) {
          callImplementation(
            set,
            this,
            [toImplementationValue(value, context, javaScriptBinding)],
            javaScriptBinding,
          );
        },
      }
      : {}),
  });
}

function registerOperation(
  registry: ImplementationRegistry,
  member: OperationMember,
  target: object,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): void {
  const value: unknown = findDescriptor(target, member.name ?? '')?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      `Web IDL operation ${member.name ?? ''} has no implementation`,
    );
  }
  const method = value as OperationSteps;

  registry.setOperationSteps(
    member,
    createOperationSteps(method, context, javaScriptBinding),
  );
}

function createOperationSteps(
  implementation: OperationSteps,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): OperationSteps {
  return function(...values) {
    return callImplementation(
      implementation,
      this,
      values.map((value) =>
        toImplementationValue(value, context, javaScriptBinding)),
      javaScriptBinding,
    );
  };
}

function callImplementation<This, Values extends unknown[], Result>(
  implementation: (this: This, ...values: Values) => Result,
  thisArgument: This,
  values: Values,
  binding: JavaScriptBinding,
): Result {
  try {
    return Reflect.apply(implementation, thisArgument, values);
  } catch (exception) {
    throw binding.realizeException(exception);
  }
}

function findDescriptor(
  target: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  for (
    let current: object | null = target;
    current && current !== Object.prototype;
    current = Reflect.getPrototypeOf(current)
  ) {
    const descriptor = Reflect.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
  }
}

function toImplementationValue(
  value: unknown,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): unknown {
  if (value === missingArgument) return undefined;
  if (isCallbackInterfaceValue(value)) {
    const callbackBinding = value.definition.binding;
    if (!callbackBinding) return value;

    const callback: CallbackInterfaceBindingValue = {
      callUserObjectOperation: (
        operationName,
        argumentsList,
        thisArgument,
      ) => callUserObjectOperation(
        value,
        operationName,
        argumentsList,
        thisArgument,
      ),
      object: value.object,
      realm: value.realm,
    };
    return callImplementation(
      callbackBinding.adapt,
      undefined,
      [context, callback],
      javaScriptBinding,
    );
  }
  if (!(value instanceof Map)) return value;

  const object: Record<PropertyKey, unknown> = {};
  const dictionary = value as Map<PropertyKey, unknown>;
  for (const [name, memberValue] of dictionary) {
    object[name] = toImplementationValue(
      memberValue,
      context,
      javaScriptBinding,
    );
  }
  return object;
}

function isMemberBindingDefinition(
  definition:
    | InterfaceBindingDefinition
    | CallbackInterfaceBindingDefinition
    | MemberBindingDefinition,
): definition is MemberBindingDefinition {
  return 'get' in definition ||
    'set' in definition ||
    'invoke' in definition ||
    'getSupportedPropertyNames' in definition;
}
