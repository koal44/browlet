import { types as nodeTypes } from 'node:util';

import { InternalError } from '../infra/internal-error';

import { addon } from './node-addons';
import type { JSRealm } from './realm';

/* eslint-disable @typescript-eslint/no-wrapper-object-types -- These operations inspect boxed primitive objects. */

/**
 * Node/V8 primitives for inspecting built-in data and object kinds.
 *
 * These operations report JavaScript-engine facts and read internal state.
 * They do not apply Web IDL conversion, decide HTML serializability, or create
 * platform exceptions.
 */

export const isArgumentsObject: (value: unknown) => value is IArguments = nodeTypes.isArgumentsObject;
export const isArrayIteratorObject = addon.isArrayIterator;
export const hasBigIntData: (value: unknown) => value is BigInt = nodeTypes.isBigIntObject;
export const hasBooleanData: (value: unknown) => value is Boolean = nodeTypes.isBooleanObject;
export const isCryptoKeyObject: (value: unknown) => boolean = nodeTypes.isCryptoKey;
export const hasDateValue: (value: unknown) => value is Date = nodeTypes.isDate;
export const isExternalObject: (value: unknown) => boolean = nodeTypes.isExternal;
export const isGeneratorObject: (value: unknown) => value is Generator<unknown, unknown, unknown> = nodeTypes.isGeneratorObject;
export const isKeyObject: (value: unknown) => boolean = nodeTypes.isKeyObject;
export const hasMapData: (value: unknown) => value is Map<unknown, unknown> = nodeTypes.isMap;
export const isModuleNamespaceObject: (value: unknown) => boolean = nodeTypes.isModuleNamespaceObject;
export const hasErrorData: (value: unknown) => value is Error = nodeTypes.isNativeError;
export const hasNumberData: (value: unknown) => value is Number = nodeTypes.isNumberObject;
export const isPromiseObject: (value: unknown) => value is Promise<unknown> = nodeTypes.isPromise;
export const isProxyObject: (value: unknown) => boolean = nodeTypes.isProxy;
export const hasRegExpMatcher: (value: unknown) => value is RegExp = nodeTypes.isRegExp;
export const isRegExpStringIteratorObject = addon.isRegExpStringIterator;
export const hasSetData: (value: unknown) => value is Set<unknown> = nodeTypes.isSet;
export const hasStringData: (value: unknown) => value is String = nodeTypes.isStringObject;
export const isStringIteratorObject = addon.isStringIterator;
export const hasSymbolData: (value: unknown) => value is Symbol = nodeTypes.isSymbolObject;
export const isWeakMapObject: (value: unknown) => value is WeakMap<object, unknown> = nodeTypes.isWeakMap;
export const isWeakSetObject: (value: unknown) => value is WeakSet<object> = nodeTypes.isWeakSet;

/** Recognize a genuine Module across realms. Select the native or fallback check once at initialization. */
export const isWebAssemblyModule = (addon.isWebAssemblyModule ?? isWebAssemblyModuleFallback) as
  (value: unknown) => value is JSWebAssemblyModule;

/** Check the engine's Instance brand without changing its identity or consulting its prototype. */
export function isWebAssemblyInstance(value: unknown): value is JSWebAssemblyInstance {
  try { Reflect.apply(wasmInstanceExports, value as object, []); return true; }
  catch (error) { if (error instanceof nativeTypeError) return false; throw error; }
}

/** Recognize a native Memory without reading author properties or allocating, growing, or detaching its buffer. */
export function isWebAssemblyMemory(value: unknown): value is JSWebAssemblyMemory {
  // HACK: grow checks the receiver before converting its delta. Our private delta
  // throws a recognizable marker during conversion, before any memory mutation.
  // Supported-runtime tests found no correctness problems. Throw/catch overhead is
  // unmeasured; the addon could expose V8's IsWasmMemoryObject() if it matters.
  // We keep this simple JS alternative for now. The buffer getter cannot serve as
  // a harmless check: it can create a lazy buffer in the inspecting realm.
  try { Reflect.apply(wasmMemoryGrow, value as object, [wasmMemoryProbe]); }
  catch (error) {
    if (error === wasmMemoryProbe) return true;
    if (error instanceof nativeTypeError) return false;
    throw error;
  }
  return false;
}

