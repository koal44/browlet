import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

import { InternalError } from '../infra/internal-error';

import type {
  CollectionIteratorKind, GlobalObject, GlobalPrototypeKind, GlobalProxy, JSFunction, JSIteratorResult,
} from './realm';
import type { JSJobCallback, NodeContext } from './runtime';

/** Typed calls to the selected backend's optional engine extensions. */
export class NodeAPI {
  /** Whether this backend supports native document.all allocation and property handling. */
  supportsHTMLDDA: boolean;

  // Requires the V8 iterator-factory patch.
  createCollectionIterator?: <Value>(
    context: NodeContext, kind: CollectionIteratorKind, next: () => JSIteratorResult<Value>,
  ) => MapIterator<Value> | SetIterator<Value>;
  createContextHandle?: (options?: AddonContextOptions) => AddonContextHandle;
  /** Allocate the callable, undetectable object used for document.all; attach properties with setPropertyHandlers. */
  createHTMLDDA?: <Result>(context: NodeContext, call: JSFunction<Result>) => JSFunction<Result>;
  createMicrotaskQueue?: () => AddonMicrotaskQueueHandle;
  getFunctionRealm?: (value: JSFunction) => object;
  getRealm?: (value: object) => object;
  // Require the V8 iterator-brand predicates.
  isArrayIterator?: (value: unknown) => boolean;
  isStringIterator?: (value: unknown) => boolean;
  isRegExpStringIterator?: (value: unknown) => boolean;
  /** Allocate in the destination context while retaining the source's shared backing store. */
  cloneSharedArrayBuffer?: (buffer: SharedArrayBuffer, context: NodeContext) => SharedArrayBuffer;
  // Requires the V8 length-tracking patch.
  isLengthTrackingArrayBufferView?: (view: ArrayBufferView) => boolean;
  /** Recognize a genuine WeakRef without dereferencing its target. */
  isWeakRef?: (value: unknown) => boolean;
  // Requires the V8 FinalizationRegistry predicate patch.
  isFinalizationRegistry?: (value: unknown) => boolean;
  // Legacy Node patch for making an existing object's prototype immutable.
  makePrototypeImmutable?: (object: object) => void;
  observePromise?: (
    promise: Promise<unknown>, realmAnchor: JSFunction | PromiseConstructor,
    onFulfilled?: JSFunction, onRejected?: JSFunction,
  ) => Promise<unknown>;
  runInContext?: (
    source: string, context: NodeContext, options?: ContextEvaluationOptions,
  ) => unknown;
  setGlobalObject?: (context: NodeContext, object: object) => void;
  // Requires the V8 host-hook patches.
  setHostHooks?: <HostDefined>(hooks: AddonHostHooks<HostDefined>) => void;
  setPropertyDelegate?: (object: object, delegate: object) => void;
  setPropertyHandlers?: (object: object, handlers: AddonPropertyHandlers) => void;

  constructor(backend: object) {
    this.createCollectionIterator = this.#loadMethod(backend, 'createCollectionIterator');
    this.createContextHandle = this.#loadMethod(backend, 'createContextHandle');
    this.createHTMLDDA = this.#loadMethod(backend, 'createHTMLDDA');
    this.createMicrotaskQueue = this.#loadMethod(backend, 'createMicrotaskQueue');
    this.getFunctionRealm = this.#loadMethod(backend, 'getFunctionRealm');
    this.getRealm = this.#loadMethod(backend, 'getRealm');
    this.isArrayIterator = this.#loadMethod(backend, 'isArrayIterator');
    this.isStringIterator = this.#loadMethod(backend, 'isStringIterator');
    this.isRegExpStringIterator = this.#loadMethod(backend, 'isRegExpStringIterator');
    this.cloneSharedArrayBuffer = this.#loadMethod(backend, 'cloneSharedArrayBuffer');
    this.isLengthTrackingArrayBufferView = this.#loadMethod(backend, 'isLengthTrackingArrayBufferView');
    this.isWeakRef = this.#loadMethod(backend, 'isWeakRef');
    this.isFinalizationRegistry = this.#loadMethod(backend, 'isFinalizationRegistry');
    this.makePrototypeImmutable = this.#loadMethod(backend, 'makePrototypeImmutable');
    this.observePromise = this.#loadMethod(backend, 'observePromise');
    this.runInContext = this.#loadMethod(backend, 'runInContext');
    this.setGlobalObject = this.#loadMethod(backend, 'setGlobalObject');
    this.setHostHooks = this.#loadMethod(backend, 'setHostHooks');
    this.setPropertyDelegate = this.#loadMethod(backend, 'setPropertyDelegate');
    this.setPropertyHandlers = this.#loadMethod(backend, 'setPropertyHandlers');
    this.supportsHTMLDDA = this.createHTMLDDA !== undefined && this.setPropertyHandlers !== undefined;
  }

