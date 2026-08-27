import type { AssembledInterface } from './assembly';
import type { JavaScriptBinding } from './binding';
import type { DOMExceptionName } from '../shared/dom-exception';
import {
  callUserObjectOperation, constructCallbackFunction, invokeCallbackFunction,
} from './callback';
import {
  isCallbackFunctionValue, isCallbackInterfaceValue,
  type CallbackFunctionValue,
} from './callback-value';
import {
  hasExtendedAttribute, reference, type ArgumentDefinition,
  type AttributeMember, type IterableMember, type OperationMember,
  type StringifierMember, type WebIDLType,
} from './declaration/definition';
import type {
  CallbackExceptionBehavior, ConstructorDependencyBinding,
  ContextValue, ImplementationClass, ImplementationDependency,
  ImplementationDependencyValue, OperationDependencyBinding,
  PositionedArgument,
} from './declaration/binding';
import type {
  AttributeSteps, ConstructorSteps, ImplementationConstructorSteps,
  ImplementationRegistry, OperationSteps, StringificationBehavior,
  ValuePairsSteps,
} from './registry';
import type { ValuePair } from './iterable';
import type { WebIDLRealmHost } from './javascript-realm';
import { missingArgument } from './overload';
import { convertToIDL } from './conversion';
import {
  createPromise, createRejectedPromise, createResolvedPromise,
  markPromiseAsHandled, reactToPromise, rejectPromise, resolvePromise,
} from './promise';
import { isPromiseValue } from './promise-value';
import { getUnannotatedType } from './types';

export type InterfaceBindingContext = {
  readonly callbacks: CallbackValueAdapter;
  readonly conversions: ConversionAdapter;
  readonly exceptions: ExceptionValueAdapter;
  readonly objects: PlatformObjectAdapter;
  readonly promises: PromiseValueAdapter;
  readonly realm: WebIDLRealmHost;
};

export type CallbackValueAdapter = {
  createFunctionValue(name: string, object: object): unknown;
  invokeFunction(
    value: unknown,
    argumentsList: readonly unknown[],
    exceptionBehavior?: 'report' | 'rethrow',
    thisArgument?: unknown,
  ): unknown;
};

export type ConversionAdapter = {
  toIDL(value: unknown, type: WebIDLType): unknown;
};

export type ExceptionValueAdapter = {
  createDOMException(
    name: DOMExceptionName,
    message?: string,
  ): DOMException;
};

export type PromiseValueAdapter = {
  create(type: WebIDLType): unknown;
  createRejected(reason: unknown, type: WebIDLType): unknown;
  createResolved(value: unknown, type: WebIDLType): unknown;
  markHandled(value: unknown): void;
  react(
    value: unknown,
    resultType: WebIDLType,
    steps: {
      fulfilled?(value: unknown): unknown;
      rejected?(reason: unknown): unknown;
    },
  ): unknown;
  reject(value: unknown, reason: unknown): void;
  resolve(value: unknown, result: unknown): void;
};

export type PlatformObjectAdapter = {
  construct<T extends object>(
    implementation: ImplementationClass<T>,
    argumentsList: readonly unknown[],
  ): T;
  create<T extends object>(
    implementation: ImplementationClass<T>,
  ): T;
  getImplementation<T extends object>(
    value: unknown,
    implementation: ImplementationClass<T>,
  ): T | undefined;
  project<T extends object>(
    implementation: ImplementationClass<T>,
    value: T,
  ): T;
};

export type InterfaceImplementationDefinition = {
  implementation?: ImplementationClass;
  create?: InterfaceObjectCreationSteps;
  withArgs?: readonly ImplementationDependency[];
  initialize?: (context: InterfaceBindingContext, value: object) => void;
};

export type CallbackInterfaceAdapterDefinition = {
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
  InterfaceImplementationDefinition,
  'implementation'
>;

export function bind(
  implementation: ImplementationClass,
  options: InterfaceBindingOptions,
): InterfaceImplementationDefinition;
export function bind(
  definition: InterfaceImplementationDefinition,
): InterfaceImplementationDefinition;
export function bind(
  definition: CallbackInterfaceAdapterDefinition,
): CallbackInterfaceAdapterDefinition;
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
    | InterfaceImplementationDefinition
    | CallbackInterfaceAdapterDefinition
    | MemberBindingDefinition,
  options: object = {},
):
  | InterfaceImplementationDefinition
  | CallbackInterfaceAdapterDefinition
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
    | InterfaceImplementationDefinition
    | CallbackInterfaceAdapterDefinition
    | MemberBindingDefinition,
): value is ImplementationClass {
  return typeof value === 'function';
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
  callbackExceptionBehavior?: CallbackExceptionBehavior;
  get?: ContextualSteps<object | null, [], unknown>;
  set?: ContextualSteps<object | null, [value: unknown], void>;
};

