import {
  isWebAssemblyMemory, isWebAssemblyTable, isWebAssemblyGlobal, isWebAssemblyTag,
  type JSWasmMemory, type JSWasmTable, type JSWasmGlobal, type JSWasmTag,
} from '../../js-engine/index';

import type { WasmEnvironment } from './webassembly';
import type { MemoryDescriptor, TableDescriptor, GlobalDescriptor, TagType } from './types';

/** A Memory implementation owns its native allocation; Binding owns the public object. */
export class WasmMemoryImpl {
  /** Native storage and its current buffer. */
  #backing: JSWasmMemory;
  /** The allocation's environment, preserved through borrowed accessors. */
  #env: WasmEnvironment;

  constructor(descriptor: MemoryDescriptor | JSWasmMemory, env: WasmEnvironment) {
    this.#env = env;
    this.#backing = isWebAssemblyMemory(descriptor) ? descriptor :
      Reflect.construct(env.realm.WebAssemblyMemory, [descriptor]) as JSWasmMemory;
    // Initialize the buffer in its owning realm before another realm can borrow the getter.
    Reflect.apply(env.realm.webAssemblyMemoryBuffer, this.#backing, []);
    objects.set(this.#backing, this);
  }

  get buffer(): ArrayBuffer | SharedArrayBuffer {
    return Reflect.apply(this.#env.realm.webAssemblyMemoryBuffer, this.#backing, []) as ArrayBuffer | SharedArrayBuffer;
  }

  grow(delta: unknown, env: WasmEnvironment): unknown {
    return Reflect.apply(env.realm.webAssemblyMemoryGrow, this.#backing, [delta]);
  }

  // TODO(Node 24): The engine lacks both buffer-conversion operations. Keep the
  // availability regressions explicit; copied buffers cannot emulate live storage.
  toFixedLengthBuffer(env: WasmEnvironment): ArrayBuffer | SharedArrayBuffer {
    return Reflect.apply(env.realm.webAssemblyMemoryToFixedLengthBuffer, this.#backing, []) as ArrayBuffer | SharedArrayBuffer;
  }

  toResizableBuffer(env: WasmEnvironment): ArrayBuffer | SharedArrayBuffer {
    return Reflect.apply(env.realm.webAssemblyMemoryToResizableBuffer, this.#backing, []) as ArrayBuffer | SharedArrayBuffer;
  }

  /** Supply the engine object only at a Wasm import boundary. */
  getBacking(): JSWasmMemory { return this.#backing; }
}

/** A Table implementation delegates typed entries and growth to the engine. */
export class WasmTableImpl {
  /** Engine table, never used as the platform object. */
  #backing: JSWasmTable;
  /** Realm owning the table and its native errors. */
  #env: WasmEnvironment;

  constructor(descriptor: TableDescriptor | JSWasmTable, value: unknown, env: WasmEnvironment) {
    this.#env = env;
    if (isWebAssemblyTable(descriptor)) {
      this.#backing = descriptor;
    } else {
      this.#backing = Reflect.construct(env.realm.WebAssemblyTable, [descriptor, value]) as JSWasmTable;
      const zero = descriptor.address === 'i64' ? 0n : 0;
      // SPEC_CLASH(wasm-empty-table-initializer): Validate even an empty table's initializer.
      if (value !== undefined && Reflect.apply(env.realm.webAssemblyTableLength, this.#backing, []) === zero) {
        Reflect.apply(env.realm.webAssemblyTableGrow, this.#backing, [zero, value]);
      }
    }
    objects.set(this.#backing, this);
  }

  get length(): unknown { return Reflect.apply(this.#env.realm.webAssemblyTableLength, this.#backing, []); }

  growDefault(delta: unknown, env: WasmEnvironment): unknown { return Reflect.apply(env.realm.webAssemblyTableGrow, this.#backing, [delta]); }

  grow(delta: unknown, value: unknown, env: WasmEnvironment): unknown {
    return Reflect.apply(env.realm.webAssemblyTableGrow, this.#backing, [delta, value]);
  }

  get(index: unknown, env: WasmEnvironment): unknown { return Reflect.apply(env.realm.webAssemblyTableGet, this.#backing, [index]); }

  setDefault(index: unknown, env: WasmEnvironment): void { Reflect.apply(env.realm.webAssemblyTableSet, this.#backing, [index]); }

  set(index: unknown, value: unknown, env: WasmEnvironment): void {
    Reflect.apply(env.realm.webAssemblyTableSet, this.#backing, [index, value]);
  }

  /** Supply the engine object only at a Wasm import boundary. */
  getBacking(): JSWasmTable { return this.#backing; }
}

/** A Global implementation retains the engine's typed mutable or immutable cell. */
export class WasmGlobalImpl {
  /** Native typed cell, separate from the platform identity. */
  #backing: JSWasmGlobal;

  constructor(descriptor: GlobalDescriptor | JSWasmGlobal, value: unknown, env: WasmEnvironment) {
    this.#backing = isWebAssemblyGlobal(descriptor) ? descriptor :
      Reflect.construct(env.realm.WebAssemblyGlobal, value === undefined ? [descriptor] : [descriptor, value]) as JSWasmGlobal;
    objects.set(this.#backing, this);
  }

  getValue(env: WasmEnvironment): unknown { return Reflect.apply(env.realm.webAssemblyGlobalValue, this.#backing, []); }
  setValue(value: unknown, env: WasmEnvironment): void { Reflect.apply(env.realm.webAssemblyGlobalSetValue, this.#backing, [value]); }

  valueOf(env: WasmEnvironment): unknown { return Reflect.apply(env.realm.webAssemblyGlobalValue, this.#backing, []); }

  /** Supply the engine object only at a Wasm import boundary. */
  getBacking(): JSWasmGlobal { return this.#backing; }
}

/** A Tag implementation owns an engine exception-tag identity. */
export class WasmTagImpl {
  /** Engine tag, shared by all references to this implementation. */
  #backing: JSWasmTag;

  constructor(type: TagType | JSWasmTag, env: WasmEnvironment) {
    this.#backing = isWebAssemblyTag(type) ? type : Reflect.construct(env.realm.WebAssemblyTag, [type]) as JSWasmTag;
    objects.set(this.#backing, this);
  }

  /** Supply the engine tag to instantiation or Exception construction. */
  getBacking(): JSWasmTag { return this.#backing; }
}

export type WasmObjectImpl = WasmMemoryImpl | WasmTableImpl | WasmGlobalImpl | WasmTagImpl;

// The native engine object supplies the cache key, matching Wasm's object-cache
// identity. This does not recognize author inputs or create platform objects;
// Binding still owns each implementation's world and realm association.
const objects = new WeakMap<object, WasmObjectImpl>();

/** Wrap an engine-produced export once; this is not author argument conversion. */
export function wrapWasmObject(backing: object, env: WasmEnvironment): WasmObjectImpl | undefined {
  const existing = objects.get(backing);
  if (existing) return existing;
  if (isWebAssemblyMemory(backing)) return new WasmMemoryImpl(backing, env);
  if (isWebAssemblyTable(backing)) return new WasmTableImpl(backing, undefined, env);
  if (isWebAssemblyGlobal(backing)) return new WasmGlobalImpl(backing, undefined, env);
  if (isWebAssemblyTag(backing)) return new WasmTagImpl(backing, env);
}