  #loadMethod<Name extends keyof AddonMethods>(backend: object, name: Name): AddonMethods[Name] {
    const method: unknown = Reflect.get(backend, name);
    if (method === undefined) return undefined;
    if (typeof method !== 'function') {
      throw new InternalError(`Node backend ${name} is not callable`);
    }
    return method.bind(backend) as AddonMethods[Name];
  }
}

export const addon = new NodeAPI(loadNodeApi());

// Derive the operation signatures from the public properties rather than listing them twice.
type AddonMethods = Omit<NodeAPI, 'supportsHTMLDDA'>;

/**
 * Supply intercepted properties for a native object.
 * `hasOwn` reports an ordinary own property already stored on that object,
 * excluding properties supplied by these handlers.
 */
// Used for HTMLAllCollection (document.all), whose falsiness an outer Proxy would lose.
export type AddonPropertyHandlers = {
  /** Whether get handles this key; false continues ordinary lookup. */
  has(key: string | symbol, hasOwn: boolean): boolean;
  // For get/set, Node 24 supplies the receiver, Node 26+ supplies the holder,
  // and global callbacks supply undefined to use their bound target.
  /** Read an intercepted value after has returns true. */
  get(key: string | symbol, receiver: object | undefined): unknown;
  /** Assign a value: true succeeds, false rejects, and undefined leaves ordinary assignment to V8. */
  set(key: string | symbol, value: unknown, receiver: object | undefined, hasOwn: boolean): boolean | undefined;
  /** Describe an intercepted own property; undefined lets V8 inspect ordinary properties. */
  getOwnPropertyDescriptor(key: string | symbol, hasOwn: boolean): PropertyDescriptor | undefined;
  /** Supply lookup flags through a descriptor; defaults to getOwnPropertyDescriptor. */
  // V8 consults these flags during assignment, so they may differ from the public descriptor.
  getPropertyAttributes?(key: string | symbol, hasOwn: boolean): PropertyDescriptor | undefined;
  /** Define a property: true succeeds, false rejects, and undefined leaves ordinary definition to V8. */
  defineProperty(key: string | symbol, descriptor: PropertyDescriptor, hasOwn: boolean): boolean | undefined;
  /** Delete a property: true succeeds, false rejects, and undefined leaves ordinary deletion to V8. */
  deleteProperty(key: string | symbol, hasOwn: boolean): boolean | undefined;
  /** List intercepted own keys; V8 also includes ordinary own keys. */
  ownKeys(): (string | symbol)[];
};

export type AddonMicrotaskQueueHandle = {
  enqueueMicrotask(steps: () => void): void;
  runMicrotasks(): void;
};

export type AddonContextHandle = {
  readonly realm: object;
  readonly globalProxy: GlobalProxy;
  readonly globalObject?: GlobalObject;
  readonly prototypeChain?: object[];
  detachGlobal(): GlobalProxy;
};

type AddonContextOptions = {
  microtaskQueue?: AddonMicrotaskQueueHandle;
  reuseGlobalProxyFrom?: NodeContext;
  globalPrototypeChain?: GlobalPrototypeKind[];
};

/** Evaluation options shared by node:vm and the compatibility addon. */
export type ContextEvaluationOptions = {
  displayErrors?: boolean;
  filename?: string;
  lineOffset?: number;
};

type AddonHostHooks<HostDefined> = {
  makeJobCallback?(
    callback: JSFunction,
    registration: { incumbent: object | null; hostDefinedOptions: unknown[]; },
  ): JSJobCallback<HostDefined>;
  callJobCallback?(
    record: JSJobCallback<HostDefined>, receiver: unknown, argumentsList: unknown[],
  ): unknown;
  enqueuePromiseJob?(job: () => void, realm: object | null): false | void;
  enqueueGenericJob?(job: () => void, realm: object): void;
  enqueueTimeoutJob?(job: () => void, realm: object, milliseconds: number): void;
};

export function isAddonMicrotaskQueueHandle(value: unknown): value is AddonMicrotaskQueueHandle {
  return typeof value === 'object' && value !== null &&
    typeof Reflect.get(value, 'enqueueMicrotask') === 'function' &&
    typeof Reflect.get(value, 'runMicrotasks') === 'function';
}

export function isAddonContextHandle(value: unknown): value is AddonContextHandle {
  if (typeof value !== 'object' || value === null) return false;
  const globalProxy: unknown = Reflect.get(value, 'globalProxy');
  return (typeof globalProxy === 'object' && globalProxy !== null) &&
    typeof Reflect.get(value, 'detachGlobal') === 'function';
}

function loadNodeApi(): object {
  const addonPath = process.env.BROWLET_NODE_ADDON;
  if (addonPath === undefined) return vm;
  if (!isAbsolute(addonPath)) {
    throw new InternalError('BROWLET_NODE_ADDON must be an absolute module path');
  }
  const api: unknown = createRequire(process.execPath)(addonPath);
  if (typeof api !== 'object' || api === null) {
    throw new InternalError('BROWLET_NODE_ADDON must export a Node backend');
  }
  return api;
}
