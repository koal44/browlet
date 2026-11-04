import {
  getBufferSourceView, isWebAssemblyModule, getWebAssemblyModuleImports, isCallable, isObject, isWebAssemblyFunction,
  type JSBufferSource, type JSEnvironment, type JSFunction, type JSWasmModule, type JSWasmInstance,
  type JSWasmModuleImport, type JSWasmImportExportKind,
} from '../../js-engine/index';
import {
  annotated, arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface, dictMember, emptyDictionary,
  idlType, impl, implementationType, reference, sequence, staticOp, xattr,
} from '../../web-idl/core/index';

import type { WebAssemblyCompileOptions, WasmEnvironment } from './webassembly';
import { WasmMemoryImpl, WasmTableImpl, WasmGlobalImpl, WasmTagImpl } from './objects';

/** A compiled module's implementation; the engine object never serves as its platform object. */
export class WasmModuleImpl {
  /** Compiled engine state, accessible only through this implementation's operations. */
  #backing: JSWasmModule;

  constructor(backing: JSWasmModule);
  constructor(bytes: JSBufferSource, options: WebAssemblyCompileOptions, env: JSEnvironment);
  constructor(source: JSWasmModule | JSBufferSource, options?: WebAssemblyCompileOptions, env?: JSEnvironment) {
    if (isWebAssemblyModule(source)) {
      this.#backing = source;
    } else {
      const view = getBufferSourceView(source);
      if (new Set(options!.builtins).size !== options!.builtins.length) {
        throw new env!.realm.WebAssemblyCompileError('Duplicate WebAssembly builtin names');
      }
      this.#backing = Reflect.construct(env!.realm.WebAssemblyModule, [view, options]) as JSWasmModule;
    }
  }

