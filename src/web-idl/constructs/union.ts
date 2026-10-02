import { getBufferTypeName, getMethod, hasStringData, isObject, toBigInt, toPrimitive } from '../../js-engine/index';
import { InternalError } from '../../infra/internal-error';
import type { FrozenArrayType, UnionType } from '../core/types';
import type { UnionInterfaceCandidate } from '../assembly';
import type { ConversionContext } from '../conversion-context';
import { _jsToIDL, idlToJSByType } from '../conversion';
import { AsyncSequenceCarrier } from './async-sequence';
import {
  CallbackFunctionCarrier, CallbackInterfaceCarrier, CallbackFunctionStamper, getCallbackRealm,
} from './callback';
import { DictionaryCarrier, jsToIDLDictionary, idlToJSDictionary } from './dictionary';
import { getPlatformRecord, isPlatformObject } from '../binding/platform-object';
import { isMap } from './record';
import { jsToIDLSequence, jsToIDLFrozenArray } from './sequence';

/** Select the applicable union member and convert the author value to that type. */
// https://webidl.spec.whatwg.org/#es-union
export function jsToIDLUnion(
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
        return jsToIDLSequence(
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
        return jsToIDLFrozenArray(value, context.forType(type.type), method);
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
  return context.throwTypeError('Value cannot be converted to the union type');
}

/** Identify a converted union value's member type and produce its author representation. */
// https://webidl.spec.whatwg.org/#es-union
export function idlToJSUnion(
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
