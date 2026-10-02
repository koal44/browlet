import { toScalarValueString } from '../infra/index';
import {
  bufferViewNames, getBufferTypeName, getMethod, hasMapData, hasStringData, isObject, toBigInt,
  toNumber, toPrimitive, toString, type JSMethod,
} from '../js-engine/index';
import { InternalPromise, type PromiseResult } from '../infra/promises';
import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError,
  TypeError as InternalTypeError,
} from '../infra/exceptions';
import type { UnionInterfaceCandidate } from './assembly';
import type { AssembledCallbackFunction, AssembledDictionary, AssembledEnumeration, AssembledInterface } from './assembled';
import { AsyncSequenceCarrier } from './async-sequence';
import { CallbackFunctionCarrier, CallbackInterfaceCarrier, CallbackFunctionStamper } from './callback';
import { jsToIDLBufferSource, idlToJSBufferSource } from './buffer-source';
import type {
  DefaultValue, FrozenArrayType, ImplementationType,
  RecordType, ReferenceType, SimpleType, SimpleTypeName, UnionType, WebIDLType,
} from './core/types';
import type { WebIDLRealm } from './realm';
import type { RealmBinding } from './realm-binding';
import type { ConversionContext } from './conversion-context';
import { getPlatformRecord } from './platform-object';
import { PromiseCarrier } from './promise';
import { defineDataProperty } from './property';
import { InternalError } from '../infra/internal-error';

/**
 * Enter conversion here so conversion failures become errors in context.realm.
 * Recursive conversion already inside this boundary uses {@link _jsToIDL}.
 * A concrete descriptor retains its known result type.
 */
// https://webidl.spec.whatwg.org/#js-type-mapping
export function jsToIDL<Type extends WebIDLType>(
  value: unknown,
  context: ConversionContext<Type>,
): IDLValue<Type>;
export function jsToIDL(
  value: unknown,
  context: ConversionContext,
): unknown {
  try {
    return _jsToIDL(value, context);
  } catch (error) {
    return throwConversionError(error, context);
  }
}

/** Prepare a reusable conversion entry point with the same rules and error boundary as {@link jsToIDL}. */
export function createJSToIDLConverter<Type extends WebIDLType>(
  context: ConversionContext<Type>,
): ValueConverter<IDLValue<Type>> {
  const convert = createJSToIDLValueConverter(context);
  return (value) => {
    try {
      return convert(value) as IDLValue<Type>;
    } catch (error) {
      return throwConversionError(error, context);
    }
  };
}

/** Prepare nullable legacy callback assignment: retain objects as callbacks and map other values to null. */
// The setter selects this conversion once for a nullable [LegacyTreatNonObjectAsNull] callback.
// https://webidl.spec.whatwg.org/#js-to-nullable
// https://webidl.spec.whatwg.org/#js-to-callback-function
export function createLegacyCallbackConverter(
  context: ConversionContext,
  assembled: AssembledCallbackFunction,
): ValueConverter<CallbackFunctionCarrier | null> {
  return (value) => {
    if (!isObject(value)) return null;
    try {
      return new CallbackFunctionCarrier(
        assembled, value, getCallbackRealm(value, context), context.realm.callbacks.captureContext(), context.binding,
      );
    } catch (error) {
      return throwConversionError(error, context);
    }
  };
}

