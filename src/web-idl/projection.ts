import type { AssembledInterface } from './assembly';
import type { RealmBinding } from './binding';
import {
  callUserObjectOperation, constructCallbackFunction, invokeCallbackFunction,
} from './callback';
import {
  isCallbackFunctionValue, isCallbackInterfaceValue,
  type CallbackFunctionValue,
} from './callback-value';
import {
  hasExtendedAttribute, idlType, type ArgumentDefinition,
  type AsyncIterableMember, type AttributeMember, type IterableMember,
  type InterfaceDefinition, type OperationMember, type StringifierMember,
  type WebIDLType,
} from './declaration/definition';
import type {
  ArgumentInjectionBinding, CallbackExceptionBehavior, ContextValue,
  ImplementationClass, ImplementationDependency, ImplementationDependencyValue,
  LegacyGetterBinding, LegacyGetterHooks, NewBufferResultBinding,
  PositionedArgument,
} from './declaration/binding';
import type {
  AsyncIteratorSteps, AttributeSteps, ConstructorSteps,
  ImplementationConstructorSteps, ImplementationRegistry, OperationSteps,
  StringificationBehavior, ValuePairsSteps,
} from './registry';
import type { ValuePair } from './iterable';
import type { WebIDLRealmHost } from './javascript-realm';
import { missingArgument } from './overload';
import { convertToIDL } from './conversion';
import {
  createPromise, createRejectedPromise, createResolvedPromise,
  getPromiseForWaitingForAll, isPromiseUnresolved, markPromiseAsHandled,
  projectPromise, reactToPromise, rejectPromise, resolvePromise, toImplementationPromise,
} from './promise';
import { isPromiseValue } from './promise-value';
import { getUnannotatedType } from './types';
import type { Capability } from './capability';
import type { PlatformObjectRecord } from './platform-object';
import {
  closeAsyncIterator, endOfIteration, getAsyncIteratorNextValue,
  isAsyncSequence, openAsyncSequence,
} from './async-sequence';

export type BindingContext = {
  readonly realm: WebIDLRealmHost;

  convert(value: unknown, type: WebIDLType): unknown;
  realizeException(value: unknown): unknown;

  createPlatformObject(
    interface_: InterfaceDefinition,
  ): Readonly<PlatformObjectRecord>;
  getCapability<Value>(
    interface_: InterfaceDefinition,
    capability: Capability<Value>,
  ): Value | undefined;
  getInterface(name: string): InterfaceDefinition | undefined;
  isInterfaceExposed(interface_: InterfaceDefinition): boolean;
  resolvePlatformObject(
    value: unknown,
  ): Readonly<PlatformObjectRecord> | undefined;

  construct<T extends object>(
    implementation: ImplementationClass<T>,
    ...argumentsList: unknown[]
  ): T;
  getImplementation<T extends object>(
    value: unknown,
    implementation: ImplementationClass<T>,
  ): T | undefined;
  project<T extends object>(
    implementation: ImplementationClass<T>,
    value: T,
  ): object;

  createPromise(type: WebIDLType): object;
  createRejectedPromise(reason: unknown, type: WebIDLType): object;
  createResolvedPromise(value: unknown, type: WebIDLType): object;
  isPromiseUnresolved(value: unknown): boolean;
  markPromiseHandled(value: unknown): void;
  reactToPromise(
    value: unknown,
    resultType: WebIDLType,
    steps: {
      fulfilled?: (value: unknown) => unknown;
      rejected?: (reason: unknown) => unknown;
    },
  ): object;
  rejectPromise(value: unknown, reason: unknown): void;
  resolvePromise(value: unknown, result: unknown): void;
  waitForAllPromises(values: readonly unknown[], type: WebIDLType): object;
};

export const bindingContext: ContextValue<BindingContext> = {
  resolve: (context) => context as BindingContext,
};

type InterfaceBindingDefinition = {
  implementation?: ImplementationClass;
  allocatePlatformObject?: PlatformObjectAllocationBinding;
  constructWith?: readonly ImplementationDependency[];
  initializeImplementation?: (context: BindingContext, value: object) => void;
};

type CallbackInterfaceBindingDefinition = {
  adapt: ContextualSteps<
    undefined,
    [value: CallbackInterfaceBindingValue],
    unknown
  >;
};

