import type {
  AnnotatedType, ArgumentDefinition, AsyncSequenceType, AttributeMember, CallbackExceptionBehavior,
  ConstantMember, ConstantValue, DecimalLiteral, ExtendedAttribute, FrozenArrayType,
  ImplementationClass, InjectedArgument, IntegerLiteral, NullableType, ObservableArrayType,
  OperationMember, PromiseType, RecordType, ReferenceType, SequenceType,
  StringifierMember, StringType, UnionType, WebIDLType,
} from './types';
import type {
  AsyncIterableMember, ConstructorMember, DictionaryMember, InterfaceDefinition,
  IterableMember, MaplikeMember, SetlikeMember,
} from './declarations';

// Members and arguments

// Project builder for Web IDL §2.5.4 Constructor operations.
export function ctor<Realm = unknown>(
  argumentsList: ArgumentDefinition[] = [],
  options: ConstructorOptions<Realm> = {},
): ConstructorMember<Realm> {
  return { ...options, kind: 'constructor', arguments: argumentsList };
}

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

/**
 * Project helper: return one built-in function per attribute and receiver realm, named after the attribute.
 * The factory receives the owning binding context; its callback supplies the function's length.
 */
export function attrFn<Realm = unknown>(
  createCallback: NonNullable<AttributeOptions<Realm>['attributeFunction']>,
): Pick<AttributeOptions<Realm>, 'attributeFunction'> {
  return { attributeFunction: createCallback };
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

// Project builder for Web IDL §2.5.3 Operations — argument declarations.
export function arg(
  name: string,
  type: WebIDLType,
  options: ArgumentOptions = {},
): ArgumentDefinition {
  return { ...options, name, type };
}

// Project builder for Web IDL §2.7 Dictionaries — dictionary members.
export function dictMember(
  name: string,
  type: WebIDLType,
  options: DictionaryMemberOptions = {},
): DictionaryMember {
  return { ...options, name, type };
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

// Project builder for Web IDL §2.5.5 Stringifiers.
export function stringifier(
  options: StringifierOptions = {},
): StringifierMember {
  return { ...options, kind: 'stringifier' };
}

// Iteration, collections, and legacy properties

// Project builder for Web IDL §2.5.9 Iterable declarations.
export function iter(
  value: WebIDLType,
  options: IterableOptions = {},
): IterableMember {
  return { ...options, kind: 'iterable', value };
}

// Project builder for Web IDL §2.5.10 Asynchronously iterable declarations.
export function asyncIter(
  value: WebIDLType,
  options: AsyncIterableOptions = {},
): AsyncIterableMember {
  return { ...options, kind: 'async-iterable', value };
}

// Project builder for Web IDL §2.5.11 Maplike declarations.
export function maplike(
  key: WebIDLType,
  value: WebIDLType,
  options: MaplikeOptions = {},
): MaplikeMember {
  return { ...options, key, kind: 'maplike', value };
}

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

// Type expressions

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

// Numeric literals

// Project helper: retain an integer token's text (Web IDL, IDL grammar).
export function integer(value: number | string): IntegerLiteral {
  return { kind: 'integer', value: String(value) };
}

// Project helper: retain a decimal token's text (Web IDL, IDL grammar).
export function decimal(value: number | string): DecimalLiteral {
  return { kind: 'decimal', value: String(value) };
}

// Extended attributes

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

// Implementation construction, invocation, and result allocation

/**
 * Project helper: declare an interface's implementation, dependencies, and projection hooks.
 *
 * Interface construction dependencies apply both when the binding creates an
 * implementation internally and when an automatically bound IDL constructor
 * constructs it. Constructor-level `constructWith` metadata overrides them.
 */
export function impl<Realm = unknown>(
  implClass: ImplementationClass,
  options: ImplementationOptions<Realm> = {},
): NonNullable<InterfaceDefinition<Realm>['implementation']> {
  return { ...options, implClass };
}

/** Project helper: supply an injected value at a final constructor or operation argument index. */
export function atArg<Realm = unknown>(
  index: number,
  resolve: InjectedArgument<Realm>['resolve'],
): InjectedArgument<Realm> {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('An injected argument index must be a nonnegative integer');
  }
  return { index, resolve };
}

/** Project helper: supply hidden arguments to an automatically bound operation. */
export function invokeWith<Realm = unknown>(
  ...argumentsList: InjectedArgument<Realm>[]
): Pick<OperationOptions<Realm>, 'invokeWith'> {
  return { invokeWith: argumentsList };
}

/**
 * Project helper: allocate a fresh buffer or view from returned or promised bytes in the result realm.
 * Without this declaration, buffer results retain their JavaScript identity.
 */
export function newBufferResult(): Pick<OperationOptions, 'newBufferResult'> {
  return { newBufferResult: true };
}

// Argument adaptation and callback errors

/**
 * Project helper: unwrap an argument as an instance of one of the listed classes, while
 * preserving values which implement none of them.
 */
export function unwrapArg(
  ...implClasses: ImplementationClass[]
): Pick<ArgumentOptions, 'implClasses'> {
  return { implClasses };
}

/**
 * Project helper: convert an object argument to a dictionary after ordinary IDL argument conversion.
 * Its callback-function members use the original input object as their receiver.
 */
export function cbDict(name: string): Pick<ArgumentOptions, 'callbackDictionary'> {
  return { callbackDictionary: name };
}

/**
 * Project helper: select the Web IDL exception behavior for a callback passed to an
 * automatically bound implementation member.
 *
 * Web IDL §3.12 Invoking callback functions.
 */
export function onError(
  exceptionBehavior: CallbackExceptionBehavior,
): Pick<ArgumentOptions, 'callbackExceptionBehavior'> {
  return {
    callbackExceptionBehavior: exceptionBehavior,
  };
}

// Helper options derived from declaration members

type ConstructorOptions<Realm = unknown> = Omit<ConstructorMember<Realm>, 'kind' | 'arguments'>;

type AttributeOptions<Realm = unknown> = Omit<AttributeMember<Realm>, 'kind' | 'name' | 'type'>;

type ReadonlyAttributeOptions<Realm = unknown> = Omit<AttributeOptions<Realm>, 'readonly'>;

type OperationOptions<Realm = unknown> = Omit<OperationMember<Realm>, 'kind' | 'name' | 'returns' | 'arguments'>;

type StaticOperationOptions<Realm = unknown> = Omit<OperationOptions<Realm>, 'static'>;

type ArgumentOptions = Omit<ArgumentDefinition, 'name' | 'type'>;

type DictionaryMemberOptions = Omit<DictionaryMember, 'name' | 'type'>;

type ConstantOptions = Omit<ConstantMember, 'kind' | 'name' | 'type' | 'value'>;

type StringifierOptions = Omit<StringifierMember, 'kind'>;

type IterableOptions = Omit<IterableMember, 'kind' | 'value'>;

type AsyncIterableOptions = Omit<AsyncIterableMember, 'kind' | 'value'>;

type MaplikeOptions = Omit<MaplikeMember, 'kind' | 'key' | 'value'>;

type SetlikeOptions = Omit<SetlikeMember, 'kind' | 'value'>;

/**
 * An unsupportedValue must occur only for missing indices, and the getter must
 * be safe to invoke for membership checks as well as reads.
 */
type IndexedPropertySupport<Implementation extends object> =
  | { unsupportedValue: null | undefined; }
  | {
    supportsIndex: (implementation: Implementation, index: number) => boolean;
  };

type ExtendedAttributeInit =
  | string
  | [name: string, value: string | string[]]
  | ExtendedAttribute;

type ExtendedAttributeOptions = {
  extendedAttributes: ExtendedAttribute[];
};

type ImplementationOptions<Realm = unknown> = Omit<
  NonNullable<InterfaceDefinition<Realm>['implementation']>,
  'implClass'
>;

// Internal helpers

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