// Prepare nested conversion inside an existing error boundary. To enter conversion,
// use createJSToIDLConverter() or jsToIDL(); dictionary members share their caller's boundary.
function createJSToIDLValueConverter(
  context: ConversionContext,
): ValueConverter {
  const assembly = context.binding.assembly;
  const resolved = context.resolvedType;
  const interfaceAssembled = resolved.kind === 'reference' ? assembly.interfaces.get(resolved.name) : undefined;
  const enumerationAssembled = resolved.kind === 'reference' ? assembly.enumerations.get(resolved.name) : undefined;
  const dictionaryAssembled = resolved.kind === 'reference' ? assembly.dictionaries.get(resolved.name) : undefined;
  const callbackAssembled = resolved.kind === 'reference' ? assembly.callbackFunctions.get(resolved.name) : undefined;
  let convert: ValueConverter;
  if (resolved.kind === 'simple') {
    const integer = integerTypes[resolved.name];
    const simple = jsToIDLSimpleConverters[resolved.name];
    convert = integer
      ? (value) => convertToInteger(value, integer.bitLength, integer.signed, context)
      : simple
        ? (value) => simple(value, context)
        : (value) => jsToIDLSimple(value, context);
  } else if (interfaceAssembled) {
    convert = (value) => jsToIDLInterface(value, context, interfaceAssembled);
  } else if (enumerationAssembled) {
    convert = (value) => jsToIDLEnumeration(value, context, enumerationAssembled);
  } else if (dictionaryAssembled) {
    // Delay recursive dictionary preparation until a value actually reaches it.
    let convertDictionary: DictionaryConverter | undefined;
    convert = (value) => (convertDictionary ??=
      context.binding.getDictionaryConverter(dictionaryAssembled, context.realm))(value);
  } else if (callbackAssembled) {
    convert = (value) => jsToIDLCallbackFunction(value, context, callbackAssembled);
  } else {
    convert = (value) => _jsToIDL(value, context);
  }
  return convert;
}

/** Convert an IDL value to its author-facing representation, projecting implementation objects as needed. */
// https://webidl.spec.whatwg.org/#js-type-mapping
export function idlToJS(
  value: unknown,
  context: ConversionContext,
): unknown {
  return idlToJSByType(value, context);
}

/** Prepare result conversion, including the selected allocation realm. */
export function createIDLToJSConverter(
  context: ConversionContext,
): ValueConverter {
  const resolved = context.resolvedType;
  const assembly = context.binding.assembly;
  if (resolved.kind === 'simple' && !bufferTypeNames.has(resolved.name)) {
    if (resolved.name === 'undefined') {
      return (value) => {
        context.binding.realizeException(value);
        return undefined;
      };
    }
    return (value) => context.binding.realizeException(value);
  }
  if (resolved.kind === 'reference') {
    const assembled = assembly.interfaces.get(resolved.name);
    if (assembled) {
      return (value) => projectInterface(context.binding.realizeException(value), context, assembled);
    }
    if (assembly.enumerations.has(resolved.name)) {
      return (value) => context.binding.realizeException(value);
    }
  }
  return (value) => idlToJSByType(value, context);
}

/** Convert a value using a retained type and ownership context. */
export type ValueConverter<Result = unknown> = (value: unknown) => Result;

// Implementation payload types describe the final representation, not intermediate
// conversion carriers. Use them only where those representations coincide. A name alone
// needs the runtime assembly, and a fully dynamic WebIDLType can denote any.
export type IDLValue<Type extends WebIDLType> =
  WebIDLType extends Type ? unknown
    : Type extends { kind: 'annotated'; type: infer Inner extends WebIDLType; } ? IDLValue<Inner>
      : Type extends { kind: 'simple' | 'interface'; } ? PromiseResult<Type>
        : Type extends { kind: 'sequence'; } ? IDLSequenceValue
          : Type extends { kind: 'record'; } ? IDLRecordValue
            : Type extends { kind: 'promise'; } ? PromiseCarrier
              : Type extends { kind: 'async-sequence'; } ? AsyncSequenceCarrier
                : Type extends { kind: 'frozen-array'; } ? readonly unknown[]
                  : unknown;

/** Convert an iterable using its already-read method, realizing element conversion errors in context.realm. */
// https://webidl.spec.whatwg.org/#create-sequence-from-iterable
export function createSequenceFromIterable(
  iterable: object,
  context: ConversionContext,
  method: JSMethod,
): IDLSequenceValue {
  // Overload resolution also enters conversion here, using the element's context.
  try {
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
      sequence.push(_jsToIDL(iteration.value, context));
    }
  } catch (error) {
    return throwConversionError(error, context);
  }
}