type CallbackInterfaceBindingValue = {
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
  implementation: ImplementationClass,
  options: InterfaceBindingOptions,
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
    | ImplementationClass
    | InterfaceBindingDefinition
    | CallbackInterfaceBindingDefinition
    | MemberBindingDefinition,
  options: object = {},
):
  | InterfaceBindingDefinition
  | CallbackInterfaceBindingDefinition
  | (object & { binding: MemberBindingDefinition; }) {
  if (isImplementationClass(implementationOrDefinition)) {
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

function isImplementationClass(
  value:
    | ImplementationClass
    | InterfaceBindingDefinition
    | CallbackInterfaceBindingDefinition
    | MemberBindingDefinition,
): value is ImplementationClass {
  return typeof value === 'function';
}

type PlatformObjectAllocationBinding = (
  context: BindingContext,
  prototype: object,
) => object;

type ContextualSteps<This, Values extends unknown[], Result> = (
  this: This,
  context: BindingContext,
  ...values: Values
) => Result;

type AttributeBindingDefinition = {
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  get?: ContextualSteps<object | null, [], unknown>;
  set?: ContextualSteps<object | null, [value: unknown], void>;
};

type ConstructorBindingDefinition =
  | ArgumentInjectionBinding
  | { construct: ContextualSteps<undefined, unknown[], object>; }
  | { invoke: ContextualSteps<object, unknown[], void>; };

type OperationBindingDefinition =
  | ArgumentInjectionBinding
  | (LegacyGetterHooks & {
    invoke: ContextualSteps<object | null, unknown[], unknown>;
  })
  | (LegacyGetterHooks & NewBufferResultBinding)
  | LegacyGetterBinding;

type StringifierBindingDefinition = {
  invoke: ContextualSteps<object, [], unknown>;
};

type IterableBindingDefinition = {
  invoke: ContextualSteps<object, [], readonly ValuePair[]>;
};

type AsyncIterableBindingDefinition = {
  getNext: (target: object, iterator: object) => unknown;
  initialize?: (
    target: object,
    iterator: object,
    argumentsList: unknown[],
  ) => void;
  return?: (
    target: object,
    iterator: object,
    value: unknown,
  ) => unknown;
};

declare module './declaration/definition' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface LanguageBindingDefinitions {
    attribute: AttributeBindingDefinition;
    'async-iterable': AsyncIterableBindingDefinition;
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
  | AsyncIterableBindingDefinition
  | ConstructorBindingDefinition
  | OperationBindingDefinition
  | StringifierBindingDefinition
  | IterableBindingDefinition;

function createPlatformObjectOperations(
  binding: RealmBinding,
  getContext: () => BindingContext,
) {
  function getInterface<T extends object>(
    implementation: ImplementationClass<T>,
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

  function associateOrigin<T extends object>(
    implementation: ImplementationClass<T>,
    value: T,
  ): T {
    binding.platformObjects.associateOrigin(
      value,
      getInterface(implementation),
      binding.realm,
    );
    return value;
  }

  return {
    construct<T extends object>(
      implementation: ImplementationClass<T>,
      ...argumentsList: unknown[]
    ): T {
      const interface_ = getInterface(implementation);
      const definition = interface_.definition.implementation;
      const value = constructImplementationObject(
        implementation,
        resolveImplementationArguments(
          argumentsList,
          definition?.constructWith ?? [],
          getContext(),
        ),
      );
      return associateOrigin(implementation, value);
    },

    getImplementation<T extends object>(
      value: unknown,
      implementation: ImplementationClass<T>,
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
      implementation: ImplementationClass<T>,
      value: T,
    ): object {
      if (binding.getPlatformObjectRecord(value)) {
        throw new TypeError('Expected an implementation target');
      }
      const object = binding.projectImplementationObject(
        value,
        getInterface(implementation),
      );
      if (!object) {
        throw new TypeError(
          'Implementation target is associated with another interface',
        );
      }
      return object;
    },
  };
}

function createInterfaceOperations(
  binding: RealmBinding,
) {
  function resolveInterface(
    definition: InterfaceDefinition,
  ): AssembledInterface {
    const interface_ = binding.definitions.getInterface(definition.name);
    if (interface_?.definition !== definition) {
      throw new TypeError(
        `Unknown Web IDL interface definition ${definition.name}`,
      );
    }
    return interface_;
  }

  return {
    createPlatformObject(definition: InterfaceDefinition) {
      const object = binding.createPlatformObject(resolveInterface(definition));
      const record = binding.getPlatformObjectRecord(object);
      if (!record) throw new Error('Created platform object has no record');
      return record;
    },

    getCapability<Value>(
      definition: InterfaceDefinition,
      capability: Capability<Value>,
    ) {
      resolveInterface(definition);
      return binding.capabilities.get(definition, capability);
    },

    getInterface(name: string) {
      return binding.definitions.getInterface(name)?.definition;
    },

    isInterfaceExposed(definition: InterfaceDefinition) {
      return binding.isExposed(resolveInterface(definition));
    },

    resolvePlatformObject(value: unknown) {
      const record = binding.platformObjects.getRecord(value) ??
        binding.platformObjects.getImplementationRecord(value);
      return record;
    },
  };
}

export function registerDefinitionBindings(
  binding: RealmBinding,
): BindingContext {
  const context = createBindingContext(binding);
  for (const interface_ of binding.definitions.getInterfaces()) {
    const { definition } = interface_;
    if (!definition.implementation) continue;
    registerDefinedInterface(
      binding,
      binding.implementations,
      interface_,
      definition.implementation,
      context,
    );
  }
  binding.platformObjects.registerRealm(
    binding.realm,
    context,
    (implementation, primaryInterface) => binding.projectPlatformObject(
      implementation,
      primaryInterface,
    ).platformObject,
  );
  return context;
}

function createBindingContext(
  binding: RealmBinding,
): BindingContext {
  const context: BindingContext = {
    realm: binding.realm,

    convert(value, type) {
      return toImplementationValue(
        convertToIDL(value, type, binding),
        type,
        {},
        context,
        binding,
      );
    },
    realizeException(value) {
      return binding.realizeException(value);
    },

    ...createInterfaceOperations(binding),
    ...createPlatformObjectOperations(binding, () => context),

    createPromise(type) {
      return createPromise(type, binding);
    },
    createRejectedPromise(reason, type) {
      return createRejectedPromise(reason, type, binding);
    },
    createResolvedPromise(value, type) {
      return createResolvedPromise(value, type, binding);
    },
    isPromiseUnresolved(value) {
      return isPromiseUnresolved(requirePromiseValue(value));
    },
    markPromiseHandled(value) {
      markPromiseAsHandled(requirePromiseValue(value));
    },
    reactToPromise(value, resultType, steps) {
      return reactToPromise(
        requirePromiseValue(value),
        resultType,
        steps,
        binding,
      );
    },
    rejectPromise(value, reason) {
      rejectPromise(requirePromiseValue(value), reason);
    },
    resolvePromise(value, result) {
      resolvePromise(
        requirePromiseValue(value),
        result,
        binding,
      );
    },
    waitForAllPromises(values, type) {
      return getPromiseForWaitingForAll(
        values.map(requirePromiseValue),
        type,
        binding,
      );
    },
  };
  return context;
}

function requirePromiseValue(value: unknown) {
  if (!isPromiseValue(value)) {
    throw new TypeError('Expected a Web IDL promise value');
  }
  return value;
}

function registerDefinedInterface(
  realmBinding: RealmBinding,
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  interfaceBinding: InterfaceBindingDefinition,
  context: BindingContext,
): void {
  const implementation = interfaceBinding.implementation;
  if (implementation) {
    registry.setInterfaceForImplementation(implementation, interface_);
  }

  for (const { member } of interface_.members) {
    switch (member.kind) {
      case 'attribute':
        if (member.binding?.get || member.binding?.set) {
          registerDefinedAttribute(
            registry,
            member,
            member.binding,
            interface_,
            context,
            realmBinding,
          );
        } else {
          if (!implementation) {
            throw missingMemberBinding(interface_, member);
          }
          registerAttribute(
            registry,
            member,
            member.static ? implementation : implementation.prototype,
            interface_,
            context,
            realmBinding,
          );
        }
        break;
      case 'constructor':
        if (member.binding) {
          if ('dependencies' in member.binding) {
            if (!implementation) throw missingMemberBinding(interface_, member);
            registry.setImplementationConstructorSteps(
              member,
              createImplementationConstructorSteps(
                implementation,
                member.arguments,
                context,
                realmBinding,
                member.binding.dependencies,
              ),
            );
          } else if ('construct' in member.binding) {
            const construct = member.binding.construct;
            registry.setImplementationConstructorSteps(member, (values) => {
              const args = values.map((value, index) => {
                const argument = getArgument(member.arguments, index);
                return toImplementationValue(
                  value, argument?.type, getArgumentProjection(argument), context, realmBinding,
                );
              });
              return callImplementation(construct, undefined, [context, ...args], realmBinding);
            });
          } else {
            registry.setConstructorSteps(
              member,
              createDefinedConstructorSteps(
                member.binding,
                member.arguments,
                context,
                realmBinding,
              ),
            );
          }
        } else {
          if (!implementation) throw missingMemberBinding(interface_, member);
          registry.setImplementationConstructorSteps(
            member,
            createImplementationConstructorSteps(
              implementation,
              member.arguments,
              context,
              realmBinding,
              interfaceBinding.constructWith,
            ),
          );
        }
        break;
      case 'operation':
        if (hasExtendedAttribute(member.extendedAttributes, 'Default')) break;
        if (member.binding) {
          if ('dependencies' in member.binding) {
            if (!implementation || member.name === undefined) {
              throw missingMemberBinding(interface_, member);
            }
            registerOperation(
              registry,
              member,
              member.name,
              member.static ? implementation : implementation.prototype,
              interface_,
              context,
              realmBinding,
              member.binding.dependencies,
            );
          } else {
            if ('invoke' in member.binding) {
              registry.setOperationSteps(
                member,
                createDefinedOperationSteps(
                  member.binding.invoke,
                  member,
                  context,
                  realmBinding,
                ),
                interface_,
              );
            } else {
              if (!implementation || member.name === undefined) {
                throw missingMemberBinding(interface_, member);
              }
              registerOperation(
                registry,
                member,
                member.name,
                member.static ? implementation : implementation.prototype,
                interface_,
                context,
                realmBinding,
              );
            }
            const getSupportedPropertyNames =
              member.binding.getSupportedPropertyNames;
            const getSupportedPropertyIndices =
              member.binding.getSupportedPropertyIndices;
            if (getSupportedPropertyIndices) {
              registry.setIndexedPropertySteps(member, {
                getSupportedPropertyIndices() {
                  return callImplementation(
                    getSupportedPropertyIndices,
                    this,
                    [context],
                    realmBinding,
                  );
                },
              });
            }
            if (getSupportedPropertyNames) {
              registry.setNamedPropertySteps(member, {
                getSupportedPropertyNames() {
                  return callImplementation(
                    getSupportedPropertyNames,
                    this,
                    [context],
                    realmBinding,
                  );
                },
              });
            }
          }
        } else {
          if (!implementation || member.name === undefined) {
            throw missingMemberBinding(interface_, member);
          }
          registerOperation(
            registry,
            member,
            member.name,
            member.static ? implementation : implementation.prototype,
            interface_,
            context,
            realmBinding,
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
              realmBinding,
            ),
          );
        } else {
          if (!implementation) throw missingMemberBinding(interface_, member);
          if (member.key !== undefined) {
            registerPairIterable(
              registry,
              member,
              implementation.prototype,
              realmBinding,
            );
          }
        }
        break;
      case 'async-iterable':
        if (member.binding) {
          registry.setAsyncIteratorSteps(
            member,
            createDefinedAsyncIteratorSteps(
              member.binding,
              member,
              context,
              realmBinding,
            ),
          );
        }
        break;
      case 'stringifier':
        if (member.binding) {
          registry.setStringificationBehavior(
            member,
            createDefinedStringifierSteps(
              member.binding,
              context,
              realmBinding,
            ),
            interface_,
          );
        } else {
          if (!implementation) throw missingMemberBinding(interface_, member);
          registerStringifier(
            registry,
            member,
            implementation.prototype,
            interface_,
            realmBinding,
          );
        }
        break;
    }
  }

  if (implementation) {
    registry.setImplementationCreationSteps(
      interface_.definition,
      () => callImplementation(
        constructImplementationObject,
        undefined,
        [
          implementation,
          resolveImplementationArguments(
            [],
            interfaceBinding.constructWith ?? [],
            context,
          ),
        ],
        realmBinding,
      ),
    );
  } else {
    throw new TypeError(
      `Web IDL ${interface_.definition.name} has no implementation creation binding`,
    );
  }
  const initializeImplementation =
    interfaceBinding.initializeImplementation;
  if (initializeImplementation) {
    registry.setImplementationInitializationSteps(
      interface_.definition,
      (value) => callImplementation(
        initializeImplementation,
        undefined,
        [context, value],
        realmBinding,
      ),
    );
  }
  const allocatePlatformObject =
    interfaceBinding.allocatePlatformObject;
  if (allocatePlatformObject) {
    registry.setPlatformObjectAllocationSteps(
      interface_.definition,
      (prototype) => callImplementation(
        allocatePlatformObject,
        undefined,
        [context, prototype],
        realmBinding,
      ),
    );
  }
}

type Constructable = new (...argumentsList: unknown[]) => object;

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
  interface_: AssembledInterface,
  context: BindingContext,
  realmBinding: RealmBinding,
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
        [getMemberBindingContext(member, this, context, realmBinding)],
        realmBinding,
      );
    },
  };
  const set = binding.set;
  if (set && !member.readonly) {
    steps.set = function(value) {
      callImplementation(
        set,
        this,
        [
          getMemberBindingContext(member, this, context, realmBinding),
          toImplementationValue(
            value,
            member.type,
            { callbackExceptionBehavior: binding.callbackExceptionBehavior },
            context,
            realmBinding,
          ),
        ],
        realmBinding,
      );
    };
  }
  registry.setAttributeSteps(member, steps, interface_);
}