/** Recognize a native Table through its length getter without reading author properties or changing entries. */
export function isWebAssemblyTable(value: unknown): value is JSWebAssemblyTable {
  try { Reflect.apply(wasmTableLength, value as object, []); return true; }
  catch (error) { if (error instanceof nativeTypeError) return false; throw error; }
}

/** Recognize Globals without reading their values; select the native or stock-Node check once. */
export const isWebAssemblyGlobal = (addon.isWebAssemblyGlobal ?? isWebAssemblyGlobalFallback) as
  (value: unknown) => value is JSWebAssemblyGlobal;

/** Recognize a native Tag through Exception.is(), which checks its argument without reading author properties. */
export function isWebAssemblyTag(value: unknown): value is JSWebAssemblyTag {
  try { Reflect.apply(wasmExceptionIs, wasmTagProbeException, [value]); return true; }
  catch (error) { if (error instanceof nativeTypeError) return false; throw error; }
}

/** Opaque native identities; these type-only brands add no properties to engine objects. */
export type JSWebAssemblyModule = { [wasmModuleBrand]: true; };
export type JSWebAssemblyInstance = { [wasmInstanceBrand]: true; };
export type JSWebAssemblyMemory = { [wasmMemoryBrand]: true; };
export type JSWebAssemblyTable = { [wasmTableBrand]: true; };
export type JSWebAssemblyGlobal = { [wasmGlobalBrand]: true; };
export type JSWebAssemblyTag = { [wasmTagBrand]: true; };
declare const wasmModuleBrand: unique symbol;
declare const wasmInstanceBrand: unique symbol;
declare const wasmMemoryBrand: unique symbol;
declare const wasmTableBrand: unique symbol;
declare const wasmGlobalBrand: unique symbol;
declare const wasmTagBrand: unique symbol;

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

/** Read [[PromiseIsHandled]] without attaching a reaction or otherwise changing the promise. */
export function isPromiseHandled(promise: Promise<unknown>): boolean {
  if (addon.isPromiseHandled) return addon.isPromiseHandled(promise);
  // Stock Node has no non-observing query; Promise.then would mark it handled.
  throw new InternalError('Reading PromiseIsHandled is not implemented');
}

/** Read [[PromiseResult]] from a settled promise without running author code. */
export function getPromiseResult(promise: Promise<unknown>): unknown {
  if (addon.getPromiseResult) return addon.getPromiseResult(promise);
  // Stock Node has no public accessor for this internal slot.
  throw new InternalError('Reading PromiseResult is not implemented');
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

  const getter = realm.errorStack;
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
  if (nativeIsWeakRef) return nativeIsWeakRef(value);
  // Without the addon, probing the captured intrinsic also keeps a live target
  // alive for the current job. The native predicate only checks the object's brand.
  if (!weakRefDeref) return false;
  try {
    Reflect.apply(weakRefDeref, value, []);
    return true;
  } catch {
    return false;
  }
}

