import type { ResultValue } from '../../infra/promises';

// Type expressions

// Project type records for the built-in names in Web IDL §2.13 Types.
export const idlType = {
  any: simpleType('any'),
  undefined: simpleType('undefined'),
  boolean: simpleType('boolean'),
  byte: simpleType('byte'),
  octet: simpleType('octet'),
  short: simpleType('short'),
  unsignedShort: simpleType('unsigned short'),
  long: simpleType('long'),
  unsignedLong: simpleType('unsigned long'),
  longLong: simpleType('long long'),
  unsignedLongLong: simpleType('unsigned long long'),
  float: simpleType('float'),
  unrestrictedFloat: simpleType('unrestricted float'),
  double: simpleType('double'),
  unrestrictedDouble: simpleType('unrestricted double'),
  bigint: simpleType('bigint'),
  DOMString: simpleType('DOMString'),
  ByteString: simpleType('ByteString'),
  USVString: simpleType('USVString'),
  object: simpleType('object'),
  symbol: simpleType('symbol'),
  ArrayBuffer: simpleType('ArrayBuffer'),
  SharedArrayBuffer: simpleType('SharedArrayBuffer'),
  DataView: simpleType('DataView'),
  Int8Array: simpleType('Int8Array'),
  Int16Array: simpleType('Int16Array'),
  Int32Array: simpleType('Int32Array'),
  Uint8Array: simpleType('Uint8Array'),
  Uint16Array: simpleType('Uint16Array'),
  Uint32Array: simpleType('Uint32Array'),
  Uint8ClampedArray: simpleType('Uint8ClampedArray'),
  BigInt64Array: simpleType('BigInt64Array'),
  BigUint64Array: simpleType('BigUint64Array'),
  Float16Array: simpleType('Float16Array'),
  Float32Array: simpleType('Float32Array'),
  Float64Array: simpleType('Float64Array'),
};

// Project representation of the type forms in Web IDL §2.13 Types.
export type WebIDLType =
  | SimpleType
  | ReferenceType
  | InterfaceType
  | NullableType
  | UnionType
  | SequenceType
  | AsyncSequenceType
  | RecordType
  | PromiseType
  | FrozenArrayType
  | ObservableArrayType
  | AnnotatedType<WebIDLType>;

export type ImplementationType<T> = WebIDLType & ResultValue<T>;

export type SimpleType = {
  kind: 'simple';
  name: SimpleTypeName;
};

export type ReferenceType = {
  kind: 'reference';
  name: string;
};

export type InterfaceType = {
  kind: 'interface';
  implClass: ImplementationClass;
};

export type NullableType = {
  kind: 'nullable';
  type: WebIDLType;
};

export type UnionType = {
  kind: 'union';
  types: [WebIDLType, WebIDLType, ...WebIDLType[]];
};

export type SequenceType = {
  kind: 'sequence';
  type: WebIDLType;
};

export type AsyncSequenceType = {
  kind: 'async-sequence';
  type: WebIDLType;
};

export type PromiseType = {
  kind: 'promise';
  type: WebIDLType;
};

export type FrozenArrayType = {
  kind: 'frozen-array';
  type: WebIDLType;
};

export type ObservableArrayType = {
  kind: 'observable-array';
  type: WebIDLType;
};

export type RecordType = {
  kind: 'record';
  key: StringType;
  value: WebIDLType;
};

// An interface keeps the recursive WebIDLType relationship lazy.

export interface AnnotatedType<Type> {
  kind: 'annotated';
  type: Type;
  extendedAttributes: ExtendedAttribute[];
}

export type StringType =
  | typeof idlType.DOMString
  | typeof idlType.ByteString
  | typeof idlType.USVString;

