import { InternalError } from '../../infra/internal-error';
import type { PromiseResult, ResultValue } from '../../infra/promises';

import type {
  AsyncIterableMember, ConstructorMember, DictionaryMember, PrimaryInterfaceDefinition,
  IterableMember, MaplikeMember, SetlikeMember,
} from './declarations';
import type {
  AnnotatedType, ArgumentDefinition, AsyncSequenceType, AttributeMember, CallbackExceptionBehavior,
  ConstantMember, ConstantValue, DecimalLiteral, DeclarationHook, DefaultValue, ExtendedAttribute, FrozenArrayType,
  ImplementationClass, ImplementationType, InjectedArgument, IntegerLiteral, InterfaceType, NullableType, ObservableArrayType,
  OperationMember, PromiseType, RecordType, ReferenceType, SequenceType,
  StringifierMember, StringType, UnionType, WebIDLType,
} from './types';

// Members and arguments

/** Declare an author-facing constructor overload and optional implementation binding. */
// https://webidl.spec.whatwg.org/#idl-constructors
export function ctor<Env = unknown, const Args extends ArgumentDefinition[] = ArgumentDefinition[]>(
  argumentsList?: Args,
  options?: ConstructorOptions<Env, ArgumentValues<Args>>,
): ConstructorMember<Env>;
export function ctor<Env = unknown>(
  argumentsList: ArgumentDefinition[] = [],
  options: ConstructorOptions<Env> = {},
): ConstructorMember<Env> {
  return { ...options, kind: 'constructor', arguments: argumentsList };
}

/** Declare an attribute with automatic property binding or explicit getter and setter hooks. */
// https://webidl.spec.whatwg.org/#idl-attributes
export function attr<Env = unknown>(
  name: string,
  type: WebIDLType,
  options: AttributeOptions<Env> = {},
): AttributeMember<Env> {
  return { ...options, kind: 'attribute', name, type };
}

/** Declare a read-only attribute. */
// https://webidl.spec.whatwg.org/#idl-attributes
export function roAttr<Env = unknown>(
  name: string,
  type: WebIDLType,
  options: ReadonlyAttributeOptions<Env> = {},
): AttributeMember<Env> {
  return attr(name, type, { ...options, readonly: true });
}

/**
 * Return one built-in function per attribute and receiver realm, named after the attribute.
 * The factory receives the owning binding context; the returned steps supply the function's length.
 */
export function attrFn<Env = unknown>(
  createSteps: NonNullable<AttributeOptions<Env>['attributeFunction']>,
): Pick<AttributeOptions<Env>, 'attributeFunction'> {
  return { attributeFunction: createSteps };
}

/** Declare an operation overload; automatic binding calls the implementation method of the same name. */
// https://webidl.spec.whatwg.org/#idl-operations
export function op<Env = unknown, const Args extends ArgumentDefinition[] = ArgumentDefinition[]>(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList?: Args,
  options?: OperationOptions<Env, ArgumentValues<Args>>,
): OperationMember<Env>;
export function op<Env = unknown>(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList: ArgumentDefinition[] = [],
  options: OperationOptions<Env> = {},
): OperationMember<Env> {
  return {
    ...options,
    arguments: argumentsList,
    kind: 'operation',
    ...(name === undefined ? {} : { name }),
    returns,
  };
}

/** Declare an operation on the interface object, automatically bound to the implementation class. */
// https://webidl.spec.whatwg.org/#idl-static-attributes-and-operations
export function staticOp<Env = unknown, const Args extends ArgumentDefinition[] = ArgumentDefinition[]>(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList?: Args,
  options?: StaticOperationOptions<Env, ArgumentValues<Args>>,
): OperationMember<Env>;
export function staticOp<Env = unknown>(
  name: string | undefined,
  returns: WebIDLType,
  argumentsList: ArgumentDefinition[] = [],
  options: StaticOperationOptions<Env> = {},
): OperationMember<Env> {
  return op(name, returns, argumentsList, { ...options, static: true });
}

