import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import type { CollectionIteratorKind, GlobalPrototypeKind, JSFunction } from './realm';
import type { JSJobCallback, NodeContext } from './runtime';

/** Typed calls to the selected backend's optional engine extensions. */
export class NodeAPI {
  #methods: Partial<AddonMethods> = {};

  /** Requires the V8 iterator-factory patch. */
  createCollectionIterator: (
    context: NodeContext, kind: CollectionIteratorKind, next: () => object,
  ) => object;
  createContextHandle: (options?: AddonContextOptions) => AddonContextHandle;
  createMicrotaskQueue: () => AddonMicrotaskQueueHandle;
  getFunctionRealm: (value: JSFunction) => object;
  getRealm: (value: object) => object;
  /** Requires the V8 length-tracking patch. */
  isLengthTrackingArrayBufferView: (view: object) => boolean;
  /** Legacy Node patch for making an existing object's prototype immutable. */
  makePrototypeImmutable: (object: object) => void;
  observePromise: (
    promise: Promise<unknown>, realmAnchor: JSFunction | PromiseConstructor,
    onFulfilled?: JSFunction, onRejected?: JSFunction,
  ) => Promise<unknown>;
  runInContext: (
    source: string, context: NodeContext, options?: ContextEvaluationOptions,
  ) => unknown;
  setGlobalObject: (context: NodeContext, object: object) => void;
  /** Requires the V8 host-hook patches. */
  setHostHooks: <HostDefined>(hooks: AddonHostHooks<HostDefined>) => void;
  setPropertyDelegate: (object: object, delegate: object) => void;

  constructor(backend: object) {
    this.createCollectionIterator = this.#loadMethod(backend, 'createCollectionIterator');
    this.createContextHandle = this.#loadMethod(backend, 'createContextHandle');
    this.createMicrotaskQueue = this.#loadMethod(backend, 'createMicrotaskQueue');
    this.getFunctionRealm = this.#loadMethod(backend, 'getFunctionRealm');
    this.getRealm = this.#loadMethod(backend, 'getRealm');
    this.isLengthTrackingArrayBufferView = this.#loadMethod(backend, 'isLengthTrackingArrayBufferView');
    this.makePrototypeImmutable = this.#loadMethod(backend, 'makePrototypeImmutable');
    this.observePromise = this.#loadMethod(backend, 'observePromise');
    this.runInContext = this.#loadMethod(backend, 'runInContext');
    this.setGlobalObject = this.#loadMethod(backend, 'setGlobalObject');
    this.setHostHooks = this.#loadMethod(backend, 'setHostHooks');
    this.setPropertyDelegate = this.#loadMethod(backend, 'setPropertyDelegate');
  }

  /** Only supplied methods appear here; unsupported-call stubs do not. */
  getMethod<Name extends keyof AddonMethods>(name: Name): AddonMethods[Name] | undefined {
    return this.#methods[name];
  }

  #loadMethod<Name extends keyof AddonMethods>(backend: object, name: Name): AddonMethods[Name] {
    const method: unknown = Reflect.get(backend, name);
    if (method === undefined) {
      return () => { throw new Error(`Node backend does not provide ${name}`); };
    }
    if (typeof method !== 'function') {
      throw new Error(`Node backend ${name} is not callable`);
    }
    const bound = method.bind(backend) as AddonMethods[Name];
    this.#methods[name] = bound;
    return bound;
  }
}

export const addon = new NodeAPI(loadNodeApi());

// Derive the cached signatures from the public calls rather than listing them twice.
type AddonMethods = Omit<NodeAPI, 'getMethod'>;

export type AddonMicrotaskQueueHandle = {
  enqueueMicrotask(steps: () => void): void;
  runMicrotasks(): void;
};

export type AddonContextHandle = {
  readonly realm: object;
  readonly globalProxy: object;
  readonly globalObject?: object;
  readonly prototypeChain?: readonly object[];
  detachGlobal(): object;
};

type AddonContextOptions = {
  microtaskQueue?: AddonMicrotaskQueueHandle;
  reuseGlobalProxyFrom?: NodeContext;
  globalPrototypeChain?: readonly GlobalPrototypeKind[];
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
    registration: { incumbent: object | null; hostDefinedOptions: readonly unknown[]; },
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
    throw new Error('BROWLET_NODE_ADDON must be an absolute module path');
  }
  const api: unknown = createRequire(process.execPath)(addonPath);
  if (typeof api !== 'object' || api === null) {
    throw new Error('BROWLET_NODE_ADDON must export a Node backend');
  }
  return api;
}
