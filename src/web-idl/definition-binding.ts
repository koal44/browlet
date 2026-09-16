import type { JSFunction, PromiseValue } from '../js-engine/index';
import type {
  CallbackInterfaceDefinition, InterfaceDefinition, InterfaceMember, NamespaceDefinition,
} from './core/declarations';
import type { NamedArgumentsExtendedAttribute } from './core/types';
import type { ValuePair } from './iterable';
import type { LegacyPropertyMetadata } from './legacy-platform-object';
import type { StampedImplInstance, PlatformRecord } from './platform-object';

/** One realm's implementation adapters and generated objects for a definition. */
export class DefinitionBinding {
  declare createImplementation?: ImplementationCreationSteps;
  declare initializeImplementation?: ImplementationInitializationSteps;
  declare allocatePlatformObject?: PlatformObjectAllocationSteps;
  declare overriddenConstructor?: OverriddenConstructorSteps;
  declare members?: Map<PlatformMemberDefinition, MemberBinding>;

  declare interfaceObject?: InterfaceObject;
  declare interfacePrototypeObject?: object;
  declare namespaceObject?: object;
  declare legacyCallbackInterfaceObject?: JSFunction;
  declare legacyFactoryFunctions?: Map<string, JSFunction>;
  declare iteratorPrototype?: object;
  declare asyncIteratorPrototype?: object;
  declare namedPropertiesObject?: object;
  declare unforgeablesObject?: object;
  declare legacyPropertyMetadata?: LegacyPropertyMetadata | null;

  /** Retain a member's adapters and platform functions under its including definition. */
  getOrCreateMemberRecord(member: PlatformMemberDefinition): MemberBinding {
    const members = this.members ??= new Map<PlatformMemberDefinition, MemberBinding>();
    let binding = members.get(member);
    if (!binding) {
      binding = {};
      members.set(member, binding);
    }
    return binding;
  }
}

/** Original declarations that own realm-specific platform objects and functions. */
export type PlatformDefinition = InterfaceDefinition | NamespaceDefinition | CallbackInterfaceDefinition;

/** Interface members and legacy factory declarations with member binding records. */
export type PlatformMemberDefinition = InterfaceMember | NamedArgumentsExtendedAttribute;
export type InterfaceObject = JSFunction & { prototype: object; };
export type MemberFunctionKind = 'attributeFunction' | 'getter' | 'operation' | 'setter' | 'stringifier';

export type MemberBinding = Partial<Record<MemberFunctionKind, JSFunction>> & {
  attributeSteps?: AttributeSteps;
  constructorBehavior?: ConstructorBehavior;
  operationSteps?: OperationSteps;
  stringificationBehavior?: StringificationBehavior;
  indexedPropertySteps?: IndexedPropertySteps;
  namedPropertySteps?: NamedPropertySteps;
  observableArraySteps?: ObservableArraySteps;
  asyncIteratorSteps?: AsyncIteratorSteps;
  valuePairsSteps?: ValuePairsSteps;
};

/** Member adapters receive the instance's binding record, or null for static/namespace members. */
export type AttributeSteps = {
  get(receiver: PlatformRecord | null): unknown;
  set?(receiver: PlatformRecord | null, value: unknown): void;
};

export type AsyncIteratorSteps = {
  create(target: StampedImplInstance, argumentsList: unknown[]): object;
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
  this: StampedImplInstance,
) => readonly ValuePair[];
