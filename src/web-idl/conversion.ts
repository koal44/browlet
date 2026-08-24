import type {
  AssembledDictionary, DefinitionAssembly,
} from './assembly';
import {
  convertAsyncSequenceToJavaScript,
  convertJavaScriptValueToAsyncSequence,
  createAsyncSequenceValue, isAsyncSequence,
} from './async-sequence';
import {
  createCallbackFunctionValue, createCallbackInterfaceValue,
  isCallbackFunctionValue, isCallbackInterfaceValue,
} from './callback-value';
import {
  convertBufferSourceToIDL, convertBufferSourceToJavaScript,
  getBufferTypeName,
} from './buffer-source';
import type {
  AnnotatedType, BufferTypeName, DefaultValue, ExtendedAttribute,
  SimpleTypeName, WebIDLType,
} from './declaration/index';
import type { WebIDLRealmHost } from './javascript-realm';
import type { PlatformObjectRegistry } from './platform-object';
import {
  convertJavaScriptValueToPromise, convertPromiseToJavaScript,
} from './promise-value';
import {
  getTypeWithApplicableExtendedAttributes, includesNullableType,
  includesUndefined,
} from './types';

export function convertToIDL(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  options: ConversionOptions = {},
): unknown {
  const legacyCallbackAttribute = options.attributeAssignment === true &&
    isNullableLegacyCallback(type, context.definitions);
  if (legacyCallbackAttribute && !isObject(value)) return null;
  return convertJavaScriptValue(
    value,
    type,
    context,
    [],
    legacyCallbackAttribute,
  );
}

export function convertToJavaScript(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
): unknown {
  return convertIDLValue(value, type, context, []);
}

export function createSequenceFromIterable(
  iterable: object,
  elementType: WebIDLType,
  method: JavaScriptMethod,
  context: ConversionContext,
): IDLSequenceValue {
  const iterator = Reflect.apply(method, iterable, []);
  if (!isObject(iterator)) {
    throwTypeError(context, 'Iterator method did not return an object');
  }

  const nextMethod = getMethod(iterator, 'next', context);
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

export function createFrozenArrayFromIterable(
  iterable: object,
  elementType: WebIDLType,
  method: JavaScriptMethod,
  context: ConversionContext,
): readonly unknown[] {
  return createFrozenArray(
    createSequenceFromIterable(iterable, elementType, method, context),
    elementType,
    context,
  );
}

export function getMethod(
  value: object,
  key: PropertyKey,
  context: ConversionContext,
): JavaScriptMethod | undefined {
  const method = Reflect.get(value, key) as unknown;
  if (method === undefined || method === null) return;
  if (typeof method !== 'function') {
    throwTypeError(context, `${String(key)} is not callable`);
  }
  return method as JavaScriptMethod;
}

export function isPlatformObject(
  value: unknown,
  context: ConversionContext,
): boolean {
  if (context.platformObjects.isPlatformObject(value)) return true;
  for (const interface_ of context.hostDefinedInterfaces.values()) {
    if (interface_.is(value)) return true;
  }
  return false;
}

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
      const numericType = getSoleNumericTypeName(type, context.definitions);
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
  definitions: DefinitionAssembly;
  hostDefinedInterfaces: ReadonlyMap<string, HostDefinedInterface>;
  platformObjects: PlatformObjectRegistry;
  realizeException?: (value: unknown) => unknown;
  realm: WebIDLRealmHost;
};

export type HostDefinedInterface = {
  is(value: unknown): boolean;
  name: string;
};

export type ConversionOptions = {
  attributeAssignment?: boolean;
};

export type IDLDictionaryValue = Map<string, unknown>;
export type IDLRecordValue = Map<string, unknown>;
export type IDLSequenceValue = unknown[];

export type JavaScriptMethod = (
  ...argumentsList: unknown[]
) => unknown;

function convertJavaScriptValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
  legacyCallbackAttribute = false,
): unknown {
  const resolved = resolveRuntimeType(
    type,
    context.definitions,
    extendedAttributes,
  );

  switch (resolved.type.kind) {
    case 'simple':
      return convertJavaScriptValueToSimpleType(
        value,
        resolved.type.name,
        resolved.extendedAttributes,
        context,
      );
    case 'reference':
      return convertJavaScriptValueToReference(
        value,
        resolved.type.name,
        context,
        legacyCallbackAttribute,
      );
    case 'nullable':
      if (
        value === undefined &&
        includesUndefined(resolved.type.type, context.definitions)
      ) return undefined;
      if (value === null || value === undefined) return null;
      return convertJavaScriptValue(
        value,
        resolved.type.type,
        context,
        resolved.extendedAttributes,
        legacyCallbackAttribute,
      );
    case 'union':
      return convertJavaScriptValueToUnion(
        value,
        resolved.type,
        context,
        resolved.extendedAttributes,
      );
    case 'sequence': {
      if (!isObject(value)) {
        throwTypeError(context, 'A sequence value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context);
      if (!method) throwTypeError(context, 'Value is not iterable');
      return createSequenceFromIterable(
        value,
        resolved.type.type,
        method,
        context,
      );
    }
    case 'record':
      return convertJavaScriptValueToRecord(value, resolved.type, context);
    case 'frozen-array': {
      if (!isObject(value)) {
        throwTypeError(context, 'A frozen array value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context);
      if (!method) throwTypeError(context, 'Value is not iterable');
      return createFrozenArrayFromIterable(
        value,
        resolved.type.type,
        method,
        context,
      );
    }
    case 'promise':
      return convertJavaScriptValueToPromise(
        value,
        resolved.type.type,
        context.realm,
        context.realizeException,
      );
    case 'async-sequence':
      return convertJavaScriptValueToAsyncSequence(
        value,
        resolved.type,
        context.realm,
      );
    case 'observable-array':
      return unsupportedConversion(resolved.type.kind);
  }
}

function convertIDLValue(
  value: unknown,
  type: WebIDLType,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
): unknown {
  const resolved = resolveRuntimeType(
    type,
    context.definitions,
    extendedAttributes,
  );

  switch (resolved.type.kind) {
    case 'simple':
      return convertSimpleTypeToJavaScript(value, resolved.type.name);
    case 'reference':
      return convertReferenceToJavaScript(
        value,
        resolved.type.name,
        context,
      );
    case 'nullable':
      if (value === null) return null;
      return convertIDLValue(
        value,
        resolved.type.type,
        context,
        resolved.extendedAttributes,
      );
    case 'union':
      return convertUnionToJavaScript(
        value,
        resolved.type,
        context,
        resolved.extendedAttributes,
      );
    case 'sequence':
      return convertSequenceToJavaScript(
        value,
        resolved.type.type,
        context,
      );
    case 'record':
      return convertRecordToJavaScript(
        value,
        resolved.type.key,
        resolved.type.value,
        context,
      );
    case 'frozen-array':
      return value;
    case 'promise':
      return convertPromiseToJavaScript(value);
    case 'async-sequence':
      return convertAsyncSequenceToJavaScript(value);
    case 'observable-array':
      return unsupportedConversion(resolved.type.kind);
  }
}

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
      context.realm,
    );
  }

  switch (name) {
    case 'any':
      return value;
    case 'undefined':
      return undefined;
    case 'boolean':
      return Boolean(value);
    case 'float':
      return convertToFloat(value, false, context);
    case 'unrestricted float':
      return convertToFloat(value, true, context);
    case 'double': {
      const number = toNumber(value, context);
      if (!Number.isFinite(number)) {
        throwTypeError(context, 'Value is not a finite double');
      }
      return number;
    }
    case 'unrestricted double':
      return toNumber(value, context);
    case 'bigint':
      return toBigInt(value, context);
    case 'DOMString':
      if (
        value === null &&
        hasExtendedAttribute(extendedAttributes, 'LegacyNullToEmptyString')
      ) return '';
      return toString(value, context);
    case 'ByteString': {
      const string = toString(value, context);
      for (let i = 0; i < string.length; i++) {
        if (string.charCodeAt(i) > 255) {
          throwTypeError(context, 'Value is not a ByteString');
        }
      }
      return string;
    }
    case 'USVString':
      if (
        value === null &&
        hasExtendedAttribute(extendedAttributes, 'LegacyNullToEmptyString')
      ) return '';
      return toString(value, context).toWellFormed();
    case 'object':
      if (!isObject(value)) {
        throwTypeError(context, 'Value is not an object');
      }
      return value;
    case 'symbol':
      if (typeof value !== 'symbol') {
        throwTypeError(context, 'Value is not a symbol');
      }
      return value;
    default:
      return unsupportedConversion(name);
  }
}

function convertSimpleTypeToJavaScript(
  value: unknown,
  name: SimpleTypeName,
): unknown {
  if (bufferTypeNames.has(name)) {
    return convertBufferSourceToJavaScript(value, name as BufferTypeName);
  }
  return name === 'undefined' ? undefined : value;
}

function convertJavaScriptValueToReference(
  value: unknown,
  name: string,
  context: ConversionContext,
  legacyCallbackAttribute: boolean,
): unknown {
  const definition = context.definitions.getDefinition(name);
  switch (definition?.kind) {
    case 'enumeration': {
      const string = toString(value, context);
      if (!definition.values.includes(string)) {
        throwTypeError(context, `${string} is not a value of ${name}`);
      }
      return string;
    }
    case 'interface': {
      const interface_ = context.definitions.getInterface(name);
      const record = context.platformObjects.getRecord(value);
      if (
        interface_ &&
        record &&
        context.platformObjects.recordImplements(record, interface_)
      ) {
        return record.implementation;
      }
      return throwTypeError(context, `Value does not implement ${name}`);
    }
    case 'dictionary': {
      const dictionary = context.definitions.getDictionary(name);
      if (!dictionary) throw new Error(`Dictionary ${name} was not assembled`);
      return convertJavaScriptValueToDictionary(value, dictionary, context);
    }
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
    case 'callback-interface': {
      if (!isObject(value)) {
        return throwTypeError(context, `${name} is not an object`);
      }
      return createCallbackInterfaceValue(
        definition,
        value,
        getCallbackRealm(value, context),
        context.realm.callbacks.captureContext(),
        context,
      );
    }
    case undefined: {
      const interface_ = context.hostDefinedInterfaces.get(name);
      if (interface_) {
        return interface_.is(value)
          ? value
          : throwTypeError(context, `Value does not implement ${name}`);
      }
      throw new Error(`Unknown Web IDL type ${name}`);
    }
    default:
      throw new Error(`${name} is not a value type`);
  }
}

function convertReferenceToJavaScript(
  value: unknown,
  name: string,
  context: ConversionContext,
): unknown {
  const definition = context.definitions.getDefinition(name);
  switch (definition?.kind) {
    case 'enumeration':
      return value;
    case 'interface': {
      const object = context.platformObjects.getPlatformObject(value);
      if (!object) {
        throw new Error(
          `IDL interface value ${name} is not an implementation target`,
        );
      }
      return object;
    }
    case 'dictionary': {
      const dictionary = context.definitions.getDictionary(name);
      if (!dictionary) throw new Error(`Dictionary ${name} was not assembled`);
      return convertDictionaryToJavaScript(value, dictionary, context);
    }
    case 'callback-function':
      if (!isCallbackFunctionValue(value)) {
        throw new Error(`IDL callback function ${name} is not a callback value`);
      }
      return value.object;
    case 'callback-interface':
      if (!isCallbackInterfaceValue(value)) {
        throw new Error(`IDL callback interface ${name} is not a callback value`);
      }
      return value.object;
    case undefined: {
      const interface_ = context.hostDefinedInterfaces.get(name);
      if (interface_) {
        if (interface_.is(value)) return value;
        throw new Error(`IDL interface value does not implement ${name}`);
      }
      throw new Error(`Unknown Web IDL type ${name}`);
    }
    default:
      throw new Error(`${name} is not a value type`);
  }
}

function convertJavaScriptValueToDictionary(
  value: unknown,
  dictionary: AssembledDictionary,
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

function convertDictionaryToJavaScript(
  value: unknown,
  dictionary: AssembledDictionary,
  context: ConversionContext,
): object {
  if (!isMap(value)) {
    throw new Error(`IDL dictionary ${dictionary.definition.name} is not a map`);
  }

  const result = createOrdinaryObject(context);
  for (const member of dictionary.members) {
    if (!value.has(member.name)) continue;
    const memberType = getTypeWithApplicableExtendedAttributes(
      member.type,
      member.extendedAttributes,
    );
    defineDataProperty(
      result,
      member.name,
      convertToJavaScript(value.get(member.name), memberType, context),
    );
  }
  return result;
}

function convertJavaScriptValueToRecord(
  value: unknown,
  type: Extract<RuntimeBaseType, { kind: 'record'; }>,
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

function convertRecordToJavaScript(
  value: unknown,
  keyType: WebIDLType,
  valueType: WebIDLType,
  context: ConversionContext,
): object {
  if (!isMap(value)) throw new Error('IDL record is not a map');

  const result = createOrdinaryObject(context);
  for (const [key, entryValue] of value) {
    const jsKey = convertToJavaScript(key, keyType, context);
    const jsValue = convertToJavaScript(entryValue, valueType, context);
    defineDataProperty(result, jsKey as PropertyKey, jsValue);
  }
  return result;
}

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

function convertJavaScriptValueToUnion(
  value: unknown,
  type: Extract<RuntimeBaseType, { kind: 'union'; }>,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
): unknown {
  if (value === undefined && includesUndefined(type, context.definitions)) {
    return undefined;
  }
  if (
    (value === null || value === undefined) &&
    includesNullableType(type, context.definitions)
  ) return null;

  const types = flattenRuntimeTypes(
    type,
    context.definitions,
    extendedAttributes,
  );

  if (value === null || value === undefined) {
    const dictionary = types.find((candidate) =>
      isDictionaryType(candidate, context.definitions));
    if (dictionary) return convertResolvedJavaScriptValue(value, dictionary, context);
  }

  if (isPlatformObject(value, context)) {
    const interface_ = types.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interface_) return value;
    const object = types.find(isObjectType);
    if (object) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName) {
      const buffer = types.find((candidate) =>
        isSimpleType(candidate, bufferName));
      if (buffer) return convertResolvedJavaScriptValue(value, buffer, context);
      const object = types.find(isObjectType);
      if (object) return value;
    }
  }

  if (typeof value === 'function') {
    const callback = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-function', context.definitions));
    if (callback) return convertResolvedJavaScriptValue(value, callback, context);
    const object = types.find(isObjectType);
    if (object) return value;
  }

  if (isObject(value)) {
    const asyncSequence = types.find((candidate) =>
      candidate.type.kind === 'async-sequence');
    if (asyncSequence && !(
      isStringObject(value) && types.some((candidate) =>
        isStringType(candidate, context.definitions))
    )) {
      const asyncMethod = getMethod(value, Symbol.asyncIterator, context);
      if (asyncMethod && asyncSequence.type.kind === 'async-sequence') {
        return createAsyncSequenceValue(
          value,
          asyncSequence.type.type,
          asyncMethod,
          'async',
        );
      }
      const syncMethod = getMethod(value, Symbol.iterator, context);
      if (syncMethod && asyncSequence.type.kind === 'async-sequence') {
        return createAsyncSequenceValue(
          value,
          asyncSequence.type.type,
          syncMethod,
          'sync',
        );
      }
    }

    const sequence = types.find((candidate) => candidate.type.kind === 'sequence');
    if (sequence && sequence.type.kind === 'sequence') {
      const method = getMethod(value, Symbol.iterator, context);
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
      const method = getMethod(value, Symbol.iterator, context);
      if (method) {
        return convertResolvedJavaScriptValue(
          value,
          frozenArray,
          context,
        );
      }
    }

    const dictionary = types.find((candidate) =>
      isDictionaryType(candidate, context.definitions));
    if (dictionary) return convertResolvedJavaScriptValue(value, dictionary, context);
    const record = types.find((candidate) => candidate.type.kind === 'record');
    if (record) return convertResolvedJavaScriptValue(value, record, context);
    const callbackInterface = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-interface', context.definitions));
    if (callbackInterface) {
      return convertResolvedJavaScriptValue(value, callbackInterface, context);
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
    if (numeric) return convertResolvedJavaScriptValue(value, numeric, context);
  }
  if (typeof value === 'bigint') {
    const bigint = types.find((candidate) => isSimpleType(candidate, 'bigint'));
    if (bigint) return value;
  }

  const string = types.find((candidate) =>
    isStringType(candidate, context.definitions));
  if (string) return convertResolvedJavaScriptValue(value, string, context);

  const numeric = types.find(isNumericType);
  const bigint = types.find((candidate) => isSimpleType(candidate, 'bigint'));
  if (numeric && bigint) {
    const primitive = toPrimitive(value, 'number', context);
    return typeof primitive === 'bigint'
      ? primitive
      : convertResolvedJavaScriptValue(primitive, numeric, context);
  }
  if (numeric) return convertResolvedJavaScriptValue(value, numeric, context);

  const boolean = types.find((candidate) => isSimpleType(candidate, 'boolean'));
  if (boolean) return Boolean(value);
  if (bigint) return toBigInt(value, context);
  return throwTypeError(context, 'Value cannot be converted to the union type');
}

function convertUnionToJavaScript(
  value: unknown,
  type: Extract<RuntimeBaseType, { kind: 'union'; }>,
  context: ConversionContext,
  extendedAttributes: ExtendedAttribute[],
): unknown {
  const types = flattenRuntimeTypes(
    type,
    context.definitions,
    extendedAttributes,
  );

  if (value === undefined) {
    const undefinedType = types.find((candidate) =>
      isSimpleType(candidate, 'undefined'));
    if (undefinedType) return undefined;
  }
  if (value === null && includesNullableType(type, context.definitions)) {
    return null;
  }
  if (isPlatformObject(value, context)) {
    const interface_ = types.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interface_) return value;
    const object = types.find(isObjectType);
    if (object) return value;
  }
  if (isCallbackFunctionValue(value)) {
    const callback = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-function', context.definitions));
    if (callback) return convertResolvedIDLValue(value, callback, context);
  }
  if (isCallbackInterfaceValue(value)) {
    const callback = types.find((candidate) =>
      isDefinitionType(candidate, 'callback-interface', context.definitions));
    if (callback) return convertResolvedIDLValue(value, callback, context);
  }
  if (isAsyncSequence(value)) {
    const sequence = types.find((candidate) =>
      candidate.type.kind === 'async-sequence');
    if (sequence) return convertResolvedIDLValue(value, sequence, context);
  }
  if (Array.isArray(value)) {
    const array = types.find((candidate) =>
      candidate.type.kind === 'sequence' ||
      candidate.type.kind === 'frozen-array');
    if (array) return convertResolvedIDLValue(value, array, context);
  }
  if (isMap(value)) {
    const dictionary = types.find((candidate) =>
      isDictionaryType(candidate, context.definitions));
    if (dictionary) return convertResolvedIDLValue(value, dictionary, context);
    const record = types.find((candidate) => candidate.type.kind === 'record');
    if (record) return convertResolvedIDLValue(value, record, context);
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
      isStringType(candidate, context.definitions));
    if (string) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    const buffer = bufferName && types.find((candidate) =>
      isSimpleType(candidate, bufferName));
    if (buffer) return convertResolvedIDLValue(value, buffer, context);
    const object = types.find(isObjectType);
    if (object) return value;
  }
  throw new Error('IDL union value has no matching specific type');
}

