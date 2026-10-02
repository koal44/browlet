import { defineDataProperty, hasMapData, isObject } from '../../js-engine/index';
import { InternalError } from '../../infra/internal-error';
import type { RecordType } from '../core/types';
import type { ConversionContext } from '../conversion-context';
import { _jsToIDL, idlToJS } from '../conversion';

/** Converted record keys and values in their author-provided property order. */
export type IDLRecord = Map<string, unknown>;

/** Convert enumerable own properties into ordered IDL record entries. */
// https://webidl.spec.whatwg.org/#es-record
export function jsToIDLRecord(
  value: unknown,
  context: ConversionContext,
): IDLRecord {
  const type = context.resolvedType as RecordType;
  if (!isObject(value)) {
    context.throwTypeError('A record value must be an object');
  }

  const keyContext = context.forType(type.key);
  const valueContext = context.forType(type.value);
  const result: IDLRecord = new Map();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    const typedKey = _jsToIDL(key, keyContext);
    const typedValue = _jsToIDL((value as Record<PropertyKey, unknown>)[key], valueContext);
    result.set(typedKey, typedValue);
  }
  return result;
}

/** Project record entries as own data properties in the conversion realm. */
// https://webidl.spec.whatwg.org/#es-record
export function idlToJSRecord(
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

/** Recognize Map-backed record values, including Maps from another realm. */
export function isMap(value: unknown): value is Map<string, unknown> {
  return isObject(value) && hasMapData(value);
}
