import { toScalarValueString } from '../infra/index';
import {
  bufferViewNames, getBufferTypeName, getMethod, hasMapData, hasStringData, isObject, toBigInt,
  toNumber, toPrimitive, toString, type ByteSequence, type JSMethod,
} from '../js-engine/index';
import { InternalPromise } from '../infra/promises';
import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError,
  TypeError as InternalTypeError,
} from '../infra/exceptions';
import type { ConversionType, DefinitionAssembly, UnionInterfaceCandidate } from './assembly';
import type { AssembledDictionary, AssembledEnumeration, AssembledInterface } from './assembled';
import {
  convertAsyncSequenceToJavaScript,
  convertJavaScriptValueToAsyncSequence,
  createIDLAsyncSequence, isIDLAsyncSequence,
} from './async-sequence';
import {
  createCallbackFunctionValue, createCallbackInterfaceRecord,
  isCallbackFunctionValue, isCallbackInterfaceRecord,
} from './callback-value';
import { convertBufferSourceToIDL, convertBufferSourceToJavaScript } from './buffer-source';
import { hasExtendedAttribute } from './core/helpers';
import type {
  BufferTypeName, DefaultValue, ExtendedAttribute, ImplementationType,
  RecordType, SimpleTypeName, UnionType, WebIDLType,
} from './core/types';
import type { WebIDLRealm } from './realm';
import type { RealmBinding } from './realm-binding';
import { getPlatformRecord } from './platform-object';
import {
  convertJavaScriptValueToPromise, isIDLPromiseRecord,
} from './promise-record';
import { defineDataProperty } from './property';
import { InternalError } from '../infra/internal-error';

// Project entry point for Web IDL §3.2 JavaScript type mapping; realizes realm-owned failures.
export function convertToIDL(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  options: ConversionOptions = {},
): unknown {
  const legacyCallbackAttribute = options.attributeAssignment === true &&
    context.binding.assembly.isNullableLegacyCallback(type);
  // Web IDL §3.2.20 Nullable types — [LegacyTreatNonObjectAsNull] attribute-assignment step.
  if (legacyCallbackAttribute && !isObject(value)) return null;
  try {
    return convertJavaScriptValue(
      value,
      type,
      context,
      [],
      legacyCallbackAttribute,
    );
  } catch (error) {
    return throwConversionError(error, context);
  }
}

/** Prepare a fixed input type for repeated conversions in the method's realm. */
export function createIDLConverter(
  type: WebIDLType,
  context: ConversionContext,
  options: ConversionOptions = {},
): (value: unknown) => unknown {
  const assembly = context.binding.assembly;
  const convert = createIDLValueConverter(type, assembly, options);
  return (value) => {
    try {
      return convert(value, context);
    } catch (error) {
      return throwConversionError(error, context);
    }
  };
}

// Retain type decisions without capturing a realm: borrowed calls still supply
// the method's conversion context, including when nested dictionary members fail.
function createIDLValueConverter(
  type: WebIDLType,
  assembly: DefinitionAssembly,
  options: ConversionOptions = {},
): ValueConverter {
  const conversion = assembly.getConversionType(type);
  const resolved = conversion.type;
  const legacyCallbackAttribute = options.attributeAssignment === true && assembly.isNullableLegacyCallback(type);
  const interfaceAssembled = resolved.kind === 'reference' ? assembly.interfaces.get(resolved.name) : undefined;
  const enumerationAssembled = resolved.kind === 'reference' ? assembly.enumerations.get(resolved.name) : undefined;
  const dictionaryAssembled = resolved.kind === 'reference' ? assembly.dictionaries.get(resolved.name) : undefined;
  let convert: ValueConverter;
  if (resolved.kind === 'simple') {
    const integer = integerTypes[resolved.name];
    const simple = simpleIDLConverters[resolved.name];
    convert = integer
      ? (value, context) => convertToInteger(
        value, integer.bitLength, integer.signed, conversion.extendedAttributes, context,
      )
      : simple
        ? (value, context) => simple(value, conversion.extendedAttributes, context)
        : (value, context) => convertJavaScriptValueToSimpleType(
          value, resolved.name, conversion.extendedAttributes, context,
        );
  } else if (interfaceAssembled) {
    convert = (value, context) => convertToInterface(value, interfaceAssembled, context);
  } else if (enumerationAssembled) {
    convert = (value, context) => convertToEnumeration(value, enumerationAssembled, context);
  } else if (dictionaryAssembled) {
    convert = (value, context) => convertJavaScriptValueToDictionary(value, dictionaryAssembled, context);
  } else {
    convert = (value, context) => convertJavaScriptValueByConversionType(
      value, conversion, context, [], legacyCallbackAttribute,
    );
  }
  return legacyCallbackAttribute
    ? (value, context) => isObject(value) ? convert(value, context) : null
    : convert;
}

// Project entry point for Web IDL §3.2 JavaScript type mapping — IDL-to-JavaScript conversion.
export function convertToJavaScript(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  allocateBuffers = false,
): unknown {
  return convertIDLValue(value, type, context, [], allocateBuffers);
}