/** Declare an author argument's IDL conversion, optionality, and default. */
// https://webidl.spec.whatwg.org/#idl-operations
export function arg<Type extends WebIDLType>(name: string, type: Type): { name: string; type: Type; };
export function arg<Type extends WebIDLType, const Options extends ArgumentOptions>(
  name: string,
  type: Type,
  options: Options,
): { name: string; type: Type; } & Options;
export function arg(
  name: string,
  type: WebIDLType,
  options: ArgumentOptions = {},
): ArgumentDefinition {
  return { ...options, name, type };
}

/** Declare a dictionary property's IDL type, required status, and default. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
export function dictMember(
  name: string,
  type: WebIDLType,
  options: DictionaryMemberOptions = {},
): DictionaryMember {
  return { ...options, name, type };
}

/** Declare a named constant with an IDL type and literal value. */
// https://webidl.spec.whatwg.org/#idl-constants
export function constant(
  name: string,
  type: WebIDLType,
  value: ConstantValue,
  options: ConstantOptions = {},
): ConstantMember {
  return { ...options, kind: 'constant', name, type, value };
}

/** Declare string conversion through the implementation's stringification method. */
// https://webidl.spec.whatwg.org/#idl-stringifiers
export function stringifier(
  options: StringifierOptions = {},
): StringifierMember {
  return { ...options, kind: 'stringifier' };
}

// Iteration, collections, and legacy properties

/** Declare value iteration, or pair iteration when the options include a key type. */
// https://webidl.spec.whatwg.org/#idl-iterable
export function iter(
  value: WebIDLType,
  options: IterableOptions = {},
): IterableMember {
  return { ...options, kind: 'iterable', value };
}

/** Declare asynchronous iteration and its implementation iterator factory. */
// https://webidl.spec.whatwg.org/#idl-async-iterable-declaration
export function asyncIter(
  value: WebIDLType,
  options: AsyncIterableOptions = {},
): AsyncIterableMember {
  return { ...options, kind: 'async-iterable', value };
}

/** Declare Map-shaped collection members for the given key and value types. */
// https://webidl.spec.whatwg.org/#idl-maplike
export function maplike(
  key: WebIDLType,
  value: WebIDLType,
  options: MaplikeOptions = {},
): MaplikeMember {
  return { ...options, key, kind: 'maplike', value };
}

/** Declare Set-shaped collection members for the given value type. */
// https://webidl.spec.whatwg.org/#idl-setlike
export function setlike(
  value: WebIDLType,
  options: SetlikeOptions = {},
): SetlikeMember {
  return { ...options, kind: 'setlike', value };
}

/**
 * Declare indexed-property enumeration separately from membership.
 * An unsupportedValue allows the getter itself to answer support checks;
 * otherwise supportsIndex tests membership without invoking the getter.
 */
// https://webidl.spec.whatwg.org/#idl-indexed-properties
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
 * Declare a named getter whose implementation supplies the supported property
 * names while ordinary operation binding supplies invocation.
 */
// https://webidl.spec.whatwg.org/#idl-named-properties
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

/** Refer to an interface by implementation class, retaining its converted argument type. */
export function reference<Class extends ImplementationClass>(implClass: Class): InterfaceType & ResultValue<Class['prototype']>;
/** Refer to a named IDL type without an implementation-class association. */
export function reference<const Name extends string>(name: Name): ReferenceType & { name: Name; };
export function reference(value: string | ImplementationClass): ReferenceType | InterfaceType {
  return typeof value === 'string'
    ? { kind: 'reference', name: value }
    : { kind: 'interface', implClass: value };
}

/** Associate an IDL type with its implementation value. */
export function implementationType<T>(type: WebIDLType): ImplementationType<T> {
  return type as ImplementationType<T>;
}

/** Permit null in addition to the supplied IDL type. */
// https://webidl.spec.whatwg.org/#idl-nullable-type
export function nullable<Type extends WebIDLType>(type: Type): NullableType & ResultValue<PromiseResult<Type> | null> {
  return { kind: 'nullable', type } as NullableType & ResultValue<PromiseResult<Type> | null>;
}

/** Declare a value selected from two or more IDL types. */
// https://webidl.spec.whatwg.org/#idl-union
export function union<const Types extends [WebIDLType, WebIDLType, ...WebIDLType[]]>(
  ...types: Types
): UnionType & ResultValue<PromiseResult<Types[number]>> {
  return { kind: 'union', types } as unknown as UnionType & ResultValue<PromiseResult<Types[number]>>;
}

