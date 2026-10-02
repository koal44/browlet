import { toScalarValueString } from '../infra/index';
import {
  bufferViewNames, getBufferTypeName, getMethod, hasMapData, hasStringData, isObject, toBigInt,
  toNumber, toPrimitive, toString, type ByteSequence, type JSMethod,
} from '../js-engine/index';
import { InternalPromise, type PromiseResult } from '../infra/promises';
import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError,
  TypeError as InternalTypeError,
} from '../infra/exceptions';
import type { ConversionType, DefinitionAssembly, UnionInterfaceCandidate } from './assembly';
import type { AssembledCallbackFunction, AssembledDictionary, AssembledEnumeration, AssembledInterface } from './assembled';
import { AsyncSequenceCarrier } from './async-sequence';
import { CallbackFunctionCarrier, CallbackInterfaceCarrier, CallbackFunctionStamper } from './callback';
import { jsToIDLBufferSource, idlBufferSourceToJS } from './buffer-source';
import { hasExtendedAttribute } from './core/helpers';
import type {
  BufferTypeName, DefaultValue, ExtendedAttribute, ImplementationType,
  RecordType, SimpleTypeName, UnionType, WebIDLType,
} from './core/types';
import type { WebIDLRealm } from './realm';
import type { RealmBinding } from './realm-binding';
import { getPlatformRecord } from './platform-object';
import { PromiseCarrier } from './promise';
import { defineDataProperty } from './property';
import { InternalError } from '../infra/internal-error';