/** Select a fixed result type's conversion once while retaining the invocation's allocation realm. */
export function createJavaScriptConverter(
  type: WebIDLType,
  assembly: DefinitionAssembly,
  allocateBuffers = false,
): ValueConverter {
  const conversion = assembly.getConversionType(type);
  const resolved = conversion.type;
  if (resolved.kind === 'simple' && !bufferTypeNames.has(resolved.name)) {
    if (resolved.name === 'undefined') {
      return (value, context) => {
        context.binding.realizeException(value);
        return undefined;
      };
    }
    return (value, context) => context.binding.realizeException(value);
  }
  if (resolved.kind === 'reference') {
    const assembled = assembly.interfaces.get(resolved.name);
    if (assembled) {
      return (value, context) => projectInterface(context.binding.realizeException(value), assembled, context);
    }
    if (assembly.enumerations.has(resolved.name)) {
      return (value, context) => context.binding.realizeException(value);
    }
  }
  return (value, context) => convertIDLValueByConversionType(value, conversion, context, [], allocateBuffers);
}

export type ValueConverter = (value: unknown, context: ConversionContext) => unknown;

// Web IDL §3.2.21.1 Creating a sequence from an iterable.
export function createSequenceFromIterable(
  iterable: object,
  elementType: WebIDLType,
  method: JSMethod,
  context: ConversionContext,
): IDLSequenceValue {
  const iterator = Reflect.apply(method, iterable, []);
  if (!isObject(iterator)) {
    throwTypeError(context, 'Iterator method did not return an object');
  }

  const nextMethod = getMethod(iterator, 'next', context.realm);
  if (!nextMethod) throwTypeError(context, 'Iterator has no next method');

  const sequence: IDLSequenceValue = [];
  while (true) {
    const result = Reflect.apply(nextMethod, iterator, []);
    if (!isObject(result)) {
      throwTypeError(context, 'Iterator result is not an object');
    }
    const iteration = result as { done?: unknown; value?: unknown; };
    if (iteration.done) return sequence;
    sequence.push(convertToIDL(
      iteration.value,
      elementType,
      context,
    ));
  }
}

// Web IDL §3.2.27 Frozen arrays — create a frozen array.
export function createFrozenArray(
  values: IDLSequenceValue,
  elementType: WebIDLType,
  context: ConversionContext,
): readonly unknown[] {
  return Object.freeze(convertSequenceToJavaScript(
    values,
    elementType,
    context,
  ));
}

// Web IDL §3.2.27.1 Creating a frozen array from an iterable.
export function createFrozenArrayFromIterable(
  iterable: object,
  elementType: WebIDLType,
  method: JSMethod,
  context: ConversionContext,
): readonly unknown[] {
  return createFrozenArray(
    createSequenceFromIterable(iterable, elementType, method, context),
    elementType,
    context,
  );
}

// Project implementation of Web IDL §2.12 Objects implementing interfaces — is a platform object.
export function isPlatformObject(
  value: unknown,
  context: ConversionContext,
): boolean {
  if (getPlatformRecord(value)?.binding.world === context.binding.world) return true;
  return context.binding.assembly.proxyObjects.is(value);
}

// Project helper: materialize the default-value records supplied by declaration builders.
export function materializeDefaultValue(
  value: DefaultValue,
  type: WebIDLType,
  context: ConversionContext,
): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  switch (value.kind) {
    case 'integer': {
      const integer = context.binding.assembly.getIntegerLiteralValue(value);
      const numericType = context.binding.assembly.getSoleNumericTypeName(type);
      if (numericType === 'bigint') return integer;
      if (numericType && integerTypes[numericType]) return Number(integer);
      return convertToIDL(Number(integer), type, context);
    }
    case 'decimal':
      return convertToIDL(Number(value.value), type, context);
    case 'positive-infinity':
      return convertToIDL(Infinity, type, context);
    case 'negative-infinity':
      return convertToIDL(-Infinity, type, context);
    case 'not-a-number':
      return convertToIDL(NaN, type, context);
    case 'undefined':
      return undefined;
    case 'empty-sequence':
      return [];
    case 'empty-dictionary':
      return convertToIDL(undefined, type, context);
  }
}

/** Reuse successfully converted scalar defaults; create mutable defaults on every call. */
export function createDefaultValueFactory(
  value: DefaultValue,
  type: WebIDLType,
): (context: ConversionContext) => unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return () => value;
  if (value.kind === 'empty-sequence') return () => [];
  if (value.kind === 'empty-dictionary') return (context) => materializeDefaultValue(value, type, context);
  let initialized = false;
  let result: unknown;
  return (context) => {
    if (!initialized) {
      result = materializeDefaultValue(value, type, context);
      // Preparation must not throw earlier than the invocation that uses the
      // default. Only successful primitive results can be shared across calls.
      initialized = !isObject(result);
    }
    return result;
  };
}

export type ConversionContext = {
  /** Definitions, implementation identity, projection, and internal failures. */
  binding: RealmBinding;
  /** JavaScript allocation and conversion errors; may differ from binding.realm. */
  realm: WebIDLRealm;
};

export type ConversionOptions = {
  attributeAssignment?: boolean;
};

