export function defineInterface(
  definition: InterfaceDefinitionInit,
): InterfaceDefinition {
  return { kind: 'interface', ...definition };
}

export function definePartialInterface(
  definition: PartialInterfaceDefinitionInit,
): PartialInterfaceDefinition {
  return { kind: 'partial-interface', ...definition };
}

export function defineInterfaceMixin(
  definition: InterfaceMixinDefinitionInit,
): InterfaceMixinDefinition {
  return { kind: 'interface-mixin', ...definition };
}

export function definePartialInterfaceMixin(
  definition: PartialInterfaceMixinDefinitionInit,
): PartialInterfaceMixinDefinition {
  return { kind: 'partial-interface-mixin', ...definition };
}

export function defineCallbackInterface(
  definition: CallbackInterfaceDefinitionInit,
): CallbackInterfaceDefinition {
  return { kind: 'callback-interface', ...definition };
}

export function defineNamespace(
  definition: NamespaceDefinitionInit,
): NamespaceDefinition {
  return { kind: 'namespace', ...definition };
}

export function definePartialNamespace(
  definition: PartialNamespaceDefinitionInit,
): PartialNamespaceDefinition {
  return { kind: 'partial-namespace', ...definition };
}

export function defineDictionary(
  definition: DictionaryDefinitionInit,
): DictionaryDefinition {
  return { kind: 'dictionary', ...definition };
}

export function definePartialDictionary(
  definition: PartialDictionaryDefinitionInit,
): PartialDictionaryDefinition {
  return { kind: 'partial-dictionary', ...definition };
}

export function defineEnumeration(
  definition: EnumerationDefinitionInit,
): EnumerationDefinition {
  return { kind: 'enumeration', ...definition };
}

export function defineCallbackFunction(
  definition: CallbackFunctionDefinitionInit,
): CallbackFunctionDefinition {
  return { kind: 'callback-function', ...definition };
}

export function defineTypedef(
  definition: TypedefDefinitionInit,
): TypedefDefinition {
  return { kind: 'typedef', ...definition };
}

export function defineIncludes(
  definition: IncludesDefinitionInit,
): IncludesDefinition {
  return { kind: 'includes', ...definition };
}

export function attr(
  name: string,
  type: WebIDLType,
  options: AttributeOptions = {},
): AttributeMember {
  return { ...options, kind: 'attribute', name, type };
}

export function readonlyAttr(
  name: string,
  type: WebIDLType,
  options: ReadonlyAttributeOptions = {},
): AttributeMember {
  return attr(name, type, { ...options, readonly: true });
}

export function constant(
  name: string,
  type: WebIDLType,
  value: ConstantValue,
  options: ConstantOptions = {},
): ConstantMember {
  return { ...options, kind: 'constant', name, type, value };
}

export function ctor(
  options?: ConstructorOptions,
): ConstructorMember;
export function ctor(
  argumentsList: ArgumentDefinition[],
  options?: ConstructorOptions,
): ConstructorMember;
export function ctor(
  argumentsOrOptions: ArgumentDefinition[] | ConstructorOptions = [],
  options: ConstructorOptions = {},
): ConstructorMember {
  if (Array.isArray(argumentsOrOptions)) {
    return {
      ...options,
      arguments: argumentsOrOptions,
      kind: 'constructor',
    };
  }
  return { ...argumentsOrOptions, arguments: [], kind: 'constructor' };
}

export function op(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList: ArgumentDefinition[] = [],
  options: OperationOptions = {},
): OperationMember {
  return {
    ...options,
    arguments: argumentsList,
    kind: 'operation',
    ...(name === undefined ? {} : { name }),
    returns,
  };
}

export function stringifier(
  options: StringifierOptions = {},
): StringifierMember {
  return { ...options, kind: 'stringifier' };
}

export function iterable(
  value: WebIDLType,
  options: IterableOptions = {},
): IterableMember {
  return { ...options, kind: 'iterable', value };
}

