import { assertNever, InternalError } from '../../infra/index';
import {
  getBufferTypeName, getMethod, hasStringData, toBigInt, toPrimitive,
} from '../../js-engine/index';

import type { IDLUnionType, UnionInterfaceCandidate } from '../assembly/index';
import { IDLAsyncSequence, IDLCallbackFunction, IDLCallbackInterface, IDLDictionary } from '../values/index';
import { getPlatformRecord } from '../binding/platform';
import { CallbackFunctionStamper } from '../binding/realm/callback';

import { Converter, type ConversionSteps } from './converter';
import { isMap } from './record';

/** Select union branches from the value while retaining the declaration's prepared candidates. */
// https://webidl.spec.whatwg.org/#es-union
export class UnionConverter<Type extends IDLUnionType = IDLUnionType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps {
    const candidates = this.type.candidates;
    const convertCbFunction = candidates.callbackFunction && this.forType(candidates.callbackFunction).getInputSteps();
    const convertCbInterface = candidates.callbackInterface && this.forType(candidates.callbackInterface).getInputSteps();
    const convertNumber = candidates.numeric && this.forType(candidates.numeric).getInputSteps();
    const convertString = candidates.string && this.forType(candidates.string).getInputSteps();

    return (value) => {
      const type = typeof value;

      switch (type) {
        case 'boolean':
          if (candidates.hasBoolean) return value;
          break;

        case 'number':
          if (convertNumber) return convertNumber(value);
          break;

        case 'bigint':
          if (candidates.hasBigInt) return value;
          break;

        case 'string':
          break; // Use the shared string conversion below.

        case 'undefined':
        case 'object':
        case 'function': {
          if (value === undefined && candidates.hasUndefined) return undefined;
          if (value === null || value === undefined) {
            if (candidates.hasNullable) return null;
            const dictionary = candidates.dictionary;
            if (dictionary) return this.forType(dictionary).getInputSteps()(value);
            break;
          }

          if (this.binding.isPlatformObject(value)) {
            const interfaceType = candidates.interfaces.find((candidate) =>
              this.#implements(candidate, value));
            if (interfaceType) {
              return this.forType(interfaceType).getInputSteps()(value);
            }
            if (candidates.hasObject) return value;
          }

          const bufferName = getBufferTypeName(value);
          if (bufferName) {
            const buffer = candidates.buffers.get(bufferName);
            if (buffer) return this.forType(buffer).getInputSteps()(value);
            if (candidates.hasObject) return value;
          }

          if (type === 'function') {
            if (convertCbFunction) return convertCbFunction(value);
            if (candidates.hasObject) return value;
          }

          const asyncSequence = candidates.asyncSequence;
          if (asyncSequence && !(hasStringData(value) && candidates.string)) {
            const asyncMethod = getMethod(value, Symbol.asyncIterator, this.realm);
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

          const dictionary = candidates.dictionary;
          if (dictionary) return this.forType(dictionary).getInputSteps()(value);
          const record = candidates.record;
          if (record) return this.forType(record).getInputSteps()(value);
          if (convertCbInterface) return convertCbInterface(value);
          if (candidates.hasObject) return value;
          break;
        }

        // SPEC_GAP(webidl-symbol-selection): Union selection omits symbols.
        case 'symbol':
          if (candidates.hasSymbol) return value;
          break;

        default: assertNever(type);
      }

      // Coercion fallbacks.
      if (convertString) return convertString(value);
      if (convertNumber) {
        if (candidates.hasBigInt) {
          // An object can still produce a bigint during numeric coercion.
          value = toPrimitive(value, 'number');
          if (typeof value === 'bigint') return value;
        }
        return convertNumber(value);
      }
      if (candidates.hasBoolean) return Boolean(value);
      if (candidates.hasBigInt) return toBigInt(value);
      return this.throwTypeError('Value cannot be converted to the union type');
    };
  }

  protected override createOutputSteps(): ConversionSteps {
    const candidates = this.type.candidates;
    return (value) => {
      switch (typeof value) {
        case 'undefined': if (candidates.hasUndefined) return value; break;
        case 'boolean': if (candidates.hasBoolean) return value; break;
        case 'number': if (candidates.numeric) return value; break;
        case 'bigint': if (candidates.hasBigInt) return value; break;
        case 'string': if (candidates.string) return value; break;
        case 'object': case 'function': {
          if (value === null) {
            if (candidates.hasNullable) return null;
            break;
          }
          if (this.binding.isPlatformObject(value)) {
            const interfaceType = candidates.interfaces.find((candidate) =>
              this.#implements(candidate, value));
            if (interfaceType) return value;
            if (candidates.hasObject) return this.binding.realizeException(value);
          }
          for (const candidate of candidates.interfaces) {
            if (candidate.kind !== 'interface') continue;
            const projected = this.binding.projectImplementationObject(value, candidate.assembled);
            if (projected) return projected;
          }
          if (candidates.callbackFunction) {
            // A callback is only one possible union member; the value selects the branch.
            if (typeof value === 'function') return CallbackFunctionStamper.getObject(value);
            if (IDLCallbackFunction.is(value)) return value.object;
          }
          if (IDLCallbackInterface.is(value) && candidates.callbackInterface) return value.object;
          if (IDLAsyncSequence.is(value) && candidates.asyncSequence) {
            return this.forType(candidates.asyncSequence).idlToJS(value);
          }
          if (Array.isArray(value) && candidates.array) return this.forType(candidates.array).idlToJS(value);
          if (value instanceof IDLDictionary && candidates.dictionary) {
            return this.forType(candidates.dictionary).idlToJS(value);
          }
          if (isMap(value) && candidates.record) return this.forType(candidates.record).idlToJS(value);
          const bufferName = getBufferTypeName(value);
          const buffer = bufferName && candidates.buffers.get(bufferName);
          if (buffer) return this.forType(buffer).idlToJS(value);
          if (candidates.dictionary) return this.forType(candidates.dictionary).idlToJS(value);
          if (candidates.record) return this.forType(candidates.record).idlToJS(value);
          if (candidates.hasObject) return this.binding.realizeException(value);
          break;
        }
        case 'symbol': if (candidates.hasSymbol) return value; break;
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