/** Converted dictionary members, kept distinct from an author-supplied object. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
// SPEC_MISMATCH: dictionary value = ordered map from member names to values
export class IDLDictionaryValue {
  assembled: AssembledDictionary;
  record: Record<string, unknown>;

  constructor(assembled: AssembledDictionary, record: Record<string, unknown>) {
    this.assembled = assembled;
    this.record = record;
  }
}

export type IDLRecordValue = Map<string, unknown>;
export type IDLSequenceValue = unknown[];

// Project dispatcher for Web IDL §3.2 JavaScript type mapping — JavaScript-to-IDL conversions.
function convertJavaScriptValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
  legacyCallbackAttribute = false,
): unknown {
  return convertJavaScriptValueByConversionType(
    value,
    context.binding.assembly.getConversionType(type),
    context,
    extendedAttributes,
    legacyCallbackAttribute,
  );
}

// Project dispatcher: convert a JavaScript value using its resolved type and retained extended attributes.
function convertJavaScriptValueByConversionType(
  value: unknown,
  { type, extendedAttributes }: ConversionType,
  context: ConversionContext,
  inheritedAttributes: ExtendedAttribute[],
  legacyCallbackAttribute = false,
): unknown {
  if (inheritedAttributes.length) extendedAttributes = [...inheritedAttributes, ...extendedAttributes];
  switch (type.kind) {
    case 'simple':
      return convertJavaScriptValueToSimpleType(
        value,
        type.name,
        extendedAttributes,
        context,
      );
    case 'reference':
      return convertJavaScriptValueToNamedType(
        value,
        type.name,
        context,
        legacyCallbackAttribute,
      );
    // Web IDL §3.2.20 Nullable types — JavaScript-to-IDL conversion.
    case 'nullable':
      if (
        value === undefined &&
        context.binding.assembly.includesUndefined(type.type)
      ) return undefined;
      if (value === null || value === undefined) return null;
      return convertJavaScriptValue(
        value,
        type.type,
        context,
        extendedAttributes,
        legacyCallbackAttribute,
      );
    case 'union':
      return convertJavaScriptValueToUnion(
        value,
        type,
        context,
        extendedAttributes,
      );
    // Web IDL §3.2.21 Sequences — JavaScript-to-IDL conversion.
    case 'sequence': {
      if (!isObject(value)) {
        throwTypeError(context, 'A sequence value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (!method) throwTypeError(context, 'Value is not iterable');
      return createSequenceFromIterable(
        value,
        type.type,
        method,
        context,
      );
    }
    case 'record':
      return convertJavaScriptValueToRecord(value, type, context);
    // Web IDL §3.2.27 Frozen arrays — JavaScript-to-IDL conversion.
    case 'frozen-array': {
      if (!isObject(value)) {
        throwTypeError(context, 'A frozen array value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (!method) throwTypeError(context, 'Value is not iterable');
      return createFrozenArrayFromIterable(
        value,
        type.type,
        method,
        context,
      );
    }
    case 'promise':
      return convertJavaScriptValueToPromise(
        value,
        type.type,
        context.realm,
        context.binding.realizeException,
      );
    case 'async-sequence':
      return convertJavaScriptValueToAsyncSequence(
        value,
        type,
        context.realm,
      );
    case 'observable-array':
      return unsupportedConversion(type.kind);
  }
}

// Project dispatcher for Web IDL §3.2 JavaScript type mapping — IDL-to-JavaScript conversions.
function convertIDLValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
  allocateBuffers = false,
): unknown {
  return convertIDLValueByConversionType(
    value,
    context.binding.assembly.getConversionType(type),
    context,
    extendedAttributes,
    allocateBuffers,
  );
}

// Project dispatcher: convert an IDL value using its resolved type and retained extended attributes.
function convertIDLValueByConversionType(
  value: unknown,
  { type, extendedAttributes }: ConversionType,
  context: ConversionContext,
  inheritedAttributes: ExtendedAttribute[],
  allocateBuffers = false,
): unknown {
  if (inheritedAttributes.length) extendedAttributes = [...inheritedAttributes, ...extendedAttributes];
  // Realize internal exceptions before exposing them, including as callback arguments.
  value = context.binding.realizeException(value);
  switch (type.kind) {
    case 'simple':
      return convertSimpleTypeToJavaScript(value, type.name, context, allocateBuffers);
    case 'reference':
      return convertNamedTypeToJavaScript(
        value,
        type.name,
        context,
      );
    // Web IDL §3.2.20 Nullable types — IDL-to-JavaScript conversion.
    case 'nullable':
      if (value === null) return null;
      return convertIDLValue(
        value,
        type.type,
        context,
        extendedAttributes,
        allocateBuffers,
      );
    case 'union':
      return convertUnionToJavaScript(
        value,
        type,
        context,
        extendedAttributes,
        allocateBuffers,
      );
    case 'sequence':
      return convertSequenceToJavaScript(
        value,
        type.type,
        context,
      );
    case 'record':
      return convertRecordToJavaScript(
        value,
        type.key,
        type.value,
        context,
      );
    // Web IDL §3.2.27 Frozen arrays — preserve the frozen array object.
    case 'frozen-array':
      return value;
    case 'promise':
      // https://webidl.spec.whatwg.org/#es-promise — expose the capability's Promise.
      if (isIDLPromiseRecord(value)) return value.promise;
      if (value instanceof InternalPromise) {
        const assembly = context.binding.assembly;
        if (
          value.type.kind === 'implementation' ||
          assembly.getConversionTypeKey(value.type as ImplementationType<unknown>) !==
          assembly.getConversionTypeKey(type.type)
        ) {
          throw new InternalError('Promise result type does not match its Web IDL declaration');
        }
        return value.backing;
      }
      throw new InternalError('Expected a declared Promise result');
    case 'async-sequence':
      return convertAsyncSequenceToJavaScript(value);
    case 'observable-array':
      return unsupportedConversion(type.kind);
  }
}

// Shared implementation of the simple-type conversions in Web IDL §3.2 JavaScript type mapping.
function convertJavaScriptValueToSimpleType(
  value: unknown,
  name: SimpleTypeName,
  extendedAttributes: ExtendedAttribute[],
  context: ConversionContext,
): unknown {
  const integerType = integerTypes[name];
  if (integerType) {
    return convertToInteger(
      value,
      integerType.bitLength,
      integerType.signed,
      extendedAttributes,
      context,
    );
  }

  if (bufferTypeNames.has(name)) {
    return convertBufferSourceToIDL(
      value,
      name as BufferTypeName,
      extendedAttributes,
    );
  }

  const convert = simpleIDLConverters[name];
  if (!convert) return unsupportedConversion(name);
  return convert(value, extendedAttributes, context);
}

// Shared simple-type IDL-to-JavaScript conversion rules from Web IDL §3.2 JavaScript type mapping.
function convertSimpleTypeToJavaScript(
  value: unknown,
  name: SimpleTypeName,
  context: ConversionContext,
  allocateBuffers: boolean,
): unknown {
  if (bufferTypeNames.has(name)) {
    const bufferName = name as BufferTypeName;
    if (allocateBuffers) {
      const bytes = value as ByteSequence;
      if (bufferName === 'ArrayBuffer') return context.realm.createArrayBuffer(bytes);
      if (bufferName === 'SharedArrayBuffer') return context.realm.createSharedArrayBuffer(bytes);
      return context.realm.createArrayBufferView(bufferName, bytes);
    }
    return convertBufferSourceToJavaScript(value, bufferName);
  }
  return name === 'undefined' ? undefined : value;
}

// Project dispatcher for named types in Web IDL §3.2 JavaScript type mapping.
function convertJavaScriptValueToNamedType(
  value: unknown,
  name: string,
  context: ConversionContext,
  legacyCallbackAttribute: boolean,
): unknown {
  const assembly = context.binding.assembly;
  const assembled = assembly.interfaces.get(name);
  if (assembled) return convertToInterface(value, assembled, context);

  const dictionaryAssembled = assembly.dictionaries.get(name);
  if (dictionaryAssembled) return convertJavaScriptValueToDictionary(value, dictionaryAssembled, context);

  const enumerationAssembled = assembly.enumerations.get(name);
  if (enumerationAssembled) return convertToEnumeration(value, enumerationAssembled, context);

  const callbackFunctionAssembled = assembly.callbackFunctions.get(name);
  if (callbackFunctionAssembled) {
    if (
      typeof value !== 'function' &&
      !(legacyCallbackAttribute && isObject(value))
    ) return throwTypeError(context, `${name} is not callable`);
    return createCallbackFunctionValue(
      callbackFunctionAssembled,
      value,
      getCallbackRealm(value, context),
      context.realm.callbacks.captureContext(),
      context,
    );
  }

  const callbackInterfaceAssembled = assembly.callbackInterfaces.get(name);
  if (callbackInterfaceAssembled) {
    if (!isObject(value)) return throwTypeError(context, `${name} is not an object`);
    return createCallbackInterfaceRecord(
      callbackInterfaceAssembled,
      value,
      getCallbackRealm(value, context),
      context.realm.callbacks.captureContext(),
      context,
    );
  }

  const proxyAssembled = assembly.proxyObjects.get(name);
  if (proxyAssembled) {
    return proxyAssembled.is(value)
      ? value
      : throwTypeError(context, `Value does not implement ${name}`);
  }
  if (assembly.namespaces.has(name)) {
    throw new InternalError(`${name} is not a value type`);
  }
  throw new InternalError(`Unknown Web IDL type ${name}`);
}

// https://webidl.spec.whatwg.org/#es-interface
function convertToInterface(value: unknown, assembled: AssembledInterface, context: ConversionContext): object {
  const record = getPlatformRecord(value);
  if (
    record?.binding.world === context.binding.world &&
    record.implements(assembled)
  ) return record.implInst;
  return throwTypeError(context, `Value does not implement ${assembled.name}`);
}

// https://webidl.spec.whatwg.org/#es-enumeration
function convertToEnumeration(value: unknown, assembled: AssembledEnumeration, context: ConversionContext): string {
  const string = toString(value);
  if (!assembled.hasValue(string)) {
    throwTypeError(context, `${string} is not a value of ${assembled.primary.name}`);
  }
  return string;
}

// Project adapter for named IDL values in Web IDL §3.2 JavaScript type mapping.
function convertNamedTypeToJavaScript(
  value: unknown,
  name: string,
  context: ConversionContext,
): unknown {
  const assembly = context.binding.assembly;
  const assembled = assembly.interfaces.get(name);
  if (assembled) return projectInterface(value, assembled, context);

  const dictionaryAssembled = assembly.dictionaries.get(name);
  if (dictionaryAssembled) return convertDictionaryToJavaScript(value, dictionaryAssembled, context);
  if (assembly.enumerations.has(name)) return value;

  if (assembly.callbackFunctions.has(name)) {
    if (isCallbackFunctionValue(value)) return value.object;
    if (typeof value === 'function') return value;
    throw new InternalError(`IDL callback function ${name} is not callable`);
  }
  if (assembly.callbackInterfaces.has(name)) {
    if (!isCallbackInterfaceRecord(value)) {
      throw new InternalError(`IDL callback interface ${name} is not a callback value`);
    }
    return value.object;
  }

  const proxyAssembled = assembly.proxyObjects.get(name);
  if (proxyAssembled) {
    if (proxyAssembled.is(value)) return value;
    throw new InternalError(`IDL interface value does not implement ${name}`);
  }
  if (assembly.namespaces.has(name)) {
    throw new InternalError(`${name} is not a value type`);
  }
  throw new InternalError(`Unknown Web IDL type ${name}`);
}

function projectInterface(value: unknown, assembled: AssembledInterface, context: ConversionContext): object {
  const object = isObject(value)
    ? context.binding.projectImplementationObject(value, assembled)
    : undefined;
  if (!object) {
    throw new InternalError(`IDL interface value ${assembled.name} is not an implementation target`);
  }
  return object;
}

// Web IDL §3.2.17 Dictionary types — convert a JavaScript value to a dictionary.
function convertJavaScriptValueToDictionary(
  value: unknown,
  assembled: AssembledDictionary,
  context: ConversionContext,
): IDLDictionaryValue {
  return context.binding.getDictionaryConverter(assembled)(value, context);
}

/** Prepare member conversions once; each call reads the current author object. */
export function createDictionaryConverter(
  assembled: AssembledDictionary,
  assembly: DefinitionAssembly,
): DictionaryConverter {
  const members = assembled.members.map((member) => ({
    member,
    convert: createIDLValueConverter(member.type, assembly),
    getDefault: member.primary.default === undefined
      ? undefined
      : createDefaultValueFactory(member.primary.default, member.type),
  }));
  // Required/defaulted members always exist after successful conversion. Copy
  // their layout together; sparse dictionaries only create present properties.
  const complete = members.every(({ member, getDefault }) => member.primary.required || getDefault);
  const template: Record<string, unknown> = {};
  if (complete) {
    for (const { member } of members) defineDataProperty(template, member.name, undefined);
  }
  // Dictionary references defer to the binding's converter on invocation, so
  // recursive dictionaries do not recursively expand during preparation.
  return (value, context) => {
    if (!isObject(value) && value !== undefined && value !== null) {
      throwTypeError(context, 'A dictionary value must be an object');
    }
    const record: Record<string, unknown> = complete ? { ...template } : {};
    const entries: [string, unknown][] | undefined = complete ? undefined : [];
    for (const { member, convert, getDefault } of members) {
      const memberValue = value === undefined || value === null
        ? undefined
        : (value as Record<string, unknown>)[member.name];
      let converted: unknown;
      if (memberValue !== undefined) {
        converted = convert(memberValue, context);
      } else if (getDefault) {
        converted = getDefault(context);
      } else if (member.primary.required) {
        throwTypeError(context, `Required dictionary member ${member.name} is missing`);
      } else {
        continue;
      }
      if (entries) entries.push([member.name, converted]);
      else record[member.name] = converted;
    }
    // Object.fromEntries creates sparse own properties together, without
    // inherited setters or deleting absent fields from the complete layout.
    return new IDLDictionaryValue(assembled, entries ? Object.fromEntries(entries) : record);
  };
}