function createDefinedConstructorSteps(
  binding: Extract<ConstructorBindingDefinition, { invoke: unknown; }>,
  arguments_: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
): ConstructorSteps {
  return function(...values) {
    callImplementation(
      binding.invoke,
      this,
      [
        context,
        ...values.map((value, index) => {
          const argument = getArgument(arguments_, index);
          return toImplementationValue(
            value,
            argument?.type,
            getArgumentProjection(argument),
            context,
            realmBinding,
          );
        }),
      ],
      realmBinding,
    );
  };
}

function createImplementationConstructorSteps(
  implementation: ImplementationClass,
  arguments_: ArgumentDefinition[],
  context: BindingContext,
  realmBinding: RealmBinding,
  dependencies: readonly ImplementationDependency[] = [],
): ImplementationConstructorSteps {
  return (values) => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implementation,
      resolveImplementationArguments(
        values.map((value, index) => {
          const argument = getArgument(arguments_, index);
          return toImplementationValue(
            value,
            argument?.type,
            getArgumentProjection(argument),
            context,
            realmBinding,
          );
        }),
        dependencies,
        context,
      ),
    ],
    realmBinding,
  );
}

function constructImplementationObject<T extends object>(
  implementation: ImplementationClass<T>,
  argumentsList: readonly unknown[],
): T {
  return Reflect.construct(
    implementation as Constructable,
    argumentsList,
    implementation as Constructable,
  ) as T;
}

