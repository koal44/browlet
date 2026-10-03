import { InternalError } from '../../infra/index';
import { defineDataProperty, hasMapData, isObject } from '../../js-engine/index';

import type { IDLRecordType } from '../assembly/index';
import type { IDLRecord, IDLValue } from '../values/index';
import { Converter, type ConversionSteps } from './converter';

/** Convert own enumerable properties to IDL entries and project them as author data properties. */
// https://webidl.spec.whatwg.org/#es-record
export class RecordConverter<Type extends IDLRecordType = IDLRecordType> extends Converter<Type> {
  protected createInputSteps(): ConversionSteps<IDLRecord<IDLValue<Type['valueType']>>> {
    const type = this.type;
    const convertKey = this.forType(type.keyType).getInputSteps();
    const convertValue = this.forType<Type['valueType']>(type.valueType).getInputSteps();
    return (value) => {
      if (!isObject(value)) this.throwTypeError('A record value must be an object');
      const result: IDLRecord<IDLValue<Type['valueType']>> = new Map();
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) continue;
        const typedKey = convertKey(key);
        const typedValue = convertValue((value as Record<PropertyKey, unknown>)[key]);
        result.set(typedKey, typedValue);
      }
      return result;
    };
  }

  protected override createOutputSteps(): ConversionSteps<object> {
    const type = this.type;
    const convertValue = this.forType(type.valueType).getIDLToJSSteps();
    return (value) => {
      if (!isObject(value)) throw new InternalError('IDL record is not an object');
      const result = this.realm.createOrdinaryObject(this.realm.intrinsics.objectPrototype);
      if (isMap(value)) {
        for (const [key, entryValue] of value) {
          defineDataProperty(result, key, convertValue(entryValue));
        }
      } else {
        // Implementation conversion consumes IDL Maps as plain records.
        const entries = value as Record<string, unknown>;
        for (const key in entries) {
          if (Object.hasOwn(entries, key)) defineDataProperty(result, key, convertValue(entries[key]));
        }
      }
      return result;
    };
  }
}

/** Recognize Map-backed record values, including Maps from another realm. */
export function isMap(value: unknown): value is IDLRecord {
  return isObject(value) && hasMapData(value);
}