export type DictionaryConverter = (value: unknown, context: ConversionContext) => IDLDictionaryValue;

// Web IDL §3.2.17 Dictionary types — convert a dictionary to a JavaScript value.
function convertDictionaryToJavaScript(
  value: unknown,
  assembled: AssembledDictionary,
  context: ConversionContext,
): object {
  if (!isObject(value)) {
    throw new InternalError(`IDL dictionary ${assembled.primary.name} is not an object`);
  }
  const members = value instanceof IDLDictionaryValue ? value.record : value as Record<string, unknown>;

  const result = context.realm.createOrdinaryObject(
    context.realm.intrinsics.objectPrototype,
  );
  for (const member of assembled.members) {
    if (!Object.hasOwn(members, member.name)) continue;
    defineDataProperty(
      result,
      member.name,
      convertToJavaScript(members[member.name], member.type, context),
    );
  }
  return result;
}

// Web IDL §3.2.23 Records — convert a JavaScript value to a record.
function convertJavaScriptValueToRecord(
  value: unknown,
  type: RecordType,
  context: ConversionContext,
): IDLRecordValue {
  if (!isObject(value)) {
    throwTypeError(context, 'A record value must be an object');
  }

  const result: IDLRecordValue = new Map();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    const typedKey = convertToIDL(key, type.key, context);
    const typedValue = convertToIDL(
      (value as Record<PropertyKey, unknown>)[key],
      type.value,
      context,
    );
    result.set(typedKey as string, typedValue);
  }
  return result;
}

