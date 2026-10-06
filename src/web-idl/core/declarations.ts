import type {
  DeclarationHook, Exposed, ExtendedAttribute, ImplementationClass, InjectedArgument, TypeParameter, WebIDLType,
} from './types';
import type {
  ArgumentDefinition, CallbackInterfaceMember, DictionaryMember, InterfaceMember,
  MixinMember, NamespaceMember, PartialInterfaceMember,
} from './members';
import type { SerialSteps, TransferSteps } from './structured-data';

// Interfaces

/** An interface's primary declaration, including its own members and implementation binding. */
export type PrimaryInterfaceDefinition<Env = unknown, Impl extends object = object> = {
  /** Declaration discriminator supplied by `defineInterface()`. */
  kind: 'interface';
  /** IDL identifier used by references and the interface object. */
  name: string;
  /** Members declared directly on this interface. */
  members: InterfaceMember<Env>[];
  /** Name of the inherited interface. */
  inherits?: string;
  /** Global exposure names, or `'*'` for every global. */
  exposed?: Exposed;
  /** Extended attributes applying to this interface. */
  extendedAttributes?: ExtendedAttribute[];
  /** HTML serialization steps for this exact interface, including any inherited state. */
  serialSteps?: SerialSteps<
    Impl, Record<string, unknown>, Env extends { realm: infer Realm; } ? Realm : unknown
  >;
  /** HTML transfer steps for this exact interface. */
  transferSteps?: TransferSteps<Impl>;
  // Project metadata: implementation identity, construction dependencies, and projection hooks.
  /** Implementation class and hooks used when constructing or projecting its instances. */
  implementation?: {
    /** Class identity used for construction, automatic member binding, and unwrapping. */
    implClass: ImplementationClass<Impl>;
    /** Injected arguments for internal construction and automatically bound constructors. */
    constructWith?: InjectedArgument<Env>[];
    /** Initialize the implementation before stamping or projection; inherited hooks run first. */
    initializeImplementation?: DeclarationHook<'initialize-implementation', Env, Impl>;
  };

  /** TypeScript parameters shared by the generated instance's members and inferred by its constructors. */
  typeParameters?: TypeParameter[];
};

/** Declare an interface; `Env` describes the environment required by its binding hooks. */
// https://webidl.spec.whatwg.org/#idl-interfaces
export function defineInterface<Env = unknown>(
  definition: Omit<PrimaryInterfaceDefinition<Env>, 'kind'>,
): PrimaryInterfaceDefinition<Env> {
  return { kind: 'interface', ...definition };
}

