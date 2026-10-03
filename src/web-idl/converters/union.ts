import { InternalError } from '../../infra/index';
import {
  getBufferTypeName, getMethod, hasStringData, isObject, toBigInt, toPrimitive,
} from '../../js-engine/index';

import type { IDLUnionType, UnionInterfaceCandidate } from '../assembly/index';
import { IDLAsyncSequence, IDLCallbackFunction, IDLCallbackInterface, IDLDictionary } from '../values/index';
import { getPlatformRecord, isPlatformObject } from '../binding/platform';
import { CallbackFunctionStamper } from '../binding/realm/callback';

import { Converter, type ConversionSteps } from './converter';
import { getCallbackRealm } from './callback';
import { isMap } from './record';

/** Select union branches from the value while retaining the declaration's prepared candidates. */
// https://webidl.spec.whatwg.org/#es-union
export class UnionConverter<Type extends IDLUnionType = IDLUnionType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    const type = this.type;
    const assembly = this.binding.assembly;
    const candidates = assembly.getUnionCandidates(type);
    return (value) => {
      if (value === undefined && candidates.hasUndefined) {
        return undefined;
      }
      if (
          (value === null || value === undefined) &&
          assembly.includesNullableType(type)
      ) return null;

      if (value === null || value === undefined) {
        const assembled = candidates.dictionary;
        if (assembled) return this.forType(assembled).inputSteps(value);
      }

      if (isPlatformObject(value, this.binding)) {
        const interfaceType = candidates.interfaces.find((candidate) =>
          this.#implements(candidate, value));
        if (interfaceType) {
          return this.forType(interfaceType).inputSteps(value);
        }
        if (candidates.hasObject) return value;
      }
      if (isObject(value)) {
        const bufferName = getBufferTypeName(value);
        if (bufferName) {
          const buffer = candidates.buffers.get(bufferName);
          if (buffer) return this.forType(buffer).inputSteps(value);
          if (candidates.hasObject) return value;
        }
      }

      if (typeof value === 'function') {
        const assembled = candidates.callbackFunction;
        if (assembled) {
          return new IDLCallbackFunction(
            assembled.assembled, value, getCallbackRealm(value, this.realm), this.realm.callbacks.captureContext(), this.binding.callbacks,
          );
        }
        if (candidates.hasObject) return value;
      }

      if (isObject(value)) {
        const asyncSequence = candidates.asyncSequence;
        if (asyncSequence && !(hasStringData(value) && candidates.string)) {
          const asyncMethod = getMethod(
            value,
            Symbol.asyncIterator,
            this.realm,
          );
          if (asyncMethod) {
            return new IDLAsyncSequence(value, asyncSequence.elementType, asyncMethod, 'async');
          }
          const syncMethod = getMethod(value, Symbol.iterator, this.realm);
          if (syncMethod) {
            return new IDLAsyncSequence(value, asyncSequence.elementType, syncMethod, 'sync');
          }
        }

        const sequence = candidates.sequence;
        if (sequence) {
          const method = getMethod(value, Symbol.iterator, this.realm);
          if (method) {
            return this.forType(sequence).jsToIDLIterable(value, method);
          }
        }

        const frozenArray = candidates.frozenArray;
        if (frozenArray) {
          const method = getMethod(value, Symbol.iterator, this.realm);
          if (method) {
            return this.forType(frozenArray).jsToIDLIterable(value, method);
          }
        }

        const dictionaryAssembled = candidates.dictionary;
        if (dictionaryAssembled) return this.forType(dictionaryAssembled).inputSteps(value);
        const record = candidates.record;
        if (record) return this.forType(record).inputSteps(value);
        const callbackInterfaceAssembled = candidates.callbackInterface;
        if (callbackInterfaceAssembled) {
          return new IDLCallbackInterface(
            callbackInterfaceAssembled.assembled,
            value,
            getCallbackRealm(value, this.realm),
            this.realm.callbacks.captureContext(),
            this.binding.callbacks,
          );
        }
        if (candidates.hasObject) return value;
      }

      if (typeof value === 'boolean') {
        if (candidates.hasBoolean) return value;
      }
      if (typeof value === 'number') {
        const numeric = candidates.numeric;
        if (numeric) return this.forType(numeric).inputSteps(value);
      }
      if (typeof value === 'bigint') {
        if (candidates.hasBigInt) return value;
      }

      const string = candidates.string;
      if (string) return this.forType(string).inputSteps(value);

      const numeric = candidates.numeric;
      const bigint = candidates.hasBigInt;
      if (numeric && bigint) {
        const primitive = toPrimitive(value, 'number');
        return typeof primitive === 'bigint'
            ? primitive
            : this.forType(numeric).inputSteps(primitive);
      }
      if (numeric) return this.forType(numeric).inputSteps(value);

      if (candidates.hasBoolean) return Boolean(value);
      if (bigint) return toBigInt(value);
      return this.throwTypeError('Value cannot be converted to the union type');
    };
  }

  protected override createOutputSteps(): ConversionSteps {
    const type = this.type;
    const assembly = this.binding.assembly;
    const candidates = assembly.getUnionCandidates(type);
    return (value) => {
      if (value === undefined) {
        if (candidates.hasUndefined) return undefined;
      }
      if (value === null && assembly.includesNullableType(type)) {
        return null;
      }
      if (isPlatformObject(value, this.binding)) {
        const interfaceType = candidates.interfaces.find((candidate) =>
          this.#implements(candidate, value));
        if (interfaceType) return value;
        if (candidates.hasObject) return value;
      }
      if (isObject(value)) {
        for (const candidate of candidates.interfaces) {
          if (candidate.kind !== 'interface') continue;
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
        const sequence = candidates.asyncSequence;
        if (sequence) return this.forType(sequence).idlToJS(value);
      }
      if (Array.isArray(value)) {
        const array = candidates.array;
        if (array) return this.forType(array).idlToJS(value);
      }
      if (value instanceof IDLDictionary) {
        const assembled = candidates.dictionary;
        if (assembled) return this.forType(assembled).idlToJS(value);
      }
      if (isMap(value)) {
        const record = candidates.record;
        if (record) return this.forType(record).idlToJS(value);
      }
      if (typeof value === 'boolean') {
        if (candidates.hasBoolean) return value;
      }
      if (typeof value === 'number') {
        if (candidates.numeric) return value;
      }
      if (typeof value === 'bigint') {
        if (candidates.hasBigInt) return value;
      }
      if (typeof value === 'string') {
        if (candidates.string) return value;
      }
      if (isObject(value)) {
        const bufferName = getBufferTypeName(value);
        const buffer = bufferName && candidates.buffers.get(bufferName);
        if (buffer) return this.forType(buffer).idlToJS(value);
        if (candidates.dictionary) return this.forType(candidates.dictionary).idlToJS(value);
        if (candidates.hasObject) return value;
      }
      throw new InternalError('IDL union value has no matching specific type');
    };
  }

  #implements(candidate: UnionInterfaceCandidate, value: unknown): boolean {
    if (candidate.kind === 'interface') {
      const record = getPlatformRecord(value);
      return record?.binding.world === this.binding.world &&
        record.implements(candidate.assembled);
    }
    return candidate.assembled.is(value);
  }
}
