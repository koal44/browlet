import type { JSFunction } from '../js-engine/index';
import type { InternalPromise } from '../infra/promises';
import type { AssembledCallbackInterface, AssembledInterface, AssembledNamespace } from './assembled';
import type { InterfaceMember } from './core/declarations';
import type { AttributeMember, NamedArgumentsExtendedAttribute } from './core/types';
import type { ValueConverter } from './conversion';
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
  /** Exposed JSON attributes in invocation order; their values are read on every call. */
  declare defaultToJSONAttributes?: DefaultToJSONAttribute[];

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

/** Assembled definitions that own realm-specific platform objects and functions. */
export type PlatformDefinition = AssembledInterface | AssembledNamespace | AssembledCallbackInterface;

/** Interface members and legacy factory declarations with member binding records. */
export type PlatformMemberDefinition = InterfaceMember | NamedArgumentsExtendedAttribute;
export type InterfaceObject = JSFunction & { prototype: object; };
export type MemberFunctionKind = 'attributeFunction' | 'getter' | 'operation' | 'setter' | 'stringifier';

/** An exposed JSON attribute and the declaration supplying its getter. */
export type DefaultToJSONAttribute = {
  assembled: AssembledInterface;
  attribute: AttributeMember;
  implementation: AttributeMember;
};

export type MemberBinding = Partial<Record<MemberFunctionKind, JSFunction>> & {
  attributeSteps?: AttributeSteps;
  constructorBehavior?: ConstructorBehavior;
  operationSteps?: OperationSteps;
  /** Result conversion chosen from the operation's fixed declaration. */
  convertResult?: ValueConverter;
  isDefaultOperation?: boolean;
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
  next(iterator: object): Promise<unknown> | InternalPromise<unknown>;
  return?(iterator: object, value: unknown): Promise<unknown> | InternalPromise<unknown>;
};

export type ConstructorSteps = (
  this: object,
  ...values: unknown[]
) => void;

export type ImplementationConstructorSteps = (
  values: unknown[],
) => object;

export type ConstructorBehavior =
  | {
    kind: 'construct';
    steps: ImplementationConstructorSteps;
  }
  | {
    kind: 'initialize';
    steps: ConstructorSteps;
  };

export type StringificationBehavior = (
  this: StampedImplInstance,
) => unknown;

export type IndexedPropertySteps =
  | {
    getSupportedPropertyIndices(this: object): Iterable<number>;
    unsupportedValue: null | undefined;
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
) => ValuePair[];
