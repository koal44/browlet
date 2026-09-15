// Shared members and arguments

export type ConstantMember = {
  kind: 'constant';
  name: string;
  type: WebIDLType;
  value: ConstantValue;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

export type AttributeMember<Realm = unknown> = {
  kind: 'attribute';
  name: string;
  type: WebIDLType;

  readonly?: boolean;
  static?: boolean;
  inherit?: boolean;
  stringifier?: boolean;
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: member steps, returned function creation, and callback exception policy.
  get?: DeclarationCallback<'attribute-get', Realm>;
  set?: DeclarationCallback<'attribute-set', Realm>;
  attributeFunction?: DeclarationCallback<'attribute-function', Realm>;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

export type OperationMember<Realm = unknown> = {
  kind: 'operation';
  returns: WebIDLType;
  arguments: ArgumentDefinition[];

  name?: string;
  static?: boolean;
  special?: 'getter' | 'setter' | 'deleter';
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: invocation, argument injection, result allocation, and legacy property support.
  invoke?: DeclarationCallback<'operation-invoke', Realm>;
  invokeWith?: InjectedArgument<Realm>[];
  newBufferResult?: boolean;
  indexedGetter?: IndexedGetterDeclaration;
  getSupportedPropertyNames?: SupportedPropertyNamesSteps;
};

export type StringifierMember = {
  kind: 'stringifier';
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

export type ArgumentDefinition = {
  name: string;
  type: WebIDLType;
  optional?: boolean;
  variadic?: boolean;
  default?: DefaultValue;
  extendedAttributes?: ExtendedAttribute[];

  // Project metadata: implementation resolution and callback adaptation.
  implClasses?: ImplementationClass[];
  callbackDictionary?: string;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
};

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
  | NullableType
  | UnionType
  | SequenceType
  | AsyncSequenceType
  | RecordType
  | PromiseType
  | FrozenArrayType
  | ObservableArrayType
  | AnnotatedType<WebIDLType>;

export type SimpleType = {
  kind: 'simple';
  name: SimpleTypeName;
};

export type ReferenceType = {
  kind: 'reference';
  name: string;
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
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
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

// Implementation identity and contextual callbacks

/**
 * An implementation class known to the Web IDL binding.
 *
 * Declarations need only its identity and prototype. Its concrete constructor
 * signature belongs to the implementation and can vary by platform object.
 */
export type ImplementationClass<T extends object = object> = {
  prototype: T;
};

export type InjectedArgument<Realm = unknown> = {
  index: number;
  resolve: DeclarationCallback<'argument-resolve', Realm>;
};

export type CallbackExceptionBehavior = 'report' | 'rethrow';

/*
 * Project typing: the full Web IDL entry supplies contextual callback signatures by augmenting
 * this interface. Declarations alone leave these callbacks unavailable.
 * The declaration records own the surrounding fields.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface DeclarationCallbacks<Realm = unknown> {}

export type DeclarationCallback<Name extends PropertyKey, Realm = unknown> =
  Name extends keyof DeclarationCallbacks<Realm>
    ? DeclarationCallbacks<Realm>[Name]
    : never;

// Legacy property support

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

export type SupportedPropertyNamesSteps = (
  this: object,
  context: unknown,
) => ReadonlySet<string>;

// Project helper: construct a named built-in type record for Web IDL §2.13 Types.
function simpleType<const Name extends SimpleTypeName>(
  name: Name,
): { kind: 'simple'; name: Name; } {
  return { kind: 'simple', name };
}