export function asyncIterable(
  value: WebIDLType,
  options: AsyncIterableOptions = {},
): AsyncIterableMember {
  return { ...options, kind: 'async-iterable', value };
}

export function maplike(
  key: WebIDLType,
  value: WebIDLType,
  options: MaplikeOptions = {},
): MaplikeMember {
  return { ...options, key, kind: 'maplike', value };
}

export function setlike(
  value: WebIDLType,
  options: SetlikeOptions = {},
): SetlikeMember {
  return { ...options, kind: 'setlike', value };
}

export function arg(
  name: string,
  type: WebIDLType,
  options: ArgumentOptions = {},
): ArgumentDefinition {
  return { ...options, name, type };
}

export function dictMember(
  name: string,
  type: WebIDLType,
  options: DictionaryMemberOptions = {},
): DictionaryMember {
  return { ...options, name, type };
}

export function xattr(
  ...attributes: ExtendedAttributeInit[]
): ExtendedAttributeOptions {
  return { extendedAttributes: attributes.map(normalizeExtendedAttribute) };
}

export function reference(name: string): ReferenceType {
  return { kind: 'reference', name };
}

export function nullable(type: WebIDLType): NullableType {
  return { kind: 'nullable', type };
}

export function union(
  ...types: [WebIDLType, WebIDLType, ...WebIDLType[]]
): UnionType {
  return { kind: 'union', types };
}

export function sequence(type: WebIDLType): SequenceType {
  return { kind: 'sequence', type };
}

export function asyncSequence(type: WebIDLType): AsyncSequenceType {
  return { kind: 'async-sequence', type };
}

export function record(
  key: StringType,
  value: WebIDLType,
): RecordType {
  return { kind: 'record', key, value };
}

export function promise(type: WebIDLType): PromiseType {
  return { kind: 'promise', type };
}

export function frozenArray(type: WebIDLType): FrozenArrayType {
  return { kind: 'frozen-array', type };
}

export function observableArray(type: WebIDLType): ObservableArrayType {
  return { kind: 'observable-array', type };
}

export function annotated<Type extends WebIDLType>(
  type: Type,
  { extendedAttributes }: ExtendedAttributeOptions,
): AnnotatedType & { type: Type; } {
  return { kind: 'annotated', extendedAttributes, type };
}

export function integer(value: number | string): IntegerLiteral {
  return { kind: 'integer', value: String(value) };
}

export function decimal(value: number | string): DecimalLiteral {
  return { kind: 'decimal', value: String(value) };
}

export const positiveInfinity: { kind: 'positive-infinity'; } = {
  kind: 'positive-infinity',
};
export const negativeInfinity: { kind: 'negative-infinity'; } = {
  kind: 'negative-infinity',
};
export const notANumber: { kind: 'not-a-number'; } = {
  kind: 'not-a-number',
};
export const undefinedDefault: { kind: 'undefined'; } = {
  kind: 'undefined',
};
export const emptySequence: { kind: 'empty-sequence'; } = {
  kind: 'empty-sequence',
};
export const emptyDictionary: { kind: 'empty-dictionary'; } = {
  kind: 'empty-dictionary',
};

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

export type Definition =
  | InterfaceDefinition
  | PartialInterfaceDefinition
  | InterfaceMixinDefinition
  | PartialInterfaceMixinDefinition
  | CallbackInterfaceDefinition
  | NamespaceDefinition
  | PartialNamespaceDefinition
  | DictionaryDefinition
  | PartialDictionaryDefinition
  | EnumerationDefinition
  | CallbackFunctionDefinition
  | TypedefDefinition
  | IncludesDefinition;