/** Project sequence entries with the element's conversion context, then freeze the resulting array. */
// https://webidl.spec.whatwg.org/#dfn-create-frozen-array
export function createFrozenArray(
  values: IDLSequenceValue,
  context: ConversionContext,
): readonly unknown[] {
  return Object.freeze(idlToJSSequence(values, context));
}

/** Create a frozen array using its already-read method and the element's conversion context. */
// https://webidl.spec.whatwg.org/#create-frozen-array-from-iterable
export function createFrozenArrayFromIterable(
  iterable: object,
  context: ConversionContext,
  method: JSMethod,
): readonly unknown[] {
  return createFrozenArray(
    createSequenceFromIterable(iterable, context, method),
    context,
  );
}

// Project implementation of Web IDL §2.12 Objects implementing interfaces — is a platform object.
export function isPlatformObject(
  value: unknown,
  binding: RealmBinding,
): boolean {
  if (getPlatformRecord(value)?.binding.world === binding.world) return true;
  return binding.assembly.proxyObjects.is(value);
}

/** Reuse successfully converted scalar defaults; create mutable defaults on every call. */
export function createDefaultValueFactory(
  value: DefaultValue,
): (context: ConversionContext) => unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return () => value;
  if (value.kind === 'empty-sequence') return () => [];
  if (value.kind === 'empty-dictionary') return (context) => context.createDefault(value);
  let initialized = false;
  let result: unknown;
  return (context) => {
    if (!initialized) {
      result = context.createDefault(value);
      // Preparation must not throw earlier than the invocation that uses the
      // default. Only successful primitive results can be shared across calls.
      initialized = !isObject(result);
    }
    return result;
  };
}

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

