import type { ImplementationClass, InjectedArgument } from '../binding';
import type {
  ArgumentDefinition, AttributeMember, ConstantMember, Exposure, ExtendedAttribute,
  OperationMember, OperationOptions, DeclarationCallback, StringifierMember, WebIDLType,
} from '../definition';

export type InterfaceDefinition<Realm = unknown> = {
  kind: 'interface';
  name: string;
  members: InterfaceMember<Realm>[];
  inherits?: string;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: implementation identity, construction dependencies, and projection hooks.
  implementation?: {
    implementation: ImplementationClass;
    constructWith?: InjectedArgument<Realm>[];
    allocatePlatformObject?: DeclarationCallback<'allocate-platform-object', Realm>;
    initializeImplementation?: DeclarationCallback<'initialize-implementation', Realm>;
  };
};

// Project builder for Web IDL §2.2 Interfaces.
export function defineInterface<Realm = unknown>(
  definition: Omit<InterfaceDefinition<Realm>, 'kind'>,
): InterfaceDefinition<Realm> {
  return { kind: 'interface', ...definition };
}

export type PartialInterfaceDefinition<Realm = unknown> = {
  kind: 'partial-interface';
  name: string;
  members: PartialInterfaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.2 Interfaces — partial interface definitions.
export function definePartialInterface<Realm = unknown>(
  definition: Omit<PartialInterfaceDefinition<Realm>, 'kind'>,
): PartialInterfaceDefinition<Realm> {
  return { kind: 'partial-interface', ...definition };
}

export type InterfaceMember<Realm = unknown> = PartialInterfaceMember<Realm> | ConstructorMember<Realm>;

export type PartialInterfaceMember<Realm = unknown> =
  | ConstantMember
  | AttributeMember<Realm>
  | OperationMember<Realm>
  | StringifierMember
  | IterableMember
  | AsyncIterableMember
  | MaplikeMember
  | SetlikeMember;

export type ImplementationOptions<Realm = unknown> = Omit<
  NonNullable<InterfaceDefinition<Realm>['implementation']>,
  'implementation'
>;

/**
 * Project helper: declare an interface's implementation, dependencies, and projection hooks.
 *
 * Interface construction dependencies apply both when the binding creates an
 * implementation internally and when an automatically bound IDL constructor
 * constructs it. Constructor-level `constructWith()` metadata overrides them.
 */
export function impl<Realm = unknown>(
  implementationClass: ImplementationClass,
  options: ImplementationOptions<Realm> = {},
): NonNullable<InterfaceDefinition<Realm>['implementation']> {
  return { ...options, implementation: implementationClass };
}

export type ConstructorMember<Realm = unknown> = {
  kind: 'constructor';
  arguments: ArgumentDefinition[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: implementation construction and argument injection.
  construct?: DeclarationCallback<'constructor-create', Realm>;
  constructWith?: InjectedArgument<Realm>[];
  invoke?: DeclarationCallback<'constructor-invoke', Realm>;
};

export type ConstructorOptions<Realm = unknown> = Omit<ConstructorMember<Realm>, 'kind' | 'arguments'>;

// Project builder for Web IDL §2.5.4 Constructor operations.
export function ctor<Realm = unknown>(
  argumentsList: ArgumentDefinition[] = [],
  options: ConstructorOptions<Realm> = {},
): ConstructorMember<Realm> {
  return { ...options, kind: 'constructor', arguments: argumentsList };
}

/** Project helper: supply hidden arguments to an automatically bound implementation constructor. */
export function constructWith<Realm = unknown>(
  ...argumentsList: InjectedArgument<Realm>[]
): Pick<ConstructorOptions<Realm>, 'constructWith'> {
  return { constructWith: argumentsList };
}

export type IterableMember = {
  kind: 'iterable';
  value: WebIDLType;
  key?: WebIDLType;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

type IterableOptions = Omit<IterableMember, 'kind' | 'value'>;

// Project builder for Web IDL §2.5.9 Iterable declarations.
export function iter(
  value: WebIDLType,
  options: IterableOptions = {},
): IterableMember {
  return { ...options, kind: 'iterable', value };
}

export type AsyncIterableMember = {
  kind: 'async-iterable';
  value: WebIDLType;
  key?: WebIDLType;
  arguments?: ArgumentDefinition[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: the iterator implementation factory and optional return operation.
  create?: string;
  return?: boolean;
};

type AsyncIterableOptions = Omit<AsyncIterableMember, 'kind' | 'value'>;

// Project builder for Web IDL §2.5.10 Asynchronously iterable declarations.
export function asyncIter(
  value: WebIDLType,
  options: AsyncIterableOptions = {},
): AsyncIterableMember {
  return { ...options, kind: 'async-iterable', value };
}

export type MaplikeMember = {
  kind: 'maplike';
  key: WebIDLType;
  value: WebIDLType;
  readonly?: boolean;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

type MaplikeOptions = Omit<MaplikeMember, 'kind' | 'key' | 'value'>;

// Project builder for Web IDL §2.5.11 Maplike declarations.
export function maplike(
  key: WebIDLType,
  value: WebIDLType,
  options: MaplikeOptions = {},
): MaplikeMember {
  return { ...options, key, kind: 'maplike', value };
}

export type SetlikeMember = {
  kind: 'setlike';
  value: WebIDLType;
  readonly?: boolean;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

type SetlikeOptions = Omit<SetlikeMember, 'kind' | 'value'>;

// Project builder for Web IDL §2.5.12 Setlike declarations.
export function setlike(
  value: WebIDLType,
  options: SetlikeOptions = {},
): SetlikeMember {
  return { ...options, kind: 'setlike', value };
}

/**
 * Project helper: declare indexed-property enumeration separately from membership.
 * An unsupportedValue allows the getter itself to answer support checks;
 * otherwise supportsIndex tests membership without invoking the getter.
 *
 * Web IDL §2.5.6.1 Indexed properties — supported property indices.
 */
export function indexedGetter<Implementation extends object>(
  getSupportedPropertyIndices: (
    implementation: Implementation,
  ) => Iterable<number>,
  support: IndexedPropertySupport<Implementation>,
): Pick<OperationOptions, 'indexedGetter' | 'special'> {
  return {
    indexedGetter: {
      // Project adapter: pass the receiver to the declared enumeration callback.
      getSupportedPropertyIndices() {
        return getSupportedPropertyIndices(this as Implementation);
      },
      ...('unsupportedValue' in support ? support : {
        // Project adapter: pass the receiver and index to the declared membership callback.
        supportsIndex(index: number) {
          return support.supportsIndex(this as Implementation, index);
        },
      }),
    },
    special: 'getter',
  };
}

/**
 * An unsupportedValue must occur only for missing indices, and the getter must
 * be safe to invoke for membership checks as well as reads.
 */
export type IndexedPropertySupport<Implementation extends object> =
  | { unsupportedValue: null | undefined; }
  | {
    supportsIndex: (implementation: Implementation, index: number) => boolean;
  };

export type IndexedGetterDeclaration =
  | {
    getSupportedPropertyIndices: SupportedPropertyIndicesSteps;
    unsupportedValue: null | undefined;
  }
  | {
    getSupportedPropertyIndices: SupportedPropertyIndicesSteps;
    supportsIndex: SupportsIndexSteps;
  };

type SupportedPropertyIndicesSteps = (
  this: object,
  context: unknown,
) => Iterable<number>;

type SupportsIndexSteps = (
  this: object,
  index: number,
  context: unknown,
) => boolean;

/**
 * Project helper: declare a named getter whose implementation supplies the supported property
 * names while ordinary operation binding supplies invocation.
 *
 * Web IDL §2.5.6.2 Named properties — supported property names.
 */
export function namedGetter<Implementation extends object>(
  getSupportedPropertyNames: (
    implementation: Implementation,
  ) => ReadonlySet<string>,
): Pick<OperationOptions, 'getSupportedPropertyNames' | 'special'> {
  return {
    // Project adapter: pass the receiver to the declared supported-name callback.
    getSupportedPropertyNames() {
      return getSupportedPropertyNames(this as Implementation);
    },
    special: 'getter',
  };
}

export type SupportedPropertyNamesSteps = (
  this: object,
  context: unknown,
) => ReadonlySet<string>;