// Web IDL §3.2.23 Records — convert a record to a JavaScript value.
function convertRecordToJavaScript(
  value: unknown,
  keyType: WebIDLType,
  valueType: WebIDLType,
  context: ConversionContext,
): object {
  if (!isMap(value)) throw new InternalError('IDL record is not a map');

  const result = context.realm.createOrdinaryObject(
    context.realm.intrinsics.objectPrototype,
  );
  for (const [key, entryValue] of value) {
    const jsKey = convertToJavaScript(key, keyType, context);
    const jsValue = convertToJavaScript(entryValue, valueType, context);
    defineDataProperty(result, jsKey as PropertyKey, jsValue);
  }
  return result;
}

// Web IDL §3.2.21 Sequences — convert a sequence to a JavaScript value.
function convertSequenceToJavaScript(
  value: unknown,
  elementType: WebIDLType,
  context: ConversionContext,
): unknown[] {
  if (!Array.isArray(value)) throw new InternalError('IDL sequence is not an array');

  const result = new context.realm.intrinsics.array();
  for (let i = 0; i < value.length; i++) {
    defineDataProperty(
      result,
      String(i),
      convertToJavaScript(value[i], elementType, context),
    );
  }
  return result;
}

// Web IDL §3.2.25 Union types — convert a JavaScript value to a union.
function convertJavaScriptValueToUnion(
  value: unknown,
  type: UnionType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
): unknown {
  const assembly = context.binding.assembly;
  if (value === undefined && assembly.includesUndefined(type)) {
    return undefined;
  }
  if (
    (value === null || value === undefined) &&
    assembly.includesNullableType(type)
  ) return null;

  const candidates = assembly.getUnionCandidates(type);

  if (value === null || value === undefined) {
    const assembled = candidates.dictionary;
    if (assembled) return convertJavaScriptValueToDictionary(value, assembled, context);
  }

  if (isPlatformObject(value, context)) {
    const interfaceType = candidates.interfaces.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interfaceType) {
      return convertJavaScriptValueByConversionType(value, interfaceType.type, context, extendedAttributes);
    }
    if (candidates.simpleTypes.has('object')) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName) {
      const buffer = candidates.simpleTypes.get(bufferName);
      if (buffer) return convertJavaScriptValueByConversionType(value, buffer, context, extendedAttributes);
      if (candidates.simpleTypes.has('object')) return value;
    }
  }

  if (typeof value === 'function') {
    const assembled = candidates.callbackFunction;
    if (assembled) {
      return createCallbackFunctionValue(
        assembled,
        value,
        getCallbackRealm(value, context),
        context.realm.callbacks.captureContext(),
        context,
      );
    }
    if (candidates.simpleTypes.has('object')) return value;
  }

  if (isObject(value)) {
    const asyncSequence = candidates.typesByKind.get('async-sequence');
    if (asyncSequence && !(hasStringData(value) && candidates.string)) {
      const asyncMethod = getMethod(
        value,
        Symbol.asyncIterator,
        context.realm,
      );
      if (asyncMethod && asyncSequence.type.kind === 'async-sequence') {
        return createIDLAsyncSequence(
          value,
          asyncSequence.type.type,
          asyncMethod,
          'async',
        );
      }
      const syncMethod = getMethod(value, Symbol.iterator, context.realm);
      if (syncMethod && asyncSequence.type.kind === 'async-sequence') {
        return createIDLAsyncSequence(
          value,
          asyncSequence.type.type,
          syncMethod,
          'sync',
        );
      }
    }

    const sequence = candidates.typesByKind.get('sequence');
    if (sequence && sequence.type.kind === 'sequence') {
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (method) {
        return createSequenceFromIterable(
          value,
          sequence.type.type,
          method,
          context,
        );
      }
    }

    const frozenArray = candidates.typesByKind.get('frozen-array');
    if (frozenArray) {
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (method) {
        return convertJavaScriptValueByConversionType(
          value,
          frozenArray,
          context,
          extendedAttributes,
        );
      }
    }

    const dictionaryAssembled = candidates.dictionary;
    if (dictionaryAssembled) return convertJavaScriptValueToDictionary(value, dictionaryAssembled, context);
    const record = candidates.typesByKind.get('record');
    if (record) return convertJavaScriptValueByConversionType(value, record, context, extendedAttributes);
    const callbackInterfaceAssembled = candidates.callbackInterface;
    if (callbackInterfaceAssembled) {
      return createCallbackInterfaceRecord(
        callbackInterfaceAssembled,
        value,
        getCallbackRealm(value, context),
        context.realm.callbacks.captureContext(),
        context,
      );
    }
    if (candidates.simpleTypes.has('object')) return value;
  }

  if (typeof value === 'boolean') {
    if (candidates.simpleTypes.has('boolean')) return value;
  }
  if (typeof value === 'number') {
    const numeric = candidates.numeric;
    if (numeric) return convertJavaScriptValueByConversionType(value, numeric, context, extendedAttributes);
  }
  if (typeof value === 'bigint') {
    if (candidates.simpleTypes.has('bigint')) return value;
  }

  const string = candidates.string;
  if (string) return convertJavaScriptValueByConversionType(value, string, context, extendedAttributes);

  const numeric = candidates.numeric;
  const bigint = candidates.simpleTypes.has('bigint');
  if (numeric && bigint) {
    const primitive = toPrimitive(value, 'number');
    return typeof primitive === 'bigint'
      ? primitive
      : convertJavaScriptValueByConversionType(primitive, numeric, context, extendedAttributes);
  }
  if (numeric) return convertJavaScriptValueByConversionType(value, numeric, context, extendedAttributes);

  if (candidates.simpleTypes.has('boolean')) return Boolean(value);
  if (bigint) return toBigInt(value);
  return throwTypeError(context, 'Value cannot be converted to the union type');
}