// Continue conversion inside an existing error boundary. To enter conversion, use jsToIDL()
// or createJSToIDLConverter(); they create errors in context.realm from conversion failures.
function _jsToIDL<Type extends WebIDLType>(
  value: unknown,
  context: ConversionContext<Type>,
): IDLValue<Type>;
function _jsToIDL(
  value: unknown,
  context: ConversionContext,
): unknown {
  const type = context.resolvedType;
  switch (type.kind) {
    case 'simple':
      return jsToIDLSimple(value, context);
    case 'reference':
      return jsToIDLNamed(value, context);
    // Web IDL §3.2.20 Nullable types — JavaScript-to-IDL conversion.
    case 'nullable':
      if (
        value === undefined &&
        context.binding.assembly.includesUndefined(type.type)
      ) return undefined;
      if (value === null || value === undefined) return null;
      return _jsToIDL(value, context.forType(type.type));
    case 'union':
      return jsToIDLUnion(value, context);
    // Web IDL §3.2.21 Sequences — JavaScript-to-IDL conversion.
    case 'sequence': {
      if (!isObject(value)) {
        throwTypeError(context, 'A sequence value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (!method) throwTypeError(context, 'Value is not iterable');
      return createSequenceFromIterable(
        value,
        context.forType(type.type),
        method,
      );
    }
    case 'record':
      return jsToIDLRecord(value, context);
    // Web IDL §3.2.27 Frozen arrays — JavaScript-to-IDL conversion.
    case 'frozen-array': {
      if (!isObject(value)) {
        throwTypeError(context, 'A frozen array value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (!method) throwTypeError(context, 'Value is not iterable');
      return createFrozenArrayFromIterable(
        value,
        context.forType(type.type),
        method,
      );
    }
    case 'promise':
      return PromiseCarrier.fromJS(value, type.type, context.realm, context.binding.realizeException);
    case 'async-sequence':
      return AsyncSequenceCarrier.fromJS(value, context);
    case 'observable-array':
      return unsupportedConversion(type.kind);
  }
}

// Convert an IDL value using the rules retained for this declared type.
function idlToJSByType(
  value: unknown,
  context: ConversionContext,
): unknown {
  const type = context.resolvedType;
  // Realize internal exceptions before exposing them, including as callback arguments.
  value = context.binding.realizeException(value);
  switch (type.kind) {
    case 'simple':
      return idlToJSSimple(value, context);
    case 'reference':
      return idlToJSNamed(value, context);
    // Web IDL §3.2.20 Nullable types — IDL-to-JavaScript conversion.
    case 'nullable':
      if (value === null) return null;
      return idlToJSByType(value, context.forType(type.type));
    case 'union':
      return idlToJSUnion(value, context);
    case 'sequence':
      return idlToJSSequence(value, context.forType(type.type));
    case 'record':
      return idlToJSRecord(value, context);
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

// The dispatchers select each helper by resolved type; the assertions below retain
// that selection without inspecting the type again for every converted value.
// Shared implementation of the simple-type conversions in Web IDL §3.2 JavaScript type mapping.
function jsToIDLSimple(
  value: unknown,
  context: ConversionContext,
): unknown {
  const { name } = context.resolvedType as SimpleType;
  const integerType = integerTypes[name];
  if (integerType) {
    return convertToInteger(
      value,
      integerType.bitLength,
      integerType.signed,
      context,
    );
  }

  if (bufferTypeNames.has(name)) {
    return jsToIDLBufferSource(value, context);
  }

  const convert = jsToIDLSimpleConverters[name];
  if (!convert) return unsupportedConversion(name);
  return convert(value, context);
}

// Shared simple-type IDL-to-JavaScript conversion rules from Web IDL §3.2 JavaScript type mapping.
function idlToJSSimple(
  value: unknown,
  context: ConversionContext,
): unknown {
  const { name } = context.resolvedType as SimpleType;
  if (bufferTypeNames.has(name)) {
    return idlToJSBufferSource(value, context);
  }
  return name === 'undefined' ? undefined : value;
}

// Project dispatcher for named types in Web IDL §3.2 JavaScript type mapping.
function jsToIDLNamed(
  value: unknown,
  context: ConversionContext,
): unknown {
  const { name } = context.resolvedType as ReferenceType;
  const assembly = context.binding.assembly;
  const assembled = assembly.interfaces.get(name);
  if (assembled) return jsToIDLInterface(value, context, assembled);

  const dictionaryAssembled = assembly.dictionaries.get(name);
  if (dictionaryAssembled) return jsToIDLDictionary(value, context, dictionaryAssembled);

  const enumerationAssembled = assembly.enumerations.get(name);
  if (enumerationAssembled) return jsToIDLEnumeration(value, context, enumerationAssembled);

  const callbackFunctionAssembled = assembly.callbackFunctions.get(name);
  if (callbackFunctionAssembled) {
    return jsToIDLCallbackFunction(value, context, callbackFunctionAssembled);
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
function jsToIDLInterface(value: unknown, context: ConversionContext, assembled: AssembledInterface): object {
  const record = getPlatformRecord(value);
  if (
    record?.binding.world === context.binding.world &&
    record.implements(assembled)
  ) return record.implInst;
  return throwTypeError(context, `Value does not implement ${assembled.name}`);
}

// https://webidl.spec.whatwg.org/#es-enumeration
function jsToIDLEnumeration(value: unknown, context: ConversionContext, assembled: AssembledEnumeration): string {
  const string = toString(value);
  if (!assembled.hasValue(string)) {
    throwTypeError(context, `${string} is not a value of ${assembled.primary.name}`);
  }
  return string;
}

// Project adapter for named IDL values in Web IDL §3.2 JavaScript type mapping.
function idlToJSNamed(
  value: unknown,
  context: ConversionContext,
): unknown {
  const { name } = context.resolvedType as ReferenceType;
  const assembly = context.binding.assembly;
  const assembled = assembly.interfaces.get(name);
  if (assembled) return projectInterface(value, context, assembled);

  const dictionaryAssembled = assembly.dictionaries.get(name);
  if (dictionaryAssembled) return idlToJSDictionary(value, context, dictionaryAssembled);
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

function projectInterface(value: unknown, context: ConversionContext, assembled: AssembledInterface): object {
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
  context: ConversionContext,
  assembled: AssembledDictionary,
): DictionaryCarrier {
  return context.binding.getDictionaryConverter(assembled, context.realm)(value);
}

/** Prepare member conversions once; each call reads the current author object. */
export function createDictionaryConverter(
  assembled: AssembledDictionary,
  binding: RealmBinding,
  realm: WebIDLRealm,
): DictionaryConverter {
  const members = assembled.members.map((member) => {
    const context = binding.getConversionContext(member.type, realm);
    return {
      member,
      context,
      convert: createJSToIDLValueConverter(context),
      getDefault: member.primary.default === undefined
        ? undefined
        : createDefaultValueFactory(member.primary.default),
    };
  });
  // Required/defaulted members always exist after successful conversion. Copy
  // their layout together; sparse dictionaries only create present properties.
  const complete = members.every(({ member, getDefault }) => member.primary.required || getDefault);
  const template: Record<string, unknown> = {};
  if (complete) {
    for (const { member } of members) defineDataProperty(template, member.name, undefined);
  }
  // Dictionary references defer to the binding's converter on invocation, so
  // recursive dictionaries do not recursively expand during preparation.
  return (value) => {
    if (!isObject(value) && value !== undefined && value !== null) {
      throw new realm.intrinsics.typeError('A dictionary value must be an object');
    }
    const record: Record<string, unknown> = complete ? { ...template } : {};
    const entries: [string, unknown][] | undefined = complete ? undefined : [];
    for (const { member, context, convert, getDefault } of members) {
      const memberValue = value === undefined || value === null
        ? undefined
        : (value as Record<string, unknown>)[member.name];
      let converted: unknown;
      if (memberValue !== undefined) {
        converted = convert(memberValue);
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
function idlToJSDictionary(
  value: unknown,
  context: ConversionContext,
  assembled: AssembledDictionary,
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
      idlToJS(members[member.name], context.forType(member.type)),
    );
  }
  return result;
}

// Web IDL §3.2.23 Records — convert a JavaScript value to a record.
function jsToIDLRecord(
  value: unknown,
  context: ConversionContext,
): IDLRecordValue {
  const type = context.resolvedType as RecordType;
  if (!isObject(value)) {
    throwTypeError(context, 'A record value must be an object');
  }

  const keyContext = context.forType(type.key);
  const valueContext = context.forType(type.value);
  const result: IDLRecordValue = new Map();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    const typedKey = _jsToIDL(key, keyContext);
    const typedValue = _jsToIDL((value as Record<PropertyKey, unknown>)[key], valueContext);
    result.set(typedKey, typedValue);
  }
  return result;
}

// Web IDL §3.2.23 Records — convert a record to a JavaScript value.
function idlToJSRecord(
  value: unknown,
  context: ConversionContext,
): object {
  const type = context.resolvedType as RecordType;
  if (!isMap(value)) throw new InternalError('IDL record is not a map');

  const result = context.realm.createOrdinaryObject(
    context.realm.intrinsics.objectPrototype,
  );
  const keyContext = context.forType(type.key);
  const valueContext = context.forType(type.value);
  for (const [key, entryValue] of value) {
    const jsKey = idlToJS(key, keyContext);
    const jsValue = idlToJS(entryValue, valueContext);
    defineDataProperty(result, jsKey as PropertyKey, jsValue);
  }
  return result;
}

// https://webidl.spec.whatwg.org/#es-sequence
// The context describes each element, allowing frozen-array creation to use the same conversion.
function idlToJSSequence(
  value: unknown,
  context: ConversionContext,
): unknown[] {
  if (!Array.isArray(value)) throw new InternalError('IDL sequence is not an array');

  const result = new context.realm.intrinsics.array();
  for (let i = 0; i < value.length; i++) {
    defineDataProperty(
      result,
      String(i),
      idlToJS(value[i], context),
    );
  }
  return result;
}

// Web IDL §3.2.25 Union types — convert a JavaScript value to a union.
function jsToIDLUnion(
  value: unknown,
  context: ConversionContext,
): unknown {
  const type = context.resolvedType as UnionType;
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
    if (assembled) return jsToIDLDictionary(value, context, assembled);
  }

  if (isPlatformObject(value, context.binding)) {
    const interfaceType = candidates.interfaces.find((candidate) =>
      isImplementedInterfaceType(candidate, value, context));
    if (interfaceType) {
      return _jsToIDL(value, context.forType(interfaceType.rules.declaredType));
    }
    if (candidates.simpleTypes.has('object')) return value;
  }
  if (isObject(value)) {
    const bufferName = getBufferTypeName(value);
    if (bufferName) {
      const buffer = candidates.simpleTypes.get(bufferName);
      if (buffer) return _jsToIDL(value, context.forType(buffer.declaredType));
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
      if (asyncMethod && asyncSequence.resolvedType.kind === 'async-sequence') {
        return new AsyncSequenceCarrier(value, asyncSequence.resolvedType.type, asyncMethod, 'async');
      }
      const syncMethod = getMethod(value, Symbol.iterator, context.realm);
      if (syncMethod && asyncSequence.resolvedType.kind === 'async-sequence') {
        return new AsyncSequenceCarrier(value, asyncSequence.resolvedType.type, syncMethod, 'sync');
      }
    }

    const sequence = candidates.typesByKind.get('sequence');
    if (sequence && sequence.resolvedType.kind === 'sequence') {
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (method) {
        return createSequenceFromIterable(
          value,
          context.forType(sequence.resolvedType.type),
          method,
        );
      }
    }

    const frozenArray = candidates.typesByKind.get('frozen-array');
    if (frozenArray) {
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (method) {
        const type = frozenArray.resolvedType as FrozenArrayType;
        return createFrozenArrayFromIterable(value, context.forType(type.type), method);
      }
    }

    const dictionaryAssembled = candidates.dictionary;
    if (dictionaryAssembled) return jsToIDLDictionary(value, context, dictionaryAssembled);
    const record = candidates.typesByKind.get('record');
    if (record) return _jsToIDL(value, context.forType(record.declaredType));
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
    if (numeric) return _jsToIDL(value, context.forType(numeric.declaredType));
  }
  if (typeof value === 'bigint') {
    if (candidates.simpleTypes.has('bigint')) return value;
  }

  const string = candidates.string;
  if (string) return _jsToIDL(value, context.forType(string.declaredType));

  const numeric = candidates.numeric;
  const bigint = candidates.simpleTypes.has('bigint');
  if (numeric && bigint) {
    const primitive = toPrimitive(value, 'number');
    return typeof primitive === 'bigint'
      ? primitive
      : _jsToIDL(primitive, context.forType(numeric.declaredType));
  }
  if (numeric) return _jsToIDL(value, context.forType(numeric.declaredType));

  if (candidates.simpleTypes.has('boolean')) return Boolean(value);
  if (bigint) return toBigInt(value);
  return throwTypeError(context, 'Value cannot be converted to the union type');
}

// Project adapter for Web IDL §3.2.25 Union types — identify our value's specific type, then convert it.
function idlToJSUnion(
  value: unknown,
  context: ConversionContext,
): unknown {
  const type = context.resolvedType as UnionType;
  const assembly = context.binding.assembly;
  const candidates = assembly.getUnionCandidates(type);

  if (value === undefined) {
    if (candidates.simpleTypes.has('undefined')) return undefined;
  }
  if (value === null && assembly.includesNullableType(type)) {
    return null;
  }
  if (isPlatformObject(value, context.binding)) {
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
    if (sequence) return idlToJSByType(value, context.forType(sequence.declaredType));
  }
  if (Array.isArray(value)) {
    const array = candidates.array;
    if (array) return idlToJSByType(value, context.forType(array.declaredType));
  }
  if (value instanceof DictionaryCarrier) {
    const assembled = candidates.dictionary;
    if (assembled) return idlToJSDictionary(value, context, assembled);
  }
  if (isMap(value)) {
    const record = candidates.typesByKind.get('record');
    if (record) return idlToJSByType(value, context.forType(record.declaredType));
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
    if (buffer) return idlToJSByType(value, context.forType(buffer.declaredType));
    if (candidates.dictionary) return idlToJSDictionary(value, context, candidates.dictionary);
    if (candidates.simpleTypes.has('object')) return value;
  }
  throw new InternalError('IDL union value has no matching specific type');
}

// Web IDL §3.2.4.9 Abstract operations — ConvertToInt.
function convertToInteger(
  value: unknown,
  bitLength: number,
  signed: boolean,
  context: ConversionContext,
): number {
  const mode = context.integerMode;
  let number = toNumber(value);
  if (Object.is(number, -0)) number = 0;

  const lowerBound = bitLength === 64
    ? signed ? -(2 ** 53) + 1 : 0
    : signed ? -(2 ** (bitLength - 1)) : 0;
  const upperBound = bitLength === 64
    ? 2 ** 53 - 1
    : signed ? 2 ** (bitLength - 1) - 1 : 2 ** bitLength - 1;

  if (mode === 'enforce-range') {
    if (!Number.isFinite(number)) {
      throwTypeError(context, 'Integer is not finite');
    }
    number = Math.trunc(number);
    if (number < lowerBound || number > upperBound) {
      throwTypeError(context, 'Integer is outside the accepted range');
    }
    return number;
  }

  if (!Number.isNaN(number) && mode === 'clamp') {
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
  context: ConversionContext,
  assembled: AssembledCallbackFunction,
): CallbackFunctionCarrier {
  if (typeof value !== 'function') {
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

/** Integer conversion parameters, also used to recognize validated integer defaults. */
// https://webidl.spec.whatwg.org/#js-integer-types
export const integerTypes: Partial<Record<
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
const jsToIDLSimpleConverters: Partial<Record<SimpleTypeName, (
  value: unknown,
  context: ConversionContext,
) => unknown>> = {
  any: (value) => value,
  undefined: () => undefined,
  boolean: (value) => Boolean(value),
  float: (value, context) => convertToFloat(value, false, context),
  'unrestricted float': (value, context) => convertToFloat(value, true, context),
  double(value, context) {
    const number = toNumber(value);
    if (!Number.isFinite(number)) throwTypeError(context, 'Value is not a finite double');
    return number;
  },
  'unrestricted double': (value) => toNumber(value),
  bigint: (value) => toBigInt(value),
  DOMString(value, context) {
    if (value === null && context.nullToEmptyString) return '';
    return toString(value);
  },
  ByteString(value, context) {
    const string = toString(value);
    for (let i = 0; i < string.length; i++) {
      if (string.charCodeAt(i) > 255) throwTypeError(context, 'Value is not a ByteString');
    }
    return string;
  },
  USVString(value, context) {
    if (value === null && context.nullToEmptyString) return toScalarValueString('');
    return toScalarValueString(toString(value));
  },
  object(value, context) {
    if (!isObject(value)) throwTypeError(context, 'Value is not an object');
    return value;
  },
  symbol(value, context) {
    if (typeof value !== 'symbol') throwTypeError(context, 'Value is not a symbol');
    return value;
  },
};