export type ConstructorBindingDefinition =
  | ConstructorDependencyBinding
  | { invoke: ContextualSteps<object, unknown[], void>; };

export type OperationBindingDefinition =
  | OperationDependencyBinding
  | {
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
    'callback-interface': CallbackInterfaceAdapterDefinition;
    constructor: ConstructorBindingDefinition;
    interface: InterfaceImplementationDefinition;
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
      implementation: ImplementationClass<T>,
      argumentsList: readonly unknown[],
    ): T {
      return requireImplementation<T>(
        binding.construct(implementation, argumentsList),
      );
    },

    create<T extends object>(
      implementation: ImplementationClass<T>,
    ): T {
      return requireImplementation<T>(
        binding.createPlatformObject(getInterface(implementation)),
      );
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
    if (!definition.implementation) continue;

    const context: InterfaceBindingContext = {
      callbacks: {
        createFunctionValue(name, object) {
          return convertToIDL(object, reference(name), binding);
        },
        invokeFunction(
          value,
          argumentsList,
          exceptionBehavior,
          thisArgument,
        ) {
          if (!isCallbackFunctionValue(value)) {
            throw new TypeError('Expected a Web IDL callback function value');
          }
          return invokeCallbackFunction(
            value,
            argumentsList,
            exceptionBehavior,
            thisArgument,
          );
        },
      },
      conversions: {
        toIDL(value, type) {
          return convertToIDL(value, type, binding);
        },
      },
      exceptions: {
        createDOMException(name, message = '') {
          const DOMException_ = binding.getInterfaceObject(
            'DOMException',
          ) as unknown as typeof DOMException;
          return new DOMException_(message, name);
        },
      },
      objects,
      promises: {
        create(type) {
          return createPromise(type, binding);
        },
        createRejected(reason, type) {
          return createRejectedPromise(reason, type, binding);
        },
        createResolved(value, type) {
          return createResolvedPromise(value, type, binding);
        },
        markHandled(value) {
          markPromiseAsHandled(requirePromiseValue(value));
        },
        react(value, resultType, steps) {
          return reactToPromise(
            requirePromiseValue(value),
            resultType,
            steps,
            binding,
          );
        },
        reject(value, reason) {
          rejectPromise(requirePromiseValue(value), reason);
        },
        resolve(value, result) {
          resolvePromise(requirePromiseValue(value), result, binding);
        },
      },
      realm: binding.realm,
    };
    registerDefinedInterface(
      binding,
      binding.implementations,
      interface_,
      definition.implementation,
      context,
    );
  }
}

function requirePromiseValue(value: unknown) {
  if (!isPromiseValue(value)) {
    throw new TypeError('Expected a Web IDL promise value');
  }
  return value;
}