/** Validate/coerce an author value to IDL; a concrete descriptor retains its known result type. */
// https://webidl.spec.whatwg.org/#js-type-mapping
export function jsToIDL<Type extends WebIDLType>(
  value: unknown,
  type: Type,
  context: ConversionContext,
  options?: ConversionOptions,
): IDLValue<Type>;
export function jsToIDL(
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
    return jsToIDLValue(
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

/** Prepare author-to-IDL conversion for a fixed type; each invocation supplies its conversion realm. */
export function createJSToIDLConverter<Type extends WebIDLType>(
  type: Type,
  assembly: DefinitionAssembly,
  options?: ConversionOptions,
): ValueConverter<IDLValue<Type>>;
export function createJSToIDLConverter(
  type: WebIDLType,
  assembly: DefinitionAssembly,
  options: ConversionOptions = {},
): ValueConverter {
  const convert = createJSToIDLValueConverter(type, assembly, options);
  return (value, context) => {
    try {
      return convert(value, context);
    } catch (error) {
      return throwConversionError(error, context);
    }
  };
}

// Retain type decisions without capturing a realm: borrowed calls still supply
// the method's conversion context, including when nested dictionary members fail.
function createJSToIDLValueConverter(
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
  const callbackAssembled = resolved.kind === 'reference' ? assembly.callbackFunctions.get(resolved.name) : undefined;
  let convert: ValueConverter;
  if (resolved.kind === 'simple') {
    const integer = integerTypes[resolved.name];
    const simple = jsToSimpleIDLConverters[resolved.name];
    convert = integer
      ? (value, context) => convertToInteger(
        value, integer.bitLength, integer.signed, conversion.extendedAttributes, context,
      )
      : simple
        ? (value, context) => simple(value, conversion.extendedAttributes, context)
        : (value, context) => jsToSimpleIDL(
          value, resolved.name, conversion.extendedAttributes, context,
        );
  } else if (interfaceAssembled) {
    convert = (value, context) => jsToIDLInterface(value, interfaceAssembled, context);
  } else if (enumerationAssembled) {
    convert = (value, context) => jsToIDLEnumeration(value, enumerationAssembled, context);
  } else if (dictionaryAssembled) {
    convert = (value, context) => jsToIDLDictionary(value, dictionaryAssembled, context);
  } else if (callbackAssembled) {
    convert = (value, context) => jsToIDLCallbackFunction(value, callbackAssembled, context, legacyCallbackAttribute);
  } else {
    convert = (value, context) => jsToIDLByType(
      value, conversion, context, [], legacyCallbackAttribute,
    );
  }
  return legacyCallbackAttribute
    ? (value, context) => isObject(value) ? convert(value, context) : null
    : convert;
}

/** Convert an IDL value to its author-facing representation, projecting implementation objects as needed. */
// https://webidl.spec.whatwg.org/#js-type-mapping
export function idlToJS(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  allocateBuffers = false,
): unknown {
  return idlToJSValue(value, type, context, [], allocateBuffers);
}

/** Select a fixed result type's conversion once while retaining the invocation's allocation realm. */
export function createIDLToJSConverter(
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
  return (value, context) => idlToJSByType(value, conversion, context, [], allocateBuffers);
}

/** Convert arbitrary input to a result fixed by the prepared descriptor. */
export type ValueConverter<Result = unknown> = (value: unknown, context: ConversionContext) => Result;

// Implementation payload types describe the final representation, not intermediate
// conversion carriers. Use them only where those representations coincide. A name alone
// needs the runtime assembly, and a fully dynamic WebIDLType can denote any.
type IDLValue<Type extends WebIDLType> =
  WebIDLType extends Type ? unknown
    : Type extends { kind: 'annotated'; type: infer Inner extends WebIDLType; } ? IDLValue<Inner>
      : Type extends { kind: 'simple' | 'interface'; } ? PromiseResult<Type>
        : Type extends { kind: 'sequence'; } ? IDLSequenceValue
          : Type extends { kind: 'record'; } ? IDLRecordValue
            : Type extends { kind: 'promise'; } ? PromiseCarrier
              : Type extends { kind: 'async-sequence'; } ? AsyncSequenceCarrier
                : Type extends { kind: 'frozen-array'; } ? readonly unknown[]
                  : unknown;

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
    sequence.push(jsToIDL(
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
  return Object.freeze(idlSequenceToJS(
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
      return jsToIDL(Number(integer), type, context);
    }
    case 'decimal':
      return jsToIDL(Number(value.value), type, context);
    case 'positive-infinity':
      return jsToIDL(Infinity, type, context);
    case 'negative-infinity':
      return jsToIDL(-Infinity, type, context);
    case 'not-a-number':
      return jsToIDL(NaN, type, context);
    case 'undefined':
      return undefined;
    case 'empty-sequence':
      return [];
    case 'empty-dictionary':
      return jsToIDL(undefined, type, context);
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

/** Select implementation ownership separately from ordinary allocation and conversion errors. */
export type ConversionContext = {
  /** Binding machinery and owner for projected implementations and internal exception requests. */
  binding: RealmBinding;
  /** Realm for ordinary result objects and new conversion errors; may differ from binding.realm. */
  realm: WebIDLRealm;
};

export type ConversionOptions = {
  attributeAssignment?: boolean;
};

/** Converted dictionary members with the declaration needed for subsequent conversion. */
// https://webidl.spec.whatwg.org/#idl-dictionaries
// SPEC_MISMATCH: dictionary value = ordered map from member names to values
export class DictionaryCarrier {
  /** Declared member types, including members that may contain nested carriers. */
  assembled: AssembledDictionary;
  /** Converted member payload, consumed in place by implementation conversion. */
  record: Record<string, unknown>;

  constructor(assembled: AssembledDictionary, record: Record<string, unknown>) {
    this.assembled = assembled;
    this.record = record;
  }
}

export type IDLRecordValue = Map<string, unknown>;
export type IDLSequenceValue = unknown[];

// Project dispatcher for Web IDL §3.2 JavaScript type mapping — JavaScript-to-IDL conversions.
function jsToIDLValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
  legacyCallbackAttribute = false,
): unknown {
  return jsToIDLByType(
    value,
    context.binding.assembly.getConversionType(type),
    context,
    extendedAttributes,
    legacyCallbackAttribute,
  );
}

// Project dispatcher: convert a JavaScript value using its resolved type and retained extended attributes.
function jsToIDLByType(
  value: unknown,
  { type, extendedAttributes }: ConversionType,
  context: ConversionContext,
  inheritedAttributes: ExtendedAttribute[],
  legacyCallbackAttribute = false,
): unknown {
  if (inheritedAttributes.length) extendedAttributes = [...inheritedAttributes, ...extendedAttributes];
  switch (type.kind) {
    case 'simple':
      return jsToSimpleIDL(
        value,
        type.name,
        extendedAttributes,
        context,
      );
    case 'reference':
      return jsToNamedIDL(
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
      return jsToIDLValue(
        value,
        type.type,
        context,
        extendedAttributes,
        legacyCallbackAttribute,
      );
    case 'union':
      return jsToIDLUnion(
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
      return jsToIDLRecord(value, type, context);
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
      return PromiseCarrier.fromJS(value, type.type, context.realm, context.binding.realizeException);
    case 'async-sequence':
      return AsyncSequenceCarrier.fromJS(value, type, context.realm);
    case 'observable-array':
      return unsupportedConversion(type.kind);
  }
}

// Project dispatcher for Web IDL §3.2 JavaScript type mapping — IDL-to-JavaScript conversions.
function idlToJSValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
  allocateBuffers = false,
): unknown {
  return idlToJSByType(
    value,
    context.binding.assembly.getConversionType(type),
    context,
    extendedAttributes,
    allocateBuffers,
  );
}

// Project dispatcher: convert an IDL value using its resolved type and retained extended attributes.
function idlToJSByType(
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
      return simpleIDLToJS(value, type.name, context, allocateBuffers);
    case 'reference':
      return namedIDLToJS(
        value,
        type.name,
        context,
      );
    // Web IDL §3.2.20 Nullable types — IDL-to-JavaScript conversion.
    case 'nullable':
      if (value === null) return null;
      return idlToJSValue(
        value,
        type.type,
        context,
        extendedAttributes,
        allocateBuffers,
      );
    case 'union':
      return idlUnionToJS(
        value,
        type,
        context,
        extendedAttributes,
        allocateBuffers,
      );
    case 'sequence':
      return idlSequenceToJS(
        value,
        type.type,
        context,
      );
    case 'record':
      return idlRecordToJS(
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
      if (PromiseCarrier.is(value)) return value.promise;
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
      if (!AsyncSequenceCarrier.is(value)) {
        throw new InternalError('IDL async sequence is not an async sequence carrier');
      }
      return value.object;
    case 'observable-array':
      return unsupportedConversion(type.kind);
  }
}

// Shared implementation of the simple-type conversions in Web IDL §3.2 JavaScript type mapping.
function jsToSimpleIDL(
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
    return jsToIDLBufferSource(
      value,
      name as BufferTypeName,
      extendedAttributes,
    );
  }

  const convert = jsToSimpleIDLConverters[name];
  if (!convert) return unsupportedConversion(name);
  return convert(value, extendedAttributes, context);
}

// Shared simple-type IDL-to-JavaScript conversion rules from Web IDL §3.2 JavaScript type mapping.
function simpleIDLToJS(
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
    return idlBufferSourceToJS(value, bufferName);
  }
  return name === 'undefined' ? undefined : value;
}

// Project dispatcher for named types in Web IDL §3.2 JavaScript type mapping.
function jsToNamedIDL(
  value: unknown,
  name: string,
  context: ConversionContext,
  legacyCallbackAttribute: boolean,
): unknown {
  const assembly = context.binding.assembly;
  const assembled = assembly.interfaces.get(name);
  if (assembled) return jsToIDLInterface(value, assembled, context);

  const dictionaryAssembled = assembly.dictionaries.get(name);
  if (dictionaryAssembled) return jsToIDLDictionary(value, dictionaryAssembled, context);

  const enumerationAssembled = assembly.enumerations.get(name);
  if (enumerationAssembled) return jsToIDLEnumeration(value, enumerationAssembled, context);

  const callbackFunctionAssembled = assembly.callbackFunctions.get(name);
  if (callbackFunctionAssembled) {
    return jsToIDLCallbackFunction(value, callbackFunctionAssembled, context, legacyCallbackAttribute);
  }

  const callbackInterfaceAssembled = assembly.callbackInterfaces.get(name);
  if (callbackInterfaceAssembled) {
    if (!isObject(value)) return throwTypeError(context, `${name} is not an object`);
    return new CallbackInterfaceCarrier(
      callbackInterfaceAssembled,
      value,
      getCallbackRealm(value, context),
      context.realm.callbacks.captureContext(),
      context.binding,
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
function jsToIDLInterface(value: unknown, assembled: AssembledInterface, context: ConversionContext): object {
  const record = getPlatformRecord(value);
  if (
    record?.binding.world === context.binding.world &&
    record.implements(assembled)
  ) return record.implInst;
  return throwTypeError(context, `Value does not implement ${assembled.name}`);
}

// https://webidl.spec.whatwg.org/#es-enumeration
function jsToIDLEnumeration(value: unknown, assembled: AssembledEnumeration, context: ConversionContext): string {
  const string = toString(value);
  if (!assembled.hasValue(string)) {
    throwTypeError(context, `${string} is not a value of ${assembled.primary.name}`);
  }
  return string;
}

// Project adapter for named IDL values in Web IDL §3.2 JavaScript type mapping.
function namedIDLToJS(
  value: unknown,
  name: string,
  context: ConversionContext,
): unknown {
  const assembly = context.binding.assembly;
  const assembled = assembly.interfaces.get(name);
  if (assembled) return projectInterface(value, assembled, context);

  const dictionaryAssembled = assembly.dictionaries.get(name);
  if (dictionaryAssembled) return idlDictionaryToJS(value, dictionaryAssembled, context);
  if (assembly.enumerations.has(name)) return value;

  if (assembly.callbackFunctions.has(name)) {
    // Result projection accepts retained IDL callbacks and callables returned by implementations.
    if (typeof value === 'function') return CallbackFunctionStamper.getObject(value);
    if (CallbackFunctionCarrier.is(value)) return value.object;
    throw new InternalError(`IDL callback function ${name} is not callable`);
  }
  if (assembly.callbackInterfaces.has(name)) {
    if (!CallbackInterfaceCarrier.is(value)) {
      throw new InternalError(`IDL callback interface ${name} is not a callback carrier`);
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
function jsToIDLDictionary(
  value: unknown,
  assembled: AssembledDictionary,
  context: ConversionContext,
): DictionaryCarrier {
  return context.binding.getDictionaryConverter(assembled)(value, context);
}

/** Prepare member conversions once; each call reads the current author object. */
export function createDictionaryConverter(
  assembled: AssembledDictionary,
  assembly: DefinitionAssembly,
): DictionaryConverter {
  const members = assembled.members.map((member) => ({
    member,
    convert: createJSToIDLValueConverter(member.type, assembly),
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
    return new DictionaryCarrier(assembled, entries ? Object.fromEntries(entries) : record);
  };
}

export type DictionaryConverter = ValueConverter<DictionaryCarrier>;

// Web IDL §3.2.17 Dictionary types — convert a dictionary to a JavaScript value.
function idlDictionaryToJS(
  value: unknown,
  assembled: AssembledDictionary,
  context: ConversionContext,
): object {
  if (!isObject(value)) {
    throw new InternalError(`IDL dictionary ${assembled.primary.name} is not an object`);
  }
  const members = value instanceof DictionaryCarrier ? value.record : value as Record<string, unknown>;

  const result = context.realm.createOrdinaryObject(
    context.realm.intrinsics.objectPrototype,
  );
  for (const member of assembled.members) {
    if (!Object.hasOwn(members, member.name)) continue;
    defineDataProperty(
      result,
      member.name,
      idlToJS(members[member.name], member.type, context),
    );
  }
  return result;
}

// Web IDL §3.2.23 Records — convert a JavaScript value to a record.
function jsToIDLRecord(
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
    const typedKey = jsToIDL(key, type.key, context);
    const typedValue = jsToIDL(
      (value as Record<PropertyKey, unknown>)[key],
      type.value,
      context,
    );
    result.set(typedKey, typedValue);
  }
  return result;
}

// Web IDL §3.2.23 Records — convert a record to a JavaScript value.
function idlRecordToJS(
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
    const jsKey = idlToJS(key, keyType, context);
    const jsValue = idlToJS(entryValue, valueType, context);
    defineDataProperty(result, jsKey as PropertyKey, jsValue);
  }
  return result;
}

// Web IDL §3.2.21 Sequences — convert a sequence to a JavaScript value.
function idlSequenceToJS(
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
      idlToJS(value[i], elementType, context),
    );
  }
  return result;
}

// Web IDL §3.2.25 Union types — convert a JavaScript value to a union.
function jsToIDLUnion(
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
    if (assembled) return jsToIDLDictionary(value, assembled, context);
  }

  if (isPlatformObject(value, context)) {
    const interfaceType = candidates.interfaces.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interfaceType) {
      return jsToIDLByType(value, interfaceType.type, context, extendedAttributes);
    }
    if (candidates.simpleTypes.has('object')) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName) {
      const buffer = candidates.simpleTypes.get(bufferName);
      if (buffer) return jsToIDLByType(value, buffer, context, extendedAttributes);
      if (candidates.simpleTypes.has('object')) return value;
    }
  }

  if (typeof value === 'function') {
    const assembled = candidates.callbackFunction;
    if (assembled) {
      return new CallbackFunctionCarrier(
        assembled, value, getCallbackRealm(value, context), context.realm.callbacks.captureContext(), context.binding,
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
        return new AsyncSequenceCarrier(value, asyncSequence.type.type, asyncMethod, 'async');
      }
      const syncMethod = getMethod(value, Symbol.iterator, context.realm);
      if (syncMethod && asyncSequence.type.kind === 'async-sequence') {
        return new AsyncSequenceCarrier(value, asyncSequence.type.type, syncMethod, 'sync');
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
        return jsToIDLByType(
          value,
          frozenArray,
          context,
          extendedAttributes,
        );
      }
    }

    const dictionaryAssembled = candidates.dictionary;
    if (dictionaryAssembled) return jsToIDLDictionary(value, dictionaryAssembled, context);
    const record = candidates.typesByKind.get('record');
    if (record) return jsToIDLByType(value, record, context, extendedAttributes);
    const callbackInterfaceAssembled = candidates.callbackInterface;
    if (callbackInterfaceAssembled) {
      return new CallbackInterfaceCarrier(
        callbackInterfaceAssembled,
        value,
        getCallbackRealm(value, context),
        context.realm.callbacks.captureContext(),
        context.binding,
      );
    }
    if (candidates.simpleTypes.has('object')) return value;
  }

  if (typeof value === 'boolean') {
    if (candidates.simpleTypes.has('boolean')) return value;
  }
  if (typeof value === 'number') {
    const numeric = candidates.numeric;
    if (numeric) return jsToIDLByType(value, numeric, context, extendedAttributes);
  }
  if (typeof value === 'bigint') {
    if (candidates.simpleTypes.has('bigint')) return value;
  }

  const string = candidates.string;
  if (string) return jsToIDLByType(value, string, context, extendedAttributes);

  const numeric = candidates.numeric;
  const bigint = candidates.simpleTypes.has('bigint');
  if (numeric && bigint) {
    const primitive = toPrimitive(value, 'number');
    return typeof primitive === 'bigint'
      ? primitive
      : jsToIDLByType(primitive, numeric, context, extendedAttributes);
  }
  if (numeric) return jsToIDLByType(value, numeric, context, extendedAttributes);

  if (candidates.simpleTypes.has('boolean')) return Boolean(value);
  if (bigint) return toBigInt(value);
  return throwTypeError(context, 'Value cannot be converted to the union type');
}

// Project adapter for Web IDL §3.2.25 Union types — identify our value's specific type, then convert it.
function idlUnionToJS(
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
  if (candidates.callbackFunction) {
    // A callback is only one possible union member; the value selects the branch.
    if (typeof value === 'function') return CallbackFunctionStamper.getObject(value);
    if (CallbackFunctionCarrier.is(value)) return value.object;
  }
  if (CallbackInterfaceCarrier.is(value)) {
    const assembled = candidates.callbackInterface;
    if (assembled) return value.object;
  }
  if (AsyncSequenceCarrier.is(value)) {
    const sequence = candidates.typesByKind.get('async-sequence');
    if (sequence) return idlToJSByType(value, sequence, context, extendedAttributes);
  }
  if (Array.isArray(value)) {
    const array = candidates.array;
    if (array) return idlToJSByType(value, array, context, extendedAttributes);
  }
  if (value instanceof DictionaryCarrier) {
    const assembled = candidates.dictionary;
    if (assembled) return idlDictionaryToJS(value, assembled, context);
  }
  if (isMap(value)) {
    const record = candidates.typesByKind.get('record');
    if (record) return idlToJSByType(value, record, context, extendedAttributes);
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
    if (buffer) return idlToJSByType(value, buffer, context, extendedAttributes, allocateBuffers);
    if (candidates.dictionary) return idlDictionaryToJS(value, candidates.dictionary, context);
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

// https://webidl.spec.whatwg.org/#es-callback-function
function jsToIDLCallbackFunction(
  value: unknown,
  assembled: AssembledCallbackFunction,
  context: ConversionContext,
  legacyCallbackAttribute: boolean,
): CallbackFunctionCarrier {
  if (typeof value !== 'function' && !(legacyCallbackAttribute && isObject(value))) {
    return throwTypeError(context, `${assembled.primary.name} is not callable`);
  }
  return new CallbackFunctionCarrier(
    assembled, value, getCallbackRealm(value, context), context.realm.callbacks.captureContext(), context.binding,
  );
}

// Resolve the callback object's associated realm for this conversion.
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
const jsToSimpleIDLConverters: Partial<Record<SimpleTypeName, (
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