export type SimpleTypeName =
  | 'any'
  | 'undefined'
  | 'boolean'
  | 'byte'
  | 'octet'
  | 'short'
  | 'unsigned short'
  | 'long'
  | 'unsigned long'
  | 'long long'
  | 'unsigned long long'
  | 'float'
  | 'unrestricted float'
  | 'double'
  | 'unrestricted double'
  | 'bigint'
  | 'DOMString'
  | 'ByteString'
  | 'USVString'
  | 'object'
  | 'symbol'
  | BufferTypeName;

export type BufferTypeName =
  | 'ArrayBuffer'
  | 'SharedArrayBuffer'
  | 'DataView'
  | 'Int8Array'
  | 'Int16Array'
  | 'Int32Array'
  | 'Uint8Array'
  | 'Uint16Array'
  | 'Uint32Array'
  | 'Uint8ClampedArray'
  | 'BigInt64Array'
  | 'BigUint64Array'
  | 'Float16Array'
  | 'Float32Array'
  | 'Float64Array';

export type BufferViewTypeName = Exclude<
  BufferTypeName,
  'ArrayBuffer' | 'SharedArrayBuffer'
>;

// Literal and default values

// Project representation of the DefaultValue grammar in Web IDL §2.5.3 Operations.
export type DefaultValue =
  | boolean
  | string
  | null
  | NumericLiteral
  | PositiveInfinity
  | NegativeInfinity
  | NotANumber
  | UndefinedDefault
  | EmptySequence
  | EmptyDictionary;

// Project representation of the ConstValue grammar in Web IDL §2.5.1 Constants.
export type ConstantValue =
  | boolean
  | NumericLiteral
  | PositiveInfinity
  | NegativeInfinity
  | NotANumber;

export type NumericLiteral = IntegerLiteral | DecimalLiteral;

export type IntegerLiteral = {
  kind: 'integer';
  value: string;
};

export type DecimalLiteral = {
  kind: 'decimal';
  value: string;
};

// Web IDL §2.5.1 Constants — FloatLiteral syntax, represented by project literal records.
export type PositiveInfinity = typeof positiveInfinity;
export const positiveInfinity = {
  kind: 'positive-infinity',
} as const;

export type NegativeInfinity = typeof negativeInfinity;
export const negativeInfinity = {
  kind: 'negative-infinity',
} as const;

export type NotANumber = typeof notANumber;
export const notANumber = {
  kind: 'not-a-number',
} as const;

// Web IDL §2.5.3 Operations — DefaultValue syntax, represented by project literal records.
export type UndefinedDefault = typeof undefinedDefault;
export const undefinedDefault = {
  kind: 'undefined',
} as const;

export type EmptySequence = typeof emptySequence;
export const emptySequence = {
  kind: 'empty-sequence',
} as const;

export type EmptyDictionary = typeof emptyDictionary;
export const emptyDictionary = {
  kind: 'empty-dictionary',
} as const;

// Exposure and extended attributes

// Project shorthand for Web IDL §3.3.7 [Exposed].
export type Exposure = string | [string, ...string[]];

// Project representation of the syntax forms in Web IDL §2.14 Extended attributes.
export type ExtendedAttribute =
  | NoArgumentsExtendedAttribute
  | ArgumentsExtendedAttribute
  | IdentifierExtendedAttribute
  | StringExtendedAttribute
  | IntegerExtendedAttribute
  | DecimalExtendedAttribute
  | WildcardExtendedAttribute
  | IdentifierListExtendedAttribute
  | IntegerListExtendedAttribute
  | NamedArgumentsExtendedAttribute
  | RawExtendedAttribute;

export type NoArgumentsExtendedAttribute = {
  kind: 'no-arguments';
  name: string;
};

export type ArgumentsExtendedAttribute = {
  kind: 'arguments';
  name: string;
  arguments: ArgumentDefinition[];
};

export type IdentifierExtendedAttribute = {
  kind: 'identifier';
  name: string;
  value: string;
};

export type StringExtendedAttribute = {
  kind: 'string';
  name: string;
  value: string;
};

export type IntegerExtendedAttribute = {
  kind: 'integer';
  name: string;
  value: string;
};

