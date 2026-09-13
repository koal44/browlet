import type {
  CallbackExceptionBehavior, ImplementationClass, InjectedArgument,
} from './binding';
import type {
  InterfaceDefinition, PartialInterfaceDefinition, IndexedGetterDeclaration, SupportedPropertyNamesSteps,
} from './definitions/interface';
import type {
  InterfaceMixinDefinition, PartialInterfaceMixinDefinition,
} from './definitions/interface-mixin';
import type { CallbackInterfaceDefinition } from './definitions/callback-interface';
import type { NamespaceDefinition, PartialNamespaceDefinition } from './definitions/namespace';
import type { DictionaryDefinition, PartialDictionaryDefinition } from './definitions/dictionary';
import type { EnumerationDefinition } from './definitions/enumeration';
import type { CallbackFunctionDefinition } from './definitions/callback-function';
import type { TypedefDefinition } from './definitions/typedef';
import type { IncludesDefinition } from './definitions/includes';

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

// Project builder for Web IDL §2.5.2 Attributes.
export function attr<Realm = unknown>(
  name: string,
  type: WebIDLType,
  options: AttributeOptions<Realm> = {},
): AttributeMember<Realm> {
  return { ...options, kind: 'attribute', name, type };
}

// Project builder for Web IDL §2.5.2 Attributes — read only attributes.
export function roAttr<Realm = unknown>(
  name: string,
  type: WebIDLType,
  options: ReadonlyAttributeOptions<Realm> = {},
): AttributeMember<Realm> {
  return attr(name, type, { ...options, readonly: true });
}

// Project builder for Web IDL §2.5.1 Constants.
export function constant(
  name: string,
  type: WebIDLType,
  value: ConstantValue,
  options: ConstantOptions = {},
): ConstantMember {
  return { ...options, kind: 'constant', name, type, value };
}

// Project builder for Web IDL §2.5.3 Operations.
export function op<Realm = unknown>(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList: ArgumentDefinition[] = [],
  options: OperationOptions<Realm> = {},
): OperationMember<Realm> {
  return {
    ...options,
    arguments: argumentsList,
    kind: 'operation',
    ...(name === undefined ? {} : { name }),
    returns,
  };
}

// Project builder for Web IDL §2.5.7 Static attributes and operations — static operations.
export function staticOp<Realm = unknown>(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList: ArgumentDefinition[] = [],
  options: StaticOperationOptions<Realm> = {},
): OperationMember<Realm> {
  return op(name, returns, argumentsList, { ...options, static: true });
}

// Project builder for Web IDL §2.5.5 Stringifiers.
export function stringifier(
  options: StringifierOptions = {},
): StringifierMember {
  return { ...options, kind: 'stringifier' };
}

// Project builder for Web IDL §2.5.3 Operations — argument declarations.
export function arg(
  name: string,
  type: WebIDLType,
  options: ArgumentOptions = {},
): ArgumentDefinition {
  return { ...options, name, type };
}

// Project builder for Web IDL §2.14 Extended attributes.
export function xattr(
  ...attributes: ExtendedAttributeInit[]
): ExtendedAttributeOptions {
  return { extendedAttributes: attributes.map(normalizeExtendedAttribute) };
}

// Project helper: find an extended attribute by its declared name.
export function hasExtendedAttribute(
  attributes: ExtendedAttribute[] | undefined,
  name: string,
): boolean {
  return attributes?.some(
    (attribute) => attribute.kind !== 'raw' && attribute.name === name,
  ) ?? false;
}

// Project helper: refer to a named IDL type by identifier.
export function reference(name: string): ReferenceType {
  return { kind: 'reference', name };
}

// Project builder for Web IDL §2.13.27 Nullable types — T?.
export function nullable(type: WebIDLType): NullableType {
  return { kind: 'nullable', type };
}

// Project builder for Web IDL §2.13.32 Union types.
export function union(
  ...types: [WebIDLType, WebIDLType, ...WebIDLType[]]
): UnionType {
  return { kind: 'union', types };
}

// Project builder for Web IDL §2.13.28 Sequence types — sequence<T>.
export function sequence(type: WebIDLType): SequenceType {
  return { kind: 'sequence', type };
}

// Project builder for Web IDL §2.13.29 Async sequence types — async_sequence<T>.
export function asyncSequence(type: WebIDLType): AsyncSequenceType {
  return { kind: 'async-sequence', type };
}

// Project builder for Web IDL §2.13.30 Record types — record<K, V>.
export function record(
  key: StringType,
  value: WebIDLType,
): RecordType {
  return { kind: 'record', key, value };
}

// Project builder for Web IDL §2.13.31 Promise types — Promise<T>.
export function promise(type: WebIDLType): PromiseType {
  return { kind: 'promise', type };
}

// Project builder for Web IDL §2.13.35 Frozen array types — FrozenArray<T>.
export function frozenArray(type: WebIDLType): FrozenArrayType {
  return { kind: 'frozen-array', type };
}

