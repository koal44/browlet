import * as vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { isObject } from './abstract-operations';
import type { GlobalPrototypeKind, JSFunction, JSRealm } from './realm';
import { TypeError } from './simple-exception';

/*
 * One module instance represents one Node/V8 isolate. Node workers load a
 * separate module instance and therefore receive a separate runtime owner.
 */
export class JSRuntime {
  // Explicit associations cover host-created objects. Plain Node additionally
  // uses prototype evidence and the active evaluation when native lookup is absent.
  #evaluatingRealm: JSRealm | undefined;
  readonly #objectRealms = new WeakMap<object, JSRealm>();
  readonly #contextRealms = new WeakMap<object, JSRealm>();
  #tickCallback: (() => void) | undefined;
  readonly hasExplicitMicrotaskQueues =
    nodeCreateMicrotaskQueue !== undefined;
  readonly hasNativeGlobalObjects = getNodeMethod('setGlobalObject') !== undefined;
  readonly supportsHostHooks = Reflect.get(nodeApi, 'supportsHostHooks') === true;

  /*
   * ACCOMMODATION(node-v8-microtask-queue): Stock Node exposes neither an
   * isolated V8 microtask queue nor a public synchronous checkpoint. Keep
   * that fallback behind this one queue object. A compatible Node runtime
   * or the addon instead returns an explicit queue from createMicrotaskQueue().
   */
  readonly #ambientMicrotaskQueue: JSMicrotaskQueue = {
    kind: 'ambient',
    enqueueMicrotask: (steps) => { globalThis.queueMicrotask(steps); },
    performMicrotaskCheckpoint: () => { this.#getTickCallback()(); },
  };

  readonly createMicrotaskQueue = (): JSMicrotaskQueue => {
    if (nodeCreateMicrotaskQueue === undefined) {
      return this.#ambientMicrotaskQueue;
    }

    const handle = Reflect.apply(nodeCreateMicrotaskQueue, nodeApi, []);
    if (!isNodeMicrotaskQueue(handle)) {
      throw new Error('Node backend createMicrotaskQueue returned an invalid queue');
    }

    const queue: JSMicrotaskQueue = {
      kind: 'explicit',
      enqueueMicrotask: (steps) => { handle.enqueueMicrotask(steps); },
      performMicrotaskCheckpoint: () => { handle.runMicrotasks(); },
    };
    nodeMicrotaskQueueHandles.set(queue, handle);
    return queue;
  };

  associateRealm(value: object, realm: JSRealm): void {
    this.#objectRealms.set(value, realm);
  }

  associateContext(context: NodeContext, realm: JSRealm): void {
    if (isNodeContextHandle(context)) this.#contextRealms.set(context.realm, realm);
  }

  /** Retain the registration's host async context for a later task handoff. */
  bindAsyncContext<T>(steps: () => T): () => T {
    return AsyncLocalStorage.bind(steps);
  }

  /** Undefined when the selected backend cannot inspect the view's length mode. */
  isLengthTrackingArrayBufferView(value: object): boolean | undefined {
    const query = getNodeMethod('isLengthTrackingArrayBufferView');
    return query === undefined ? undefined :
      Reflect.apply(query, nodeApi, [value]) as boolean;
  }

  observePromise(
    realm: JSRealm,
    promise: Promise<unknown>,
    onFulfilled: JSFunction | undefined,
    onRejected: JSFunction | undefined,
  ): void {
    const observe = getNodeMethod('observePromise');
    if (observe) {
      Reflect.apply(observe, nodeApi, [
        promise, realm.intrinsics.promise.constructor, onFulfilled, onRejected,
      ]);
    } else {
      /*
       * ACCOMMODATION(node-v8-promise-reactions): Plain Node lacks native
       * observation. The captured intrinsic bypasses an overridden then, but
       * still consults constructor/@@species and creates a derived promise.
       */
      Reflect.apply(realm.intrinsics.promise.then, promise, [onFulfilled, onRejected]);
    }
  }

