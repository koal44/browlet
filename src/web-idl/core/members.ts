import type {
  CallbackExceptionBehavior, ConstantValue, DeclarationHook, DefaultValue, Exposed, ExtendedAttribute,
  ImplementationClass, InjectedArgument, ReferenceType, TypeParameter, WebIDLType,
} from './types';

// Member sets

/** Any member accepted by a primary interface declaration. */
export type InterfaceMember<Env = unknown> = PartialInterfaceMember<Env> | ConstructorMember<Env>;

/** Interface members that may also be contributed by a partial declaration. */
export type PartialInterfaceMember<Env = unknown> =
  | ConstantMember
  | AttributeMember<Env>
  | OperationMember<Env>
  | StringifierMember
  | IterableMember
  | AsyncIterableMember
  | MaplikeMember
  | SetlikeMember;

/** Constants, attributes, operations, and stringifiers contributed by a mixin. */
export type MixinMember<Env = unknown> =
  | ConstantMember
  | AttributeMember<Env>
  | OperationMember<Env>
  | StringifierMember;

/** Constants, attributes, and operations exposed on a namespace object. */
export type NamespaceMember<Env = unknown> = ConstantMember | AttributeMember<Env> | OperationMember<Env>;

/** Constants and operations accepted by a callback-interface declaration. */
export type CallbackInterfaceMember<Env = unknown> = ConstantMember | OperationMember<Env>;

// Interface members

/** A named constant installed with its declared IDL type and value. */
export type ConstantMember = {
  /** Member discriminator supplied by `constant()`. */
  kind: 'constant';
  /** Exposed constant name. */
  name: string;
  /** IDL type of the constant. */
  type: WebIDLType;
  /** Literal value, including explicit records for special numeric values. */
  value: ConstantValue;
  /** Global exposure names for this constant. */
  exposed?: Exposed;
  /** Extended attributes applying to this constant. */
  extendedAttributes?: ExtendedAttribute[];
};

