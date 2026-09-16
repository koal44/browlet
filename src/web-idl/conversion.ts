import { toScalarValueString } from '../infra/index';
import {
  bufferViewNames, getBufferTypeName, getMethod, hasMapData, hasStringData, isObject, PromiseValue,
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError, TypeError as InternalTypeError,
  toBigInt, toNumber, toPrimitive, toString, type ByteSequence, type JSMethod,
} from '../js-engine/index';
import type { AssembledDictionaryDefinition, DefinitionAssembly } from './assembly';
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
  AnnotatedType, BufferTypeName, DefaultValue, ExtendedAttribute,
  RecordType, SimpleTypeName, UnionType, WebIDLType,
} from './core/types';
import type { WebIDLRealmHost } from './realm-host';
import type { RealmBinding } from './realm-binding';
import { getPlatformRecord, type StampedPlatformObject } from './platform-object';
import {
  convertJavaScriptValueToPromise, createIDLPromiseRecord, isIDLPromiseRecord,
  PromiseProjectionStamper, type PromiseSource,
} from './promise-record';
import { defineDataProperty } from './property';
import {
  getTypeWithApplicableExtendedAttributes, includesNullableType,
  getUnannotatedType, includesUndefined,
} from './types';

// Project entry point for Web IDL §3.2 JavaScript type mapping; realizes realm-owned failures.
export function convertToIDL(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  options: ConversionOptions = {},
): unknown {
  const legacyCallbackAttribute = options.attributeAssignment === true &&
    isNullableLegacyCallback(type, context.binding.definitions);
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
    if (InternalTypeError.is(error)) throw new context.realm.intrinsics.typeError(error.message);
    if (InternalRangeError.is(error)) throw new context.realm.intrinsics.rangeError(error.message);
    if (InternalSyntaxError.is(error)) throw new context.realm.intrinsics.syntaxError(error.message);
    throw error;
  }
}

// Project entry point for Web IDL §3.2 JavaScript type mapping — IDL-to-JavaScript conversion.
export function convertToJavaScript(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): unknown {
  return convertIDLValue(value, type, context, []);
}

// Project adapter: preserve projected promise identity and convert fulfillment values into the target realm.
/** Project an implementation promise into its declared result type and realm. */
export function projectPromise(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  newBufferResult = false,
): Promise<unknown> {
  // Web IDL §3.2.24 — an existing capability converts to its Promise field.
  if (isIDLPromiseRecord(value)) return value.promise;
  const source = value as PromiseSource;
  let projections = PromiseProjectionStamper.get(source);
  const existing = projections?.find((entry) =>
    entry.world === context.binding.world &&
    entry.record.realm === context.realm && entry.record.type === type &&
    entry.newBufferResult === newBufferResult);
  if (existing) return existing.record.promise;

  const record = createIDLPromiseRecord(type, context.realm, context.binding.realizeException);
  if (!projections) {
    projections = [];
    void PromiseProjectionStamper.stamp(source, projections);
  }
  projections.push({ world: context.binding.world, record, newBufferResult });
  // These callbacks adapt implementation state; author reactions still run
  // through the projected promise's own realm and queue.
  const onFulfilled = (result: unknown): void => {
    try {
      const resolution = newBufferResult
        ? createBufferResult(result as ByteSequence, type, context)
        : result;
      record.resolve(isIDLPromiseRecord(resolution)
        ? resolution.promise
        : convertToJavaScript(resolution, type, context));
    } catch (error) {
      record.reject(error);
    }
  };
  try {
    if (source instanceof PromiseValue) {
      context.realm.promises.import(source).observe(onFulfilled, record.reject);
    } else {
      context.realm.observePromise(source, onFulfilled, record.reject);
    }
  } catch (error) {
    record.reject(error);
  }
  return record.promise;
}