function registerDefinedInterface(
  javaScriptBinding: JavaScriptBinding,
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  interfaceImplementation: InterfaceImplementationDefinition,
  context: InterfaceBindingContext,
): void {
  const implementation = interfaceImplementation.implementation;
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
          if ('dependencies' in member.binding) {
            if (!implementation) throw missingMemberBinding(interface_, member);
            registry.setImplementationConstructorSteps(
              member,
              createImplementationConstructorSteps(
                implementation,
                member.arguments,
                context,
                javaScriptBinding,
                member.binding.dependencies,
              ),
            );
          } else {
            registry.setConstructorSteps(
              member,
              createDefinedConstructorSteps(
                member.binding,
                member.arguments,
                context,
                javaScriptBinding,
              ),
            );
          }
        } else {
          if (!implementation) throw missingMemberBinding(interface_, member);
          if (interfaceImplementation.create) {
            if (member.arguments.length > 0) {
              throw missingMemberBinding(interface_, member);
            }
            registry.setConstructorSteps(member, emptyConstructorSteps);
          } else {
            registry.setImplementationConstructorSteps(
              member,
              createImplementationConstructorSteps(
                implementation,
                member.arguments,
                context,
                javaScriptBinding,
                interfaceImplementation.withArgs,
              ),
            );
          }
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
              context,
              javaScriptBinding,
              member.binding.dependencies,
            );
          } else {
            registry.setOperationSteps(
              member,
              createDefinedOperationSteps(
                member.binding,
                member,
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
        } else {
          if (!implementation) throw missingMemberBinding(interface_, member);
          if (member.key !== undefined) {
            registerPairIterable(
              registry,
              member,
              implementation.prototype,
              javaScriptBinding,
            );
          }
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
        } else {
          if (!implementation) throw missingMemberBinding(interface_, member);
          registerStringifier(
            registry,
            member,
            implementation.prototype,
            javaScriptBinding,
          );
        }
        break;
    }
  }

  const create = interfaceImplementation.create;
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
        [
          interface_,
          implementation,
          newTarget,
          resolveInjectedArguments(
            [],
            interfaceImplementation.withArgs ?? [],
            (dependency) =>
              resolveImplementationDependency(dependency, context),
          ),
        ],
        javaScriptBinding,
      ),
    );
  } else {
    throw new TypeError(
      `Web IDL ${interface_.definition.name} has no object creation binding`,
    );
  }
  const initialize = interfaceImplementation.initialize;
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
  implementation: ImplementationClass<object>,
  newTarget: object | undefined,
  argumentsList: readonly unknown[],
): object {
  if (!newTarget) {
    throw new Error(
      `${interface_.definition.name} implementation creation requires newTarget`,
    );
  }
  return Reflect.construct(
    implementation as Constructable,
    argumentsList,
    newTarget as Constructable,
  );
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
      return projectImplementationResult(
        callImplementation(
          binding.get,
          this,
          [context],
          javaScriptBinding,
        ),
        member.type,
        context,
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
        [
          context,
          toImplementationValue(
            value,
            member.type,
            { callbackExceptionBehavior: binding.callbackExceptionBehavior },
            context,
            javaScriptBinding,
          ),
        ],
        javaScriptBinding,
      );
    };
  }
  registry.setAttributeSteps(member, steps);
}

function createDefinedConstructorSteps(
  binding: Extract<ConstructorBindingDefinition, { invoke: unknown; }>,
  arguments_: ArgumentDefinition[],
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
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
            javaScriptBinding,
          );
        }),
      ],
      javaScriptBinding,
    );
  };
}

function emptyConstructorSteps(): void {}

function createImplementationConstructorSteps(
  implementation: ImplementationClass,
  arguments_: ArgumentDefinition[],
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
  dependencies: readonly ImplementationDependency[] = [],
): ImplementationConstructorSteps {
  return (newTarget, values) => callImplementation(
    constructImplementationObject,
    undefined,
    [
      implementation,
      newTarget,
      resolveInjectedArguments(
        values.map((value, index) => {
          const argument = getArgument(arguments_, index);
          return toImplementationValue(
            value,
            argument?.type,
            getArgumentProjection(argument),
            context,
            javaScriptBinding,
          );
        }),
        dependencies,
        (dependency) => resolveImplementationDependency(dependency, context),
      ),
    ],
    javaScriptBinding,
  );
}

function constructImplementationObject(
  implementation: ImplementationClass,
  newTarget: object,
  argumentsList: unknown[],
): object {
  return Reflect.construct(
    implementation as Constructable,
    argumentsList,
    newTarget as Constructable,
  );
}

function createDefinedOperationSteps(
  binding: Extract<OperationBindingDefinition, { invoke: unknown; }>,
  member: OperationMember,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): OperationSteps {
  return function(...values) {
    return projectImplementationResult(
      callImplementation(
        binding.invoke,
        this,
        [
          context,
          ...values.map((value, index) => {
            const argument = getArgument(member.arguments, index);
            return toImplementationValue(
              value,
              argument?.type,
              getArgumentProjection(argument),
              context,
              javaScriptBinding,
            );
          }),
        ],
        javaScriptBinding,
      ),
      member.returns,
      context,
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
      return projectImplementationResult(
        callImplementation(get, this, [], javaScriptBinding),
        member.type,
        context,
        javaScriptBinding,
      );
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
                javaScriptBinding,
              ),
            ],
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
  name: string,
  target: object,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
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
      javaScriptBinding,
      dependencies,
    ),
  );
}