// Project adapter for Web IDL §3.2.25 Union types — identify our value's specific type, then convert it.
function convertUnionToJavaScript(
  value: unknown,
  type: UnionType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
  allocateBuffers: boolean,
): unknown {
  const assembly = context.binding.assembly;
  const candidates = assembly.getUnionCandidates(type);

  if (value === undefined) {
    if (candidates.simpleTypes.has('undefined')) return undefined;
  }
  if (value === null && assembly.includesNullableType(type)) {
    return null;
  }
  if (isPlatformObject(value, context)) {
    const interfaceType = candidates.interfaces.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interfaceType) return value;
    if (candidates.simpleTypes.has('object')) return value;
  }
  if (isObject(value)) {
    for (const candidate of candidates.interfaces) {
      if (!('assembled' in candidate)) continue;
      const projected = context.binding.projectImplementationObject(value, candidate.assembled);
      if (projected) return projected;
    }
  }
  if (isCallbackFunctionValue(value) || typeof value === 'function') {
    const assembled = candidates.callbackFunction;
    if (assembled) return isCallbackFunctionValue(value) ? value.object : value;
  }
  if (isCallbackInterfaceRecord(value)) {
    const assembled = candidates.callbackInterface;
    if (assembled) return value.object;
  }
  if (isIDLAsyncSequence(value)) {
    const sequence = candidates.typesByKind.get('async-sequence');
    if (sequence) return convertIDLValueByConversionType(value, sequence, context, extendedAttributes);
  }
  if (Array.isArray(value)) {
    const array = candidates.array;
    if (array) return convertIDLValueByConversionType(value, array, context, extendedAttributes);
  }
  if (value instanceof IDLDictionaryValue) {
    const assembled = candidates.dictionary;
    if (assembled) return convertDictionaryToJavaScript(value, assembled, context);
  }
  if (isMap(value)) {
    const record = candidates.typesByKind.get('record');
    if (record) return convertIDLValueByConversionType(value, record, context, extendedAttributes);
  }
  if (typeof value === 'boolean') {
    if (candidates.simpleTypes.has('boolean')) return value;
  }
  if (typeof value === 'number') {
    if (candidates.numeric) return value;
  }
  if (typeof value === 'bigint') {
    if (candidates.simpleTypes.has('bigint')) return value;
  }
  if (typeof value === 'string') {
    if (candidates.string) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    const buffer = bufferName && candidates.simpleTypes.get(bufferName);
    if (buffer) return convertIDLValueByConversionType(value, buffer, context, extendedAttributes, allocateBuffers);
    if (candidates.dictionary) return convertDictionaryToJavaScript(value, candidates.dictionary, context);
    if (candidates.simpleTypes.has('object')) return value;
  }
  throw new InternalError('IDL union value has no matching specific type');
}