function createDefinedOperationSteps(
  invoke: ContextualSteps<object | null, unknown[], unknown>,
  member: OperationMember,
  context: BindingContext,
  realmBinding: RealmBinding,
): OperationSteps {
  return function(...values) {
    const operationContext = getMemberBindingContext(
      member,
      this,
      context,
      realmBinding,
    );
    return callImplementation(
      invoke,
      this,
      [
        operationContext,
        ...values.map((value, index) => {
          const argument = getArgument(member.arguments, index);
          return toImplementationValue(
            value,
            argument?.type,
            getArgumentProjection(argument),
            context,
            realmBinding,
          );
        }),
      ],
      realmBinding,
    );
  };
}

function createDefinedStringifierSteps(
  binding: StringifierBindingDefinition,
  context: BindingContext,
  realmBinding: RealmBinding,
): StringificationBehavior {
  return function() {
    return callImplementation(
      binding.invoke,
      this,
      [context],
      realmBinding,
    );
  };
}

function createDefinedValuePairsSteps(
  binding: IterableBindingDefinition,
  context: BindingContext,
  realmBinding: RealmBinding,
): ValuePairsSteps {
  return function() {
    return callImplementation(
      binding.invoke,
      this,
      [context],
      realmBinding,
    );
  };
}

function createDefinedAsyncIteratorSteps(
  binding: AsyncIterableBindingDefinition,
  member: AsyncIterableMember,
  context: BindingContext,
  realmBinding: RealmBinding,
): AsyncIteratorSteps {
  return {
    getNext(target, iterator) {
      return projectPromise(callImplementation(
        binding.getNext,
        undefined,
        [target, iterator],
        realmBinding,
      ), idlType.any, realmBinding);
    },
    ...(binding.initialize
      ? {
        initialize(
          target: object,
          iterator: object,
          argumentsList: unknown[],
        ) {
          callImplementation(
            binding.initialize!,
            undefined,
            [
              target,
              iterator,
              argumentsList.map((value, index) => {
                const argument = getArgument(member.arguments ?? [], index);
                return toImplementationValue(
                  value,
                  argument?.type,
                  getArgumentProjection(argument),
                  context,
                  realmBinding,
                );
              }),
            ],
            realmBinding,
          );
        },
      }
      : {}),
    ...(binding.return
      ? {
        return(target: object, iterator: object, value: unknown) {
          return projectPromise(callImplementation(
            binding.return!,
            undefined,
            [target, iterator, value],
            realmBinding,
          ), idlType.any, realmBinding);
        },
      }
      : {}),
  };
}

function registerAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  target: object,
  interface_: AssembledInterface,
  context: BindingContext,
  realmBinding: RealmBinding,
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
      return callImplementation(get, this, [], realmBinding);
    },
    ...(set && !member.readonly
      ? {
        set(value: unknown) {
          callImplementation(
            set,
            this,
            [
              toImplementationValue(
                value,
                member.type,
                {
                  callbackExceptionBehavior:
                    member.binding?.callbackExceptionBehavior,
                },
                context,
                realmBinding,
              ),
            ],
            realmBinding,
          );
        },
      }
      : {}),
  }, interface_);
}

function registerOperation(
  registry: ImplementationRegistry,
  member: OperationMember,
  name: string,
  target: object,
  interface_: AssembledInterface,
  context: BindingContext,
  realmBinding: RealmBinding,
  dependencies: readonly ImplementationDependency[] = [],
): void {
  const value: unknown = findDescriptor(target, name)?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      `Web IDL operation ${name} has no implementation`,
    );
  }
  const method = value as OperationSteps;

  registry.setOperationSteps(
    member,
    createOperationSteps(
      method,
      member,
      context,
      realmBinding,
      dependencies,
    ),
    interface_,
  );
}

function createOperationSteps(
  implementation: OperationSteps,
  member: OperationMember,
  context: BindingContext,
  realmBinding: RealmBinding,
  dependencies: readonly ImplementationDependency[] = [],
): OperationSteps {
  return function(...values) {
    const operationContext = getMemberBindingContext(
      member,
      this,
      context,
      realmBinding,
    );
    return callImplementation(
      implementation,
      this,
      resolveImplementationArguments(
        values.map((value, index) => {
          const argument = getArgument(member.arguments, index);
          return toImplementationValue(
            value,
            argument?.type,
            getArgumentProjection(argument),
            context,
            realmBinding,
          );
        }),
        dependencies,
        operationContext,
      ),
      realmBinding,
    );
  };
}