function createOperationSteps(
  implementation: OperationSteps,
  member: OperationMember,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
  dependencies: readonly ImplementationDependency[] = [],
): OperationSteps {
  return function(...values) {
    return projectImplementationResult(
      callImplementation(
        implementation,
        this,
        resolveInjectedArguments(
          values.map((value, index) => {
            const argument = getArgument(member.arguments, index);
            return toImplementationValue(
              value,
              argument?.type,
              getArgumentProjection(argument),
              context,
              javaScriptBinding,
            );
          }),
          dependencies,
          (dependency) =>
            resolveImplementationDependency(dependency, context),
        ),
        javaScriptBinding,
      ),
      member.returns,
      context,
      javaScriptBinding,
    );
  };
}

function resolveImplementationDependency(
  dependency: ImplementationDependencyValue,
  context: InterfaceBindingContext,
): unknown {
  if (dependency === 'current-global') return context.realm.global;
  if (isContextValue(dependency)) {
    return dependency.resolve(context);
  }
  return context.objects.create(dependency);
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
  javaScriptBinding: JavaScriptBinding,
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
      javaScriptBinding,
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
  javaScriptBinding: JavaScriptBinding,
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
      javaScriptBinding,
    );
  });
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
  type: WebIDLType | undefined,
  projection: ImplementationValueProjection,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): unknown {
  if (value === missingArgument) return undefined;
  for (const implementation of projection.implementations ?? []) {
    const resolved = context.objects.getImplementation(value, implementation);
    if (resolved) return resolved;
  }
  if (isCallbackFunctionValue(value)) {
    return projectCallbackFunction(
      value,
      projection.callbackExceptionBehavior,
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
      javaScriptBinding,
    );
  }
  if (Array.isArray(value)) {
    const itemType = type && getArrayItemType(
      type,
      javaScriptBinding,
    );
    if (!itemType) return value;
    return value.map((item) =>
      toImplementationValue(
        item,
        itemType,
        { callbackExceptionBehavior: projection.callbackExceptionBehavior },
        context,
        javaScriptBinding,
      ));
  }
  if (!(value instanceof Map)) return value;

  const getMemberType = type && getMapMemberType(
    type,
    javaScriptBinding,
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
          getMapMemberExceptionBehavior(type, name, javaScriptBinding) ??
          projection.callbackExceptionBehavior,
      },
      context,
      javaScriptBinding,
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

function projectImplementationResult(
  value: unknown,
  type: WebIDLType | undefined,
  context: InterfaceBindingContext,
  javaScriptBinding: JavaScriptBinding,
): unknown {
  if (!type || value === null) return value;

  const resolved = getUnannotatedType(type, javaScriptBinding.definitions);
  if (resolved.kind === 'nullable') {
    return projectImplementationResult(
      value,
      resolved.type,
      context,
      javaScriptBinding,
    );
  }
  if (resolved.kind !== 'reference') return value;

  const definition = javaScriptBinding.definitions.getDefinition(
    resolved.name,
  );
  if (
    definition?.kind === 'callback-function' &&
    typeof value === 'function' &&
    !isCallbackFunctionValue(value)
  ) {
    return context.callbacks.createFunctionValue(resolved.name, value);
  }
  if (typeof value !== 'object') return value;

  const interface_ = javaScriptBinding.definitions.getInterface(resolved.name);
  if (!interface_) return value;
  if (javaScriptBinding.platformObjects.getImplementationRecord(value)) {
    return value;
  }

  const registered = javaScriptBinding.implementations
    .getImplementationForObject(value);
  if (!registered) return value;

  let implemented: AssembledInterface | undefined = registered.interface_;
  while (implemented) {
    if (implemented.definition === interface_.definition) {
      return context.objects.project(registered.implementation, value);
    }
    implemented = implemented.parent;
  }
  return value;
}

function projectCallbackFunction(
  value: CallbackFunctionValue,
  exceptionBehavior: CallbackExceptionBehavior | undefined,
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
      return invokeCallbackFunction(
        value,
        argumentsList,
        exceptionBehavior,
        thisArgument,
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
  binding: JavaScriptBinding,
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
  binding: JavaScriptBinding,
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
  binding: JavaScriptBinding,
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
    | InterfaceImplementationDefinition
    | CallbackInterfaceAdapterDefinition
    | MemberBindingDefinition,
): definition is MemberBindingDefinition {
  return 'get' in definition ||
    'set' in definition ||
    'invoke' in definition ||
    'getSupportedPropertyNames' in definition;
}