export type DecimalExtendedAttribute = {
  kind: 'decimal';
  name: string;
  value: string;
};

export type WildcardExtendedAttribute = {
  kind: 'wildcard';
  name: string;
};

export type IdentifierListExtendedAttribute = {
  kind: 'identifier-list';
  name: string;
  values: string[];
};

export type IntegerListExtendedAttribute = {
  kind: 'integer-list';
  name: string;
  values: string[];
};

export type NamedArgumentsExtendedAttribute = {
  kind: 'named-arguments';
  name: string;
  value: string;
  arguments: ArgumentDefinition[];
};

export type RawExtendedAttribute = {
  kind: 'raw';
  value: string;
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

/**
 * An implementation class known to the Web IDL binding.
 *
 * Declarations need only its identity and prototype. Its concrete constructor
 * signature belongs to the implementation and can vary by platform object.
 */
export type ImplementationClass<T extends object = object> = {
  /** Prototype identifying the implementation class and its available members. */
  prototype: T;
};

/** Whether a converted author callback reports an exception or propagates it to its caller. */
export type CallbackExceptionBehavior = 'report' | 'rethrow';

// Shared members and arguments

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
  exposed?: Exposure;
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
  exposed?: Exposure;
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
  exposed?: Exposure;
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
};

/** A standalone stringifier bound to the implementation's string conversion method. */
export type StringifierMember = {
  /** Member discriminator supplied by `stringifier()`. */
  kind: 'stringifier';
  /** Global exposure names for this stringifier. */
  exposed?: Exposure;
  /** Extended attributes applying to this stringifier. */
  extendedAttributes?: ExtendedAttribute[];
};

// Implementation identity and declaration hooks

/** A construction or invocation dependency inserted among converted author arguments. */
export type InjectedArgument<Env = unknown> = {
  /** Zero-based index in the final implementation argument list. */
  index: number;
  /** Compute the dependency from receiver and method contexts; constructors supply the same context twice. */
  resolve: DeclarationHook<'argument-resolve', Env>;
};

/** Signatures for declaration hooks, supplied by the full Web IDL entry's module augmentation. */
// Core alone leaves binding hooks unavailable; the declaration records own their fields.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface DeclarationHooks<Env = unknown, Impl extends object = object, Values extends unknown[] = unknown[]> {}

/** Select a declaration hook's signature for its environment, implementation, and arguments. */
export type DeclarationHook<
  Name extends PropertyKey, Env = unknown, Impl extends object = object, Values extends unknown[] = unknown[],
> =
  Name extends keyof DeclarationHooks<Env, Impl, Values>
    ? DeclarationHooks<Env, Impl, Values>[Name]
    : never;

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

type SupportedPropertyIndicesSteps = (
  this: object,
  context: unknown,
) => Iterable<number>;

type SupportsIndexSteps = (
  this: object,
  index: number,
  context: unknown,
) => boolean;

export type SupportedPropertyNamesSteps = (
  this: object,
  context: unknown,
) => ReadonlySet<string>;

type SimpleValue<N extends SimpleTypeName> =
  N extends 'any' ? unknown
    : N extends 'undefined' ? void
      : N extends 'boolean' ? boolean
        : N extends 'bigint' ? bigint
          : N extends 'symbol' ? symbol
            : N extends 'object' ? object
              : N extends 'DOMString' | 'ByteString' | 'USVString' ? string
                : N extends keyof typeof globalThis
                  ? typeof globalThis[N] extends abstract new (...args: never[]) => infer T ? T : never
                  : number;

// Project helper: construct a named built-in type record for Web IDL §2.13 Types.
function simpleType<const Name extends SimpleTypeName>(
  name: Name,
): { kind: 'simple'; name: Name; } & ResultValue<SimpleValue<Name>> {
  return { kind: 'simple', name } as { kind: 'simple'; name: Name; } & ResultValue<SimpleValue<Name>>;
}
