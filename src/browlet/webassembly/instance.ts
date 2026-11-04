import { isObject, isWebAssemblyInstance, type JSWasmInstance } from '../../js-engine/index';

import type { WasmModuleImpl } from './module';
import { wrapWasmObject } from './objects';
import type { WasmEnvironment, WasmInvocation } from './webassembly';

/** A running module's implementation and its retained exports object. */
export class WasmInstanceImpl {
  /** Engine instance; the platform Instance is an ordinary Web IDL object. */
  #backing: JSWasmInstance;
  /** Environment that owns the instance and newly produced exports. */
  #env: WasmEnvironment;
  /** One immutable exports object, allocated only when requested. */
  #exports?: object;

  constructor(module: WasmModuleImpl | JSWasmInstance, imports: object | undefined, call: WasmInvocation) {
    const { env } = call;
    this.#env = env;
    if (isWebAssemblyInstance(module)) {
      this.#backing = module;
    } else {
      const incumbent = call.incumbent ?? env;
      env.realm.callbacks.prepareToRunCallback(incumbent);
      try { this.#backing = module.createInstance(imports, env); }
      finally { env.realm.callbacks.cleanUpAfterRunningCallback(incumbent); }
    }
    instances.set(this.#backing, this);
  }

  get exports(): object {
    if (this.#exports) return this.#exports;
    const native = Reflect.apply(this.#env.realm.webAssemblyInstanceExports, this.#backing, []) as Record<string, unknown>;
    const exports = this.#env.realm.createOrdinaryObject(null);
    for (const [name, value] of Object.entries(native)) {
      const implementation = isObject(value) && wrapWasmObject(value, this.#env);
      Object.defineProperty(exports, name, {
        value: implementation ? this.#env.project(implementation) : value,
        enumerable: true, writable: false, configurable: false,
      });
    }
    return this.#exports = Object.freeze(exports);
  }

  /** Internal ESM bridge entry; the native instance never crosses the public API. */
  getBacking(): JSWasmInstance { return this.#backing; }
}

// One implementation per engine instance; ordinary PlatformRecord owns projection.
const instances = new WeakMap<object, WasmInstanceImpl>();

/** Reuse the implementation of an asynchronously or ESM-created instance. */
export function wrapWasmInstance(backing: JSWasmInstance, env: WasmEnvironment): WasmInstanceImpl {
  return instances.get(backing) ?? new WasmInstanceImpl(backing, undefined, { env });
}