// Web IDL §3.2.4.9 Abstract operations — ConvertToInt.
function convertToInteger(
  value: unknown,
  bitLength: number,
  signed: boolean,
  extendedAttributes: ExtendedAttribute[],
  context: ConversionContext,
): number {
  let number = toNumber(value);
  if (Object.is(number, -0)) number = 0;

  const lowerBound = bitLength === 64
    ? signed ? -(2 ** 53) + 1 : 0
    : signed ? -(2 ** (bitLength - 1)) : 0;
  const upperBound = bitLength === 64
    ? 2 ** 53 - 1
    : signed ? 2 ** (bitLength - 1) - 1 : 2 ** bitLength - 1;

  if (hasExtendedAttribute(extendedAttributes, 'EnforceRange')) {
    if (!Number.isFinite(number)) {
      throwTypeError(context, 'Integer is not finite');
    }
    number = Math.trunc(number);
    if (number < lowerBound || number > upperBound) {
      throwTypeError(context, 'Integer is outside the accepted range');
    }
    return number;
  }

  if (!Number.isNaN(number) && hasExtendedAttribute(extendedAttributes, 'Clamp')) {
    number = Math.min(Math.max(number, lowerBound), upperBound);
    return roundToEven(number);
  }

  if (!Number.isFinite(number) || number === 0) return 0;
  const integer = BigInt(Math.trunc(number));
  return Number(signed
    ? BigInt.asIntN(bitLength, integer)
    : BigInt.asUintN(bitLength, integer));
}