/** Declare an ordered sequence of values converted to the supplied element type. */
// https://webidl.spec.whatwg.org/#idl-sequence
export function sequence<Type extends WebIDLType>(type: Type): SequenceType & ResultValue<PromiseResult<Type>[]> {
  return { kind: 'sequence', type } as SequenceType & ResultValue<PromiseResult<Type>[]>;
}

/** Declare an asynchronous sequence of values with the supplied element type. */
// https://webidl.spec.whatwg.org/#idl-async-iterable-type
export function asyncSequence(type: WebIDLType): AsyncSequenceType {
  return { kind: 'async-sequence', type };
}

/** Declare string-keyed entries with the supplied key and value conversions. */
// https://webidl.spec.whatwg.org/#idl-record
export function record<Key extends StringType, Value extends WebIDLType>(
  key: Key,
  value: Value,
): RecordType & ResultValue<Record<string, PromiseResult<Value>>> {
  return { kind: 'record', key, value } as RecordType & ResultValue<Record<string, PromiseResult<Value>>>;
}

/** Declare a Promise whose fulfillment uses the supplied IDL type. */
// https://webidl.spec.whatwg.org/#idl-promise
export function promise(type: WebIDLType): PromiseType {
  return { kind: 'promise', type };
}

/** Declare values exposed as a frozen JavaScript array. */
// https://webidl.spec.whatwg.org/#idl-frozen-array
export function frozenArray<Type extends WebIDLType>(type: Type): FrozenArrayType & ResultValue<PromiseResult<Type>[]> {
  return { kind: 'frozen-array', type } as FrozenArrayType & ResultValue<PromiseResult<Type>[]>;
}

/** Declare an array whose author mutations invoke the interface's observable-array steps. */
// https://webidl.spec.whatwg.org/#idl-observable-array
export function observableArray(type: WebIDLType): ObservableArrayType {
  return { kind: 'observable-array', type };
}

/** Attach extended attributes to a type expression. */
// https://webidl.spec.whatwg.org/#idl-annotated-types
export function annotated<Type extends WebIDLType>(
  type: Type,
  { extendedAttributes }: ExtendedAttributeOptions,
): AnnotatedType<Type> & ResultValue<PromiseResult<Type>> {
  return { kind: 'annotated', extendedAttributes, type } as AnnotatedType<Type> & ResultValue<PromiseResult<Type>>;
}

// Numeric literals

/** Represent an integer literal, accepting text to preserve values beyond JavaScript's safe range. */
export function integer(value: number | string): IntegerLiteral {
  return { kind: 'integer', value: String(value) };
}

/** Represent a decimal literal, preserving its spelling when supplied as text. */
export function decimal(value: number | string): DecimalLiteral {
  return { kind: 'decimal', value: String(value) };
}

// Extended attributes

/** Supply extended attributes using names, name/value pairs, or complete attribute records. */
// https://webidl.spec.whatwg.org/#idl-extended-attributes
export function xattr(
  ...attributes: ExtendedAttributeInit[]
): ExtendedAttributeOptions {
  return { extendedAttributes: attributes.map(normalizeExtendedAttribute) };
}

/** Check for a structured extended attribute with the supplied name. */
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
 * Declare an interface's implementation, dependencies, and projection hooks.
 *
 * Interface construction dependencies apply both when the binding creates an
 * implementation internally and when an automatically bound IDL constructor
 * constructs it. Constructor-level `constructWith` metadata overrides them.
 * The initializer receives the supplied class's instance type.
 */
export function impl<Env = unknown, Class extends ImplementationClass = ImplementationClass>(
  implClass: Class,
  options: ImplementationOptions<Env, Class['prototype']> = {},
): ImplementationOptions<Env> & { implClass: Class; } {
  return { ...options, implClass };
}

/**
 * Supply an injected value at a final constructor or operation argument index.
 * Resolvers receive receiver and method contexts; constructors use the same context for both.
 */