function convertResolvedJavaScriptValue(
  value: unknown,
  resolved: RuntimeType,
  context: ConversionContext,
): unknown {
  return convertJavaScriptValue(
    value,
    resolved.type,
    context,
    resolved.extendedAttributes,
  );
}

function convertResolvedIDLValue(
  value: unknown,
  resolved: RuntimeType,
  context: ConversionContext,
): unknown {
  return convertIDLValue(
    value,
    resolved.type,
    context,
    resolved.extendedAttributes,
  );
}

function convertToInteger(
  value: unknown,
  bitLength: number,
  signed: boolean,
  extendedAttributes: ExtendedAttribute[],
  context: ConversionContext,
): number {
  let number = toNumber(value, context);
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

function convertToFloat(
  value: unknown,
  unrestricted: boolean,
  context: ConversionContext,
): number {
  const number = toNumber(value, context);
  if (!unrestricted && !Number.isFinite(number)) {
    throwTypeError(context, 'Value is not a finite float');
  }
  const rounded = Math.fround(number);
  if (!unrestricted && !Number.isFinite(rounded)) {
    throwTypeError(context, 'Value is outside the float range');
  }
  return rounded;
}

function toNumber(value: unknown, context: ConversionContext): number {
  return toNumberFromPrimitive(toPrimitive(value, 'number', context), context);
}

function toNumberFromPrimitive(
  value: Primitive,
  context: ConversionContext,
): number {
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return throwTypeError(context, 'Value cannot be converted to a number');
  }
  return context.realm.intrinsics.number(value);
}

