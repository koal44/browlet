import * as vm from 'node:vm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MessageChannel, moveMessagePortToContext, receiveMessageOnPort } from 'node:worker_threads';

import { Stamper } from '../infra/stamper';
import { TypeError } from '../infra/exceptions';
import { InternalError } from '../infra/internal-error';

import { isObject } from './abstract-operations';
import {
  addon, isAddonContextHandle, isAddonMicrotaskQueueHandle,
  type AddonContextHandle, type AddonMicrotaskQueueHandle, type ContextEvaluationOptions,
} from './node-addons';
import type {
  CollectionIteratorKind, CompiledCode, CompiledScript, ExoticObjectHandlers, GlobalAccessHandlers, GlobalAllocation, GlobalIndexedProperties,
  GlobalPrototypeKind, GlobalProxy,
  JSFunction, JSIteratorResult, JSRealm,
} from './realm';
import type { ImportModuleDynamically } from './modules';

const getNativeRealm = addon.getRealm;

/** Compile trusted host code with explicit parameters, independently of the active author realm. */
export function compileHostFunction(source: string, parameters: string[]): JSFunction {
  return vm.compileFunction(source, parameters) as JSFunction;
}

/** Select handlers using the engine's current realm before entering JavaScript trap functions. */
export function createExoticObject(
  realmAnchor: object, select: (realm: JSRealm | undefined) => ExoticObjectHandlers,
): object | undefined {
  return addon.createExoticObject?.(realmAnchor, (reference) => select(RealmStamper.get(reference)));
}

/** Resolve the native accessing context through the same realm identity used by exotic objects. */
export function setGlobalAccess(target: GlobalProxy, select: (realm: JSRealm | undefined) => GlobalAccessHandlers): void {
  if (!addon.setGlobalAccess) throw new InternalError('Node backend does not provide native global access checks');
  addon.setGlobalAccess(target, (reference) => select(RealmStamper.get(reference)));
}

/** Create the owning queue, optionally requesting checkpoints after native completion or Promise settlement. */
export function createMicrotaskQueue(requestCheckpoint?: () => void): JSMicrotaskQueue {
  return jsRuntime.createMicrotaskQueue(requestCheckpoint);
}

export function associateGlobalRealm(global: object, realm: JSRealm): void {
  jsRuntime.associateGlobalRealm(global, realm);
}

/** Native allocations already retain their creation context; only plain Node needs a stamp. */
export const associateObjectRealm: (object: object, realm: JSRealm) => void = getNativeRealm
  ? () => undefined
  : (object, realm) => { RealmStamper.stamp(object, realm); };

export function associateContext(context: VMContext, realm: JSRealm): void {
  if (isAddonContextHandle(context)) RealmStamper.stamp(context.realm, realm);
}

/** Capture at native function entry; an unregistered Node caller has no associated JSRealm. */
export function createFunctionWithIncumbent<Result>(
  context: VMContext,
  steps: (incumbent: JSRealm | undefined, receiver: unknown, argumentsList: unknown[]) => Result,
): JSFunction<Result> | undefined {
  return addon.createFunctionWithIncumbent?.(context, (reference, receiver, argumentsList) =>
    steps(reference === null ? undefined : RealmStamper.get(reference), receiver, argumentsList));
}

/** Retain the registration's host async context for a later task handoff. */
export function bindAsyncContext<T>(steps: () => T): () => T {
  return AsyncLocalStorage.bind(steps);
}

/** Undefined when the selected backend cannot inspect the view's length mode. */
export function getNativeArrayBufferViewLengthTracking(value: ArrayBufferView): boolean | undefined {
  return addon.isLengthTrackingArrayBufferView?.(value);
}

/** Allocate a new buffer object in the context without copying its shared storage. */
export function cloneSharedArrayBuffer(buffer: SharedArrayBuffer, context: VMContext): SharedArrayBuffer {
  const clone = addon.cloneSharedArrayBuffer;
  if (clone) return clone(buffer, context);

  // Stock Node receives a message in the port's creation context. Posting queues
  // it synchronously, so no event listener, worker, or retained port is needed.
  const channel = new MessageChannel();
  let receiver = channel.port2;
  try {
    receiver = moveMessagePortToContext(receiver, context);
    channel.port1.postMessage(buffer);
    return receiveMessageOnPort(receiver)!.message as SharedArrayBuffer;
  } finally {
    channel.port1.close();
    receiver.close();
  }
}