export function atArg<Env = unknown>(
  index: number,
  resolve: InjectedArgument<Env>['resolve'],
): InjectedArgument<Env> {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new InternalError('An injected argument index must be a nonnegative integer');
  }
  return { index, resolve };
}

/** Supply implementation-only arguments to an automatically bound operation. */
export function invokeWith<Env = unknown>(
  ...argumentsList: InjectedArgument<Env>[]
): Pick<OperationOptions<Env>, 'invokeWith'> {
  return { invokeWith: argumentsList };
}

// Argument adaptation and callback errors

/**
 * Unwrap an argument as an instance of one of the listed classes, while
 * preserving values which implement none of them.
 */
export function unwrapArg(
  ...implClasses: ImplementationClass[]
): Pick<ArgumentOptions, 'implClasses'> {
  return { implClasses };
}

/**
 * Convert an object argument to a dictionary after ordinary IDL argument conversion.
 * Its callback-function members use the original input object as their receiver.
 */
export function cbDict(name: string): Pick<ArgumentOptions, 'callbackDictionary'> {
  return { callbackDictionary: reference(name) };
}

/**
 * Select the Web IDL exception behavior for a callback passed to an
 * automatically bound implementation member.
 */
// https://webidl.spec.whatwg.org/#js-invoking-callback-functions
export function onError(
  exceptionBehavior: CallbackExceptionBehavior,
): Pick<ArgumentOptions, 'callbackExceptionBehavior'> {
  return {
    callbackExceptionBehavior: exceptionBehavior,
  };
}

// Helper options derived from declaration members

type ConstructorOptions<Env = unknown, Values extends unknown[] = unknown[]> =
  Omit<ConstructorMember<Env>, 'kind' | 'arguments' | 'construct' | 'invoke'> & {
    construct?: DeclarationHook<'constructor-create', Env, object, Values>;
    invoke?: DeclarationHook<'constructor-invoke', Env, object, Values>;
  };

type AttributeOptions<Env = unknown> = Omit<AttributeMember<Env>, 'kind' | 'name' | 'type'>;

type ReadonlyAttributeOptions<Env = unknown> = Omit<AttributeOptions<Env>, 'readonly'>;

type OperationOptions<Env = unknown, Values extends unknown[] = unknown[]> =
  Omit<OperationMember<Env>, 'kind' | 'name' | 'returns' | 'arguments' | 'invoke'> & {
    invoke?: DeclarationHook<'operation-invoke', Env, object, Values>;
  };

type StaticOperationOptions<Env = unknown, Values extends unknown[] = unknown[]> = Omit<OperationOptions<Env, Values>, 'static'>;

type ArgumentOptions = Omit<ArgumentDefinition, 'name' | 'type'>;

// Custom bindings receive converted arguments; optional arguments without defaults remain undefined.
type ArgumentValues<Args extends ArgumentDefinition[]> =
  Args extends [infer First extends ArgumentDefinition, ...infer Rest extends ArgumentDefinition[]]
    ? First extends { variadic: true; }
      ? ArgumentValue<First>[]
      : [
        First extends { optional: true; }
          ? First extends { default: DefaultValue; } ? ArgumentValue<First> : ArgumentValue<First> | undefined
          : ArgumentValue<First>,
        ...ArgumentValues<Rest>,
      ]
    : Args extends [] ? [] : unknown[];

type ArgumentValue<Arg extends ArgumentDefinition> =
  Extract<keyof Arg, 'callbackDictionary' | 'implClasses'> extends never
    ? PromiseResult<Arg['type']>
    : unknown;

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
  | {
    /** Getter result reserved for missing indices; permits getter calls during membership checks. */
    unsupportedValue: null | undefined;
  }
  | {
    /** Test whether an index is supported without invoking the getter. */
    supportsIndex: (implementation: Implementation, index: number) => boolean;
  };

type ExtendedAttributeInit =
  | string
  | [name: string, value: string | string[]]
  | ExtendedAttribute;

type ExtendedAttributeOptions = {
  /** Extended attributes applying to this declaration or type expression. */
  extendedAttributes: ExtendedAttribute[];
};

type ImplementationOptions<Env = unknown, Impl extends object = object> = Omit<
  NonNullable<PrimaryInterfaceDefinition<Env, Impl>['implementation']>,
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