function getMemberBindingContext(
  member: OperationMember | AttributeMember,
  receiver: object | null,
  installedContext: BindingContext,
  realmBinding: RealmBinding,
): BindingContext {
  if (member.static) return installedContext;
  if (!receiver) {
    throw new Error('Instance member has no implementation receiver');
  }
  const record = realmBinding.platformObjects.getImplementationRecord(receiver);
  if (!record) {
    throw new Error('Instance member receiver has no platform-object record');
  }
  const context = realmBinding.platformObjects.getBindingContext(record.realm);
  if (!context) {
    throw new Error('Member receiver realm has no binding context');
  }
  return context;
}

function resolveImplementationDependency(
  dependency: ImplementationDependencyValue,
  context: BindingContext,
): unknown {
  if (dependency === 'current-global') return context.realm.global;
  if (isContextValue(dependency)) {
    return dependency.resolve(context);
  }
  return context.construct(dependency);
}

function resolveImplementationArguments(
  argumentsList: unknown[],
  dependencies: readonly ImplementationDependency[],
  context: BindingContext,
): unknown[] {
  return resolveInjectedArguments(
    argumentsList,
    dependencies,
    (dependency) => resolveImplementationDependency(dependency, context),
  );
}

function isContextValue(
  dependency: ImplementationDependencyValue,
): dependency is ContextValue {
  return typeof dependency === 'object';
}

function resolveInjectedArguments<Value>(
  argumentsList: unknown[],
  injected: readonly (PositionedArgument<Value> | Value)[],
  resolve: (value: Value) => unknown,
): unknown[] {
  const leading: Value[] = [];
  const positioned: PositionedArgument<Value>[] = [];
  for (const value of injected) {
    if (isPositionedArgument(value)) positioned.push(value);
    else leading.push(value);
  }

  const result = [...leading.map(resolve), ...argumentsList];
  const occupied = new Set(result.keys());
  for (const { index, value } of positioned) {
    if (occupied.has(index)) {
      throw new TypeError(`Constructor argument ${index} is already occupied`);
    }
    result[index] = resolve(value);
    occupied.add(index);
  }
  return result;
}

