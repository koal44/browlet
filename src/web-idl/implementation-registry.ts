import type { PromiseValue } from '../js-engine/index';
import type { AssembledInterfaceDefinition } from './assembly';
import type {
  AsyncIterableMember, ConstructorMember, InterfaceDefinition, IterableMember,
} from './core/declarations';
import type {
  AttributeMember, NamedArgumentsExtendedAttribute, OperationMember, StringifierMember,
  ImplementationClass,
} from './core/types';
import type { ValuePair } from './iterable';
import type { StampedImplInstance, PlatformRecord } from './platform-object';

export class ImplementationRegistry {
  #attributes = new WeakMap<
    AttributeMember,
    InterfaceScopedSteps<AttributeSteps>
  >();
  #asyncIterators = new WeakMap<AsyncIterableMember, AsyncIteratorSteps>();
  #constructors = new WeakMap<
    ConstructorMember | NamedArgumentsExtendedAttribute,
    ConstructorBehavior
  >();
  #interfaces = new WeakMap<
    ImplementationClass<object>,
    AssembledInterfaceDefinition
  >();
  #interfaceImplementations = new WeakMap<
    InterfaceDefinition,
    ImplementationClass<object>
  >();
  #indexedProperties = new WeakMap<
    OperationMember,
    IndexedPropertySteps
  >();
  #namedProperties = new WeakMap<OperationMember, NamedPropertySteps>();
  #implementationCreators = new WeakMap<
    InterfaceDefinition,
    ImplementationCreationSteps
  >();
  #implementationInitializers = new WeakMap<
    InterfaceDefinition,
    ImplementationInitializationSteps
  >();
  #platformObjectAllocators = new WeakMap<
    InterfaceDefinition,
    PlatformObjectAllocationSteps
  >();
  #observableArrays = new WeakMap<
    AttributeMember,
    ObservableArraySteps
  >();
  #operations = new WeakMap<
    OperationMember,
    InterfaceScopedSteps<OperationSteps>
  >();
  #overriddenConstructors = new WeakMap<
    InterfaceDefinition,
    OverriddenConstructorSteps
  >();
  #stringifiers = new WeakMap<
    StringifierMember,
    InterfaceScopedSteps<StringificationBehavior>
  >();
  #valuePairs = new WeakMap<IterableMember, ValuePairsSteps>();

