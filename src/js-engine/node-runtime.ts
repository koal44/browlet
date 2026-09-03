import * as vm from 'node:vm';
import type { Context } from 'node:vm';

import type {
  JavaScriptMicrotaskQueue, JavaScriptRealm, JavaScriptRuntime,
} from './realm';

const nodeCreateMicrotaskQueue = getNodeMicrotaskQueueFactory();
const nodeContextSupport = getNodeContextSupport();

/*
 * One module instance represents one Node/V8 isolate. Node workers load a
 * separate module instance and therefore receive a separate runtime owner.
 */
class NodeRuntime implements JavaScriptRuntime {
  /*
   * ACCOMMODATION(node-v8-object-realms): ECMAScript does not expose [[Realm]]
   * for arbitrary objects, so retain associations for objects this host sees.
   */
  #evaluatingRealm: JavaScriptRealm | undefined;
  readonly #objectRealms = new WeakMap<object, JavaScriptRealm>();
  #tickCallback: (() => void) | undefined;
  readonly hasExplicitMicrotaskQueues =
    nodeCreateMicrotaskQueue !== undefined;

  /*
   * ACCOMMODATION(node-v8-microtask-queue): Stock Node exposes neither an
   * isolateable V8 microtask queue nor a public synchronous checkpoint. Keep
   * that fallback behind this one queue object. A compatible Node runtime
   * instead returns an explicit queue from createMicrotaskQueue().
   */
  readonly #ambientMicrotaskQueue: JavaScriptMicrotaskQueue = {
    kind: 'ambient',
    enqueueMicrotask: (steps) => { globalThis.queueMicrotask(steps); },
    performMicrotaskCheckpoint: () => { this.#getTickCallback()(); },
  };

  readonly createMicrotaskQueue = (): JavaScriptMicrotaskQueue => {
    if (nodeCreateMicrotaskQueue === undefined) {
      return this.#ambientMicrotaskQueue;
    }

    const handle = Reflect.apply(nodeCreateMicrotaskQueue, vm, []);
    if (!isNodeMicrotaskQueue(handle)) {
      throw new Error('Node vm.createMicrotaskQueue returned an invalid queue');
    }

    const queue: JavaScriptMicrotaskQueue = {
      kind: 'explicit',
      enqueueMicrotask: (steps) => { handle.enqueueMicrotask(steps); },
      performMicrotaskCheckpoint: () => { handle.runMicrotasks(); },
    };
    nodeMicrotaskQueueHandles.set(queue, handle);
    return queue;
  };

  associateRealm(value: object, realm: JavaScriptRealm): void {
    this.#objectRealms.set(value, realm);
  }

  getAssociatedRealm(value: object): JavaScriptRealm | undefined {
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
    microtaskQueue: JavaScriptMicrotaskQueue,
    reuseGlobalProxyFrom?: Context,
  ): Context {
    const handle = nodeMicrotaskQueueHandles.get(microtaskQueue);
    const options = handle === undefined
      ? undefined
      : { microtaskQueue: handle };

    if (nodeContextSupport !== undefined) {
      const context: unknown = Reflect.apply(
        nodeContextSupport.createContextHandle,
        vm,
        [{ ...options, reuseGlobalProxyFrom }],
      );
      if (!isNodeContextHandle(context)) {
        throw new Error('Node vm.createContextHandle returned an invalid handle');
      }
      return context;
    }

    if (reuseGlobalProxyFrom !== undefined) {
      throw new Error('Node does not support reusable global proxies');
    }
    return Reflect.apply(vm.createContext, vm, [
      vm.constants.DONT_CONTEXTIFY,
      options,
    ]) as Context;
  }

  getContextGlobal(context: Context): object {
    return isNodeContextHandle(context)
      ? context.globalProxy
      : context;
  }

  detachContext(context: Context): object {
    if (!isNodeContextHandle(context)) {
      throw new Error('Node does not support detachable context handles');
    }
    return context.detachGlobal();
  }

  makePrototypeImmutable(object: object): void {
    if (nodeContextSupport === undefined) return;
    Reflect.apply(nodeContextSupport.makePrototypeImmutable, vm, [object]);
  }

  runWithActiveRealm<Result>(
    realm: JavaScriptRealm,
    steps: () => Result,
  ): Result {
    const previous = this.#evaluatingRealm;
    this.#evaluatingRealm = realm;
    try {
      return steps();
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

export const nodeRuntime = new NodeRuntime();

type NodeMicrotaskQueue = {
  enqueueMicrotask(steps: () => void): void;
  runMicrotasks(): void;
};

type NodeMicrotaskQueueFactory = () => unknown;

type NodeContextHandle = {
  readonly globalProxy: object;
  detachGlobal(): object;
};

type NodeContextHandleFactory = (options?: {
  reuseGlobalProxyFrom?: NodeContextHandle;
  microtaskQueue?: NodeMicrotaskQueue;
}) => unknown;

type NodeContextSupport = {
  createContextHandle: NodeContextHandleFactory;
  makePrototypeImmutable: (object: object) => void;
};

const nodeMicrotaskQueueHandles = new WeakMap<
  JavaScriptMicrotaskQueue,
  NodeMicrotaskQueue
>();

function isNodeMicrotaskQueue(value: unknown): value is NodeMicrotaskQueue {
  return typeof value === 'object' && value !== null &&
    typeof Reflect.get(value, 'enqueueMicrotask') === 'function' &&
    typeof Reflect.get(value, 'runMicrotasks') === 'function';
}

function getNodeMicrotaskQueueFactory():
NodeMicrotaskQueueFactory | undefined {
  const create = Reflect.get(vm, 'createMicrotaskQueue') as unknown;
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
    vm,
    'createContextHandle',
  );
  const makePrototypeImmutable: unknown = Reflect.get(
    vm,
    'makePrototypeImmutable',
  );
  if (
    createContextHandle === undefined &&
    makePrototypeImmutable === undefined
  ) return undefined;
  if (
    typeof createContextHandle !== 'function' ||
    typeof makePrototypeImmutable !== 'function'
  ) {
    throw new Error('Node exposes an incomplete context-handle API');
  }
  return {
    createContextHandle: createContextHandle as NodeContextHandleFactory,
    makePrototypeImmutable: makePrototypeImmutable as (
      object: object,
    ) => void,
  };
}
