import { InternalError } from '../../infra/index';
import { defineDataProperty, hasMapData, isObject } from '../../js-engine/index';

import type { IDLRecordType } from '../assembly/index';
import type { IDLRecord } from '../values/index';
import { Converter, type ConversionSteps } from './converter';

/** Convert own enumerable properties to IDL entries and project them as author data properties. */
// https://webidl.spec.whatwg.org/#es-record
export class RecordConverter<Type extends IDLRecordType = IDLRecordType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps<IDLRecord> {
    const type = this.type;
    const convertKey = this.forType(type.keyType).inputSteps;
    const convertValue = this.forType(type.valueType).inputSteps;
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
    const type = this.type;
    const convertKey = this.forType(type.keyType).getIDLToJSSteps();
    const convertValue = this.forType(type.valueType).getIDLToJSSteps();
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