// Shared JavaScript-to-IDL conversions from Web IDL §3.2.5 float and §3.2.6 unrestricted float.
function convertToFloat(
  value: unknown,
  unrestricted: boolean,
  context: ConversionContext,
): number {
  const number = toNumber(value);
  if (!unrestricted && !Number.isFinite(number)) {
    throwTypeError(context, 'Value is not a finite float');
  }
  const rounded = Math.fround(number);
  if (!unrestricted && !Number.isFinite(rounded)) {
    throwTypeError(context, 'Value is outside the float range');
  }
  return rounded;
}

// Project helper: test whether a value implements the candidate interface type.
function isImplementedInterfaceType(
  candidate: UnionInterfaceCandidate,
  value: unknown,
  context: ConversionContext,
): boolean {
  if ('assembled' in candidate) {
    const record = getPlatformRecord(value);
    return record?.binding.world === context.binding.world &&
      record.implements(candidate.assembled);
  }
  return candidate.proxy.is(value);
}

// Project helper: resolve the callback object's associated realm.
function getCallbackRealm(
  value: object,
  context: ConversionContext,
): WebIDLRealm {
  return getPlatformRecord(value)?.realm ??
    context.realm.callbacks.getAssociatedRealm(value);
}

// Recognize Map-backed record values, including Maps from another realm.
function isMap(value: unknown): value is Map<string, unknown> {
  return isObject(value) && hasMapData(value);
}

// Extracted from Web IDL §3.2.4.9 Abstract operations — ConvertToInt's [Clamp] rounding step.
function roundToEven(value: number): number {
  const lower = Math.floor(value);
  const difference = value - lower;
  if (difference < 0.5) return lower === 0 ? 0 : lower;
  if (difference > 0.5) return lower + 1;
  const result = lower % 2 === 0 ? lower : lower + 1;
  return result === 0 ? 0 : result;
}

// Project helper: create a conversion failure in the selected realm.
function throwTypeError(
  context: ConversionContext,
  message: string,
): never {
  throw new context.realm.intrinsics.typeError(message);
}

function throwConversionError(error: unknown, context: ConversionContext): never {
  if (InternalTypeError.is(error)) throw new context.realm.intrinsics.typeError(error.message);
  if (InternalRangeError.is(error)) throw new context.realm.intrinsics.rangeError(error.message);
  if (InternalSyntaxError.is(error)) throw new context.realm.intrinsics.syntaxError(error.message);
  throw error;
}

// Project helper: report a conversion that has not been implemented.
function unsupportedConversion(type: string): never {
  throw new InternalError(`Web IDL conversion for ${type} is not implemented`);
}

// Web IDL §3.2.4 Integer types — bit lengths and signedness supplied to ConvertToInt.
const integerTypes: Partial<Record<
  SimpleTypeName,
  { bitLength: number; signed: boolean; }
>> = {
  byte: { bitLength: 8, signed: true },
  octet: { bitLength: 8, signed: false },
  short: { bitLength: 16, signed: true },
  'unsigned short': { bitLength: 16, signed: false },
  long: { bitLength: 32, signed: true },
  'unsigned long': { bitLength: 32, signed: false },
  'long long': { bitLength: 64, signed: true },
  'unsigned long long': { bitLength: 64, signed: false },
};

const bufferTypeNames = new Set<SimpleTypeName>([
  'ArrayBuffer', 'SharedArrayBuffer', ...bufferViewNames,
]);

// https://webidl.spec.whatwg.org/#es-type-mapping
// The generic converter and prepared inputs use the same conversion algorithms.
const simpleIDLConverters: Partial<Record<SimpleTypeName, (
  value: unknown,
  extendedAttributes: ExtendedAttribute[],
  context: ConversionContext,
) => unknown>> = {
  any: (value) => value,
  undefined: () => undefined,
  boolean: (value) => Boolean(value),
  float: (value, _attributes, context) => convertToFloat(value, false, context),
  'unrestricted float': (value, _attributes, context) => convertToFloat(value, true, context),
  double(value, _attributes, context) {
    const number = toNumber(value);
    if (!Number.isFinite(number)) throwTypeError(context, 'Value is not a finite double');
    return number;
  },
  'unrestricted double': (value) => toNumber(value),
  bigint: (value) => toBigInt(value),
  DOMString(value, attributes) {
    if (value === null && hasExtendedAttribute(attributes, 'LegacyNullToEmptyString')) return '';
    return toString(value);
  },
  ByteString(value, _attributes, context) {
    const string = toString(value);
    for (let i = 0; i < string.length; i++) {
      if (string.charCodeAt(i) > 255) throwTypeError(context, 'Value is not a ByteString');
    }
    return string;
  },
  USVString(value, attributes) {
    if (value === null && hasExtendedAttribute(attributes, 'LegacyNullToEmptyString')) return toScalarValueString('');
    return toScalarValueString(toString(value));
  },
  object(value, _attributes, context) {
    if (!isObject(value)) throwTypeError(context, 'Value is not an object');
    return value;
  },
  symbol(value, _attributes, context) {
    if (typeof value !== 'symbol') throwTypeError(context, 'Value is not a symbol');
    return value;
  },
};