/*
 * Language bindings may augment this map with metadata carried alongside IDL
 * declarations. Declaration and serialization deliberately do not interpret
 * that metadata.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-empty-object-type
export interface LanguageBindingDefinitions {}

type LanguageBinding<Name extends PropertyKey> =
  Name extends keyof LanguageBindingDefinitions
    ? LanguageBindingDefinitions[Name]
    : object;

export type InterfaceDefinition = Attributed & {
  binding?: LanguageBinding<'interface'>;
  kind: 'interface';
  name: string;
  inherits?: string;
  members: InterfaceMember[];
};

export type PartialInterfaceDefinition = Attributed & {
  kind: 'partial-interface';
  name: string;
  members: PartialInterfaceMember[];
};

export type InterfaceMixinDefinition = Attributed & {
  kind: 'interface-mixin';
  name: string;
  members: MixinMember[];
};

export type PartialInterfaceMixinDefinition = Attributed & {
  kind: 'partial-interface-mixin';
  name: string;
  members: MixinMember[];
};

export type CallbackInterfaceDefinition = Attributed & {
  binding?: LanguageBinding<'callback-interface'>;
  kind: 'callback-interface';
  name: string;
  members: CallbackInterfaceMember[];
};

export type NamespaceDefinition = Attributed & {
  kind: 'namespace';
  name: string;
  members: NamespaceMember[];
};

export type PartialNamespaceDefinition = Attributed & {
  kind: 'partial-namespace';
  name: string;
  members: NamespaceMember[];
};

export type DictionaryDefinition = Attributed & {
  kind: 'dictionary';
  name: string;
  inherits?: string;
  members: DictionaryMember[];
};

export type PartialDictionaryDefinition = Attributed & {
  kind: 'partial-dictionary';
  name: string;
  members: DictionaryMember[];
};

export type EnumerationDefinition = Attributed & {
  kind: 'enumeration';
  name: string;
  values: string[];
};

export type CallbackFunctionDefinition = Attributed & {
  kind: 'callback-function';
  name: string;
  returns: WebIDLType;
  arguments: ArgumentDefinition[];
};

export type TypedefDefinition = Attributed & {
  kind: 'typedef';
  name: string;
  type: WebIDLType;
};

export type IncludesDefinition = Attributed & {
  kind: 'includes';
  interface: string;
  mixin: string;
};

export type InterfaceDefinitionInit = Omit<InterfaceDefinition, 'kind'>;
export type PartialInterfaceDefinitionInit = Omit<
  PartialInterfaceDefinition,
  'kind'
>;
export type InterfaceMixinDefinitionInit = Omit<
  InterfaceMixinDefinition,
  'kind'
>;
export type PartialInterfaceMixinDefinitionInit = Omit<
  PartialInterfaceMixinDefinition,
  'kind'
>;
export type CallbackInterfaceDefinitionInit = Omit<
  CallbackInterfaceDefinition,
  'kind'
>;
export type NamespaceDefinitionInit = Omit<NamespaceDefinition, 'kind'>;
export type PartialNamespaceDefinitionInit = Omit<
  PartialNamespaceDefinition,
  'kind'
>;
export type DictionaryDefinitionInit = Omit<DictionaryDefinition, 'kind'>;
export type PartialDictionaryDefinitionInit = Omit<
  PartialDictionaryDefinition,
  'kind'
>;
export type EnumerationDefinitionInit = Omit<EnumerationDefinition, 'kind'>;
export type CallbackFunctionDefinitionInit = Omit<
  CallbackFunctionDefinition,
  'kind'
>;
export type TypedefDefinitionInit = Omit<TypedefDefinition, 'kind'>;
export type IncludesDefinitionInit = Omit<IncludesDefinition, 'kind'>;

export type InterfaceMember = PartialInterfaceMember | ConstructorMember;

export type PartialInterfaceMember =
  | ConstantMember
  | AttributeMember
  | OperationMember
  | StringifierMember
  | IterableMember
  | AsyncIterableMember
  | MaplikeMember
  | SetlikeMember;

export type MixinMember =
  | ConstantMember
  | AttributeMember
  | OperationMember
  | StringifierMember;

export type CallbackInterfaceMember = ConstantMember | OperationMember;

export type NamespaceMember = ConstantMember | AttributeMember | OperationMember;

export type ConstantMember = Member & {
  kind: 'constant';
  name: string;
  type: WebIDLType;
  value: ConstantValue;
};

export type AttributeMember = Member & {
  binding?: LanguageBinding<'attribute'>;
  kind: 'attribute';
  name: string;
  type: WebIDLType;
  readonly?: boolean;
  inherit?: boolean;
  static?: boolean;
  stringifier?: boolean;
};

export type OperationMember = Member & {
  binding?: LanguageBinding<'operation'>;
  kind: 'operation';
  name?: string;
  returns: WebIDLType;
  arguments: ArgumentDefinition[];
  special?: 'getter' | 'setter' | 'deleter';
  static?: boolean;
};

export type ConstructorMember = Member & {
  binding?: LanguageBinding<'constructor'>;
  kind: 'constructor';
  arguments: ArgumentDefinition[];
};

export type StringifierMember = Member & {
  binding?: LanguageBinding<'stringifier'>;
  kind: 'stringifier';
};

export type IterableMember = Member & {
  binding?: LanguageBinding<'iterable'>;
  kind: 'iterable';
  key?: WebIDLType;
  value: WebIDLType;
};

export type AsyncIterableMember = Member & {
  kind: 'async-iterable';
  key?: WebIDLType;
  value: WebIDLType;
  arguments?: ArgumentDefinition[];
};

export type MaplikeMember = Member & {
  kind: 'maplike';
  key: WebIDLType;
  value: WebIDLType;
  readonly?: boolean;
};

export type SetlikeMember = Member & {
  kind: 'setlike';
  value: WebIDLType;
  readonly?: boolean;
};

export type DictionaryMember = Attributed & {
  name: string;
  type: WebIDLType;
  required?: boolean;
  default?: DefaultValue;
};

export type ArgumentDefinition = Attributed & {
  name: string;
  type: WebIDLType;
  optional?: boolean;
  variadic?: boolean;
  default?: DefaultValue;
};

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
  | AnnotatedType;

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

export type SequenceType = ContainerType & { kind: 'sequence'; };
export type AsyncSequenceType = ContainerType & {
  kind: 'async-sequence';
};
export type PromiseType = ContainerType & { kind: 'promise'; };
export type FrozenArrayType = ContainerType & { kind: 'frozen-array'; };
export type ObservableArrayType = ContainerType & {
  kind: 'observable-array';
};

export type RecordType = {
  kind: 'record';
  key: StringType;
  value: WebIDLType;
};

export type AnnotatedType = {
  kind: 'annotated';
  extendedAttributes: ExtendedAttribute[];
  type: WebIDLType;
};

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

export type Exposure = string | [string, ...string[]];

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
  | readonly [name: string, value: string | readonly string[]]
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

type Attributed = {
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

type Member = Attributed;

type AttributeOptions = Omit<AttributeMember, 'kind' | 'name' | 'type'>;

type ReadonlyAttributeOptions = Omit<AttributeOptions, 'readonly'>;

type ConstantOptions = Omit<
  ConstantMember,
  'kind' | 'name' | 'type' | 'value'
>;

type ConstructorOptions = Omit<ConstructorMember, 'arguments' | 'kind'>;

type OperationOptions = Omit<
  OperationMember,
  'arguments' | 'kind' | 'name' | 'returns'
>;

type StringifierOptions = Omit<StringifierMember, 'kind'>;

type IterableOptions = Omit<IterableMember, 'kind' | 'value'>;

type AsyncIterableOptions = Omit<AsyncIterableMember, 'kind' | 'value'>;

type MaplikeOptions = Omit<MaplikeMember, 'key' | 'kind' | 'value'>;

type SetlikeOptions = Omit<SetlikeMember, 'kind' | 'value'>;

type ArgumentOptions = Omit<ArgumentDefinition, 'name' | 'type'>;

type DictionaryMemberOptions = Omit<DictionaryMember, 'name' | 'type'>;

type ContainerType = {
  type: WebIDLType;
};

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

function simpleType<const Name extends SimpleTypeName>(
  name: Name,
): { kind: 'simple'; name: Name; } {
  return { kind: 'simple', name };
}