function isPositionedArgument<Value>(
  value: PositionedArgument<Value> | Value,
): value is PositionedArgument<Value> {
  return typeof value === 'object' && value !== null &&
    'index' in value && 'value' in value;
}

function registerPairIterable(
  registry: ImplementationRegistry,
  member: IterableMember,
  target: object,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'entries')?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      'Web IDL pair iterable implementation has no entries method',
    );
  }
  const entries = value as PairEntries;
  registry.setValuePairsSteps(member, function() {
    return callImplementation(
      collectValuePairs,
      this,
      [entries],
      realmBinding,
    );
  });
}

function collectValuePairs(
  this: object,
  entries: PairEntries,
): readonly ValuePair[] {
  const pairs = Reflect.apply(entries, this, []);
  return Array.from(pairs, ([key, value]) => ({ key, value }));
}

type PairEntries = (
  this: object,
) => Iterable<readonly [key: unknown, value: unknown]>;

function registerStringifier(
  registry: ImplementationRegistry,
  member: StringifierMember,
  target: object,
  interface_: AssembledInterface,
  realmBinding: RealmBinding,
): void {
  const value: unknown = findDescriptor(target, 'toString')?.value;
  if (typeof value !== 'function') {
    throw new TypeError('Web IDL stringifier has no implementation');
  }
  const stringify = value as StringificationBehavior;
  registry.setStringificationBehavior(member, function() {
    return callImplementation(
      stringify,
      this,
      [],
      realmBinding,
    );
  }, interface_);
}

function callImplementation<This, Values extends unknown[], Result>(
  implementation: (this: This, ...values: Values) => Result,
  thisArgument: This,
  values: Values,
  binding: RealmBinding,
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
  type: WebIDLType | undefined,
  projection: ImplementationValueProjection,
  context: BindingContext,
  realmBinding: RealmBinding,
): unknown {
  if (value === missingArgument) return undefined;
  if (isAsyncSequence(value)) {
    const iterator = openAsyncSequence(value, realmBinding.realm);
    return {
      next: () => toImplementationPromise(
        getAsyncIteratorNextValue(iterator, realmBinding.realm,
          (item, itemType) => convertToIDL(item, itemType, realmBinding)),
        realmBinding,
        (item) => item === endOfIteration ? item :
          toImplementationValue(item, value.elementType, {}, context, realmBinding),
      ),
      return: (reason: unknown) => toImplementationPromise(
        closeAsyncIterator(iterator, reason, realmBinding.realm), realmBinding, (result) => result,
      ),
    };
  }
  if (isPromiseValue(value)) {
    return toImplementationPromise(value, realmBinding, (result) =>
      toImplementationValue(
        result, value.type, projection, context, realmBinding,
      ));
  }
  for (const implementation of projection.implementations ?? []) {
    const resolved = context.getImplementation(value, implementation);
    if (resolved) return resolved;
  }
  if (isCallbackFunctionValue(value)) {
    return projectCallbackFunction(
      value,
      projection.callbackExceptionBehavior,
      context,
      realmBinding,
    );
  }
  if (isCallbackInterfaceValue(value)) {
    const callbackAdapter = value.definition.adapter;
    if (!callbackAdapter) return value;

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
      callbackAdapter.adapt,
      undefined,
      [context, callback],
      realmBinding,
    );
  }
  if (Array.isArray(value)) {
    const itemType = type && getArrayItemType(
      type,
      realmBinding,
    );
    if (!itemType) return value;
    return value.map((item) =>
      toImplementationValue(
        item,
        itemType,
        { callbackExceptionBehavior: projection.callbackExceptionBehavior },
        context,
        realmBinding,
      ));
  }
  if (!(value instanceof Map)) return value;

  const getMemberType = type && getMapMemberType(
    type,
    realmBinding,
  );
  if (!getMemberType) return value;

  const object: Record<PropertyKey, unknown> = {};
  const dictionary = value as Map<PropertyKey, unknown>;
  for (const [name, memberValue] of dictionary) {
    object[name] = toImplementationValue(
      memberValue,
      getMemberType(name),
      {
        callbackExceptionBehavior:
          getMapMemberExceptionBehavior(type, name, realmBinding) ??
          projection.callbackExceptionBehavior,
      },
      context,
      realmBinding,
    );
  }
  return object;
}

