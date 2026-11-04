import { isWebAssemblyException, type JSEnvironment, type JSWasmException } from '../../js-engine/index';

import type { WasmTagImpl } from './objects';
import type { ExceptionOptions } from './types';

/** Exception methods delegate to the engine's exception and its typed payload. */
export class WasmExceptionImpl {
  /** Native tag, payload, and optional stack; Exception's binding also uses this as its platform object. */
  #backing: JSWasmException;
  /** Native stack accessor retained from the implementation's environment. */
  #env: JSEnvironment;

  constructor(tag: WasmTagImpl | JSWasmException, payload: unknown[], options: ExceptionOptions, env: JSEnvironment) {
    this.#env = env;
    this.#backing = isWebAssemblyException(tag) ? tag :
      Reflect.construct(env.realm.WebAssemblyException, [tag.getBacking(), payload, options]) as JSWasmException;
  }

  // SPEC_CLASH(wasm-exception-stack): V8 keeps a traced stack as an own property;
  // invoking the prototype getter directly still returns undefined.
  get stack(): string | undefined {
    return Reflect.apply(this.#env.realm.webAssemblyExceptionStack, this.#backing, []) as string | undefined;
  }

  /** Read an already-converted payload index using the invoked method's realm. */
  getArg(tag: WasmTagImpl, index: number, env: JSEnvironment): unknown {
    return Reflect.apply(env.realm.webAssemblyExceptionGetArg, this.#backing, [tag.getBacking(), index]);
  }

  /** Test tag identity using the invoked method's realm for native exceptions. */
  is(tag: WasmTagImpl, env: JSEnvironment): boolean {
    return Reflect.apply(env.realm.webAssemblyExceptionIs, this.#backing, [tag.getBacking()]) as boolean;
  }

  /** Preserve native tagged throws and catches at the Exception-specific binding boundary. */
  getBacking(): JSWasmException { return this.#backing; }
}
