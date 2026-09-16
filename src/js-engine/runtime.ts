import * as vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Stamper } from '../infra/stamper';
import { isObject } from './abstract-operations';
import {
  addon, isAddonContextHandle, isAddonMicrotaskQueueHandle,
  type AddonMicrotaskQueueHandle, type ContextEvaluationOptions,
} from './node-addons';
import type {
  CollectionIteratorKind, GlobalPrototypeKind, JSFunction, JSRealm,
} from './realm';
import { TypeError } from './exceptions';

const getNativeRealm = addon.getMethod('getRealm');

export function createMicrotaskQueue(): JSMicrotaskQueue {
  return jsRuntime.createMicrotaskQueue();
}

export function associateGlobalRealm(global: object, realm: JSRealm): void {
  jsRuntime.associateGlobalRealm(global, realm);
}

/** Native allocations already retain their creation context; only plain Node needs a stamp. */
export const associateObjectRealm: (object: object, realm: JSRealm) => void = getNativeRealm
  ? () => undefined
  : (object, realm) => { RealmStamper.stamp(object, realm); };

export function associateContext(context: NodeContext, realm: JSRealm): void {
  if (isAddonContextHandle(context)) RealmStamper.stamp(context.realm, realm);
}

/** Retain the registration's host async context for a later task handoff. */
export function bindAsyncContext<T>(steps: () => T): () => T {
  return AsyncLocalStorage.bind(steps);
}

/** Undefined when the selected backend cannot inspect the view's length mode. */
export function getNativeArrayBufferViewLengthTracking(value: object): boolean | undefined {
  return addon.getMethod('isLengthTrackingArrayBufferView')
    ? addon.isLengthTrackingArrayBufferView(value)
    : undefined;
}

export function observePromise(
  realm: JSRealm,
  promise: Promise<unknown>,
  onFulfilled: JSFunction | undefined,
  onRejected: JSFunction | undefined,
): void {
  if (addon.getMethod('observePromise')) {
    void addon.observePromise(
      promise, realm.intrinsics.promise.constructor, onFulfilled, onRejected,
    );
  } else {
    /*
     * ACCOMMODATION(node-v8-promise-reactions): Plain Node lacks native
     * observation. The captured intrinsic bypasses an overridden then, but
     * still consults constructor/@@species and creates a derived promise.
     */
    Reflect.apply(realm.intrinsics.promise.then, promise, [onFulfilled, onRejected]);
  }
}

export const setHostHooks = addon.getMethod('setHostHooks') && getNativeRealm
  ? <HostDefined>(hooks: JSHostHooks<HostDefined>): void => {
    addon.setHostHooks({
      makeJobCallback: (callback, registration) => hooks.makeJobCallback(callback, {
        incumbent: registration.incumbent === null ? null :
          RealmStamper.get(registration.incumbent) ?? null,
        hostDefinedOptions: registration.hostDefinedOptions,
      }),
      callJobCallback: hooks.callJobCallback,
      enqueuePromiseJob: (job, realm) => {
        // The job's creation context owns its queue, including handlerless jobs
        // whose specification-supplied realm is null.
        const queueRealm = getNativeRealm(job);
        return hooks.enqueuePromiseJob(job,
          realm === null ? null : RealmStamper.get(realm) ?? null,
          RealmStamper.get(queueRealm) ?? null);
      },
      enqueueGenericJob: (job, realm) =>
        hooks.enqueueGenericJob(job, RealmStamper.get(realm) ?? null),
      enqueueTimeoutJob: (job, realm, milliseconds) =>
        hooks.enqueueTimeoutJob(job, RealmStamper.get(realm) ?? null, milliseconds),
    });
  }
  : undefined;

export function getAssociatedRealm(value: object): JSRealm | undefined {
  return jsRuntime.getAssociatedRealm(value);
}

export function createContext(
  microtaskQueue: JSMicrotaskQueue,
  reuseGlobalProxyFrom?: NodeContext,
  globalPrototypeChain?: readonly GlobalPrototypeKind[],
): NodeContext {
  const handle = microtaskQueue instanceof AddonMicrotaskQueue
    ? microtaskQueue.handle
    : undefined;
  const options = handle ? { microtaskQueue: handle } : undefined;

  if (addon.getMethod('createContextHandle') && addon.getMethod('runInContext')) {
    const context: unknown = addon.createContextHandle({
      ...options, reuseGlobalProxyFrom, globalPrototypeChain,
    });
    if (!isAddonContextHandle(context)) {
      throw new Error('Node backend createContextHandle returned an invalid handle');
    }
    return context;
  }

  if (globalPrototypeChain) {
    throw new Error('Node does not support preallocated global prototypes');
  }
  if (reuseGlobalProxyFrom) {
    throw new Error('Node does not support reusable global proxies');
  }
  return Reflect.apply(vm.createContext, vm, [
    vm.constants.DONT_CONTEXTIFY,
    options,
  ]) as NodeContext;
}

export function getContextGlobal(context: NodeContext): object {
  return isAddonContextHandle(context)
    ? context.globalProxy
    : context;
}

/** Undefined when the backend lacks callback-driven native iterator creation. */
export function createCollectionIterator(
  context: NodeContext,
  kind: CollectionIteratorKind,
  next: () => object,
): object | undefined {
  return addon.getMethod('createCollectionIterator')
    ? addon.createCollectionIterator(context, kind, next)
    : undefined;
}

export function getContextPrototypeChain(context: NodeContext): readonly object[] | undefined {
  return isAddonContextHandle(context) ? context.prototypeChain : undefined;
}

export function getAllocatedGlobalObject(context: NodeContext): object | undefined {
  return isAddonContextHandle(context) ? context.globalObject : undefined;
}