function toBigInt(value: unknown, context: ConversionContext): bigint {
  const primitive = toPrimitive(value, 'number', context);
  if (
    typeof primitive === 'bigint' ||
    typeof primitive === 'boolean' ||
    typeof primitive === 'string'
  ) return context.realm.intrinsics.bigInt(primitive);
  return throwTypeError(context, 'Value cannot be converted to a bigint');
}

function toString(value: unknown, context: ConversionContext): string {
  const primitive = toPrimitive(value, 'string', context);
  if (typeof primitive === 'symbol') {
    return throwTypeError(context, 'A symbol cannot be converted to a string');
  }
  return context.realm.intrinsics.string(primitive);
}

function toPrimitive(
  value: unknown,
  hint: 'number' | 'string',
  context: ConversionContext,
): Primitive {
  if (!isObject(value)) return value as Primitive;

  const exotic = Reflect.get(value, Symbol.toPrimitive) as unknown;
  if (exotic !== undefined && exotic !== null) {
    if (typeof exotic !== 'function') {
      return throwTypeError(context, 'Symbol.toPrimitive is not callable');
    }
    const result = Reflect.apply(exotic, value, [hint]) as unknown;
    if (isObject(result)) {
      return throwTypeError(context, 'Symbol.toPrimitive returned an object');
    }
    return result as Primitive;
  }

  const methods = hint === 'string'
    ? ['toString', 'valueOf']
    : ['valueOf', 'toString'];
  for (const name of methods) {
    const method = Reflect.get(value, name) as unknown;
    if (typeof method !== 'function') continue;
    const result = Reflect.apply(method, value, []) as unknown;
    if (!isObject(result)) return result as Primitive;
  }
  return throwTypeError(context, 'Object cannot be converted to a primitive');
}