export function isFinalizationRegistryObject(value: unknown): value is FinalizationRegistry<unknown> {
  if (nativeIsFinalizationRegistry) return nativeIsFinalizationRegistry(value);
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
 * every V8 object kind. For an object with no enumerable own string properties,
 * native structured cloning can identify an unsupported exotic without
 * traversing an author-controlled property graph or advancing an iterator.
 */
/** Supply the current Object.keys(value) snapshot; populated objects bypass the probe. */
export function nativeCloneRejectsPropertylessObject(value: object, keys: string[]): boolean {
  if (keys.length !== 0) return false;

  try {
    nativeStructuredClone(value);
    return false;
  } catch (error) {
    if (isNativeDataCloneError(error)) return true;
    throw error;
  }
}

function isWebAssemblyModuleFallback(value: unknown): value is JSWebAssemblyModule {
  if (typeof value !== 'object' || value === null) return false;
  if (knownWebAssemblyModules.has(value)) return true;
  // Without the addon, inspect exports once. A Module cannot change its underlying type.
  try {
    Reflect.apply(wasmModuleExports, undefined, [value]);
    knownWebAssemblyModules.add(value);
    return true;
  } catch (error) { if (error instanceof nativeTypeError) return false; throw error; }
}

function isWebAssemblyGlobalFallback(value: unknown): value is JSWebAssemblyGlobal {
  if (typeof value !== 'object' || value === null) return false;
  // HACK: an immutable externref import accepts every ordinary object as a value,
  // but recognizes real Globals by their internal type. A matching Global is
  // re-exported by identity; a type/mutability mismatch throws native LinkError.
  // This allocates an Instance or error per check. The addon avoids that cost.
  // Do not substitute a value getter: v128 reads throw, and function reads can
  // create the first JS wrapper in the inspecting realm. Neither happens here.
  try {
    const imported = Object.create(null) as { g: unknown; };
    imported.g = value;
    const imports = Object.create(null) as { env: object; };
    imports.env = imported;
    const instance = new wasmInstanceConstructor(wasmGlobalProbeModule!, imports);
    const exports = Reflect.apply(wasmInstanceExports, instance, []) as { g: unknown; };
    return exports.g === value;
  } catch (error) {
    if (Reflect.getPrototypeOf(error as object) === wasmGlobalLinkErrorPrototype) return true;
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

const nativeIsWeakRef = addon.isWeakRef;
const nativeIsFinalizationRegistry = addon.isFinalizationRegistry;
/** Successful fallback checks only; recognition must not retain otherwise unreachable Modules. */
const knownWebAssemblyModules = new WeakSet<object>();
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
const nativeWebAssembly = Reflect.get(globalThis, 'WebAssembly') as {
  Module: { new (bytes: Uint8Array): JSWebAssemblyModule; exports: (value: unknown) => unknown; };
  Instance: { new (module: JSWebAssemblyModule, imports: object): object; prototype: object; };
  Memory: { prototype: object; };
  Table: { prototype: object; };
  LinkError: { prototype: object; };
  Tag: new (descriptor: { parameters: string[]; }) => object;
  Exception: { new (tag: object, payload: unknown[]): object; prototype: object; };
};
const wasmModuleExports = nativeWebAssembly.Module.exports;
const wasmInstanceExports = getAccessor<unknown>(nativeWebAssembly.Instance.prototype, 'exports');
const wasmMemoryGrow = Reflect.get(nativeWebAssembly.Memory.prototype, 'grow') as (this: object, delta: unknown) => unknown;
const wasmMemoryProbe = {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- Private identity sentinel stops conversion before mutation.
  [Symbol.toPrimitive](): never { throw wasmMemoryProbe; },
};
const wasmTableLength = getAccessor<unknown>(nativeWebAssembly.Table.prototype, 'length');
const wasmInstanceConstructor = nativeWebAssembly.Instance;
const wasmGlobalLinkErrorPrototype = nativeWebAssembly.LinkError.prototype;
// Compiled once, only without the addon. No start function or imported callbacks.
// (module (import "env" "g" (global externref)) (export "g" (global 0)))
const wasmGlobalProbeModule = addon.isWebAssemblyGlobal ? undefined : new nativeWebAssembly.Module(new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 2, 10, 1, 3, 101, 110, 118, 1, 103, 3, 111, 0,
  7, 5, 1, 1, 103, 3, 0,
]));
// Node/V8 exposes no Tag predicate. A private empty exception supplies the receiver
// for the intrinsic's Tag check; false is still a successful check of a different Tag.
const wasmTagProbeException = new nativeWebAssembly.Exception(new nativeWebAssembly.Tag({ parameters: [] }), []);
const wasmExceptionIs = Reflect.get(nativeWebAssembly.Exception.prototype, 'is') as (this: object, tag: unknown) => boolean;
// eslint-disable-next-line no-restricted-properties -- Identify the captured intrinsic's brand-check failure, not an author-visible error.
const nativeTypeError = globalThis.TypeError;