type ImplementationValueProjection = {
  readonly callbackExceptionBehavior?: CallbackExceptionBehavior;
  readonly implementations?: readonly ImplementationClass[];
};

function getArgumentProjection(
  argument: ArgumentDefinition | undefined,
): ImplementationValueProjection {
  const binding = argument?.binding;
  if (!binding) return {};
  if ('callbackExceptionBehavior' in binding) {
    return { callbackExceptionBehavior: binding.callbackExceptionBehavior };
  }
  return {
    implementations: binding.implementations,
  };
}

function projectCallbackFunction(
  value: CallbackFunctionValue,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
  context: BindingContext,
  realmBinding: RealmBinding,
): CallableFunction {
  const existing = callbackFunctionProjections.get(value);
  if (existing) return existing;

  /*
   * Present Web IDL callback machinery to implementations as an ordinary
   * callable. Copying the callback record onto the wrapper preserves its
   * Web IDL identity, so returning the callable projects the original
   * JavaScript function rather than exposing this wrapper.
   */
  const adapter = new Proxy(function callback() {}, {
    apply(_target, thisArgument, argumentsList) {
      const result = invokeCallbackFunction(
        value,
        argumentsList,
        exceptionBehavior,
        thisArgument,
      );
      return toImplementationValue(
        result, value.definition.returns, {}, context, realmBinding,
      );
    },
    construct(_target, argumentsList) {
      return constructCallbackFunction(value, argumentsList) as object;
    },
  });
  Object.defineProperties(adapter, Object.getOwnPropertyDescriptors(value));
  callbackFunctionProjections.set(value, adapter);
  return adapter;
}

const callbackFunctionProjections = new WeakMap<
  CallbackFunctionValue,
  CallableFunction
>();

function getArgument(
  definitions: ArgumentDefinition[],
  index: number,
): ArgumentDefinition | undefined {
  const definition = definitions[index];
  if (definition) return definition;
  const variadic = definitions.at(-1);
  return variadic?.variadic ? variadic : undefined;
}

function getArrayItemType(
  type: WebIDLType,
  binding: RealmBinding,
): WebIDLType | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getArrayItemType(innerType.type, binding);
    case 'union':
      return innerType.types
        .map((memberType) => getArrayItemType(memberType, binding))
        .find((memberType) => memberType !== undefined);
    case 'sequence':
      return innerType.type;
    default:
      return undefined;
  }
}

function getMapMemberType(
  type: WebIDLType,
  binding: RealmBinding,
): ((name: PropertyKey) => WebIDLType | undefined) | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getMapMemberType(innerType.type, binding);
    case 'union':
      return innerType.types
        .map((memberType) => getMapMemberType(memberType, binding))
        .find((getMemberType) => getMemberType !== undefined);
    case 'record':
      return () => innerType.value;
    case 'reference': {
      const dictionary = binding.definitions.getDictionary(innerType.name);
      if (!dictionary) return undefined;
      return (name) => typeof name === 'string'
        ? dictionary.members.find((member) => member.name === name)?.type
        : undefined;
    }
    default:
      return undefined;
  }
}

function getMapMemberExceptionBehavior(
  type: WebIDLType,
  name: PropertyKey,
  binding: RealmBinding,
): CallbackExceptionBehavior | undefined {
  const innerType = getUnannotatedType(type, binding.definitions);
  switch (innerType.kind) {
    case 'nullable':
      return getMapMemberExceptionBehavior(innerType.type, name, binding);
    case 'union':
      return innerType.types
        .map((memberType) => getMapMemberExceptionBehavior(
          memberType,
          name,
          binding,
        ))
        .find((behavior) => behavior !== undefined);
    case 'reference': {
      if (typeof name !== 'string') return undefined;
      const dictionary = binding.definitions.getDictionary(innerType.name);
      return dictionary?.members.find((member) => member.name === name)
        ?.binding?.callbackExceptionBehavior;
    }
    default:
      return undefined;
  }
}

function isMemberBindingDefinition(
  definition:
    | InterfaceBindingDefinition
    | CallbackInterfaceBindingDefinition
    | MemberBindingDefinition,
): definition is MemberBindingDefinition {
  return 'get' in definition ||
    'getNext' in definition ||
    'set' in definition ||
    'invoke' in definition ||
    'construct' in definition ||
    'newBufferResult' in definition ||
    'getSupportedPropertyIndices' in definition ||
    'getSupportedPropertyNames' in definition;
}