  /** Read import declarations without consulting author-facing methods. */
  imports(): JSWasmModuleImport[] {
    return getWebAssemblyModuleImports(this.#backing);
  }

  /** Read export declarations; Binding creates the result dictionaries in the invoked realm. */
  exports(env: JSEnvironment): ModuleExportDescriptor[] {
    return Reflect.apply(env.realm.webAssemblyModuleExports, undefined, [this.#backing]) as ModuleExportDescriptor[];
  }

  /** Copy custom sections into buffers belonging to the invoked realm. */
  customSections(sectionName: string, env: JSEnvironment): ArrayBuffer[] {
    return Reflect.apply(env.realm.webAssemblyModuleCustomSections, undefined, [this.#backing, sectionName]) as ArrayBuffer[];
  }

  /** Instantiate synchronously using this compiled module and the existing HTML callback adapter. */
  createInstance(imports: object | undefined, env: WasmEnvironment): JSWasmInstance {
    return Reflect.construct(env.realm.WebAssemblyInstance, [this.#backing, this.#adaptImports(imports, env)]) as JSWasmInstance;
  }

  /** Start native instantiation; the caller owns Promise result projection. */
  // SPEC_CLASH(wasm-module-start-timing): V8 runs start synchronously while capturing imports.
  instantiate(imports: object | undefined, env: WasmEnvironment): Promise<unknown> {
    return Reflect.apply(env.realm.webAssemblyInstantiate, undefined, [this.#backing, this.#adaptImports(imports, env)]) as Promise<unknown>;
  }

  /** Adapt function callbacks and unwrap typed imports lazily, preserving the engine's lookup order. */
  #adaptImports(imports: object | undefined, env: WasmEnvironment): object | undefined {
    if (imports === undefined) return imports;
    const declarations = getWebAssemblyModuleImports(this.#backing);
    if (declarations.length === 0) return imports;
    let index = 0;
    // Web IDL's object argument deliberately leaves Wasm to distinguish functions
    // from other imports, including externref globals that happen to contain functions.
    // V8 reads each declaration's namespace and field in this order, including duplicates.
    // Module.imports omits compile-time builtins and string constants just as that lookup does.
    // Use fresh proxy targets: wrapping the author's frozen objects would violate Proxy invariants.
    return new Proxy(Object.create(null) as object, {
      get: (_target, name) => {
        const importIndex = index;
        const declaration = declarations[index++]!;
        // These reads belong to native instantiation's realm. In particular,
        // an uninitialized ESM binding must not create a Node-realm ReferenceError.
        const namespace: unknown = env.realm.reflectGet(imports, name);
        if (!isObject(namespace)) return namespace;
        return new Proxy(Object.create(null) as object, {
          get: (_target, field) => {
            const callback: unknown = env.realm.reflectGet(namespace, field);
            const implementation = isObject(callback) ? env.unwrap(callback) : undefined;
            if ((declaration.kind === 'memory' && implementation instanceof WasmMemoryImpl) ||
              (declaration.kind === 'table' && implementation instanceof WasmTableImpl) ||
              (declaration.kind === 'global' && implementation instanceof WasmGlobalImpl) ||
              (declaration.kind === 'tag' && implementation instanceof WasmTagImpl)) return implementation.getBacking();
            if (declaration.kind !== 'function') return callback;
            if (!isCallable(callback) || isWebAssemblyFunction(callback)) return callback;
            const invokeWithResultConversion = env.realm.createWebAssemblyImportCall(this.#backing, importIndex, callback);
            return this.#createHostFunction(callback, invokeWithResultConversion, env);
          },
        });
      },
    });
  }

  /** Keep the author's callback for realm lookup; invoke it through the engine's result-conversion adapter. */
  // https://webassembly.github.io/spec/js-api/#create-a-host-function
  #createHostFunction(
    callback: JSFunction, invokeWithResultConversion: JSFunction, env: WasmEnvironment,
  ): JSFunction {
    const callbackEnv = env.realm.callbacks.captureEnvironment();
    return (...args) => {
      // Resolve the original callable at invocation, including bound functions and callable Proxies.
      // A Proxy revoked after registration must not introduce an earlier import-time exception.
      const callbacks = env.realm.callbacks.getAssociatedRealm(callback).callbacks;
      callbacks.prepareToRunScript();
      try {
        callbacks.prepareToRunCallback(callbackEnv);
        try {
          // The engine bridge finishes scalar coercion and multi-value iteration
          // here, while the original callback's script/settings scope is active.
          return Reflect.apply(invokeWithResultConversion, undefined, args);
        } finally {
          callbacks.cleanUpAfterRunningCallback(callbackEnv);
        }
      } finally {
        callbacks.cleanUpAfterRunningScript();
      }
    };
  }
}

/** Converted export metadata for the ModuleExportDescriptor dictionary. */
interface ModuleExportDescriptor {
  name: string;
  kind: JSWasmImportExportKind;
}

/*
enum ImportExportKind { "function", "table", "memory", "global", "tag" };
dictionary ModuleExportDescriptor {
  required USVString name;
  required ImportExportKind kind;
};
dictionary ModuleImportDescriptor {
  required USVString module;
  required USVString name;
  required ImportExportKind kind;
};
*/
export const wasmImportExportKindIDL = defineEnumeration({
  name: 'ImportExportKind', values: ['function', 'table', 'memory', 'global', 'tag'],
});
export const wasmModuleExportDescriptorIDL = defineDictionary({
  name: 'ModuleExportDescriptor', members: [
    dictMember('name', idlType.USVString, { required: true }),
    dictMember('kind', reference('ImportExportKind'), { required: true }),
  ],
});
export const wasmModuleImportDescriptorIDL = defineDictionary({
  name: 'ModuleImportDescriptor', members: [
    dictMember('module', idlType.USVString, { required: true }),
    dictMember('name', idlType.USVString, { required: true }),
    dictMember('kind', reference('ImportExportKind'), { required: true }),
  ],
});

// Web API §3 adds [Serializable]. HTML structured data owns native Module cloning;
// the structured-data integration snapshots the implementation's private engine state.
// https://webassembly.github.io/spec/js-api/#modules
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Module {
  constructor([AllowResizable] AllowSharedBufferSource bytes, optional WebAssemblyCompileOptions options = {});
  static sequence<ModuleExportDescriptor> exports(Module moduleObject);
  static sequence<ModuleImportDescriptor> imports(Module moduleObject);
  static sequence<ArrayBuffer> customSections(Module moduleObject, DOMString sectionName);
};
*/
export const wasmModuleIDL = defineInterface<JSEnvironment>({
  name: 'Module', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmModuleImpl, { constructWith: [atArg<JSEnvironment>(2, (env) => env)] }),
  members: [
    // SPEC_CLASH(wasm-module-constructor-order): Binding converts arguments before reading newTarget.prototype, unlike V8.
    ctor(
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
    ),
    // SPEC_CLASH(wasm-module-descriptor-order): Use normal Web IDL dictionary conversion;
    // browsers return native name/kind and module/name/kind order instead.
    staticOp('exports', sequence(reference('ModuleExportDescriptor')),
      [arg('moduleObject', reference(WasmModuleImpl))],
      { overrideInvoke: ({ relevant: env }, module) => module.exports(env) },
    ),
    staticOp('imports', sequence(reference('ModuleImportDescriptor')),
      [arg('moduleObject', reference(WasmModuleImpl))],
      { overrideInvoke: (_environments, module) => module.imports() },
    ),
    // SPEC_CLASH(wasm-custom-section-name): V8 rejects explicit undefined instead of converting it to "undefined".
    staticOp('customSections', sequence(idlType.ArrayBuffer),
      [arg('moduleObject', reference(WasmModuleImpl)), arg('sectionName', idlType.DOMString)],
      {
        overrideInvoke: ({ relevant: env }, module, sectionName) => module.customSections(sectionName, env),
      },
    ),
  ],
});
