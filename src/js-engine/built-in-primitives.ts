import { types as nodeTypes } from 'node:util';

import { addon } from './node-addons';
import type { JSRealm } from './realm';
import { InternalError } from '../infra/internal-error';

/* eslint-disable @typescript-eslint/no-wrapper-object-types -- These operations inspect boxed primitive objects. */

/**
 * Node/V8 primitives for inspecting built-in data and object kinds.
 *
 * These operations report JavaScript-engine facts and read internal state.
 * They do not apply Web IDL conversion, decide HTML serializability, or create
 * platform exceptions.
 */

export const isArgumentsObject: (value: unknown) => value is IArguments = nodeTypes.isArgumentsObject;
export const isArrayIteratorObject = addon.getMethod('isArrayIterator');
export const hasBigIntData: (value: unknown) => value is BigInt = nodeTypes.isBigIntObject;
export const hasBooleanData: (value: unknown) => value is Boolean = nodeTypes.isBooleanObject;
export const isCryptoKeyObject: (value: unknown) => boolean = nodeTypes.isCryptoKey;
export const hasDateValue: (value: unknown) => value is Date = nodeTypes.isDate;
export const isExternalObject: (value: unknown) => boolean = nodeTypes.isExternal;
export const isGeneratorObject: (value: unknown) => value is Generator<unknown, unknown, unknown> = nodeTypes.isGeneratorObject;
export const isKeyObject: (value: unknown) => boolean = nodeTypes.isKeyObject;
export const hasMapData: (value: unknown) => value is Map<unknown, unknown> = nodeTypes.isMap;
export const isModuleNamespaceObject: (value: unknown) => boolean =
  nodeTypes.isModuleNamespaceObject;
export const hasErrorData: (value: unknown) => value is Error = nodeTypes.isNativeError;
export const hasNumberData: (value: unknown) => value is Number = nodeTypes.isNumberObject;
export const isPromiseObject: (value: unknown) => value is Promise<unknown> = nodeTypes.isPromise;
export const isProxyObject: (value: unknown) => boolean = nodeTypes.isProxy;
export const hasRegExpMatcher: (value: unknown) => value is RegExp = nodeTypes.isRegExp;
export const isRegExpStringIteratorObject = addon.getMethod('isRegExpStringIterator');
export const hasSetData: (value: unknown) => value is Set<unknown> = nodeTypes.isSet;
export const hasStringData: (value: unknown) => value is String = nodeTypes.isStringObject;
export const isStringIteratorObject = addon.getMethod('isStringIterator');
export const hasSymbolData: (value: unknown) => value is Symbol = nodeTypes.isSymbolObject;
export const isWeakMapObject: (value: unknown) => value is WeakMap<object, unknown> = nodeTypes.isWeakMap;
export const isWeakSetObject: (value: unknown) => value is WeakSet<object> = nodeTypes.isWeakSet;

export function isMapIteratorObject(value: unknown): value is MapIterator<unknown> {
  return nodeTypes.isMapIterator(value);
}

export function isSetIteratorObject(value: unknown): value is SetIterator<unknown> {
  return nodeTypes.isSetIterator(value);
}

export function getBooleanData(value: Boolean): boolean {
  return Reflect.apply(booleanValueOf, value, []);
}

export function getNumberData(value: Number): number {
  return Reflect.apply(numberValueOf, value, []);
}

export function getBigIntData(value: BigInt): bigint {
  return Reflect.apply(bigIntValueOf, value, []);
}

export function getStringData(value: String): string {
  return Reflect.apply(stringValueOf, value, []);
}

export function getDateValue(value: Date): number {
  return Reflect.apply(dateValueOf, value, []);
}

export function getRegExpData(value: RegExp): RegExpData {
  let flags = '';
  for (const [getter, flag] of regExpFlagAccessors) {
    if (getter && Reflect.apply(getter, value, []) === true) flags += flag;
  }
  return {
    flags,
    source: Reflect.apply(regExpSource, value, []),
  };
}

export type RegExpData = {
  flags: string;
  source: string;
};

export function copyMapData<Key, Value>(value: Map<Key, Value>): Array<[Key, Value]> {
  const iterator = Reflect.apply(mapEntries, value, []);
  const copied: Array<[Key, Value]> = [];
  while (true) {
    const result = Reflect.apply(mapIteratorNext, iterator, []) as IteratorResult<[Key, Value]>;
    if (result.done) return copied;
    copied.push([result.value[0], result.value[1]]);
  }
}