// Project helper: allocate a fresh buffer result of the declared type in the target realm.
export function createBufferResult(
  bytes: ByteSequence,
  type: WebIDLType,
  context: ConversionContext,
): ArrayBufferLike | ArrayBufferView {
  const resultType = getUnannotatedType(type, context.binding.definitions);
  if (resultType.kind !== 'simple' || !bufferTypeNames.has(resultType.name)) {
    throw new TypeError('newBufferResult requires a buffer source return type');
  }
  const name = resultType.name as BufferTypeName;
  if (name === 'ArrayBuffer') return context.realm.createArrayBuffer(bytes);
  if (name === 'SharedArrayBuffer') return context.realm.createSharedArrayBuffer(bytes);
  return context.realm.createArrayBufferView(name, bytes);
}

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
    if (Reflect.get(result, 'done')) return sequence;
    sequence.push(convertToIDL(
      Reflect.get(result, 'value'),
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
  for (const hostInterface of context.binding.hostDefinedInterfaces.values()) {
    if (hostInterface.is(value)) return true;
  }
  return false;
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
      const integer = parseBigInteger(value.value);
      const numericType = getSoleNumericTypeName(type, context.binding.definitions);
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

export type ConversionContext = {
  /** Definitions, implementation identity, projection, and internal failures. */
  binding: RealmBinding;
  /** JavaScript allocation and conversion errors; may differ from binding.realm. */
  realm: WebIDLRealmHost;
};

export type HostDefinedInterface = {
  is(value: unknown): boolean;
  name: string;
  /*
   * Some host-defined exotic objects expose another platform object's Web IDL
   * members without themselves being registered as that platform object.
   * Resolve such a value only when it is used as an interface-member receiver;
   * this hook does not participate in ordinary Web IDL value conversion.
   * WindowProxy is the motivating and currently sole Browlet case.
   */
  resolveReceiver?(value: unknown): object | undefined;
};

export type ConversionOptions = {
  attributeAssignment?: boolean;
};

export type IDLDictionaryValue = Map<string, unknown>;
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
  return convertJavaScriptValueByEffectiveType(
    value,
    resolveEffectiveType(type, context.binding.definitions, extendedAttributes),
    context,
    legacyCallbackAttribute,
  );
}

// Project dispatcher: convert a JavaScript value using its resolved type and retained extended attributes.
function convertJavaScriptValueByEffectiveType(
  value: unknown,
  { type, extendedAttributes }: EffectiveType,
  context: ConversionContext,
  legacyCallbackAttribute = false,
): unknown {
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
        includesUndefined(type.type, context.binding.definitions)
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
): unknown {
  return convertIDLValueByEffectiveType(
    value,
    resolveEffectiveType(type, context.binding.definitions, extendedAttributes),
    context,
  );
}

// Project dispatcher: convert an IDL value using its resolved type and retained extended attributes.
function convertIDLValueByEffectiveType(
  value: unknown,
  { type, extendedAttributes }: EffectiveType,
  context: ConversionContext,
): unknown {
  // Realize internal exceptions before exposing them, including as callback arguments.
  value = context.binding.realizeException(value);
  switch (type.kind) {
    case 'simple':
      return convertSimpleTypeToJavaScript(value, type.name);
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
      );
    case 'union':
      return convertUnionToJavaScript(
        value,
        type,
        context,
        extendedAttributes,
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
      return projectPromise(value, type.type, context);
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

  switch (name) {
    // Web IDL §3.2.1 any — JavaScript-to-IDL conversion.
    case 'any':
      return value;
    // Web IDL §3.2.2 undefined — JavaScript-to-IDL conversion.
    case 'undefined':
      return undefined;
    // Web IDL §3.2.3 boolean — JavaScript-to-IDL conversion.
    case 'boolean':
      return Boolean(value);
    // Web IDL §3.2.5 float — JavaScript-to-IDL conversion.
    case 'float':
      return convertToFloat(value, false, context);
    // Web IDL §3.2.6 unrestricted float — JavaScript-to-IDL conversion.
    case 'unrestricted float':
      return convertToFloat(value, true, context);
    // Web IDL §3.2.7 double — JavaScript-to-IDL conversion.
    case 'double': {
      const number = toNumber(value);
      if (!Number.isFinite(number)) {
        throwTypeError(context, 'Value is not a finite double');
      }
      return number;
    }
    // Web IDL §3.2.8 unrestricted double — JavaScript-to-IDL conversion.
    case 'unrestricted double':
      return toNumber(value);
    // Web IDL §3.2.9 bigint — JavaScript-to-IDL conversion.
    case 'bigint':
      return toBigInt(value);
    // Web IDL §3.2.10 DOMString — JavaScript-to-IDL conversion.
    case 'DOMString':
      if (
        value === null &&
        hasExtendedAttribute(extendedAttributes, 'LegacyNullToEmptyString')
      ) return '';
      return toString(value);
    // Web IDL §3.2.11 ByteString — JavaScript-to-IDL conversion.
    case 'ByteString': {
      const string = toString(value);
      for (let i = 0; i < string.length; i++) {
        if (string.charCodeAt(i) > 255) {
          throwTypeError(context, 'Value is not a ByteString');
        }
      }
      return string;
    }
    // Web IDL §3.2.12 USVString — JavaScript-to-IDL conversion.
    case 'USVString':
      if (
        value === null &&
        hasExtendedAttribute(extendedAttributes, 'LegacyNullToEmptyString')
      ) return toScalarValueString('');
      return toScalarValueString(toString(value));
    // Web IDL §3.2.13 object — JavaScript-to-IDL conversion.
    case 'object':
      if (!isObject(value)) {
        throwTypeError(context, 'Value is not an object');
      }
      return value;
    // Web IDL §3.2.14 symbol — JavaScript-to-IDL conversion.
    case 'symbol':
      if (typeof value !== 'symbol') {
        throwTypeError(context, 'Value is not a symbol');
      }
      return value;
    default:
      return unsupportedConversion(name);
  }
}

// Shared simple-type IDL-to-JavaScript conversion rules from Web IDL §3.2 JavaScript type mapping.
function convertSimpleTypeToJavaScript(
  value: unknown,
  name: SimpleTypeName,
): unknown {
  if (bufferTypeNames.has(name)) {
    return convertBufferSourceToJavaScript(value, name as BufferTypeName);
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
  const definition = context.binding.definitions.getDefinition(name);
  switch (definition?.kind) {
    // Web IDL §3.2.18 Enumeration types — JavaScript-to-IDL conversion.
    case 'enumeration': {
      const string = toString(value);
      if (!definition.values.includes(string)) {
        throwTypeError(context, `${string} is not a value of ${name}`);
      }
      return string;
    }
    // Web IDL §3.2.15 Interface types — JavaScript-to-IDL conversion.
    case 'interface': {
      const primaryInterface = context.binding.definitions.getInterface(name);
      const record = getPlatformRecord(value);
      if (
        primaryInterface &&
        record &&
        record.binding.world === context.binding.world &&
        record.implements(primaryInterface)
      ) {
        return record.implInst;
      }
      return throwTypeError(context, `Value does not implement ${name}`);
    }
    case 'dictionary': {
      const dictionary = context.binding.definitions.getDictionary(name);
      if (!dictionary) throw new Error(`Dictionary ${name} was not assembled`);
      return convertJavaScriptValueToDictionary(value, dictionary, context);
    }
    // Web IDL §3.2.19 Callback function types — JavaScript-to-IDL conversion.
    case 'callback-function': {
      if (
        typeof value !== 'function' &&
        !(legacyCallbackAttribute && isObject(value))
      ) {
        return throwTypeError(context, `${name} is not callable`);
      }
      return createCallbackFunctionValue(
        definition,
        value,
        getCallbackRealm(value, context),
        context.realm.callbacks.captureContext(),
        context,
      );
    }
    // Web IDL §3.2.16 Callback interface types — JavaScript-to-IDL conversion.
    case 'callback-interface': {
      if (!isObject(value)) {
        return throwTypeError(context, `${name} is not an object`);
      }
      return createCallbackInterfaceRecord(
        definition,
        value,
        getCallbackRealm(value, context),
        context.realm.callbacks.captureContext(),
        context,
      );
    }
    // Project adapter: convert an interface supplied by the host.
    case undefined: {
      const hostInterface = context.binding.hostDefinedInterfaces.get(name);
      if (hostInterface) {
        return hostInterface.is(value)
          ? value
          : throwTypeError(context, `Value does not implement ${name}`);
      }
      throw new Error(`Unknown Web IDL type ${name}`);
    }
    default:
      throw new Error(`${name} is not a value type`);
  }
}

// Project adapter for named IDL values in Web IDL §3.2 JavaScript type mapping.
function convertNamedTypeToJavaScript(
  value: unknown,
  name: string,
  context: ConversionContext,
): unknown {
  const definition = context.binding.definitions.getDefinition(name);
  switch (definition?.kind) {
    // Web IDL §3.2.18 Enumeration types — IDL-to-JavaScript conversion.
    case 'enumeration':
      return value;
    // Web IDL §3.2.15 Interface types — project our implementation to its platform object.
    case 'interface': {
      const primaryInterface = context.binding.definitions.getInterface(name);
      const object = primaryInterface && isObject(value)
        ? context.binding.projectImplementationObject(value, primaryInterface)
        : undefined;
      if (!object) {
        throw new Error(
          `IDL interface value ${name} is not an implementation target`,
        );
      }
      return object;
    }
    case 'dictionary': {
      const dictionary = context.binding.definitions.getDictionary(name);
      if (!dictionary) throw new Error(`Dictionary ${name} was not assembled`);
      return convertDictionaryToJavaScript(value, dictionary, context);
    }
    // Web IDL §3.2.19 Callback function types — recover the JavaScript callback object.
    case 'callback-function':
      if (isCallbackFunctionValue(value)) return value.object;
      if (typeof value === 'function') return value;
      throw new Error(`IDL callback function ${name} is not callable`);
    // Web IDL §3.2.16 Callback interface types — recover the JavaScript callback object.
    case 'callback-interface':
      if (!isCallbackInterfaceRecord(value)) {
        throw new Error(`IDL callback interface ${name} is not a callback value`);
      }
      return value.object;
    // Project adapter: recover an interface value supplied by the host.
    case undefined: {
      const hostInterface = context.binding.hostDefinedInterfaces.get(name);
      if (hostInterface) {
        if (hostInterface.is(value)) return value;
        throw new Error(`IDL interface value does not implement ${name}`);
      }
      throw new Error(`Unknown Web IDL type ${name}`);
    }
    default:
      throw new Error(`${name} is not a value type`);
  }
}

// Web IDL §3.2.17 Dictionary types — convert a JavaScript value to a dictionary.
function convertJavaScriptValueToDictionary(
  value: unknown,
  dictionary: AssembledDictionaryDefinition,
  context: ConversionContext,
): IDLDictionaryValue {
  if (!isObject(value) && value !== undefined && value !== null) {
    throwTypeError(context, 'A dictionary value must be an object');
  }

  const result: IDLDictionaryValue = new Map();
  for (const member of dictionary.members) {
    const memberType = getTypeWithApplicableExtendedAttributes(
      member.type,
      member.extendedAttributes,
    );
    const memberValue = value === undefined || value === null
      ? undefined
      : Reflect.get(value, member.name) as unknown;

    if (memberValue !== undefined) {
      result.set(
        member.name,
        convertToIDL(memberValue, memberType, context),
      );
    } else if (member.default !== undefined) {
      result.set(
        member.name,
        materializeDefaultValue(member.default, memberType, context),
      );
    } else if (member.required) {
      throwTypeError(context, `Required dictionary member ${member.name} is missing`);
    }
  }
  return result;
}

// Web IDL §3.2.17 Dictionary types — convert a dictionary to a JavaScript value.
function convertDictionaryToJavaScript(
  value: unknown,
  dictionary: AssembledDictionaryDefinition,
  context: ConversionContext,
): object {
  if (!isObject(value)) {
    throw new Error(`IDL dictionary ${dictionary.definition.name} is not an object`);
  }
  const members = isMap(value) ? value : new Map(Object.entries(value));

  const result = context.realm.createOrdinaryObject(
    context.realm.intrinsics.objectPrototype,
  );
  for (const member of dictionary.members) {
    if (!members.has(member.name)) continue;
    const memberType = getTypeWithApplicableExtendedAttributes(
      member.type,
      member.extendedAttributes,
    );
    defineDataProperty(
      result,
      member.name,
      convertToJavaScript(members.get(member.name), memberType, context),
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
      Reflect.get(value, key),
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
  if (!isMap(value)) throw new Error('IDL record is not a map');

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
  if (!Array.isArray(value)) throw new Error('IDL sequence is not an array');

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
  if (value === undefined && includesUndefined(type, context.binding.definitions)) {
    return undefined;
  }
  if (
    (value === null || value === undefined) &&
    includesNullableType(type, context.binding.definitions)
  ) return null;

  const types = flattenEffectiveTypes(
    type,
    context.binding.definitions,
    extendedAttributes,
  );

  if (value === null || value === undefined) {
    const dictionary = types.find((candidate) =>
      isDictionaryType(candidate, context.binding.definitions));
    if (dictionary) return convertJavaScriptValueByEffectiveType(value, dictionary, context);
  }

  if (isPlatformObject(value, context)) {
    const interfaceType = types.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interfaceType) {
      return convertJavaScriptValueByEffectiveType(value, interfaceType, context);
    }
    const object = types.find(isObjectType);
    if (object) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName) {
      const buffer = types.find((candidate) =>
        isSimpleType(candidate, bufferName));
      if (buffer) return convertJavaScriptValueByEffectiveType(value, buffer, context);
      const object = types.find(isObjectType);
      if (object) return value;
    }
  }

  if (typeof value === 'function') {
    const callback = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-function', context.binding.definitions));
    if (callback) return convertJavaScriptValueByEffectiveType(value, callback, context);
    const object = types.find(isObjectType);
    if (object) return value;
  }

  if (isObject(value)) {
    const asyncSequence = types.find((candidate) =>
      candidate.type.kind === 'async-sequence');
    if (asyncSequence && !(
      hasStringData(value) && types.some((candidate) =>
        isStringType(candidate, context.binding.definitions))
    )) {
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

    const sequence = types.find((candidate) => candidate.type.kind === 'sequence');
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

    const frozenArray = types.find((candidate) =>
      candidate.type.kind === 'frozen-array');
    if (frozenArray) {
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (method) {
        return convertJavaScriptValueByEffectiveType(
          value,
          frozenArray,
          context,
        );
      }
    }

    const dictionary = types.find((candidate) =>
      isDictionaryType(candidate, context.binding.definitions));
    if (dictionary) return convertJavaScriptValueByEffectiveType(value, dictionary, context);
    const record = types.find((candidate) => candidate.type.kind === 'record');
    if (record) return convertJavaScriptValueByEffectiveType(value, record, context);
    const callbackInterface = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-interface', context.binding.definitions));
    if (callbackInterface) {
      return convertJavaScriptValueByEffectiveType(value, callbackInterface, context);
    }
    const object = types.find(isObjectType);
    if (object) return value;
  }

  if (typeof value === 'boolean') {
    const boolean = types.find((candidate) => isSimpleType(candidate, 'boolean'));
    if (boolean) return value;
  }
  if (typeof value === 'number') {
    const numeric = types.find(isNumericType);
    if (numeric) return convertJavaScriptValueByEffectiveType(value, numeric, context);
  }
  if (typeof value === 'bigint') {
    const bigint = types.find((candidate) => isSimpleType(candidate, 'bigint'));
    if (bigint) return value;
  }

  const string = types.find((candidate) =>
    isStringType(candidate, context.binding.definitions));
  if (string) return convertJavaScriptValueByEffectiveType(value, string, context);

  const numeric = types.find(isNumericType);
  const bigint = types.find((candidate) => isSimpleType(candidate, 'bigint'));
  if (numeric && bigint) {
    const primitive = toPrimitive(value, 'number');
    return typeof primitive === 'bigint'
      ? primitive
      : convertJavaScriptValueByEffectiveType(primitive, numeric, context);
  }
  if (numeric) return convertJavaScriptValueByEffectiveType(value, numeric, context);

  const boolean = types.find((candidate) => isSimpleType(candidate, 'boolean'));
  if (boolean) return Boolean(value);
  if (bigint) return toBigInt(value);
  return throwTypeError(context, 'Value cannot be converted to the union type');
}

// Project adapter for Web IDL §3.2.25 Union types — identify our value's specific type, then convert it.
function convertUnionToJavaScript(
  value: unknown,
  type: UnionType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
): unknown {
  const types = flattenEffectiveTypes(
    type,
    context.binding.definitions,
    extendedAttributes,
  );

  if (value === undefined) {
    const undefinedType = types.find((candidate) =>
      isSimpleType(candidate, 'undefined'));
    if (undefinedType) return undefined;
  }
  if (value === null && includesNullableType(type, context.binding.definitions)) {
    return null;
  }
  if (isPlatformObject(value, context)) {
    const interfaceType = types.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interfaceType) return value;
    const object = types.find(isObjectType);
    if (object) return value;
  }
  if (isObject(value)) {
    for (const candidate of types) {
      const projected = projectImplementationForType(
        value,
        candidate,
        context,
      );
      if (projected) return projected;
    }
  }
  if (isCallbackFunctionValue(value) || typeof value === 'function') {
    const callback = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-function', context.binding.definitions));
    if (callback) return convertIDLValueByEffectiveType(value, callback, context);
  }
  if (isCallbackInterfaceRecord(value)) {
    const callback = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-interface', context.binding.definitions));
    if (callback) return convertIDLValueByEffectiveType(value, callback, context);
  }
  if (isIDLAsyncSequence(value)) {
    const sequence = types.find((candidate) =>
      candidate.type.kind === 'async-sequence');
    if (sequence) return convertIDLValueByEffectiveType(value, sequence, context);
  }
  if (Array.isArray(value)) {
    const array = types.find((candidate) =>
      candidate.type.kind === 'sequence' ||
      candidate.type.kind === 'frozen-array');
    if (array) return convertIDLValueByEffectiveType(value, array, context);
  }
  if (isMap(value)) {
    const dictionary = types.find((candidate) =>
      isDictionaryType(candidate, context.binding.definitions));
    if (dictionary) return convertIDLValueByEffectiveType(value, dictionary, context);
    const record = types.find((candidate) => candidate.type.kind === 'record');
    if (record) return convertIDLValueByEffectiveType(value, record, context);
  }
  if (typeof value === 'boolean') {
    const boolean = types.find((candidate) => isSimpleType(candidate, 'boolean'));
    if (boolean) return value;
  }
  if (typeof value === 'number') {
    const numeric = types.find(isNumericType);
    if (numeric) return value;
  }
  if (typeof value === 'bigint') {
    const bigint = types.find((candidate) => isSimpleType(candidate, 'bigint'));
    if (bigint) return value;
  }
  if (typeof value === 'string') {
    const string = types.find((candidate) =>
      isStringType(candidate, context.binding.definitions));
    if (string) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    const buffer = bufferName && types.find((candidate) =>
      isSimpleType(candidate, bufferName));
    if (buffer) return convertIDLValueByEffectiveType(value, buffer, context);
    const object = types.find(isObjectType);
    if (object) return value;
  }
  throw new Error('IDL union value has no matching specific type');
}

// Project helper: project an implementation using a candidate interface type.
function projectImplementationForType(
  value: object,
  type: EffectiveType,
  context: ConversionContext,
): StampedPlatformObject | undefined {
  if (type.type.kind !== 'reference') return;
  const primaryInterface = context.binding.definitions.getInterface(type.type.name);
  return primaryInterface && context.binding.projectImplementationObject(value, primaryInterface);
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

// Project helper: follow typedefs while retaining the extended attributes associated with a type.
// Web IDL §2.11 Typedefs; §2.13.33 Annotated types.
function resolveEffectiveType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
  extendedAttributes: ExtendedAttribute[],
): EffectiveType {
  const attributes = [...extendedAttributes];
  let resolved = type;

  while (true) {
    if (resolved.kind === 'annotated') {
      attributes.push(...resolved.extendedAttributes);
      resolved = resolved.type;
      continue;
    }
    if (resolved.kind === 'reference') {
      const definition = definitions.getDefinition(resolved.name);
      if (definition?.kind === 'typedef') {
        resolved = definition.type;
        continue;
      }
    }
    return {
      extendedAttributes: attributes,
      type: resolved,
    };
  }
}

// Project helper: flatten union members while retaining conversion attributes.
// Web IDL §2.13.32 Union types — flattened member types.
function flattenEffectiveTypes(
  type: WebIDLType,
  definitions: DefinitionAssembly,
  extendedAttributes: ExtendedAttribute[],
): EffectiveType[] {
  const resolved = resolveEffectiveType(type, definitions, extendedAttributes);
  if (resolved.type.kind === 'nullable') {
    return flattenEffectiveTypes(
      resolved.type.type,
      definitions,
      resolved.extendedAttributes,
    );
  }
  if (resolved.type.kind === 'union') {
    return resolved.type.types.flatMap((member) =>
      flattenEffectiveTypes(member, definitions, resolved.extendedAttributes));
  }
  return [resolved];
}

// Project helper: test whether a value implements the candidate interface type.
function isImplementedInterfaceType(
  type: EffectiveType,
  value: unknown,
  context: ConversionContext,
): boolean {
  if (type.type.kind !== 'reference') return false;
  const primaryInterface = context.binding.definitions.getInterface(type.type.name);
  if (primaryInterface) {
    const record = getPlatformRecord(value);
    return record?.binding.world === context.binding.world &&
      record.implements(primaryInterface);
  }
  return context.binding.hostDefinedInterfaces.get(type.type.name)?.is(value) ?? false;
}

// Project helper: recognize a named callback definition in a resolved type.
function isDefinitionType(
  type: EffectiveType,
  kind: 'callback-function' | 'callback-interface',
  definitions: DefinitionAssembly,
): boolean {
  return type.type.kind === 'reference' &&
    definitions.getDefinition(type.type.name)?.kind === kind;
}

// Project helper: recognize a named dictionary in a resolved type.
function isDictionaryType(
  type: EffectiveType,
  definitions: DefinitionAssembly,
): boolean {
  return type.type.kind === 'reference' &&
    definitions.getDefinition(type.type.name)?.kind === 'dictionary';
}

// Project helper: recognize string and enumeration conversion candidates.
function isStringType(
  type: EffectiveType,
  definitions: DefinitionAssembly,
): boolean {
  return type.type.kind === 'simple'
    ? stringTypeNames.has(type.type.name)
    : type.type.kind === 'reference' &&
      definitions.getDefinition(type.type.name)?.kind === 'enumeration';
}

// Project helper: recognize a numeric conversion candidate.
function isNumericType(type: EffectiveType): boolean {
  return type.type.kind === 'simple' && numericTypeNames.has(type.type.name);
}

// Project helper: recognize the object conversion candidate.
function isObjectType(type: EffectiveType): boolean {
  return isSimpleType(type, 'object');
}

// Project helper: match a resolved simple type by name.
function isSimpleType(type: EffectiveType, name: SimpleTypeName): boolean {
  return type.type.kind === 'simple' && type.type.name === name;
}

// Project helper for Web IDL §3.4.8 [LegacyTreatNonObjectAsNull] — recognize affected attribute types.
function isNullableLegacyCallback(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  const nullableType = resolveEffectiveType(type, definitions, []).type;
  if (nullableType.kind !== 'nullable') return false;
  const callbackType = resolveEffectiveType(
    nullableType.type,
    definitions,
    [],
  ).type;
  if (callbackType.kind !== 'reference') return false;
  const definition = definitions.getDefinition(callbackType.name);
  return definition?.kind === 'callback-function' &&
    hasExtendedAttribute(
      definition.extendedAttributes ?? [],
      'LegacyTreatNonObjectAsNull',
    );
}

// Project helper: resolve the callback object's associated realm.
function getCallbackRealm(
  value: object,
  context: ConversionContext,
): WebIDLRealmHost {
  return getPlatformRecord(value)?.realm ??
    context.realm.callbacks.getAssociatedRealm(value);
}

// Project helper: recognize our Map-backed dictionary and record values.
function isMap(value: unknown): value is Map<string, unknown> {
  return isObject(value) && hasMapData(value);
}

// Project helper: parse the integer literal text retained by declaration builders.
function parseBigInteger(value: string): bigint {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  let result: bigint;
  if (/^0[xX][0-9a-fA-F]+$/.test(unsigned)) {
    result = BigInt(unsigned);
  } else if (/^0[0-7]+$/.test(unsigned)) {
    result = BigInt(`0o${unsigned.slice(1)}`);
  } else {
    result = BigInt(unsigned);
  }
  return negative ? -result : result;
}

// Project helper: find the numeric type used to materialize an integer default.
function getSoleNumericTypeName(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): SimpleTypeName | undefined {
  const numericTypes = flattenEffectiveTypes(type, definitions, [])
    .filter((candidate) => candidate.type.kind === 'simple' && (
      candidate.type.name === 'bigint' ||
      numericTypeNames.has(candidate.type.name)
    ));
  const numericType = numericTypes.length === 1
    ? numericTypes[0]?.type
    : undefined;
  return numericType?.kind === 'simple' ? numericType.name : undefined;
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

// Project helper: report a conversion that has not been implemented.
function unsupportedConversion(type: string): never {
  throw new Error(`Web IDL conversion for ${type} is not implemented`);
}

type EffectiveType = {
  extendedAttributes: ExtendedAttribute[];
  type: EffectiveBaseType;
};

type EffectiveBaseType = Exclude<WebIDLType, AnnotatedType<WebIDLType>>;

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

const numericTypeNames = new Set<SimpleTypeName>([
  'byte', 'octet', 'short', 'unsigned short', 'long', 'unsigned long',
  'long long', 'unsigned long long', 'float', 'unrestricted float',
  'double', 'unrestricted double',
]);

const stringTypeNames = new Set<SimpleTypeName>([
  'DOMString', 'ByteString', 'USVString',
]);

const bufferTypeNames = new Set<SimpleTypeName>([
  'ArrayBuffer', 'SharedArrayBuffer', ...bufferViewNames,
]);
