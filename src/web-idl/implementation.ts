import type {
  AssembledInterface,
} from './assembly';
import type {
  AsyncIterableMember, AttributeMember, ConstructorMember,
  InterfaceDefinition, IterableMember, NamedArgumentsExtendedAttribute,
  OperationMember, StringifierMember,
} from './definition';
import type { IDLPromise } from './promise-value';
import { missingArgument } from './overload';

export function registerInterfaceImplementation(
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  implementation: ImplementationConstructor<object>,
  options: InterfaceImplementationOptions = {},
): void {
  const normalizeException = options.normalizeException ?? identity;
  for (const { member } of interface_.members) {
    if (member.kind === 'attribute') {
      registerAttribute(
        registry,
        member,
        member.static ? implementation : implementation.prototype,
        normalizeException,
      );
    } else if (member.kind === 'operation') {
      const override = getOperationOverride(options.operations, member);
      if (override) {
        registry.setOperationSteps(member, override);
      } else {
        registerOperation(
          registry,
          member,
          member.static ? implementation : implementation.prototype,
          normalizeException,
        );
      }
    }
  }

  if (options.create) {
    registry.setObjectCreationSteps(
      interface_.definition,
      typeof options.create === 'function'
        ? options.create
        : createImplementationObject(
          interface_,
          implementation,
          options.create,
        ),
    );
  }
  if (options.construct) {
    registerMemberKind(
      registry,
      interface_,
      'constructor',
      options.construct,
    );
  }
  if (options.valuePairs) {
    registerMemberKind(
      registry,
      interface_,
      'iterable',
      options.valuePairs,
    );
  }
  if (options.stringify) {
    registerMemberKind(
      registry,
      interface_,
      'stringifier',
      options.stringify,
    );
  }
  validateOperationOverrides(
    interface_,
    options.operations?.instance,
    false,
  );
  validateOperationOverrides(
    interface_,
    options.operations?.static,
    true,
  );
}

