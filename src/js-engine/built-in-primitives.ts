import { types as nodeTypes } from 'node:util';

import type { JavaScriptRealm } from './realm';

/**
 * Node/V8 primitives for inspecting built-in data and object kinds.
 *
 * These operations report JavaScript-engine facts and read internal state.
 * They do not apply Web IDL conversion, decide HTML serializability, or create
 * platform exceptions.
 */

type ObjectPredicate = (value: object) => boolean;

export const isArgumentsObject: ObjectPredicate = nodeTypes.isArgumentsObject;
export const hasBigIntData: ObjectPredicate = nodeTypes.isBigIntObject;
export const hasBooleanData: ObjectPredicate = nodeTypes.isBooleanObject;
export const isCryptoKeyObject: ObjectPredicate = nodeTypes.isCryptoKey;
export const hasDateValue: ObjectPredicate = nodeTypes.isDate;
export const isExternalObject: ObjectPredicate = nodeTypes.isExternal;
export const isGeneratorObject: ObjectPredicate = nodeTypes.isGeneratorObject;
export const isKeyObject: ObjectPredicate = nodeTypes.isKeyObject;
export const hasMapData: ObjectPredicate = nodeTypes.isMap;
export const isMapIteratorObject: ObjectPredicate = nodeTypes.isMapIterator;
export const isModuleNamespaceObject: ObjectPredicate =
  nodeTypes.isModuleNamespaceObject;
export const hasErrorData: ObjectPredicate = nodeTypes.isNativeError;
export const hasNumberData: ObjectPredicate = nodeTypes.isNumberObject;
export const isPromiseObject: ObjectPredicate = nodeTypes.isPromise;
export const isProxyObject: ObjectPredicate = nodeTypes.isProxy;
export const hasRegExpMatcher: ObjectPredicate = nodeTypes.isRegExp;
export const hasSetData: ObjectPredicate = nodeTypes.isSet;
export const isSetIteratorObject: ObjectPredicate = nodeTypes.isSetIterator;
export const hasStringData: ObjectPredicate = nodeTypes.isStringObject;
export const hasSymbolData: ObjectPredicate = nodeTypes.isSymbolObject;
export const isWeakMapObject: ObjectPredicate = nodeTypes.isWeakMap;
export const isWeakSetObject: ObjectPredicate = nodeTypes.isWeakSet;

export function getBooleanData(value: object): boolean {
  return Reflect.apply(booleanValueOf, value, []);
}

export function getNumberData(value: object): number {
  return Reflect.apply(numberValueOf, value, []);
}

export function getBigIntData(value: object): bigint {
  return Reflect.apply(bigIntValueOf, value, []);
}

export function getStringData(value: object): string {
  return Reflect.apply(stringValueOf, value, []);
}

export function getDateValue(value: object): number {
  return Reflect.apply(dateValueOf, value, []);
}

export function getRegExpData(value: object): RegExpData {
  let flags = '';
  for (const [getter, flag] of regExpFlagAccessors) {
    if (getter && Reflect.apply(getter, value, []) === true) flags += flag;
  }
  return {
    flags,
    source: Reflect.apply(regExpSource, value, []) as string,
  };
}

export type RegExpData = {
  flags: string;
  source: string;
};

export function copyMapData(value: object): Array<[unknown, unknown]> {
  const iterator = Reflect.apply(mapEntries, value, []) as object;
  const copied: Array<[unknown, unknown]> = [];
  while (true) {
    const result = Reflect.apply(mapIteratorNext, iterator, []);
    if (result.done) return copied;
    copied.push([result.value[0], result.value[1]]);
  }
}

export function appendMapData(
  value: object,
  key: unknown,
  entryValue: unknown,
): void {
  Reflect.apply(mapSet, value, [key, entryValue]);
}

export function copySetData(value: object): unknown[] {
  const iterator = Reflect.apply(setValues, value, []) as object;
  const copied: unknown[] = [];
  while (true) {
    const result = Reflect.apply(setIteratorNext, iterator, []);
    if (result.done) return copied;
    copied.push(result.value);
  }
}

export function appendSetData(value: object, entryValue: unknown): void {
  Reflect.apply(setAdd, value, [entryValue]);
}

/*
 * ACCOMMODATION(node-v8-error-stack): ECMAScript does not expose [[Stack]].
 * V8 represents it through a realm-specific own accessor until userland or
 * structured deserialization replaces that accessor with a data property.
 * Reading or writing that representation only approximates internal-slot
 * access; HTML decides the serialized form.
 */