/** An exposed attribute and any explicit getter or setter binding. */
export type AttributeMember<Env = unknown> = {
  /** Member discriminator supplied by `attr()` or `roAttr()`. */
  kind: 'attribute';
  /** Exposed property name; also the implementation property name for automatic binding. */
  name: string;
  /** IDL type used for getter results and setter arguments. */
  type: WebIDLType;

  /** Declare the attribute read-only; extended attributes may still supply setter behavior. */
  readonly?: boolean;
  /** Install on the interface object and bind to the implementation class. */
  static?: boolean;
  /** Declare an inherited attribute with a setter on the derived interface. */
  inherit?: boolean;
  /** Use this attribute's value for the interface's stringification. */
  stringifier?: boolean;
  /** Global exposure names for this attribute. */
  exposed?: Exposed;
  /** Extended attributes applying to this attribute. */
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: member steps, returned function creation, and callback exception policy.
  /** Read the implementation value using the owner's context; `this` is the implementation or null for static access. */
  get?: DeclarationHook<'attribute-get', Env>;
  /** Store a converted value using the owner's context; `this` is the implementation or null for static access. */
  set?: DeclarationHook<'attribute-set', Env>;
  /** Create the steps for a cached realm-owned function returned by this attribute. */
  attributeFunction?: DeclarationHook<'attribute-function', Env>;
  /** Report or rethrow exceptions from an author callback assigned to this attribute. */
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

/** Steps for an attribute's returned function, receiving author-side `this` and arguments. */
export type AttributeFunctionSteps = (this: unknown, ...argumentsList: unknown[]) => unknown;

/** An author-facing constructor overload and its implementation creation steps. */
export type ConstructorMember<Env = unknown> = {
  /** Member discriminator supplied by `ctor()`. */
  kind: 'constructor';
  /** Author arguments in declaration order. */
  arguments: ArgumentDefinition[];
  /** Global exposure names for this overload. */
  exposed?: Exposed;
  /** Extended attributes applying to this constructor. */
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: implementation construction and argument injection.
  /** Return a new implementation from the binding context and converted arguments. */
  construct?: DeclarationHook<'constructor-create', Env>;
  /** Injected arguments for automatic construction; overrides the interface's `constructWith`. */
  constructWith?: InjectedArgument<Env>[];
  /** Initialize the preallocated implementation supplied as `this`, using converted arguments. */
  invoke?: DeclarationHook<'constructor-invoke', Env>;

  /** Additional TypeScript parameters scoped to this generated constructor overload. */
  typeParameters?: TypeParameter[];
};

/** An operation overload and its explicit or automatic implementation binding. */
export type OperationMember<Env = unknown> = {
  /** Member discriminator supplied by `op()` or `staticOp()`. */
  kind: 'operation';
  /** IDL type used to expose the implementation's result to JavaScript. */
  returns: WebIDLType;
  /** Author arguments in declaration order. */
  arguments: ArgumentDefinition[];

  /** Exposed method name; may be omitted for an unnamed special operation. */
  name?: string;
  /** Install on the interface object and bind to the implementation class. */
  static?: boolean;
  /** Legacy property operation performed in addition to ordinary named invocation. */
  special?: 'getter' | 'setter' | 'deleter';
  /** Global exposure names for this overload. */
  exposed?: Exposed;
  /** Extended attributes applying to this overload. */
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: invocation, argument injection, and legacy property support.
  /**
   * Run with converted arguments and return the implementation result.
   * The context belongs to the receiver, or the method for a static operation; `this` is the implementation or null.
   */
  invoke?: DeclarationHook<'operation-invoke', Env>;
  /** Injected arguments for an automatically bound implementation method. */
  invokeWith?: InjectedArgument<Env>[];
  /** Supported indices and membership checks for a legacy indexed getter. */
  indexedGetter?: IndexedGetterDeclaration;
  /** Live supported names for a legacy named getter, with the implementation as `this`. */
  getSupportedPropertyNames?: SupportedPropertyNamesSteps;

  /** TypeScript parameters scoped to this generated operation overload. */
  typeParameters?: TypeParameter[];
};

/** A standalone stringifier bound to the implementation's string conversion method. */
export type StringifierMember = {
  /** Member discriminator supplied by `stringifier()`. */
  kind: 'stringifier';
  /** Global exposure names for this stringifier. */
  exposed?: Exposed;
  /** Extended attributes applying to this stringifier. */
  extendedAttributes?: ExtendedAttribute[];
};

// Iteration and collections

/** Synchronous iteration over values or key/value pairs. */
export type IterableMember = {
  /** Member discriminator supplied by `iter()`. */
  kind: 'iterable';
  /** Type of each iterated value. */
  value: WebIDLType;
  /** Type of each key; omit for value-only iteration. */
  key?: WebIDLType;
  /** Global exposure names for the generated iteration members. */
  exposed?: Exposed;
  /** Extended attributes applying to this iterable declaration. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Asynchronous iteration backed by an implementation iterator factory. */
export type AsyncIterableMember = {
  /** Member discriminator supplied by `asyncIter()`. */
  kind: 'async-iterable';
  /** Type of each iterated value. */
  value: WebIDLType;
  /** Type of each key; omit for value-only iteration. */
  key?: WebIDLType;
  /** Author arguments accepted by the iteration methods. */
  arguments?: ArgumentDefinition[];
  /** Global exposure names for the generated iteration members. */
  exposed?: Exposed;
  /** Extended attributes applying to this iterable declaration. */
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: the iterator implementation factory and optional return operation.
  /** Name of the implementation method creating the iterator; required for automatic binding. */
  create?: string;
  /** Whether the iterator supports an author-visible `return()` operation. */
  return?: boolean;
};

/** Map-shaped collection members generated from declared key and value types. */
export type MaplikeMember = {
  /** Member discriminator supplied by `maplike()`. */
  kind: 'maplike';
  /** Type accepted and returned as a collection key. */
  key: WebIDLType;
  /** Type accepted and returned as a collection value. */
  value: WebIDLType;
  /** Omit the author-facing mutation methods. */
  readonly?: boolean;
  /** Global exposure names for the generated collection members. */
  exposed?: Exposed;
  /** Extended attributes applying to this maplike declaration. */
  extendedAttributes?: ExtendedAttribute[];
};

/** Set-shaped collection members generated from a declared value type. */
export type SetlikeMember = {
  /** Member discriminator supplied by `setlike()`. */
  kind: 'setlike';
  /** Type accepted and returned as a collection value. */
  value: WebIDLType;
  /** Omit the author-facing mutation methods. */
  readonly?: boolean;
  /** Global exposure names for the generated collection members. */
  exposed?: Exposed;
  /** Extended attributes applying to this setlike declaration. */
  extendedAttributes?: ExtendedAttribute[];
};

// Dictionary members and arguments

/** One dictionary property and its conversion requirements. */
export type DictionaryMember = {
  /** Property name read from the author-supplied dictionary. */
  name: string;
  /** IDL type used to convert this property's value. */
  type: WebIDLType;
  /** Reject a missing or undefined value instead of leaving the member absent. */
  required?: boolean;
  /** IDL default used when the supplied value is undefined. */
  default?: DefaultValue;
  /** Extended attributes applying to this member. */
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: exception policy for a callback-valued member.
  /** Report or rethrow author callback exceptions when this member is invoked. */
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

/** One author argument, its conversion, and optional implementation adaptation. */
export type ArgumentDefinition = {
  /** Argument identifier used in IDL and conversion errors. */
  name: string;
  /** IDL type used to convert the author-supplied value. */
  type: WebIDLType;
  /** Permit the argument to be omitted. */
  optional?: boolean;
  /** Collect remaining arguments, converting each to the declared type. */
  variadic?: boolean;
  /** IDL default used when an optional argument is absent or undefined. */
  default?: DefaultValue;
  /** Extended attributes applying to this argument. */
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: implementation resolution and callback adaptation.
  /** Classes to try when unwrapping; values matching none are retained unchanged. */
  implClasses?: ImplementationClass[];
  /** Retained dictionary reference for object adaptation; callback members use the input object as `this`. */
  callbackDictionary?: ReferenceType;
  /** Report or rethrow author callback exceptions when the converted callback is invoked. */
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

// Legacy property support

/** Enumeration and membership rules for a legacy indexed getter. */
export type IndexedGetterDeclaration =
  | {
    /** Enumerate live supported indices with the implementation as `this`. */
    getSupportedPropertyIndices: SupportedPropertyIndicesSteps;
    /** Getter result reserved for missing indices; the getter must be safe to call during membership checks. */
    unsupportedValue: null | undefined;
  }
  | {
    /** Enumerate live supported indices with the implementation as `this`. */
    getSupportedPropertyIndices: SupportedPropertyIndicesSteps;
    /** Test membership without invoking the getter, with the implementation as `this`. */
    supportsIndex: SupportsIndexSteps;
  };

export type SupportedPropertyNamesSteps = (
  this: object,
  context: unknown,
) => ReadonlySet<string>;

type SupportedPropertyIndicesSteps = (
  this: object,
  context: unknown,
) => Iterable<number>;

type SupportsIndexSteps = (
  this: object,
  index: number,
  context: unknown,
) => boolean;