export class ImplementationRegistry {
  #attributes = new WeakMap<AttributeMember, AttributeSteps>();
  #asyncIterators = new WeakMap<AsyncIterableMember, AsyncIteratorSteps>();
  #constructors = new WeakMap<
    ConstructorMember | NamedArgumentsExtendedAttribute,
    ConstructorSteps
  >();
  #indexedProperties = new WeakMap<
    OperationMember,
    IndexedPropertySteps
  >();
  #namedProperties = new WeakMap<OperationMember, NamedPropertySteps>();
  #objects = new WeakMap<InterfaceDefinition, ObjectCreationSteps>();
  #observableArrays = new WeakMap<
    AttributeMember,
    ObservableArraySteps
  >();
  #operations = new WeakMap<OperationMember, OperationSteps>();
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

export type InterfaceImplementationOptions = {
  construct?: ConstructorSteps;
  create?: ObjectCreationSteps | ImplementationObjectCreation;
  normalizeException?: ExceptionNormalizer;
  operations?: {
    instance?: Record<string, OperationSteps>;
    static?: Record<string, OperationSteps>;
  };
  stringify?: StringificationBehavior;
  valuePairs?: ValuePairsSteps;
};

export type ImplementationObjectCreation = {
  arguments?: readonly unknown[] | (() => readonly unknown[]);
  created?(value: object): void;
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

export type ObservableArraySteps = {
  delete?(this: object, value: unknown, index: number): void;
  set?(this: object, value: unknown, index: number): void;
};

export type ValuePair = {
  key: unknown;
  value: unknown;
};

export type ValuePairsSteps = (
  this: object,
) => readonly ValuePair[];

export type ImplementationConstructor<T extends object> = {
  readonly prototype: T;
} & (abstract new (...argumentsList: never[]) => T);

export type ExceptionNormalizer = (exception: unknown) => unknown;

function createImplementationObject(
  interface_: AssembledInterface,
  implementation: ImplementationConstructor<object>,
  creation: ImplementationObjectCreation,
): ObjectCreationSteps {
  return (newTarget) => {
    if (!newTarget) {
      throw new Error(
        `${interface_.definition.name} implementation creation requires newTarget`,
      );
    }
    const value = Reflect.construct(
      implementation,
      typeof creation.arguments === 'function'
        ? creation.arguments()
        : creation.arguments ?? [],
      newTarget as unknown as ImplementationConstructor<object>,
    ) as object;
    creation.created?.(value);
    return value;
  };
}

function registerMemberKind(
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  kind: 'constructor',
  steps: ConstructorSteps,
): void;
function registerMemberKind(
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  kind: 'iterable',
  steps: ValuePairsSteps,
): void;
function registerMemberKind(
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  kind: 'stringifier',
  steps: StringificationBehavior,
): void;
function registerMemberKind(
  registry: ImplementationRegistry,
  interface_: AssembledInterface,
  kind: 'constructor' | 'iterable' | 'stringifier',
  steps: ConstructorSteps | ValuePairsSteps | StringificationBehavior,
): void {
  let found = false;
  for (const { member } of interface_.members) {
    if (member.kind !== kind) continue;
    found = true;
    if (member.kind === 'constructor') {
      registry.setConstructorSteps(member, steps);
    } else if (member.kind === 'iterable') {
      registry.setValuePairsSteps(member, steps as ValuePairsSteps);
    } else {
      registry.setStringificationBehavior(
        member,
        steps,
      );
    }
  }
  if (!found) {
    throw new Error(
      `${interface_.definition.name} has no ${kind} declaration`,
    );
  }
}

function validateOperationOverrides(
  interface_: AssembledInterface,
  operations: Record<string, OperationSteps> | undefined,
  static_: boolean,
): void {
  if (!operations) return;
  for (const name of Object.keys(operations)) {
    let found = false;
    for (const { member } of interface_.members) {
      if (
        member.kind !== 'operation' ||
        member.name !== name ||
        Boolean(member.static) !== static_
      ) continue;
      found = true;
    }
    if (!found) {
      const modifier = static_ ? 'static ' : '';
      throw new Error(
        `${interface_.definition.name} has no ${modifier}${name} operation`,
      );
    }
  }
}

function getOperationOverride(
  operations: InterfaceImplementationOptions['operations'],
  member: OperationMember,
): OperationSteps | undefined {
  const implementations = member.static
    ? operations?.static
    : operations?.instance;
  const name = member.name;
  return name && implementations && Object.hasOwn(implementations, name)
    ? implementations[name]
    : undefined;
}

function registerAttribute(
  registry: ImplementationRegistry,
  member: AttributeMember,
  target: object,
  normalizeException: ExceptionNormalizer,
): void {
  const descriptor = findDescriptor(target, member.name);
  if (!descriptor?.get) {
    throw new TypeError(`Web IDL attribute ${member.name} has no implementation`);
  }

  const getterValue: unknown = Reflect.get(descriptor, 'get');
  const setterValue: unknown = Reflect.get(descriptor, 'set');
  const get = getterValue as (this: object) => unknown;
  const set = setterValue as
    ((this: object, value: unknown) => void) | undefined;
  registry.setAttributeSteps(member, {
    get() {
      return callImplementation(get, this, [], normalizeException);
    },
    ...(set && !member.readonly
      ? {
        set(value: unknown) {
          callImplementation(
            set,
            this,
            [toImplementationValue(value)],
            normalizeException,
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
  normalizeException: ExceptionNormalizer,
): void {
  const value: unknown = findDescriptor(target, member.name ?? '')?.value;
  if (typeof value !== 'function') {
    throw new TypeError(
      `Web IDL operation ${member.name ?? ''} has no implementation`,
    );
  }
  const method = value as (this: object, ...values: unknown[]) => unknown;

  registry.setOperationSteps(member, function(...values) {
    return callImplementation(
      method,
      this,
      values.map(toImplementationValue),
      normalizeException,
    );
  });
}

function callImplementation(
  implementation: (this: object, ...values: unknown[]) => unknown,
  thisArgument: object | null,
  values: unknown[],
  normalizeException: ExceptionNormalizer,
): unknown {
  try {
    return Reflect.apply(implementation, thisArgument, values);
  } catch (exception) {
    throw normalizeException(exception);
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

function toImplementationValue(value: unknown): unknown {
  if (value === missingArgument) return undefined;
  if (!(value instanceof Map)) return value;

  const object: Record<PropertyKey, unknown> = {};
  const dictionary = value as Map<PropertyKey, unknown>;
  for (const [name, memberValue] of dictionary) {
    object[name] = toImplementationValue(memberValue);
  }
  return object;
}

function identity<T>(value: T): T {
  return value;
}
