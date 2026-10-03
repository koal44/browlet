import { InternalError } from '../../infra/index';

import {
  getBufferTypeName, getMethod, hasStringData, isObject, toBigInt, toPrimitive,
} from '../../js-engine/index';

import type { UnionType, WebIDLType } from '../core/index';

import type { UnionInterfaceCandidate } from '../assembly';
import { Converter, type ConversionSteps } from './converter';

import { getPlatformRecord, isPlatformObject } from '../binding/platform';
import { CallbackFunctionStamper } from '../binding/realm/callback';

import {
  IDLAsyncSequence, IDLCallbackFunction, IDLCallbackInterface,
  IDLDictionary,
} from '../values/index';

import { getCallbackRealm } from './callback';
import { isMap } from './record';
import type { SequenceConverter } from './sequence';

/** Select union branches from the value while retaining the declaration's prepared candidates. */
// https://webidl.spec.whatwg.org/#es-union
export class UnionConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    const type = this.resolvedType as UnionType;
    const assembly = this.binding.assembly;
    const candidates = assembly.getUnionCandidates(type);
    return (value) => {
      if (value === undefined && assembly.includesUndefined(type)) {
        return undefined;
      }
      if (
          (value === null || value === undefined) &&
          assembly.includesNullableType(type)
      ) return null;

      if (value === null || value === undefined) {
        const assembled = candidates.dictionary;
        if (assembled) return this.binding.getDictionaryConverter(assembled, this.realm).inputSteps(value);
      }

      if (isPlatformObject(value, this.binding)) {
        const interfaceType = candidates.interfaces.find((candidate) =>
          this.#implements(candidate, value));
        if (interfaceType) {
          return this.forType(interfaceType.rules.declaredType).inputSteps(value);
        }
        if (candidates.simpleTypes.has('object')) return value;
      }
      if (isObject(value)) {
        const bufferName = getBufferTypeName(value);
        if (bufferName) {
          const buffer = candidates.simpleTypes.get(bufferName);
          if (buffer) return this.forType(buffer.declaredType).inputSteps(value);
          if (candidates.simpleTypes.has('object')) return value;
        }
      }

      if (typeof value === 'function') {
        const assembled = candidates.callbackFunction;
        if (assembled) {
          return new IDLCallbackFunction(
            assembled, value, getCallbackRealm(value, this.realm), this.realm.callbacks.captureContext(), this.binding.callbacks,
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
            this.realm,
          );
          if (asyncMethod && asyncSequence.resolvedType.kind === 'async-sequence') {
            return new IDLAsyncSequence(value, asyncSequence.resolvedType.type, asyncMethod, 'async');
          }
          const syncMethod = getMethod(value, Symbol.iterator, this.realm);
          if (syncMethod && asyncSequence.resolvedType.kind === 'async-sequence') {
            return new IDLAsyncSequence(value, asyncSequence.resolvedType.type, syncMethod, 'sync');
          }
        }

        const sequence = candidates.typesByKind.get('sequence');
        if (sequence && sequence.resolvedType.kind === 'sequence') {
          const method = getMethod(value, Symbol.iterator, this.realm);
          if (method) {
            return (this.forType(sequence.declaredType) as SequenceConverter).jsToIDLIterable(value, method);
          }
        }

        const frozenArray = candidates.typesByKind.get('frozen-array');
        if (frozenArray) {
          const method = getMethod(value, Symbol.iterator, this.realm);
          if (method) {
            return (this.forType(frozenArray.declaredType) as SequenceConverter).jsToIDLIterable(value, method);
          }
        }

        const dictionaryAssembled = candidates.dictionary;
        if (dictionaryAssembled) return this.binding.getDictionaryConverter(dictionaryAssembled, this.realm).inputSteps(value);
        const record = candidates.typesByKind.get('record');
        if (record) return this.forType(record.declaredType).inputSteps(value);
        const callbackInterfaceAssembled = candidates.callbackInterface;
        if (callbackInterfaceAssembled) {
          return new IDLCallbackInterface(
            callbackInterfaceAssembled,
            value,
            getCallbackRealm(value, this.realm),
            this.realm.callbacks.captureContext(),
            this.binding.callbacks,
          );
        }
        if (candidates.simpleTypes.has('object')) return value;
      }

      if (typeof value === 'boolean') {
        if (candidates.simpleTypes.has('boolean')) return value;
      }
      if (typeof value === 'number') {
        const numeric = candidates.numeric;
        if (numeric) return this.forType(numeric.declaredType).inputSteps(value);
      }
      if (typeof value === 'bigint') {
        if (candidates.simpleTypes.has('bigint')) return value;
      }

      const string = candidates.string;
      if (string) return this.forType(string.declaredType).inputSteps(value);

      const numeric = candidates.numeric;
      const bigint = candidates.simpleTypes.has('bigint');
      if (numeric && bigint) {
        const primitive = toPrimitive(value, 'number');
        return typeof primitive === 'bigint'
            ? primitive
            : this.forType(numeric.declaredType).inputSteps(primitive);
      }
      if (numeric) return this.forType(numeric.declaredType).inputSteps(value);

      if (candidates.simpleTypes.has('boolean')) return Boolean(value);
      if (bigint) return toBigInt(value);
      return this.throwTypeError('Value cannot be converted to the union type');
    };
  }

  protected override createOutputSteps(): ConversionSteps {
    const type = this.resolvedType as UnionType;
    const assembly = this.binding.assembly;
    const candidates = assembly.getUnionCandidates(type);
    return (value) => {
      if (value === undefined) {
        if (candidates.simpleTypes.has('undefined')) return undefined;
      }
      if (value === null && assembly.includesNullableType(type)) {
        return null;
      }
      if (isPlatformObject(value, this.binding)) {
        const interfaceType = candidates.interfaces.find((candidate) =>
          this.#implements(candidate, value));
        if (interfaceType) return value;
        if (candidates.simpleTypes.has('object')) return value;
      }
      if (isObject(value)) {
        for (const candidate of candidates.interfaces) {
          if (!('assembled' in candidate)) continue;
          const projected = this.binding.projectImplementationObject(value, candidate.assembled);
          if (projected) return projected;
        }
      }
      if (candidates.callbackFunction) {
        // A callback is only one possible union member; the value selects the branch.
        if (typeof value === 'function') return CallbackFunctionStamper.getObject(value);
        if (IDLCallbackFunction.is(value)) return value.object;
      }
      if (IDLCallbackInterface.is(value)) {
        const assembled = candidates.callbackInterface;
        if (assembled) return value.object;
      }
      if (IDLAsyncSequence.is(value)) {
        const sequence = candidates.typesByKind.get('async-sequence');
        if (sequence) return this.forType(sequence.declaredType).idlToJS(value);
      }
      if (Array.isArray(value)) {
        const array = candidates.array;
        if (array) return this.forType(array.declaredType).idlToJS(value);
      }
      if (value instanceof IDLDictionary) {
        const assembled = candidates.dictionary;
        if (assembled) return this.binding.getDictionaryConverter(assembled, this.realm).idlToJS(value);
      }
      if (isMap(value)) {
        const record = candidates.typesByKind.get('record');
        if (record) return this.forType(record.declaredType).idlToJS(value);
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
        if (buffer) return this.forType(buffer.declaredType).idlToJS(value);
        if (candidates.dictionary) return this.binding.getDictionaryConverter(candidates.dictionary, this.realm).idlToJS(value);
        if (candidates.simpleTypes.has('object')) return value;
      }
      throw new InternalError('IDL union value has no matching specific type');
    };
  }

  #implements(candidate: UnionInterfaceCandidate, value: unknown): boolean {
    if ('assembled' in candidate) {
      const record = getPlatformRecord(value);
      return record?.binding.world === this.binding.world &&
        record.implements(candidate.assembled);
    }
    return candidate.proxy.is(value);
  }
}
