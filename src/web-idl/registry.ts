import type { AssembledInterface } from './assembly';
import type {
  AsyncIterableMember, AttributeMember, ConstructorMember,
  InterfaceDefinition, IterableMember, NamedArgumentsExtendedAttribute,
  OperationMember, StringifierMember,
} from './declaration/definition';
import type { ImplementationClass } from './declaration/binding';
import type { ValuePair } from './iterable';
import type { IDLPromise } from './promise-value';

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
    AssembledInterface
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

  setAttributeSteps(
    attribute: AttributeMember,
    steps: AttributeSteps,
    interface_?: AssembledInterface,
  ): void {
    setInterfaceScopedSteps(this.#attributes, attribute, steps, interface_);
  }

  setAsyncIteratorSteps(
    declaration: AsyncIterableMember,
    steps: AsyncIteratorSteps,
  ): void {
    this.#asyncIterators.set(declaration, steps);
  }

  setConstructorSteps(
    constructor: ConstructorMember | NamedArgumentsExtendedAttribute,
    steps: ConstructorSteps,
  ): void {
    this.#constructors.set(constructor, { kind: 'initialize', steps });
  }

  setImplementationConstructorSteps(
    constructor: ConstructorMember,
    steps: ImplementationConstructorSteps,
  ): void {
    this.#constructors.set(constructor, { kind: 'construct', steps });
  }

  setInterfaceForImplementation(
    implementation: ImplementationClass<object>,
    interface_: AssembledInterface,
  ): void {
    this.#interfaces.set(implementation, interface_);
    this.#interfaceImplementations.set(interface_.definition, implementation);
  }

  setOverriddenConstructorSteps(
    interface_: InterfaceDefinition,
    steps: OverriddenConstructorSteps,
  ): void {
    this.#overriddenConstructors.set(interface_, steps);
  }

  setStringificationBehavior(
    stringifier: StringifierMember,
    behavior: StringificationBehavior,
    interface_?: AssembledInterface,
  ): void {
    setInterfaceScopedSteps(
      this.#stringifiers,
      stringifier,
      behavior,
      interface_,
    );
  }

  setIndexedPropertySteps(
    getter: OperationMember,
    steps: IndexedPropertySteps,
  ): void {
    this.#indexedProperties.set(getter, steps);
  }

  setNamedPropertySteps(
    getter: OperationMember,
    steps: NamedPropertySteps,
  ): void {
    this.#namedProperties.set(getter, steps);
  }

  setOperationSteps(
    operation: OperationMember,
    steps: OperationSteps,
    interface_?: AssembledInterface,
  ): void {
    setInterfaceScopedSteps(this.#operations, operation, steps, interface_);
  }

  setImplementationCreationSteps(
    interface_: InterfaceDefinition,
    steps: ImplementationCreationSteps,
  ): void {
    this.#implementationCreators.set(interface_, steps);
  }

  setImplementationInitializationSteps(
    interface_: InterfaceDefinition,
    steps: ImplementationInitializationSteps,
  ): void {
    this.#implementationInitializers.set(interface_, steps);
  }

  setPlatformObjectAllocationSteps(
    interface_: InterfaceDefinition,
    steps: PlatformObjectAllocationSteps,
  ): void {
    this.#platformObjectAllocators.set(interface_, steps);
  }

  setObservableArraySteps(
    attribute: AttributeMember,
    steps: ObservableArraySteps,
  ): void {
    this.#observableArrays.set(attribute, steps);
  }

  setValuePairsSteps(
    iterable: IterableMember,
    steps: ValuePairsSteps,
  ): void {
    this.#valuePairs.set(iterable, steps);
  }

  getAttributeSteps(
    attribute: AttributeMember,
    interface_?: AssembledInterface,
  ): AttributeSteps | undefined {
    return getInterfaceScopedSteps(this.#attributes, attribute, interface_);
  }

  getAsyncIteratorSteps(
    declaration: AsyncIterableMember,
  ): AsyncIteratorSteps | undefined {
    return this.#asyncIterators.get(declaration);
  }

  getConstructorBehavior(
    constructor: ConstructorMember | NamedArgumentsExtendedAttribute,
  ): ConstructorBehavior | undefined {
    return this.#constructors.get(constructor);
  }

  getInterfaceForImplementation(
    implementation: ImplementationClass<object>,
  ): AssembledInterface | undefined {
    return this.#interfaces.get(implementation);
  }

  getImplementationForInterface(
    interface_: InterfaceDefinition,
  ): ImplementationClass<object> | undefined {
    return this.#interfaceImplementations.get(interface_);
  }

  getImplementationForObject(
    value: object,
  ): RegisteredImplementation | undefined {
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
      const interface_ = this.#interfaces.get(implementation);
      if (interface_) return { implementation, interface_ };
    }
  }

  getOverriddenConstructorSteps(
    interface_: InterfaceDefinition,
  ): OverriddenConstructorSteps | undefined {
    return this.#overriddenConstructors.get(interface_);
  }

  getStringificationBehavior(
    stringifier: StringifierMember,
    interface_?: AssembledInterface,
  ): StringificationBehavior | undefined {
    return getInterfaceScopedSteps(
      this.#stringifiers,
      stringifier,
      interface_,
    );
  }

  getIndexedPropertySteps(
    getter: OperationMember,
  ): IndexedPropertySteps | undefined {
    return this.#indexedProperties.get(getter);
  }

  getNamedPropertySteps(
    getter: OperationMember,
  ): NamedPropertySteps | undefined {
    return this.#namedProperties.get(getter);
  }

  getOperationSteps(
    operation: OperationMember,
    interface_?: AssembledInterface,
  ): OperationSteps | undefined {
    return getInterfaceScopedSteps(this.#operations, operation, interface_);
  }

  getImplementationCreationSteps(
    interface_: InterfaceDefinition,
  ): ImplementationCreationSteps | undefined {
    return this.#implementationCreators.get(interface_);
  }

  getImplementationInitializationSteps(
    interface_: InterfaceDefinition,
  ): ImplementationInitializationSteps | undefined {
    return this.#implementationInitializers.get(interface_);
  }

  getPlatformObjectAllocationSteps(
    interface_: AssembledInterface,
  ): PlatformObjectAllocationSteps | undefined {
    for (
      let current: AssembledInterface | undefined = interface_;
      current;
      current = current.parent
    ) {
      const steps = this.#platformObjectAllocators.get(current.definition);
      if (steps) return steps;
    }
  }

  getObservableArraySteps(
    attribute: AttributeMember,
  ): ObservableArraySteps | undefined {
    return this.#observableArrays.get(attribute);
  }

  getValuePairsSteps(iterable: IterableMember): ValuePairsSteps | undefined {
    return this.#valuePairs.get(iterable);
  }
}

type InterfaceScopedSteps<T> = {
  default?: T;
  readonly interfaces: WeakMap<AssembledInterface, T>;
};

function setInterfaceScopedSteps<K extends object, T>(
  registry: WeakMap<K, InterfaceScopedSteps<T>>,
  key: K,
  steps: T,
  interface_: AssembledInterface | undefined,
): void {
  let scoped = registry.get(key);
  if (!scoped) {
    scoped = { interfaces: new WeakMap() };
    registry.set(key, scoped);
  }
  if (interface_) scoped.interfaces.set(interface_, steps);
  else scoped.default = steps;
}

function getInterfaceScopedSteps<K extends object, T>(
  registry: WeakMap<K, InterfaceScopedSteps<T>>,
  key: K,
  interface_: AssembledInterface | undefined,
): T | undefined {
  const scoped = registry.get(key);
  if (!scoped) return;
  for (
    let current = interface_;
    current;
    current = current.parent
  ) {
    const steps = scoped.interfaces.get(current);
    if (steps) return steps;
  }
  return scoped.default;
}

export type RegisteredImplementation = {
  readonly implementation: ImplementationClass<object>;
  readonly interface_: AssembledInterface;
};

export type AttributeSteps = {
  get(this: object | null): unknown;
  set?(this: object | null, value: unknown): void;
};

export type AsyncIteratorSteps = {
  getNext(target: object, iterator: object): IDLPromise;
  initialize?(
    target: object,
    iterator: object,
    argumentsList: unknown[],
  ): void;
  return?(
    target: object,
    iterator: object,
    value: unknown,
  ): IDLPromise;
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
  this: object,
) => unknown;

export type IndexedPropertySteps = {
  getSupportedPropertyIndices(this: object): ReadonlySet<number>;
  setExisting?(this: object, index: number, value: unknown): void;
  setNew?(this: object, index: number, value: unknown): void;
};

export type NamedPropertySteps = {
  deleteExisting?(this: object, name: string): boolean;
  getSupportedPropertyNames(this: object): ReadonlySet<string>;
  setExisting?(this: object, name: string, value: unknown): void;
  setNew?(this: object, name: string, value: unknown): void;
};

export type OperationSteps = (
  this: object | null,
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