export function appendMapData<Key, Value>(
  value: Map<Key, Value>,
  key: NoInfer<Key>,
  entryValue: NoInfer<Value>,
): void {
  Reflect.apply(mapSet, value, [key, entryValue]);
}

export function copySetData<Value>(value: Set<Value>): Value[] {
  const iterator = Reflect.apply(setValues, value, []);
  const copied: Value[] = [];
  while (true) {
    const result = Reflect.apply(setIteratorNext, iterator, []) as IteratorResult<Value>;
    if (result.done) return copied;
    copied.push(result.value);
  }
}

export function appendSetData<Value>(value: Set<Value>, entryValue: NoInfer<Value>): void {
  Reflect.apply(setAdd, value, [entryValue]);
}

/*
 * ACCOMMODATION(node-v8-error-stack): ECMAScript does not expose [[Stack]].
 * V8 represents it through a realm-specific own accessor until userland or
 * structured deserialization replaces that accessor with a data property.
 * Reading or writing that representation only approximates internal-slot
 * access; HTML and Web IDL decide the serialized form. Native formatting may
 * run author name/message getters or Error.prepareStackTrace; a formatting
 * failure leaves the stack unavailable rather than failing serialization.
 */
export function readErrorStack(
  value: object,
  realm: JSRealm,
): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'stack');
  if (!descriptor) return;
  if ('value' in descriptor) return descriptor.value;

  const getter = realm.intrinsics.errorStack;
  if (!getter || descriptor.get !== getter) return;
  try {
    return Reflect.apply(getter, value, []);
  } catch {
    return undefined;
  }
}

export function writeErrorStack(value: object, stack: string): void {
  const defined = Reflect.defineProperty(value, 'stack', {
    configurable: true,
    enumerable: false,
    value: stack,
    writable: true,
  });
  if (!defined) throw new InternalError('Could not restore an Error stack');
}

export function isWeakRefObject(value: unknown): value is WeakRef<object> {
  if (!weakRefDeref) return false;
  try {
    Reflect.apply(weakRefDeref, value, []);
    return true;
  } catch {
    return false;
  }
}

export function isFinalizationRegistryObject(value: unknown): value is FinalizationRegistry<unknown> {
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

function getAccessor<Value>(
  object: object,
  key: PropertyKey,
): (this: object) => Value {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (typeof descriptor?.get !== 'function') {
    throw new InternalError(`Missing intrinsic accessor ${String(key)}`);
  }
  return descriptor.get as (this: object) => Value;
}

function getOptionalAccessor<Value>(
  object: object,
  key: PropertyKey,
): ((this: object) => Value) | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  return typeof descriptor?.get === 'function' ? descriptor.get as (this: object) => Value : undefined;
}

/* eslint-disable @typescript-eslint/unbound-method -- Captured intrinsics are invoked with explicit receivers. */
const booleanValueOf = Boolean.prototype.valueOf;
const numberValueOf = Number.prototype.valueOf;
const bigIntValueOf = BigInt.prototype.valueOf;
const stringValueOf = String.prototype.valueOf;
const dateValueOf = Date.prototype.getTime;
/* eslint-enable @typescript-eslint/unbound-method */
const regExpSource = getAccessor<string>(RegExp.prototype, 'source');
const regExpFlagAccessors = [
  [getOptionalAccessor<boolean>(RegExp.prototype, 'hasIndices'), 'd'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'global'), 'g'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'ignoreCase'), 'i'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'multiline'), 'm'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'dotAll'), 's'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'unicode'), 'u'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'unicodeSets'), 'v'],
  [getOptionalAccessor<boolean>(RegExp.prototype, 'sticky'), 'y'],
] as const;

const mapEntries = Reflect.get(
  Map.prototype,
  'entries',
) as (this: Map<unknown, unknown>) => MapIterator<[unknown, unknown]>;
const mapSet = Reflect.get(
  Map.prototype,
  'set',
) as (this: Map<unknown, unknown>, key: unknown, value: unknown) => Map<unknown, unknown>;
const mapIteratorNext = Reflect.get(
  Reflect.getPrototypeOf(new Map().entries())!,
  'next',
) as (this: MapIterator<[unknown, unknown]>) => IteratorResult<[unknown, unknown]>;
const setValues = Reflect.get(
  Set.prototype,
  'values',
) as (this: Set<unknown>) => SetIterator<unknown>;
const setAdd = Reflect.get(
  Set.prototype,
  'add',
) as (this: Set<unknown>, value: unknown) => Set<unknown>;
const setIteratorNext = Reflect.get(
  Reflect.getPrototypeOf(new Set().values())!,
  'next',
) as (this: SetIterator<unknown>) => IteratorResult<unknown>;

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
