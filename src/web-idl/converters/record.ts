import { InternalError } from '../../infra/index';

import { defineDataProperty, hasMapData, isObject } from '../../js-engine/index';

import type { RecordType, WebIDLType } from '../core/index';

import { Converter, type ConversionSteps } from './converter';

import type { IDLRecord } from '../values/index';

/** Convert own enumerable properties to IDL entries and project them as author data properties. */
// https://webidl.spec.whatwg.org/#es-record
export class RecordConverter<Type extends WebIDLType = WebIDLType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps<IDLRecord> {
    const type = this.resolvedType as RecordType;
    const convertKey = this.forType(type.key).inputSteps;
    const convertValue = this.forType(type.value).inputSteps;
    return (value) => {
      if (!isObject(value)) this.throwTypeError('A record value must be an object');
      const result: IDLRecord = new Map();
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        const typedKey = convertKey(key) as string;
        const typedValue = convertValue((value as Record<PropertyKey, unknown>)[key]);
        result.set(typedKey, typedValue);
      }
      return result;
    };
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    const type = this.resolvedType as RecordType;
    const convertKey = this.forType(type.key).getIDLToJSSteps();
    const convertValue = this.forType(type.value).getIDLToJSSteps();
    return (value) => {
      if (!isMap(value)) throw new InternalError('IDL record is not a map');
      const result = this.realm.createOrdinaryObject(this.realm.intrinsics.objectPrototype);
      for (const [key, entryValue] of value) {
        const jsKey = convertKey(key);
        const jsValue = convertValue(entryValue);
        defineDataProperty(result, jsKey, jsValue);
      }
      return result;
    };
  }
}

/** Recognize Map-backed record values, including Maps from another realm. */
export function isMap(value: unknown): value is IDLRecord {
  return isObject(value) && hasMapData(value);
}