export function readErrorStack(
  value: object,
  realm: JavaScriptRealm,
): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'stack');
  if (!descriptor) return;
  if ('value' in descriptor) return descriptor.value;

  const getter = realm.intrinsics.errorStack;
  return getter && descriptor.get === getter
    ? Reflect.apply(getter, value, [])
    : undefined;
}

export function writeErrorStack(value: object, stack: string): void {
  const defined = Reflect.defineProperty(value, 'stack', {
    configurable: true,
    enumerable: false,
    value: stack,
    writable: true,
  });
  if (!defined) throw new Error('Could not restore an Error stack');
}

export function isWeakRefObject(value: object): boolean {
  if (!weakRefDeref) return false;
  try {
    Reflect.apply(weakRefDeref, value, []);
    return true;
  } catch {
    return false;
  }
}

export function isFinalizationRegistryObject(value: object): boolean {
  if (!finalizationRegistryUnregister) return false;
  try {
    Reflect.apply(finalizationRegistryUnregister, value, [brandProbe]);
    return true;
  } catch {
    return false;
  }
}

/*
 * ACCOMMODATION(node-v8-exotic-object-slots): Node exposes no predicates for
 * every V8 object kind. For a propertyless object, native structured cloning
 * can identify an unsupported exotic without traversing an author-controlled
 * property graph or advancing an iterator.
 */
export function nativeCloneRejectsPropertylessObject(value: object): boolean {
  if (Object.keys(value).length !== 0) return false;

  try {
    nativeStructuredClone(value);
    return false;
  } catch (error) {
    if (isNativeDataCloneError(error)) return true;
    throw error;
  }
}

function isNativeDataCloneError(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    Reflect.get(value, 'name') === 'DataCloneError';
}

function getAccessor(
  object: object,
  key: PropertyKey,
): (this: object) => unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (typeof descriptor?.get !== 'function') {
    throw new Error(`Missing intrinsic accessor ${String(key)}`);
  }
  return descriptor.get;
}

function getOptionalAccessor(
  object: object,
  key: PropertyKey,
): ((this: object) => unknown) | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  return typeof descriptor?.get === 'function' ? descriptor.get : undefined;
}

const booleanValueOf = Reflect.get(Boolean.prototype, 'valueOf');
const numberValueOf = Reflect.get(Number.prototype, 'valueOf');
const bigIntValueOf = Reflect.get(BigInt.prototype, 'valueOf');
const stringValueOf = Reflect.get(String.prototype, 'valueOf');
const dateValueOf = Reflect.get(Date.prototype, 'getTime');
const regExpSource = getAccessor(RegExp.prototype, 'source');
const regExpFlagAccessors = [
  [getOptionalAccessor(RegExp.prototype, 'hasIndices'), 'd'],
  [getOptionalAccessor(RegExp.prototype, 'global'), 'g'],
  [getOptionalAccessor(RegExp.prototype, 'ignoreCase'), 'i'],
  [getOptionalAccessor(RegExp.prototype, 'multiline'), 'm'],
  [getOptionalAccessor(RegExp.prototype, 'dotAll'), 's'],
  [getOptionalAccessor(RegExp.prototype, 'unicode'), 'u'],
  [getOptionalAccessor(RegExp.prototype, 'unicodeSets'), 'v'],
  [getOptionalAccessor(RegExp.prototype, 'sticky'), 'y'],
] as const;

const mapEntries = Reflect.get(
  Map.prototype,
  'entries',
) as (this: object) => MapIterator<[unknown, unknown]>;
const mapSet = Reflect.get(
  Map.prototype,
  'set',
) as (this: object, key: unknown, value: unknown) => object;
const mapIteratorNext = Reflect.get(
  Reflect.getPrototypeOf(new Map().entries())!,
  'next',
) as (this: object) => IteratorResult<[unknown, unknown]>;
const setValues = Reflect.get(
  Set.prototype,
  'values',
) as (this: object) => SetIterator<unknown>;
const setAdd = Reflect.get(
  Set.prototype,
  'add',
) as (this: object, value: unknown) => object;
const setIteratorNext = Reflect.get(
  Reflect.getPrototypeOf(new Set().values())!,
  'next',
) as (this: object) => IteratorResult<unknown>;

const weakRefDeref = typeof WeakRef === 'undefined'
  ? undefined
  : Reflect.get(
    WeakRef.prototype,
    'deref',
  ) as (this: object) => object | undefined;
const finalizationRegistryUnregister = typeof FinalizationRegistry === 'undefined'
  ? undefined
  : Reflect.get(
    FinalizationRegistry.prototype,
    'unregister',
  );
const brandProbe = {};
const nativeStructuredClone = globalThis.structuredClone;
