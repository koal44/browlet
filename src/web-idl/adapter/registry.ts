import type { AssembledInterface } from './assembly';
import type {
  AsyncIterableMember, AttributeMember, ConstructorMember,
  InterfaceDefinition, IterableMember, NamedArgumentsExtendedAttribute,
  OperationMember, StringifierMember,
} from './definition';
import type { ValuePair } from '../iterable';
import type { IDLPromise } from '../promise-value';

export type ImplementationConstructor<T extends object = object> = {
  readonly prototype: T;
} & (abstract new (...argumentsList: never[]) => T);

export class ImplementationRegistry {
  #attributes = new WeakMap<AttributeMember, AttributeSteps>();
  #asyncIterators = new WeakMap<AsyncIterableMember, AsyncIteratorSteps>();
  #constructors = new WeakMap<
    ConstructorMember | NamedArgumentsExtendedAttribute,
    ConstructorSteps
  >();
  #interfaces = new WeakMap<
    ImplementationConstructor<object>,
    AssembledInterface
  >();
  #indexedProperties = new WeakMap<
    OperationMember,
    IndexedPropertySteps
  >();
  #namedProperties = new WeakMap<OperationMember, NamedPropertySteps>();
  #objects = new WeakMap<InterfaceDefinition, ObjectCreationSteps>();
  #objectInitializers = new WeakMap<
    InterfaceDefinition,
    ObjectInitializationSteps
  >();
  #observableArrays = new WeakMap<
    AttributeMember,
    ObservableArraySteps
  >();
  #operations = new WeakMap<OperationMember, OperationSteps>();
  #overriddenConstructors = new WeakMap<
    InterfaceDefinition,
    OverriddenConstructorSteps
  >();
  #stringifiers = new WeakMap<StringifierMember, StringificationBehavior>();
  #valuePairs = new WeakMap<IterableMember, ValuePairsSteps>();

  setAttributeSteps(
    attribute: AttributeMember,
    steps: AttributeSteps,
  ): void {
    this.#attributes.set(attribute, steps);
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
    this.#constructors.set(constructor, steps);
  }

  setInterfaceForImplementation(
    implementation: ImplementationConstructor<object>,
    interface_: AssembledInterface,
  ): void {
    this.#interfaces.set(implementation, interface_);
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
  ): void {
    this.#stringifiers.set(stringifier, behavior);
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
  ): void {
    this.#operations.set(operation, steps);
  }

  setObjectCreationSteps(
    interface_: InterfaceDefinition,
    steps: ObjectCreationSteps,
  ): void {
    this.#objects.set(interface_, steps);
  }

  setObjectInitializationSteps(
    interface_: InterfaceDefinition,
    steps: ObjectInitializationSteps,
  ): void {
    this.#objectInitializers.set(interface_, steps);
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

  getAttributeSteps(attribute: AttributeMember): AttributeSteps | undefined {
    return this.#attributes.get(attribute);
  }

  getAsyncIteratorSteps(
    declaration: AsyncIterableMember,
  ): AsyncIteratorSteps | undefined {
    return this.#asyncIterators.get(declaration);
  }

  getConstructorSteps(
    constructor: ConstructorMember | NamedArgumentsExtendedAttribute,
  ): ConstructorSteps | undefined {
    return this.#constructors.get(constructor);
  }

  getInterfaceForImplementation(
    implementation: ImplementationConstructor<object>,
  ): AssembledInterface | undefined {
    return this.#interfaces.get(implementation);
  }

  getOverriddenConstructorSteps(
    interface_: InterfaceDefinition,
  ): OverriddenConstructorSteps | undefined {
    return this.#overriddenConstructors.get(interface_);
  }

  getStringificationBehavior(
    stringifier: StringifierMember,
  ): StringificationBehavior | undefined {
    return this.#stringifiers.get(stringifier);
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

  getOperationSteps(operation: OperationMember): OperationSteps | undefined {
    return this.#operations.get(operation);
  }

  getObjectCreationSteps(
    interface_: InterfaceDefinition,
  ): ObjectCreationSteps | undefined {
    return this.#objects.get(interface_);
  }

  getObjectInitializationSteps(
    interface_: InterfaceDefinition,
  ): ObjectInitializationSteps | undefined {
    return this.#objectInitializers.get(interface_);
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

export type ObjectCreationSteps = (
  newTarget: object | undefined,
) => object;

export type ObjectInitializationSteps = (value: object) => void;

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

export type ExceptionNormalizer = (exception: unknown) => unknown;