  // Project helper: register attribute accessors, optionally for a particular interface.
  setAttributeSteps(
    attribute: AttributeMember,
    steps: AttributeSteps,
    primaryInterface?: AssembledInterfaceDefinition,
  ): void {
    setInterfaceScopedSteps(this.#attributes, attribute, steps, primaryInterface);
  }

  // Project helper: register an implementation iterator adapter.
  setAsyncIteratorSteps(
    declaration: AsyncIterableMember,
    steps: AsyncIteratorSteps,
  ): void {
    this.#asyncIterators.set(declaration, steps);
  }

  // Project helper: register constructor behavior that initializes an existing implementation.
  setConstructorSteps(
    constructor: ConstructorMember | NamedArgumentsExtendedAttribute,
    steps: ConstructorSteps,
  ): void {
    this.#constructors.set(constructor, { kind: 'initialize', steps });
  }

  // Project helper: register constructor behavior that creates an implementation.
  setImplementationConstructorSteps(
    constructor: ConstructorMember,
    steps: ImplementationConstructorSteps,
  ): void {
    this.#constructors.set(constructor, { kind: 'construct', steps });
  }

  // Project helper: index the implementation class and interface in both directions.
  setInterfaceForImplementation(
    implementation: ImplementationClass<object>,
    primaryInterface: AssembledInterfaceDefinition,
  ): void {
    this.#interfaces.set(implementation, primaryInterface);
    this.#interfaceImplementations.set(primaryInterface.definition, implementation);
  }

  // Project helper: register a replacement interface-constructor callback.
  setOverriddenConstructorSteps(
    definition: InterfaceDefinition,
    steps: OverriddenConstructorSteps,
  ): void {
    this.#overriddenConstructors.set(definition, steps);
  }

  // Project helper: register stringification behavior, optionally for a particular interface.
  setStringificationBehavior(
    stringifier: StringifierMember,
    behavior: StringificationBehavior,
    primaryInterface?: AssembledInterfaceDefinition,
  ): void {
    setInterfaceScopedSteps(
      this.#stringifiers,
      stringifier,
      behavior,
      primaryInterface,
    );
  }

  // Project helper: register supported-index and indexed-mutation callbacks before creating instances.
  setIndexedPropertySteps(
    getter: OperationMember,
    steps: IndexedPropertySteps,
  ): void {
    this.#indexedProperties.set(getter, steps);
  }

  // Project helper: register supported-name and named-mutation callbacks before creating instances.
  setNamedPropertySteps(
    getter: OperationMember,
    steps: NamedPropertySteps,
  ): void {
    this.#namedProperties.set(getter, steps);
  }

  // Project helper: register operation behavior, optionally for a particular interface.
  setOperationSteps(
    operation: OperationMember,
    steps: OperationSteps,
    primaryInterface?: AssembledInterfaceDefinition,
  ): void {
    setInterfaceScopedSteps(this.#operations, operation, steps, primaryInterface);
  }

  // Project helper: register implementation creation for internal platform-object allocation.
  setImplementationCreationSteps(
    definition: InterfaceDefinition,
    steps: ImplementationCreationSteps,
  ): void {
    this.#implementationCreators.set(definition, steps);
  }

  // Project helper: register initialization after implementation creation.
  setImplementationInitializationSteps(
    definition: InterfaceDefinition,
    steps: ImplementationInitializationSteps,
  ): void {
    this.#implementationInitializers.set(definition, steps);
  }

  // Project helper: register a custom platform-object allocator.
  setPlatformObjectAllocationSteps(
    definition: InterfaceDefinition,
    steps: PlatformObjectAllocationSteps,
  ): void {
    this.#platformObjectAllocators.set(definition, steps);
  }

  // Project helper: register observable-array mutation callbacks.
  setObservableArraySteps(
    attribute: AttributeMember,
    steps: ObservableArraySteps,
  ): void {
    this.#observableArrays.set(attribute, steps);
  }

  // Project helper: register access to a pair iterable's current entry list.
  setValuePairsSteps(
    iterable: IterableMember,
    steps: ValuePairsSteps,
  ): void {
    this.#valuePairs.set(iterable, steps);
  }

  // Project helper: select registered attribute accessors by interface ancestry.
  getAttributeSteps(
    attribute: AttributeMember,
    primaryInterface?: AssembledInterfaceDefinition,
  ): AttributeSteps | undefined {
    return getInterfaceScopedSteps(this.#attributes, attribute, primaryInterface);
  }

  // Project helper: retrieve the registered implementation iterator adapter.
  getAsyncIteratorSteps(
    declaration: AsyncIterableMember,
  ): AsyncIteratorSteps | undefined {
    return this.#asyncIterators.get(declaration);
  }

  // Project helper: retrieve registered constructor behavior and its initialization mode.
  getConstructorBehavior(
    constructor: ConstructorMember | NamedArgumentsExtendedAttribute,
  ): ConstructorBehavior | undefined {
    return this.#constructors.get(constructor);
  }

  // Project helper: look up the interface registered for an implementation class.
  getInterfaceForImplementation(
    implementation: ImplementationClass<object>,
  ): AssembledInterfaceDefinition | undefined {
    return this.#interfaces.get(implementation);
  }

  // Project helper: look up the implementation class registered for an interface.
  getImplementationForInterface(
    definition: InterfaceDefinition,
  ): ImplementationClass<object> | undefined {
    return this.#interfaceImplementations.get(definition);
  }

  // Project helper: identify the registered interface through an implementation's prototype constructors.
  getInterfaceForObject(
    value: object,
  ): AssembledInterfaceDefinition | undefined {
    for (
      let prototype = Reflect.getPrototypeOf(value);
      prototype;
      prototype = Reflect.getPrototypeOf(prototype)
    ) {
      const candidate: unknown = Reflect.getOwnPropertyDescriptor(
        prototype,
        'constructor',
      )?.value;
      if (typeof candidate !== 'function') continue;

      const implementation = candidate as ImplementationClass<object>;
      const primaryInterface = this.#interfaces.get(implementation);
      if (primaryInterface) return primaryInterface;
    }
  }

  // Project helper: retrieve a registered interface-constructor override.
  getOverriddenConstructorSteps(
    definition: InterfaceDefinition,
  ): OverriddenConstructorSteps | undefined {
    return this.#overriddenConstructors.get(definition);
  }

  // Project helper: select registered stringification behavior by interface ancestry.
  getStringificationBehavior(
    stringifier: StringifierMember,
    primaryInterface?: AssembledInterfaceDefinition,
  ): StringificationBehavior | undefined {
    return getInterfaceScopedSteps(
      this.#stringifiers,
      stringifier,
      primaryInterface,
    );
  }

  // Project helper: retrieve registered indexed-property callbacks.
  getIndexedPropertySteps(
    getter: OperationMember,
  ): IndexedPropertySteps | undefined {
    return this.#indexedProperties.get(getter);
  }

  // Project helper: retrieve registered named-property callbacks.
  getNamedPropertySteps(
    getter: OperationMember,
  ): NamedPropertySteps | undefined {
    return this.#namedProperties.get(getter);
  }

  // Project helper: select registered operation behavior by interface ancestry.
  getOperationSteps(
    operation: OperationMember,
    primaryInterface?: AssembledInterfaceDefinition,
  ): OperationSteps | undefined {
    return getInterfaceScopedSteps(this.#operations, operation, primaryInterface);
  }

  // Project helper: retrieve registered internal implementation creation steps.
  getImplementationCreationSteps(
    definition: InterfaceDefinition,
  ): ImplementationCreationSteps | undefined {
    return this.#implementationCreators.get(definition);
  }

  // Project helper: retrieve registered implementation initialization steps.
  getImplementationInitializationSteps(
    definition: InterfaceDefinition,
  ): ImplementationInitializationSteps | undefined {
    return this.#implementationInitializers.get(definition);
  }

  // Project helper: select the first registered allocator in the interface ancestry.
  getPlatformObjectAllocationSteps(
    primaryInterface: AssembledInterfaceDefinition,
  ): PlatformObjectAllocationSteps | undefined {
    for (
      let current: AssembledInterfaceDefinition | undefined = primaryInterface;
      current;
      current = current.parent
    ) {
      const steps = this.#platformObjectAllocators.get(current.definition);
      if (steps) return steps;
    }
  }

  // Project helper: retrieve registered observable-array mutation callbacks.
  getObservableArraySteps(
    attribute: AttributeMember,
  ): ObservableArraySteps | undefined {
    return this.#observableArrays.get(attribute);
  }

  // Project helper: retrieve access to a pair iterable's current entry list.
  getValuePairsSteps(iterable: IterableMember): ValuePairsSteps | undefined {
    return this.#valuePairs.get(iterable);
  }
}

type InterfaceScopedSteps<T> = {
  default?: T;
  readonly interfaces: WeakMap<AssembledInterfaceDefinition, T>;
};

// Project helper: store default or interface-specific member behavior.
function setInterfaceScopedSteps<K extends object, T>(
  registry: WeakMap<K, InterfaceScopedSteps<T>>,
  key: K,
  steps: T,
  primaryInterface: AssembledInterfaceDefinition | undefined,
): void {
  let scoped = registry.get(key);
  if (!scoped) {
    scoped = { interfaces: new WeakMap() };
    registry.set(key, scoped);
  }
  if (primaryInterface) scoped.interfaces.set(primaryInterface, steps);
  else scoped.default = steps;
}

// Project helper: search interface ancestry for member behavior, then use the registered default.
function getInterfaceScopedSteps<K extends object, T>(
  registry: WeakMap<K, InterfaceScopedSteps<T>>,
  key: K,
  primaryInterface: AssembledInterfaceDefinition | undefined,
): T | undefined {
  const scoped = registry.get(key);
  if (!scoped) return;
  for (
    let current = primaryInterface;
    current;
    current = current.parent
  ) {
    const steps = scoped.interfaces.get(current);
    if (steps) return steps;
  }
  return scoped.default;
}

/** Member adapters receive the instance's binding record, or null for static/namespace members. */
export type AttributeSteps = {
  get(receiver: PlatformRecord | null): unknown;
  set?(receiver: PlatformRecord | null, value: unknown): void;
};

export type AsyncIteratorSteps = {
  create(target: object, argumentsList: unknown[]): object;
  next(iterator: object): Promise<unknown> | PromiseValue<unknown>;
  return?(iterator: object, value: unknown): Promise<unknown> | PromiseValue<unknown>;
};

export type ConstructorSteps = (
  this: object,
  ...values: unknown[]
) => void;

export type ImplementationConstructorSteps = (
  values: readonly unknown[],
) => object;

export type ConstructorBehavior =
  | {
    readonly kind: 'construct';
    readonly steps: ImplementationConstructorSteps;
  }
  | {
    readonly kind: 'initialize';
    readonly steps: ConstructorSteps;
  };

export type StringificationBehavior = (
  this: StampedImplInstance,
) => unknown;

export type IndexedPropertySteps =
  | {
    getSupportedPropertyIndices(this: object): Iterable<number>;
    readonly unsupportedValue: null | undefined;
    setExisting?(this: object, index: number, value: unknown): void;
    setNew?(this: object, index: number, value: unknown): void;
  }
  | {
    getSupportedPropertyIndices(this: object): Iterable<number>;
    supportsIndex(this: object, index: number): boolean;
    setExisting?(this: object, index: number, value: unknown): void;
    setNew?(this: object, index: number, value: unknown): void;
  };

export type NamedPropertySteps = {
  deleteExisting?(this: object, name: string): boolean;
  getSupportedPropertyNames(this: object): ReadonlySet<string>;
  setExisting?(this: object, name: string, value: unknown): void;
  setNew?(this: object, name: string, value: unknown): void;
};

/** Member adapters receive the recognized record before the converted arguments. */
export type OperationSteps = (
  receiver: PlatformRecord | null,
  ...values: unknown[]
) => unknown;

export type ImplementationCreationSteps = () => object;

export type ImplementationInitializationSteps = (value: object) => void;

export type PlatformObjectAllocationSteps = (prototype: object) => object;

export type OverriddenConstructorSteps = (
  argumentsList: unknown[],
  newTarget: object | undefined,
  activeFunction: object,
) => unknown;

export type ObservableArraySteps = {
  delete?(this: object, value: unknown, index: number): void;
  set?(this: object, value: unknown, index: number): void;
};

export type ValuePairsSteps = (
  this: object,
) => readonly ValuePair[];
