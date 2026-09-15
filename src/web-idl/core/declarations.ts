import type {
  ArgumentDefinition, AttributeMember, CallbackExceptionBehavior, ConstantMember,
  DeclarationCallback, DefaultValue, Exposure, ExtendedAttribute, ImplementationClass,
  InjectedArgument, OperationMember, StringifierMember, WebIDLType,
} from './types';

// Interfaces

export type InterfaceDefinition<Realm = unknown> = {
  kind: 'interface';
  name: string;
  members: InterfaceMember<Realm>[];
  inherits?: string;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: implementation identity, construction dependencies, and projection hooks.
  implementation?: {
    implClass: ImplementationClass;
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

export type IterableMember = {
  kind: 'iterable';
  value: WebIDLType;
  key?: WebIDLType;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

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

export type MaplikeMember = {
  kind: 'maplike';
  key: WebIDLType;
  value: WebIDLType;
  readonly?: boolean;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

export type SetlikeMember = {
  kind: 'setlike';
  value: WebIDLType;
  readonly?: boolean;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Interface mixins and includes

export type InterfaceMixinDefinition<Realm = unknown> = {
  kind: 'interface-mixin';
  name: string;
  members: MixinMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.3 Interface mixins.
export function defineInterfaceMixin<Realm = unknown>(
  definition: Omit<InterfaceMixinDefinition<Realm>, 'kind'>,
): InterfaceMixinDefinition<Realm> {
  return { kind: 'interface-mixin', ...definition };
}

export type PartialInterfaceMixinDefinition<Realm = unknown> = {
  kind: 'partial-interface-mixin';
  name: string;
  members: MixinMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.3 Interface mixins — partial interface mixin definitions.
export function definePartialInterfaceMixin<Realm = unknown>(
  definition: Omit<PartialInterfaceMixinDefinition<Realm>, 'kind'>,
): PartialInterfaceMixinDefinition<Realm> {
  return { kind: 'partial-interface-mixin', ...definition };
}

export type MixinMember<Realm = unknown> =
  | ConstantMember
  | AttributeMember<Realm>
  | OperationMember<Realm>
  | StringifierMember;

export type IncludesDefinition = {
  kind: 'includes';
  interface: string;
  mixin: string;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.3 Interface mixins — includes statements.
export function defineIncludes(
  definition: Omit<IncludesDefinition, 'kind'>,
): IncludesDefinition {
  return { kind: 'includes', ...definition };
}

// Dictionaries

export type DictionaryDefinition = {
  kind: 'dictionary';
  name: string;
  members: DictionaryMember[];
  inherits?: string;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.7 Dictionaries.
export function defineDictionary(
  definition: Omit<DictionaryDefinition, 'kind'>,
): DictionaryDefinition {
  return { kind: 'dictionary', ...definition };
}

export type PartialDictionaryDefinition = {
  kind: 'partial-dictionary';
  name: string;
  members: DictionaryMember[];
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.7 Dictionaries — partial dictionary definitions.
export function definePartialDictionary(
  definition: Omit<PartialDictionaryDefinition, 'kind'>,
): PartialDictionaryDefinition {
  return { kind: 'partial-dictionary', ...definition };
}

export type DictionaryMember = {
  name: string;
  type: WebIDLType;
  required?: boolean;
  default?: DefaultValue;
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: exception policy for a callback-valued member.
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

// Namespaces

export type NamespaceDefinition<Realm = unknown> = {
  kind: 'namespace';
  name: string;
  members: NamespaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.6 Namespaces.
export function defineNamespace<Realm = unknown>(
  definition: Omit<NamespaceDefinition<Realm>, 'kind'>,
): NamespaceDefinition<Realm> {
  return { kind: 'namespace', ...definition };
}

export type PartialNamespaceDefinition<Realm = unknown> = {
  kind: 'partial-namespace';
  name: string;
  members: NamespaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.6 Namespaces — partial namespace definitions.
export function definePartialNamespace<Realm = unknown>(
  definition: Omit<PartialNamespaceDefinition<Realm>, 'kind'>,
): PartialNamespaceDefinition<Realm> {
  return { kind: 'partial-namespace', ...definition };
}

export type NamespaceMember<Realm = unknown> = ConstantMember | AttributeMember<Realm> | OperationMember<Realm>;

// Callbacks

export type CallbackInterfaceDefinition<Realm = unknown> = {
  kind: 'callback-interface';
  name: string;
  members: CallbackInterfaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: adapt the converted callback interface for implementation code.
  adapt?: DeclarationCallback<'callback-interface-adapt', Realm>;
};

// Project builder for Web IDL §2.4 Callback interfaces.
export function defineCallbackInterface<Realm = unknown>(
  definition: Omit<CallbackInterfaceDefinition<Realm>, 'kind'>,
): CallbackInterfaceDefinition<Realm> {
  return { kind: 'callback-interface', ...definition };
}

export type CallbackInterfaceMember<Realm = unknown> = ConstantMember | OperationMember<Realm>;

export type CallbackFunctionDefinition = {
  kind: 'callback-function';
  name: string;
  returns: WebIDLType;
  arguments: ArgumentDefinition[];
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.10 Callback functions.
export function defineCallbackFunction(
  definition: Omit<CallbackFunctionDefinition, 'kind'>,
): CallbackFunctionDefinition {
  return { kind: 'callback-function', ...definition };
}

// Enumerations and typedefs

export type EnumerationDefinition = {
  kind: 'enumeration';
  name: string;
  values: string[];
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.9 Enumerations.
export function defineEnumeration(
  definition: Omit<EnumerationDefinition, 'kind'>,
): EnumerationDefinition {
  return { kind: 'enumeration', ...definition };
}

export type TypedefDefinition = {
  kind: 'typedef';
  name: string;
  type: WebIDLType;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.11 Typedefs.
export function defineTypedef(
  definition: Omit<TypedefDefinition, 'kind'>,
): TypedefDefinition {
  return { kind: 'typedef', ...definition };
}

// All definition kinds

// Project declaration records for Web IDL §2 Interface definition language.
export type Definition<Realm = unknown> =
  | InterfaceDefinition<Realm>
  | PartialInterfaceDefinition<Realm>
  | InterfaceMixinDefinition<Realm>
  | PartialInterfaceMixinDefinition<Realm>
  | CallbackInterfaceDefinition<Realm>
  | NamespaceDefinition<Realm>
  | PartialNamespaceDefinition<Realm>
  | DictionaryDefinition
  | PartialDictionaryDefinition
  | EnumerationDefinition
  | CallbackFunctionDefinition
  | TypedefDefinition
  | IncludesDefinition;