  setHostHooks<HostDefined>(hooks: JSHostHooks<HostDefined>): void {
    const install = getNodeMethod('setHostHooks');
    const getRealm = getNodeMethod('getRealm');
    if (!this.supportsHostHooks || !install || !getRealm) {
      throw new Error('Node does not support job host hooks');
    }
    Reflect.apply(install, nodeApi, [{
      makeJobCallback: (callback: JSFunction, registration: {
        incumbent: object | null;
        hostDefinedOptions: readonly unknown[];
      }) => hooks.makeJobCallback(callback, {
        incumbent: registration.incumbent === null ? null :
          this.#contextRealms.get(registration.incumbent) ?? null,
        hostDefinedOptions: registration.hostDefinedOptions,
      }),
      callJobCallback: hooks.callJobCallback,
      enqueuePromiseJob: (job: () => void, realm: object | null) => {
        // The job's creation context owns its queue, including handlerless jobs
        // whose specification-supplied realm is null.
        const queueRealm = Reflect.apply(getRealm, nodeApi, [job]) as object;
        return hooks.enqueuePromiseJob(job,
          realm === null ? null : this.#contextRealms.get(realm) ?? null,
          this.#contextRealms.get(queueRealm) ?? null);
      },
      enqueueGenericJob: (job: () => void, realm: object) =>
        hooks.enqueueGenericJob(job, this.#contextRealms.get(realm) ?? null),
      enqueueTimeoutJob: (job: () => void, realm: object, milliseconds: number) =>
        hooks.enqueueTimeoutJob(job, this.#contextRealms.get(realm) ?? null, milliseconds),
    }]);
  }

  getAssociatedRealm(value: object): JSRealm | undefined {
    const getFunctionRealm = getNodeMethod('getFunctionRealm');
    if (typeof value === 'function' && getFunctionRealm) {
      try {
        const reference = Reflect.apply(getFunctionRealm, nodeApi, [value]) as object;
        return this.#contextRealms.get(reference);
      } catch (error) {
        if (typeof error === 'object' && error !== null &&
          Reflect.get(error, 'code') === 'ERR_REVOKED_PROXY') {
          throw new TypeError('Cannot get the realm of a revoked proxy');
        }
        throw error;
      }
    }

    const associated = this.#objectRealms.get(value);
    if (associated) return associated;
    const getRealm = getNodeMethod('getRealm');
    if (getRealm) {
      const reference = Reflect.apply(getRealm, nodeApi, [value]) as object;
      return this.#contextRealms.get(reference);
    }

    // ACCOMMODATION(node-v8-object-realms): plain Node has no native realm lookup.
    try {
      let current: object | null = value;
      while (current !== null) {
        const associated = this.#objectRealms.get(current);
        if (associated) {
          this.#objectRealms.set(value, associated);
          return associated;
        }
        current = Reflect.getPrototypeOf(current);
      }
    } catch {
      // Proxies can prevent prototype inspection. The active evaluation is
      // the only realm information Node exposes at this boundary.
    }
    return this.#evaluatingRealm;
  }

  createContext(
    microtaskQueue: JSMicrotaskQueue,
    reuseGlobalProxyFrom?: NodeContext,
    globalPrototypeChain?: readonly GlobalPrototypeKind[],
  ): NodeContext {
    const handle = nodeMicrotaskQueueHandles.get(microtaskQueue);
    const options = handle === undefined
      ? undefined
      : { microtaskQueue: handle };

    if (nodeContextSupport !== undefined) {
      const context: unknown = Reflect.apply(
        nodeContextSupport.createContextHandle,
        nodeApi,
        [{ ...options, reuseGlobalProxyFrom, globalPrototypeChain }],
      );
      if (!isNodeContextHandle(context)) {
        throw new Error('Node backend createContextHandle returned an invalid handle');
      }
      return context;
    }

    if (globalPrototypeChain !== undefined) {
      throw new Error('Node does not support preallocated global prototypes');
    }
    if (reuseGlobalProxyFrom !== undefined) {
      throw new Error('Node does not support reusable global proxies');
    }
    return Reflect.apply(vm.createContext, vm, [
      vm.constants.DONT_CONTEXTIFY,
      options,
    ]) as NodeContext;
  }

  getContextGlobal(context: NodeContext): object {
    return isNodeContextHandle(context)
      ? context.globalProxy
      : context;
  }

  getContextPrototypeChain(context: NodeContext): readonly object[] | undefined {
    return isNodeContextHandle(context) ? context.prototypeChain : undefined;
  }

  getAllocatedGlobalObject(context: NodeContext): object | undefined {
    return isNodeContextHandle(context) ? context.globalObject : undefined;
  }

  setPropertyDelegate(object: object, delegate: object): void {
    const set = getNodeMethod('setPropertyDelegate');
    if (!set) throw new Error('Node does not support delegated prototypes');
    Reflect.apply(set, nodeApi, [object, delegate]);
  }

  setGlobalObject(context: NodeContext, object: object): void {
    const set = getNodeMethod('setGlobalObject');
    if (!set) throw new Error('Node does not support allocated global objects');
    Reflect.apply(set, nodeApi, [context, object]);
  }

  detachContext(context: NodeContext): object {
    if (!isNodeContextHandle(context)) {
      throw new Error('Node does not support detachable context handles');
    }
    return context.detachGlobal();
  }

  makePrototypeImmutable(object: object): void {
    if (nodeMakePrototypeImmutable === undefined) return;
    Reflect.apply(nodeMakePrototypeImmutable, nodeApi, [object]);
  }

  runInContext(
    source: string,
    context: NodeContext,
    options?: {
      displayErrors?: boolean;
      filename?: string;
      lineOffset?: number;
    },
  ): unknown {
    if (nodeContextSupport !== undefined && isNodeContextHandle(context)) {
      return Reflect.apply(nodeContextSupport.runInContext, nodeApi, [
        source, context, options,
      ]);
    }
    return vm.runInContext(source, context, options) as unknown;
  }

  runWithActiveRealm<Result>(
    realm: JSRealm,
    steps: () => Result,
  ): Result {
    const previous = this.#evaluatingRealm;
    this.#evaluatingRealm = realm;
    try {
      const result = steps();
      // ACCOMMODATION(node-v8-object-realms): plain Node cannot inspect a
      // returned value's creation realm without author traps. Keep its first
      // evaluation association, without overwriting an already-known origin.
      if (getNodeMethod('getRealm') === undefined && isObject(result) &&
        !this.#objectRealms.has(result)) {
        this.#objectRealms.set(result, realm);
      }
      return result;
    } finally {
      this.#evaluatingRealm = previous;
    }
  }

  #getTickCallback(): () => void {
    if (this.#tickCallback !== undefined) return this.#tickCallback;

    const candidate: unknown = Reflect.get(process, '_tickCallback');
    if (typeof candidate !== 'function') {
      throw new Error(
        'Node does not expose the provisional microtask checkpoint bridge',
      );
    }

    this.#tickCallback = () => { Reflect.apply(candidate, process, []); };
    return this.#tickCallback;
  }
}

const nodeApi = loadNodeApi();
const nodeCreateMicrotaskQueue = getNodeMicrotaskQueueFactory();
const nodeContextSupport = getNodeContextSupport();
const nodeMakePrototypeImmutable = getNodeMethod('makePrototypeImmutable');

export const jsRuntime = new JSRuntime();

export type JSHostHooks<HostDefined> = {
  makeJobCallback(
    this: void,
    callback: JSFunction,
    registration: JSJobRegistration,
  ): JSJobCallback<HostDefined>;
  callJobCallback(
    this: void,
    record: JSJobCallback<HostDefined>,
    receiver: unknown,
    argumentsList: unknown[],
  ): unknown;
  enqueuePromiseJob(
    this: void,
    job: () => void,
    realm: JSRealm | null,
    queueRealm: JSRealm | null,
  ): false | void;
  enqueueGenericJob(
    this: void,
    job: () => void,
    realm: JSRealm | null,
  ): void;
  enqueueTimeoutJob(
    this: void,
    job: () => void,
    realm: JSRealm | null,
    milliseconds: number,
  ): void;
};

export type JSJobCallback<HostDefined> = {
  readonly callback: JSFunction;
  readonly hostDefined: HostDefined;
};

export type JSJobRegistration = {
  readonly incumbent: JSRealm | null;
  readonly hostDefinedOptions: readonly unknown[];
};

export type JSMicrotaskQueue = {
  readonly kind: 'ambient' | 'explicit';
  enqueueMicrotask(steps: () => void): void;
  performMicrotaskCheckpoint(): void;
};

type NodeMicrotaskQueue = {
  enqueueMicrotask(steps: () => void): void;
  runMicrotasks(): void;
};

type NodeMicrotaskQueueFactory = () => unknown;

type NodeContextHandle = {
  readonly realm: object;
  readonly globalProxy: object;
  readonly globalObject?: object;
  readonly prototypeChain?: readonly object[];
  detachGlobal(): object;
};

/** Opaque Node VM context or compatibility-addon context handle. */
export type NodeContext = object;

type NodeContextHandleFactory = (options?: {
  reuseGlobalProxyFrom?: NodeContextHandle;
  microtaskQueue?: NodeMicrotaskQueue;
}) => unknown;

type NodeContextSupport = {
  createContextHandle: NodeContextHandleFactory;
  runInContext: CallableFunction;
};

const nodeMicrotaskQueueHandles = new WeakMap<
  JSMicrotaskQueue,
  NodeMicrotaskQueue
>();

function isNodeMicrotaskQueue(value: unknown): value is NodeMicrotaskQueue {
  return typeof value === 'object' && value !== null &&
    typeof Reflect.get(value, 'enqueueMicrotask') === 'function' &&
    typeof Reflect.get(value, 'runMicrotasks') === 'function';
}

function getNodeMicrotaskQueueFactory():
NodeMicrotaskQueueFactory | undefined {
  const create = Reflect.get(nodeApi, 'createMicrotaskQueue') as unknown;
  if (create === undefined) return undefined;
  if (typeof create !== 'function') {
    throw new Error('Node vm.createMicrotaskQueue is not callable');
  }
  return create as NodeMicrotaskQueueFactory;
}

function isNodeContextHandle(value: unknown): value is NodeContextHandle {
  if (typeof value !== 'object' || value === null) return false;
  const globalProxy: unknown = Reflect.get(value, 'globalProxy');
  return (typeof globalProxy === 'object' && globalProxy !== null) &&
    typeof Reflect.get(value, 'detachGlobal') === 'function';
}

function getNodeContextSupport(): NodeContextSupport | undefined {
  const createContextHandle: unknown = Reflect.get(
    nodeApi,
    'createContextHandle',
  );
  if (createContextHandle === undefined) return undefined;
  const runInContext = getNodeMethod('runInContext');
  if (
    typeof createContextHandle !== 'function' ||
    runInContext === undefined
  ) {
    throw new Error('Node exposes an incomplete context-handle API');
  }
  return {
    createContextHandle: createContextHandle as NodeContextHandleFactory,
    runInContext,
  };
}

function getNodeMethod(name: string): CallableFunction | undefined {
  const method: unknown = Reflect.get(nodeApi, name);
  if (method === undefined) return undefined;
  if (typeof method !== 'function') {
    throw new Error(`Node backend ${name} is not callable`);
  }
  return method;
}

function loadNodeApi(): object {
  const addonPath = process.env.BROWLET_NODE_ADDON;
  if (addonPath === undefined) return vm;
  if (!isAbsolute(addonPath)) {
    throw new Error('BROWLET_NODE_ADDON must be an absolute module path');
  }
  const addon: unknown = createRequire(process.execPath)(addonPath);
  if (typeof addon !== 'object' || addon === null) {
    throw new Error('BROWLET_NODE_ADDON must export a Node backend');
  }
  return addon;
}