function resolveRuntimeType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
  extendedAttributes: ExtendedAttribute[],
): RuntimeType {
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

function flattenRuntimeTypes(
  type: WebIDLType,
  definitions: DefinitionAssembly,
  extendedAttributes: ExtendedAttribute[],
): RuntimeType[] {
  const resolved = resolveRuntimeType(type, definitions, extendedAttributes);
  if (resolved.type.kind === 'nullable') {
    return flattenRuntimeTypes(
      resolved.type.type,
      definitions,
      resolved.extendedAttributes,
    );
  }
  if (resolved.type.kind === 'union') {
    return resolved.type.types.flatMap((member) =>
      flattenRuntimeTypes(member, definitions, resolved.extendedAttributes));
  }
  return [resolved];
}

function isImplementedInterfaceType(
  type: RuntimeType,
  value: unknown,
  context: ConversionContext,
): boolean {
  if (type.type.kind !== 'reference') return false;
  const interface_ = context.definitions.getInterface(type.type.name);
  if (interface_) return context.platformObjects.implements(value, interface_);
  return context.hostDefinedInterfaces.get(type.type.name)?.is(value) ?? false;
}

function isDefinitionType(
  type: RuntimeType,
  kind: 'callback-function' | 'callback-interface',
  definitions: DefinitionAssembly,
): boolean {
  return type.type.kind === 'reference' &&
    definitions.getDefinition(type.type.name)?.kind === kind;
}

function isDictionaryType(
  type: RuntimeType,
  definitions: DefinitionAssembly,
): boolean {
  return type.type.kind === 'reference' &&
    definitions.getDefinition(type.type.name)?.kind === 'dictionary';
}

function isStringType(
  type: RuntimeType,
  definitions: DefinitionAssembly,
): boolean {
  return type.type.kind === 'simple'
    ? stringTypeNames.has(type.type.name)
    : type.type.kind === 'reference' &&
      definitions.getDefinition(type.type.name)?.kind === 'enumeration';
}

function isNumericType(type: RuntimeType): boolean {
  return type.type.kind === 'simple' && numericTypeNames.has(type.type.name);
}

function isObjectType(type: RuntimeType): boolean {
  return isSimpleType(type, 'object');
}

function isSimpleType(type: RuntimeType, name: SimpleTypeName): boolean {
  return type.type.kind === 'simple' && type.type.name === name;
}

function hasExtendedAttribute(
  attributes: ExtendedAttribute[],
  name: string,
): boolean {
  return attributes.some((attribute) =>
    attribute.kind !== 'raw' && attribute.name === name);
}

function isNullableLegacyCallback(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  const nullableType = resolveRuntimeType(type, definitions, []).type;
  if (nullableType.kind !== 'nullable') return false;
  const callbackType = resolveRuntimeType(
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

function getCallbackRealm(
  value: object,
  context: ConversionContext,
): WebIDLRealmHost {
  return context.platformObjects.getRecord(value)?.realm ??
    context.realm.callbacks.getAssociatedRealm(value);
}

function createOrdinaryObject(context: ConversionContext): object {
  return Reflect.construct(context.realm.intrinsics.object, []);
}

function defineDataProperty(
  object: object,
  key: PropertyKey,
  value: unknown,
): void {
  const created = Reflect.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  if (!created) throw new Error(`Could not create property ${String(key)}`);
}

function isStringObject(value: object): boolean {
  try {
    Reflect.apply(
      Reflect.get(String.prototype, 'valueOf') as JavaScriptMethod,
      value,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

function isMap(value: unknown): value is Map<string, unknown> {
  if (!isObject(value)) return false;
  try {
    Reflect.apply(
      Reflect.get(Map.prototype, 'has') as JavaScriptMethod,
      value,
      [mapBrandKey],
    );
    return true;
  } catch {
    return false;
  }
}

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

function getSoleNumericTypeName(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): SimpleTypeName | undefined {
  const numericTypes = flattenRuntimeTypes(type, definitions, [])
    .filter((candidate) => candidate.type.kind === 'simple' && (
      candidate.type.name === 'bigint' ||
      numericTypeNames.has(candidate.type.name)
    ));
  const numericType = numericTypes.length === 1
    ? numericTypes[0]?.type
    : undefined;
  return numericType?.kind === 'simple' ? numericType.name : undefined;
}

function roundToEven(value: number): number {
  const lower = Math.floor(value);
  const difference = value - lower;
  if (difference < 0.5) return lower === 0 ? 0 : lower;
  if (difference > 0.5) return lower + 1;
  const result = lower % 2 === 0 ? lower : lower + 1;
  return result === 0 ? 0 : result;
}

function throwTypeError(
  context: ConversionContext,
  message: string,
): never {
  throw new context.realm.intrinsics.typeError(message);
}

function unsupportedConversion(type: string): never {
  throw new Error(`Web IDL conversion for ${type} is not implemented`);
}

type RuntimeType = {
  extendedAttributes: ExtendedAttribute[];
  type: RuntimeBaseType;
};

type RuntimeBaseType = Exclude<WebIDLType, AnnotatedType>;

type Primitive = bigint | boolean | null | number | string | symbol | undefined;

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
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Int16Array',
  'Int32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array', 'Float16Array',
  'Float32Array', 'Float64Array',
]);

const mapBrandKey = Symbol('Web IDL map brand check');

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
