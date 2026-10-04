import type { ResultValue } from '../../infra/promises';

import type { ArgumentDefinition } from './members';

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

export interface NullableType<Type extends WebIDLType = WebIDLType> {
  kind: 'nullable';
  type: Type;
}

export interface UnionType<Types extends [WebIDLType, WebIDLType, ...WebIDLType[]] = [WebIDLType, WebIDLType, ...WebIDLType[]]> {
  kind: 'union';
  types: Types;
}

export interface SequenceType<Type extends WebIDLType = WebIDLType> {
  kind: 'sequence';
  type: Type;
}

export interface AsyncSequenceType<Type extends WebIDLType = WebIDLType> {
  kind: 'async-sequence';
  type: Type;
}

export interface PromiseType<Type extends WebIDLType = WebIDLType> {
  kind: 'promise';
  type: Type;
}

export interface FrozenArrayType<Type extends WebIDLType = WebIDLType> {
  kind: 'frozen-array';
  type: Type;
}

export type ObservableArrayType = {
  kind: 'observable-array';
  type: WebIDLType;
};

export interface RecordType<Key extends StringType = StringType, Value extends WebIDLType = WebIDLType> {
  kind: 'record';
  key: Key;
  value: Value;
}

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
export type Exposed = string | [string, ...string[]];

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

// Implementation identity and declaration hooks

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