export function observePromise(
  realm: JSRealm,
  promise: Promise<unknown>,
  onFulfilled: JSFunction | undefined,
  onRejected: JSFunction | undefined,
): void {
  if (addon.observePromise) {
    void addon.observePromise(
      promise, realm.NativePromise, onFulfilled, onRejected,
    );
  } else {
    /*
     * ACCOMMODATION(node-v8-promise-reactions): Plain Node lacks native
     * observation. The captured intrinsic bypasses an overridden then, but
     * still consults constructor/@@species and creates a derived promise.
     */
    Reflect.apply(realm.promiseThen, promise, [onFulfilled, onRejected]);
  }
}

const setNativeHostHooks = addon.setHostHooks;
let promiseJobsObserved = false;
export const setHostHooks = setNativeHostHooks && getNativeRealm
  ? <HostDefined>(hooks: JSHostHooks<HostDefined>): void => {
    setNativeHostHooks({
      makeJobCallback: (callback, registration) => hooks.makeJobCallback(callback, {
        incumbent: registration.incumbent === null ? null :
          RealmStamper.get(registration.incumbent) ?? null,
        compiledCode: registration.compiledCode,
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
    promiseJobsObserved = true;
  }
  : undefined;

export function getAssociatedRealm(value: object): JSRealm | undefined {
  return jsRuntime.getAssociatedRealm(value);
}

export function createContext(
  microtaskQueue: JSMicrotaskQueue,
  reuseGlobalProxyFrom?: VMContext,
  globalPrototypeChain?: GlobalPrototypeKind[],
  importModuleDynamically?: ImportModuleDynamically<VMContext>,
  globalAccess = false,
): VMContext {
  const handle = microtaskQueue instanceof AddonMicrotaskQueue
    ? microtaskQueue.handle
    : undefined;
  const options = { microtaskQueue: handle, importModuleDynamically };

  if (addon.createContextHandle && addon.runInContext) {
    if (reuseGlobalProxyFrom) {
      if (!isAddonContextHandle(reuseGlobalProxyFrom)) {
        throw new InternalError('Cannot reuse a global proxy from another backend');
      }
      reuseGlobalProxyFrom.detachGlobal();
    }
    const context: unknown = addon.createContextHandle({
      ...options, reuseGlobalProxyFrom, globalPrototypeChain, globalAccess,
      importModuleDynamically: addon.supportsDynamicImport ? importModuleDynamically : undefined,
    });
    if (!isAddonContextHandle(context)) {
      throw new InternalError('Node backend createContextHandle returned an invalid handle');
    }
    return context;
  }

  // Stock Node allocates an ordinary context. The host uses its modeled global
  // bridge when globalAllocation is absent; native reuse/access remain unavailable.
  return Reflect.apply(vm.createContext, vm, [
    vm.constants.DONT_CONTEXTIFY,
    options,
  ]) as GlobalProxy;
}

export function getContextGlobalProxy(context: VMContext): GlobalProxy {
  return isAddonContextHandle(context)
    ? context.globalProxy
    : context;
}

/** Undefined when the backend lacks callback-driven native iterator creation. */
export function createCollectionIterator<Value>(
  context: VMContext,
  kind: CollectionIteratorKind,
  next: () => JSIteratorResult<Value>,
): MapIterator<Value> | SetIterator<Value> | undefined {
  return addon.createCollectionIterator?.(context, kind, next);
}

export function getContextGlobalAllocation(context: VMContext): GlobalAllocation | undefined {
  if (!isAddonContextHandle(context)) return undefined;
  const { globalObject, prototypeChain } = context;
  if (globalObject === undefined && prototypeChain === undefined) return undefined;
  if (globalObject === undefined || prototypeChain === undefined) {
    throw new InternalError('Node backend must supply globalObject and prototypeChain together');
  }
  return { object: globalObject, prototypeChain };
}

export function setPropertyDelegate(object: object, delegate: object): void {
  if (!addon.setPropertyDelegate) {
    throw new InternalError('Node backend does not provide setPropertyDelegate');
  }
  addon.setPropertyDelegate(object, delegate);
}

export function setGlobalObject(context: VMContext, object: object, indexedProperties?: GlobalIndexedProperties): void {
  if (!addon.setGlobalObject) {
    throw new InternalError('Node backend does not provide setGlobalObject');
  }
  addon.setGlobalObject(context, object, indexedProperties);
}

export function makePrototypeImmutable(object: object): void {
  addon.makePrototypeImmutable?.(object);
}

export function runInContext(
  source: string,
  context: VMContext,
  options?: ContextEvaluationOptions,
): unknown {
  if (addon.createContextHandle && addon.runInContext &&
    isAddonContextHandle(context)) {
    return addon.runInContext(source, context, options);
  }
  return vm.runInContext(source, context, options as vm.RunningScriptOptions) as unknown;
}

/** Compile without execution using the backend that owns the supplied context. */
export function compileScript(
  source: string, context: VMContext, filename: string, importModuleDynamically?: ImportModuleDynamically<CompiledScript>,
  lineOffset = 0,
): CompiledScript {
  if (isAddonContextHandle(context)) {
    if (!addon.Script) throw new InternalError('Node backend does not provide Script');
    return new addon.Script(source, { filename, lineOffset, displayErrors: false, importModuleDynamically });
  }
  return new vm.Script(source, { filename, lineOffset, importModuleDynamically } as vm.ScriptOptions);
}

/** Run retained code without reparsing it or performing a microtask checkpoint. */
export function runScript(script: CompiledScript, context: VMContext): unknown {
  return script.runInContext(context, { displayErrors: false });
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
  #ambientMicrotaskQueue: JSMicrotaskQueue = {
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
    const getFunctionRealm = addon.getFunctionRealm;

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

  createMicrotaskQueue(requestCheckpoint?: () => void): JSMicrotaskQueue {
    if (!addon.createMicrotaskQueue) {
      return this.#ambientMicrotaskQueue;
    }

    // Native enqueue hooks already notify HTML. Otherwise, observed outer
    // calls and Promise settlements can wake the owning queue without polling.
    const handle: unknown = addon.createMicrotaskQueue(promiseJobsObserved ? undefined : requestCheckpoint);
    if (!isAddonMicrotaskQueueHandle(handle)) {
      throw new InternalError('Node backend createMicrotaskQueue returned an invalid queue');
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
      throw new InternalError(
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
  /** Schedule the job, or return false to retain V8's native delivery. */
  enqueueGenericJob(
    this: void,
    job: () => void,
    realm: JSRealm | null,
  ): false | void;
  /** Schedule the timeout, or return false to retain V8's native timer. */
  enqueueTimeoutJob(
    this: void,
    job: () => void,
    realm: JSRealm | null,
    milliseconds: number,
  ): false | void;
};

export type JSJobCallback<HostDefined> = {
  callback: JSFunction;
  hostDefined: HostDefined;
};

export type JSJobRegistration = {
  /** Incumbent observed before entering host JavaScript. */
  incumbent: JSRealm | null;
  /**
   * Retained VM compilation. Undefined means no metadata was observed, allowing
   * fallback to saved execution state. Null means metadata was present but
   * unrecognized, so it must not inherit an unrelated host script.
   */
  compiledCode: CompiledCode | null | undefined;
};

export type JSMicrotaskQueue = {
  kind: 'ambient' | 'explicit';
  enqueueMicrotask(steps: () => void): void;
  performMicrotaskCheckpoint(): void;
};

/** Stock Node's DONT_CONTEXTIFY global proxy or a compatibility-addon context handle. */
export type VMContext = GlobalProxy | AddonContextHandle;

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
  kind = 'explicit' as const;
  handle: AddonMicrotaskQueueHandle;

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