export function setPropertyDelegate(object: object, delegate: object): void {
  addon.setPropertyDelegate(object, delegate);
}

export function setGlobalObject(context: NodeContext, object: object): void {
  addon.setGlobalObject(context, object);
}

export function detachContext(context: NodeContext): object {
  if (!isAddonContextHandle(context)) {
    throw new Error('Node does not support detachable context handles');
  }
  return context.detachGlobal();
}

export function makePrototypeImmutable(object: object): void {
  if (!addon.getMethod('makePrototypeImmutable')) return;
  addon.makePrototypeImmutable(object);
}

export function runInContext(
  source: string,
  context: NodeContext,
  options?: ContextEvaluationOptions,
): unknown {
  if (addon.getMethod('createContextHandle') && addon.getMethod('runInContext') &&
    isAddonContextHandle(context)) {
    return addon.runInContext(source, context, options);
  }
  return vm.runInContext(source, context, options) as unknown;
}

export const runWithActiveRealm = getNativeRealm
  ? <Result>(_realm: JSRealm, steps: () => Result): Result => steps()
  : <Result>(realm: JSRealm, steps: () => Result): Result =>
    jsRuntime.runWithActiveRealm(realm, steps);

/*
 * One module instance represents one Node/V8 isolate. Node workers load a
 * separate module instance and therefore receive a separate runtime owner.
 * Only operations that use this state forward to the private instance below.
 */
class JSRuntime {
  getAssociatedRealm: (value: object) => JSRealm | undefined;

  // Globals can have an assigned realm distinct from their creation context.
  // Native global proxies also lose their private fields on detachment/reuse.
  #globalRealms = new WeakMap<object, JSRealm>();
  #evaluatingRealm: JSRealm | undefined;
  #tickCallback: (() => void) | undefined;

  /*
   * ACCOMMODATION(node-v8-microtask-queue): Stock Node exposes neither an
   * isolated V8 microtask queue nor a public synchronous checkpoint. Keep
   * that fallback behind this one queue object. A compatible Node runtime
   * or the addon instead returns an explicit queue from createMicrotaskQueue().
   */
  readonly #ambientMicrotaskQueue: JSMicrotaskQueue = {
    kind: 'ambient',
    // eslint-disable-next-line no-restricted-syntax -- Stock Node queue backend, used only when explicit queues are unavailable.
    enqueueMicrotask: (steps) => { globalThis.queueMicrotask(steps); },
    performMicrotaskCheckpoint: () => { this.#getTickCallback()(); },
  };

  constructor() {
    const getObjectRealm = getNativeRealm
      ? (value: object): JSRealm | undefined =>
        this.#globalRealms.get(value) ?? RealmStamper.get(getNativeRealm(value))
      : (value: object): JSRealm | undefined => this.#getFallbackRealm(value);
    const getFunctionRealm = addon.getMethod('getFunctionRealm');

    this.getAssociatedRealm = getFunctionRealm
      ? (value) => {
        if (typeof value !== 'function') return getObjectRealm(value);
        try {
          return RealmStamper.get(getFunctionRealm(value as JSFunction));
        } catch (error) {
          if (typeof error === 'object' && error !== null &&
            Reflect.get(error, 'code') === 'ERR_REVOKED_PROXY') {
            throw new TypeError('Cannot get the realm of a revoked proxy');
          }
          throw error;
        }
      }
      : getObjectRealm;
  }

  createMicrotaskQueue(): JSMicrotaskQueue {
    if (!addon.getMethod('createMicrotaskQueue')) {
      return this.#ambientMicrotaskQueue;
    }

    const handle: unknown = addon.createMicrotaskQueue();
    if (!isAddonMicrotaskQueueHandle(handle)) {
      throw new Error('Node backend createMicrotaskQueue returned an invalid queue');
    }

    return new AddonMicrotaskQueue(handle);
  }

  associateGlobalRealm(global: object, realm: JSRealm): void {
    this.#globalRealms.set(global, realm);
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
      if (isObject(result) && !this.#globalRealms.has(result)) {
        RealmStamper.stamp(result, realm);
      }
      return result;
    } finally {
      this.#evaluatingRealm = previous;
    }
  }

  #getFallbackRealm(value: object): JSRealm | undefined {
    // ACCOMMODATION(node-v8-object-realms): plain Node has no native realm lookup.
    try {
      let current: object | null = value;
      while (current !== null) {
        const associated = this.#globalRealms.get(current) ?? RealmStamper.get(current);
        if (associated) {
          if (current !== value) RealmStamper.stamp(value, associated);
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

  #getTickCallback(): () => void {
    if (this.#tickCallback) return this.#tickCallback;

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

const jsRuntime = new JSRuntime();

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

/** Opaque Node VM context or compatibility-addon context handle. */
export type NodeContext = object;

/** Attach a realm to its backend reference or, on plain Node, its ordinary objects. */
class RealmStamper extends Stamper {
  #realm: JSRealm;

  private constructor(object: object, realm: JSRealm) {
    super(object);
    this.#realm = realm;
  }

  static stamp(object: object, realm: JSRealm): void {
    // Repeated evaluation must preserve the first known origin.
    if (!(#realm in object)) new RealmStamper(object, realm);
  }

  static get(object: object): JSRealm | undefined {
    return #realm in object ? object.#realm : undefined;
  }
}

class AddonMicrotaskQueue implements JSMicrotaskQueue {
  readonly kind = 'explicit';
  readonly handle: AddonMicrotaskQueueHandle;

  constructor(handle: AddonMicrotaskQueueHandle) {
    this.handle = handle;
  }

  enqueueMicrotask(steps: () => void): void {
    this.handle.enqueueMicrotask(steps);
  }

  performMicrotaskCheckpoint(): void {
    this.handle.runMicrotasks();
  }
}
