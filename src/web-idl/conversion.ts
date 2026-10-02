import { getMethod, isObject, toString } from '../js-engine/index';
import type { PromiseResult } from '../infra/promises';
import { InternalError } from '../infra/internal-error';
import type { AssembledEnumeration } from './assembled';
import type { DefaultValue, ReferenceType, WebIDLType } from './core/types';
import type { ConversionContext } from './conversion-context';
import { AsyncSequenceCarrier } from './constructs/async-sequence';
import { bufferTypeNames } from './constructs/buffer-source';
import {
  CallbackFunctionCarrier, CallbackInterfaceCarrier, CallbackFunctionStamper,
  getCallbackRealm, jsToIDLCallbackFunction,
} from './constructs/callback';
import { PromiseCarrier, idlToJSPromise } from './constructs/promise';
import { jsToIDLInterface, projectInterface } from './constructs/interface';
import { jsToIDLDictionary, idlToJSDictionary, type DictionaryConverter } from './constructs/dictionary';
import { jsToIDLRecord, idlToJSRecord, type IDLRecord } from './constructs/record';
import { jsToIDLSequence, jsToIDLFrozenArray, idlToJSSequence, type IDLSequence } from './constructs/sequence';
import { jsToIDLSimple, idlToJSSimple, createJSToIDLSimpleConverter } from './constructs/simple';
import { jsToIDLUnion, idlToJSUnion } from './constructs/union';

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
    return context.throwConversionError(error);
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
      return context.throwConversionError(error);
    }
  };
}

/**
 * Prepare nested conversion inside an existing error boundary.
 * Enter conversion through createJSToIDLConverter() or jsToIDL(); dictionary members share their caller's boundary.
 */
export function createJSToIDLValueConverter(
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
    convert = createJSToIDLSimpleConverter(context);
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
        : Type extends { kind: 'sequence'; } ? IDLSequence
          : Type extends { kind: 'record'; } ? IDLRecord
            : Type extends { kind: 'promise'; } ? PromiseCarrier
              : Type extends { kind: 'async-sequence'; } ? AsyncSequenceCarrier
                : Type extends { kind: 'frozen-array'; } ? readonly unknown[]
                  : unknown;

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

// Continue conversion inside an existing error boundary. To enter conversion, use jsToIDL()
// or createJSToIDLConverter(); they create errors in context.realm from conversion failures.
export function _jsToIDL<Type extends WebIDLType>(
  value: unknown,
  context: ConversionContext<Type>,
): IDLValue<Type>;

export function _jsToIDL(
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
        context.throwTypeError('A sequence value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (!method) context.throwTypeError('Value is not iterable');
      return jsToIDLSequence(
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
        context.throwTypeError('A frozen array value must be an object');
      }
      const method = getMethod(value, Symbol.iterator, context.realm);
      if (!method) context.throwTypeError('Value is not iterable');
      return jsToIDLFrozenArray(
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
      throw new InternalError(`Web IDL conversion for ${type.kind} is not implemented`);
  }
}

// Convert an IDL value using the rules retained for this declared type.
export function idlToJSByType(
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
      return idlToJSPromise(value, context);
    case 'async-sequence':
      if (!AsyncSequenceCarrier.is(value)) {
        throw new InternalError('IDL async sequence is not an async sequence carrier');
      }
      return value.object;
    case 'observable-array':
      throw new InternalError(`Web IDL conversion for ${type.kind} is not implemented`);
  }
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
    if (!isObject(value)) return context.throwTypeError(`${name} is not an object`);
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
      : context.throwTypeError(`Value does not implement ${name}`);
  }
  if (assembly.namespaces.has(name)) {
    throw new InternalError(`${name} is not a value type`);
  }
  throw new InternalError(`Unknown Web IDL type ${name}`);
}

// https://webidl.spec.whatwg.org/#es-enumeration
function jsToIDLEnumeration(value: unknown, context: ConversionContext, assembled: AssembledEnumeration): string {
  const string = toString(value);
  if (!assembled.hasValue(string)) {
    context.throwTypeError(`${string} is not a value of ${assembled.primary.name}`);
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