/** Additional members of an existing interface. */
export type PartialInterfaceDefinition<Env = unknown> = {
  /** Declaration discriminator supplied by `definePartialInterface()`. */
  kind: 'partial-interface';
  /** Name of the primary interface being amended. */
  name: string;
  /** Members contributed to the primary interface. */
  members: PartialInterfaceMember<Env>[];
  /** Global exposure names for this contribution, or `'*'` for every global. */
  exposed?: Exposed;
  /** Extended attributes applying to this contribution. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Add members to an existing interface without creating a separate implementation. */
// https://webidl.spec.whatwg.org/#idl-interfaces
export function definePartialInterface<Env = unknown>(
  definition: Omit<PartialInterfaceDefinition<Env>, 'kind'>,
): PartialInterfaceDefinition<Env> {
  return { kind: 'partial-interface', ...definition };
}

// Interface mixins and includes

/** Members contributed to interfaces through includes declarations. */
export type InterfaceMixinDefinition<Env = unknown> = {
  /** Declaration discriminator supplied by `defineInterfaceMixin()`. */
  kind: 'interface-mixin';
  /** IDL identifier used by includes declarations. */
  name: string;
  /** Members supplied to each including interface. */
  members: MixinMember<Env>[];
  /** Global exposure names for these members. */
  exposed?: Exposed;
  /** Extended attributes applying to this mixin. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Declare reusable interface members; implementation state remains with the includer. */
// https://webidl.spec.whatwg.org/#idl-interface-mixins
export function defineInterfaceMixin<Env = unknown>(
  definition: Omit<InterfaceMixinDefinition<Env>, 'kind'>,
): InterfaceMixinDefinition<Env> {
  return { kind: 'interface-mixin', ...definition };
}

/** Additional members of an existing interface mixin. */
export type PartialInterfaceMixinDefinition<Env = unknown> = {
  /** Declaration discriminator supplied by `definePartialInterfaceMixin()`. */
  kind: 'partial-interface-mixin';
  /** Name of the primary mixin being amended. */
  name: string;
  /** Members contributed to the primary mixin. */
  members: MixinMember<Env>[];
  /** Global exposure names for this contribution. */
  exposed?: Exposed;
  /** Extended attributes applying to this contribution. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Add members to an existing interface mixin. */
// https://webidl.spec.whatwg.org/#idl-interface-mixins
export function definePartialInterfaceMixin<Env = unknown>(
  definition: Omit<PartialInterfaceMixinDefinition<Env>, 'kind'>,
): PartialInterfaceMixinDefinition<Env> {
  return { kind: 'partial-interface-mixin', ...definition };
}

/** Applies a named mixin's members to a named interface. */
export type IncludesDefinition = {
  /** Declaration discriminator supplied by `defineIncludes()`. */
  kind: 'includes';
  /** Interface receiving the mixin's members. */
  interface: string;
  /** Mixin contributing the members. */
  mixin: string;
  /** Extended attributes applying to this includes declaration. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Apply an interface mixin to an interface. */
// https://webidl.spec.whatwg.org/#idl-interface-mixins
export function defineIncludes(
  definition: Omit<IncludesDefinition, 'kind'>,
): IncludesDefinition {
  return { kind: 'includes', ...definition };
}

// Dictionaries

/** Named dictionary members and defaults used during conversion. */
export type DictionaryDefinition = {
  /** Declaration discriminator supplied by `defineDictionary()`. */
  kind: 'dictionary';
  /** IDL identifier used to refer to this dictionary. */
  name: string;
  /** Members declared directly on this dictionary. */
  members: DictionaryMember[];
  /** Name of the inherited dictionary. */
  inherits?: string;
  /** Extended attributes applying to this dictionary. */
  extendedAttributes?: ExtendedAttribute[];

  /** TypeScript parameters shared by the generated dictionary's members. */
  typeParameters?: TypeParameter[];
};

/** Declare dictionary conversion, including member types, required fields, and defaults. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
export function defineDictionary(
  definition: Omit<DictionaryDefinition, 'kind'>,
): DictionaryDefinition {
  return { kind: 'dictionary', ...definition };
}

/** Additional members of an existing dictionary. */
export type PartialDictionaryDefinition = {
  /** Declaration discriminator supplied by `definePartialDictionary()`. */
  kind: 'partial-dictionary';
  /** Name of the primary dictionary being amended. */
  name: string;
  /** Members contributed to the primary dictionary. */
  members: DictionaryMember[];
  /** Extended attributes applying to this contribution. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Add members to an existing dictionary. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
export function definePartialDictionary(
  definition: Omit<PartialDictionaryDefinition, 'kind'>,
): PartialDictionaryDefinition {
  return { kind: 'partial-dictionary', ...definition };
}

// Namespaces

/** Members exposed together on a named namespace object. */
export type NamespaceDefinition<Env = unknown> = {
  /** Declaration discriminator supplied by `defineNamespace()`. */
  kind: 'namespace';
  /** IDL identifier and name of the exposed namespace object. */
  name: string;
  /** Constants, attributes, and operations supplied by this namespace. */
  members: NamespaceMember<Env>[];
  /** Global exposure names, or `'*'` for every global. */
  exposed?: Exposed;
  /** Extended attributes applying to this namespace. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Declare a namespace object and its members. */
// https://webidl.spec.whatwg.org/#idl-namespaces
export function defineNamespace<Env = unknown>(
  definition: Omit<NamespaceDefinition<Env>, 'kind'>,
): NamespaceDefinition<Env> {
  return { kind: 'namespace', ...definition };
}

/** Additional members of an existing namespace. */
export type PartialNamespaceDefinition<Env = unknown> = {
  /** Declaration discriminator supplied by `definePartialNamespace()`. */
  kind: 'partial-namespace';
  /** Name of the primary namespace being amended. */
  name: string;
  /** Members contributed to the primary namespace. */
  members: NamespaceMember<Env>[];
  /** Global exposure names for this contribution. */
  exposed?: Exposed;
  /** Extended attributes applying to this contribution. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Add members to an existing namespace object. */
// https://webidl.spec.whatwg.org/#idl-namespaces
export function definePartialNamespace<Env = unknown>(
  definition: Omit<PartialNamespaceDefinition<Env>, 'kind'>,
): PartialNamespaceDefinition<Env> {
  return { kind: 'partial-namespace', ...definition };
}

// Callbacks

/** Declared operations on an author-supplied callback object. */
export type CallbackInterfaceDefinition<Env = unknown> = {
  /** Declaration discriminator supplied by `defineCallbackInterface()`. */
  kind: 'callback-interface';
  /** IDL identifier used by callback-interface arguments and attributes. */
  name: string;
  /** Operations and constants defined by this callback interface. */
  members: CallbackInterfaceMember<Env>[];
  /** Global exposure names for the callback interface object. */
  exposed?: Exposed;
  /** Extended attributes applying to this callback interface. */
  extendedAttributes?: ExtendedAttribute[];
  /** Turn the IDL callback, including its invocation method, into the implementation's value. */
  toImpl?: DeclarationHook<'callback-interface-to-impl', Env>;

  /** TypeScript parameters shared by the generated callback object's members. */
  typeParameters?: TypeParameter[];
};

/** Declare an author callback object's operations and optional implementation conversion. */
// https://webidl.spec.whatwg.org/#idl-callback-interfaces
export function defineCallbackInterface<Env = unknown>(
  definition: Omit<CallbackInterfaceDefinition<Env>, 'kind'>,
): CallbackInterfaceDefinition<Env> {
  return { kind: 'callback-interface', ...definition };
}

/** The arguments and result conversion of an author-supplied callback function. */
export type CallbackFunctionDefinition = {
  /** Declaration discriminator supplied by `defineCallbackFunction()`. */
  kind: 'callback-function';
  /** IDL identifier used to refer to this callback type. */
  name: string;
  /** IDL type used to convert the author's return value. */
  returns: WebIDLType;
  /** Callback arguments in declaration order. */
  arguments: ArgumentDefinition[];
  /** Extended attributes applying to this callback function. */
  extendedAttributes?: ExtendedAttribute[];

  /** TypeScript parameters of the generated callback type alias. */
  typeParameters?: TypeParameter[];
};

/** Declare conversion for calls into an author-supplied function. */
// https://webidl.spec.whatwg.org/#idl-callback-functions
export function defineCallbackFunction(
  definition: Omit<CallbackFunctionDefinition, 'kind'>,
): CallbackFunctionDefinition {
  return { kind: 'callback-function', ...definition };
}

// Enumerations and typedefs

/** A named set of accepted string values. */
export type EnumerationDefinition = {
  /** Declaration discriminator supplied by `defineEnumeration()`. */
  kind: 'enumeration';
  /** IDL identifier used to refer to this enumeration. */
  name: string;
  /** Accepted strings, compared exactly after string conversion. */
  values: string[];
  /** Extended attributes applying to this enumeration. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Declare a named set of accepted string values. */
// https://webidl.spec.whatwg.org/#idl-enums
export function defineEnumeration(
  definition: Omit<EnumerationDefinition, 'kind'>,
): EnumerationDefinition {
  return { kind: 'enumeration', ...definition };
}

/** A named alias for an IDL type expression. */
export type TypedefDefinition = {
  /** Declaration discriminator supplied by `defineTypedef()`. */
  kind: 'typedef';
  /** IDL identifier introduced by this alias. */
  name: string;
  /** Type expression to which references to this alias resolve. */
  type: WebIDLType;
  /** Extended attributes applying to this typedef. */
  extendedAttributes?: ExtendedAttribute[];

  /** TypeScript parameters of the generated type alias. */
  typeParameters?: TypeParameter[];
};

/** Give an IDL type expression a reusable name. */
// https://webidl.spec.whatwg.org/#idl-typedefs
export function defineTypedef(
  definition: Omit<TypedefDefinition, 'kind'>,
): TypedefDefinition {
  return { kind: 'typedef', ...definition };
}

// Proxy objects

/** A proxy type with its own identity that stands in for a platform object, e.g. WindowProxy. */
export type ProxyObjectDefinition = {
  /** Declaration discriminator supplied by `defineProxyObject()`. */
  kind: 'proxy-object';
  /** IDL type name used to refer to these proxies. */
  name: string;
  /** Recognize values during conversion, union selection, and overload resolution. */
  is(value: unknown): boolean;
  /** Retrieve the platform receiver for member calls, e.g. a WindowProxy's current Window. */
  // Value conversion preserves the proxy object; only member receivers use this resolution.
  resolveReceiver?(value: unknown): object | undefined;
};

/** Declare a proxy type whose identity is preserved through IDL conversion. */
// Project declaration: describes receiver forwarding, not every use of JavaScript's Proxy.
export function defineProxyObject(
  definition: Omit<ProxyObjectDefinition, 'kind'>,
): ProxyObjectDefinition {
  return { kind: 'proxy-object', ...definition };
}

// All definition kinds

/** Any declaration accepted by definition assembly; `Env` carries binding-hook requirements. */
// https://webidl.spec.whatwg.org/#idl
export type Definition<Env = unknown> =
  | PrimaryInterfaceDefinition<Env>
  | PartialInterfaceDefinition<Env>
  | InterfaceMixinDefinition<Env>
  | PartialInterfaceMixinDefinition<Env>
  | CallbackInterfaceDefinition<Env>
  | NamespaceDefinition<Env>
  | PartialNamespaceDefinition<Env>
  | DictionaryDefinition
  | PartialDictionaryDefinition
  | EnumerationDefinition
  | CallbackFunctionDefinition
  | TypedefDefinition
  | ProxyObjectDefinition
  | IncludesDefinition;