// Project builder for Web IDL §2.13.36 Observable array types — ObservableArray<T>.
export function observableArray(type: WebIDLType): ObservableArrayType {
  return { kind: 'observable-array', type };
}

// Project builder for Web IDL §2.13.33 Annotated types.
export function annotated<Type extends WebIDLType>(
  type: Type,
  { extendedAttributes }: ExtendedAttributeOptions,
): AnnotatedType<Type> {
  return { kind: 'annotated', extendedAttributes, type };
}

// Project helper: retain an integer token's text (Web IDL, IDL grammar).
export function integer(value: number | string): IntegerLiteral {
  return { kind: 'integer', value: String(value) };
}

// Project helper: retain a decimal token's text (Web IDL, IDL grammar).
export function decimal(value: number | string): DecimalLiteral {
  return { kind: 'decimal', value: String(value) };
}

// Web IDL §2.5.1 Constants — FloatLiteral syntax, represented by project literal records.
export const positiveInfinity: { kind: 'positive-infinity'; } = {
  kind: 'positive-infinity',
};

export const negativeInfinity: { kind: 'negative-infinity'; } = {
  kind: 'negative-infinity',
};

export const notANumber: { kind: 'not-a-number'; } = {
  kind: 'not-a-number',
};

// Web IDL §2.5.3 Operations — DefaultValue syntax, represented by project literal records.
export const undefinedDefault: { kind: 'undefined'; } = {
  kind: 'undefined',
};

export const emptySequence: { kind: 'empty-sequence'; } = {
  kind: 'empty-sequence',
};

export const emptyDictionary: { kind: 'empty-dictionary'; } = {
  kind: 'empty-dictionary',
};

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

/*
 * Project typing: the full Web IDL entry supplies contextual callback signatures by augmenting
 * this interface. Declarations alone leave these callbacks unavailable.
 * The definitions own the surrounding fields and option types.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export interface DeclarationCallbacks<Realm = unknown> {}

export type DeclarationCallback<Name extends PropertyKey, Realm = unknown> =
  Name extends keyof DeclarationCallbacks<Realm>
    ? DeclarationCallbacks<Realm>[Name]
    : never;

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
  implementations?: ImplementationClass[];
  callbackDictionary?: string;
  callbackExceptionBehavior?: CallbackExceptionBehavior;
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

// Project representation of the DefaultValue grammar in Web IDL §2.5.3 Operations.
export type DefaultValue =
  | boolean
  | string
  | null
  | NumericLiteral
  | typeof positiveInfinity
  | typeof negativeInfinity
  | typeof notANumber
  | typeof undefinedDefault
  | typeof emptySequence
  | typeof emptyDictionary;

// Project representation of the ConstValue grammar in Web IDL §2.5.1 Constants.
export type ConstantValue =
  | boolean
  | NumericLiteral
  | typeof positiveInfinity
  | typeof negativeInfinity
  | typeof notANumber;

export type NumericLiteral = IntegerLiteral | DecimalLiteral;

export type IntegerLiteral = {
  kind: 'integer';
  value: string;
};

export type DecimalLiteral = {
  kind: 'decimal';
  value: string;
};

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

export type ExtendedAttributeInit =
  | string
  | [name: string, value: string | string[]]
  | ExtendedAttribute;

export type ExtendedAttributeOptions = {
  extendedAttributes: ExtendedAttribute[];
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

// Project helper options derived from the member records above.
export type AttributeOptions<Realm = unknown> = Omit<AttributeMember<Realm>, 'kind' | 'name' | 'type'>;

export type ReadonlyAttributeOptions<Realm = unknown> = Omit<AttributeOptions<Realm>, 'readonly'>;

type ConstantOptions = Omit<ConstantMember, 'kind' | 'name' | 'type' | 'value'>;

export type OperationOptions<Realm = unknown> = Omit<OperationMember<Realm>, 'kind' | 'name' | 'returns' | 'arguments'>;

export type StaticOperationOptions<Realm = unknown> = Omit<OperationOptions<Realm>, 'static'>;

type StringifierOptions = Omit<StringifierMember, 'kind'>;

export type ArgumentOptions = Omit<ArgumentDefinition, 'name' | 'type'>;

// Project helper: expand shorthand extended attributes into declaration records.
function normalizeExtendedAttribute(
  attribute: ExtendedAttributeInit,
): ExtendedAttribute {
  if (typeof attribute === 'string') {
    return { kind: 'no-arguments', name: attribute };
  }
  if ('kind' in attribute) return attribute;

  const [name, value] = attribute;
  if (typeof value !== 'string') {
    return { kind: 'identifier-list', name, values: [...value] };
  }
  if (value === '*') return { kind: 'wildcard', name };
  return { kind: 'identifier', name, value };
}

// Project helper: construct a named built-in type record for Web IDL §2.13 Types.
function simpleType<const Name extends SimpleTypeName>(
  name: Name,
): { kind: 'simple'; name: Name; } {
  return { kind: 'simple', name };
}
