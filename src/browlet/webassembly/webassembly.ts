import type { InternalPromise } from '../../infra/index';
import {
  getBufferSourceView, getWebAssemblyModuleImports, isCallable, isObject,
  isWebAssemblyModule, isWebAssemblyInstance, isWebAssemblyMemory, isWebAssemblyTable,
  isWebAssemblyGlobal, isWebAssemblyTag, isWebAssemblyFunction,
  type JSBufferSource, type JSEnvironment, type JSFunction, type JSWebAssemblyModule, type JSWebAssemblyInstance,
  type JSWebAssemblyMemory, type JSWebAssemblyTable, type JSWebAssemblyGlobal, type JSWebAssemblyTag,
} from '../../js-engine/index';
import {
  annotated, arg, ctor, defineDictionary, defineEnumeration, defineInterface, defineNamespace, definePartialDictionary,
  defineTypedef, dictMember, emptyDictionary, emptySequence,
  idlType, implementationType, nullable, op, promise, reference, roAttr, sequence, staticOp, xattr,
  type WebIDLRealm,
} from '../../web-idl/index';

/** WebAssembly operations backed by the owning realm's native engine. */
export class WebAssemblyImpl {
  /** Validate already-converted bytes and options using the owner's native engine. */
  // SPEC_CLASH(wasm-validate-bindings): Apply Web IDL conversion before native byte access; see ROADMAP.md.
  static validate(bytes: JSBufferSource, options: WebAssemblyCompileOptions, env: JSEnvironment): boolean {
    // Options may mutate or detach the source. Only inspect it after their conversion.
    const view = getBufferSourceView(bytes);
    if (new Set(options.builtins).size !== options.builtins.length) return false;
    return Reflect.apply(env.realm.webAssemblyValidate, undefined, [view, options]) as boolean;
  }

  /** Compile already-converted input, retaining the native Promise and Module identities. */
  // SPEC_CLASH(wasm-validate-bindings): The same native input-conversion gaps affect compile().
  static compile(bytes: JSBufferSource, options: WebAssemblyCompileOptions, env: JSEnvironment): InternalPromise<JSWebAssemblyModule> {
    // Converted options contain no author accessors; native compilation copies this view now.
    const view = getBufferSourceView(bytes);
    if (new Set(options.builtins).size !== options.builtins.length) {
      const result = env.InternalPromise.withResolvers(moduleType);
      env.queueTask('engine', () => {
        result.reject(new env.realm.WebAssemblyCompileError('Duplicate WebAssembly builtin names'));
      });
      return result.promise;
    }
    const result = Reflect.apply(env.realm.webAssemblyCompile, undefined, [view, options]) as Promise<unknown>;
    // Keep the native Promise without observing or resolving its Module a second time.
    return env.InternalPromise.fromNative(result, (value) => {
      // Author thenables can replace the compilation result; internal instantiation still requires a Module.
      if (!isWebAssemblyModule(value)) throw new env.realm.TypeError('Compilation did not resolve to a WebAssembly.Module');
      return value;
    }, moduleType);
  }

  /** Instantiate converted bytes through the native compiler and its Module Promise. */
  static instantiateBytes(
    bytes: JSBufferSource, imports: object | undefined, options: WebAssemblyCompileOptions, env: WebAssemblyEnvironment,
  ): InternalPromise<WebAssemblyInstantiatedSource> {
    const result = env.InternalPromise.withResolvers(instantiatedSourceType);
    const { callbacks } = env.realm;
    const incumbent = callbacks.captureEnvironment();
    this.compile(bytes, options, env).observe((module) => {
      // ACCOMMODATION(node-v8-internal-promise-incumbent): This internal observer is
      // a Node host function, so native Promise hooks do not save its HTML incumbent.
      // Carry the reaction's registration settings into the later import reads.
      callbacks.prepareToRunCallback(incumbent);
      try {
        this.instantiateModule(module, imports, env).observe((instance) => {
          result.resolve({ module, instance });
        }, result.reject);
      } finally {
        callbacks.cleanUpAfterRunningCallback(incumbent);
      }
    }, result.reject);
    return result.promise;
  }

  /** Instantiate a converted native Module, retaining the invoked realm's Promise and Instance. */
  // SPEC_CLASH(wasm-module-start-timing): V8 still runs start synchronously while capturing imports.
  static instantiateModule(
    module: JSWebAssemblyModule, imports: object | undefined, env: WebAssemblyEnvironment,
  ): InternalPromise<JSWebAssemblyInstance> {
    const adapted = this.#adaptImports(module, imports, env);
    const result = Reflect.apply(env.realm.webAssemblyInstantiate, undefined, [module, adapted]) as Promise<unknown>;
    return env.InternalPromise.fromNative(result, (value) => value as JSWebAssemblyInstance, instanceType);
  }

  /** Return the engine's JavaScript exception tag without consulting the replaceable namespace property. */
  // SPEC_CLASH(wasm-js-tag-realms): V8 owns a tag per context instead of per Agent; see ROADMAP.md.
  static getJSTag(env: JSEnvironment): JSWebAssemblyTag {
    return env.realm.webAssemblyJSTag;
  }

  /** Compile converted bytes synchronously, returning the owning realm's native Module. */
  // SPEC_CLASH(wasm-validate-bindings): Native constructors share the namespace operations' conversion gaps.
  static createModule(bytes: JSBufferSource, options: WebAssemblyCompileOptions, env: JSEnvironment): JSWebAssemblyModule {
    const view = getBufferSourceView(bytes);
    if (new Set(options.builtins).size !== options.builtins.length) {
      throw new env.realm.WebAssemblyCompileError('Duplicate WebAssembly builtin names');
    }
    return Reflect.construct(env.realm.WebAssemblyModule, [view, options]) as JSWebAssemblyModule;
  }

  /** Instantiate a converted Module synchronously; the engine reads imports, links, and runs start. */
  static createInstance(module: JSWebAssemblyModule, imports: object | undefined, env: WebAssemblyEnvironment): JSWebAssemblyInstance {
    return Reflect.construct(env.realm.WebAssemblyInstance, [module, this.#adaptImports(module, imports, env)]) as JSWebAssemblyInstance;
  }

  /** Adapt function imports lazily, leaving lookup, validation, and all other import kinds with the engine. */
  static #adaptImports(module: JSWebAssemblyModule, imports: object | undefined, env: WebAssemblyEnvironment): object | undefined {
    if (imports === undefined) return imports;
    const declarations = getWebAssemblyModuleImports(module);
    if (!declarations.some((entry) => entry.kind === 'function')) return imports;
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
        const namespace: unknown = Reflect.get(imports, name);
        if (declaration.kind !== 'function' || !isObject(namespace)) return namespace;
        return new Proxy(Object.create(null) as object, {
          get: (_target, field) => {
            const callback: unknown = Reflect.get(namespace, field);
            if (!isCallable(callback) || isWebAssemblyFunction(callback)) return callback;
            const invokeWithResultConversion = env.realm.createWebAssemblyImportCall(module, importIndex, callback);
            return this.#createHostFunction(callback, invokeWithResultConversion, env);
          },
        });
      },
    });
  }

  /** Keep the author's callback for realm lookup; invoke it through the engine's result-conversion adapter. */
  // https://webassembly.github.io/spec/js-api/#create-a-host-function
  static #createHostFunction(
    callback: JSFunction, invokeWithResultConversion: JSFunction, env: WebAssemblyEnvironment,
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

  /** Allocate native memory from a converted descriptor; V8 owns address conversion, limits, and backing storage. */
  static createMemory(descriptor: MemoryDescriptor, env: JSEnvironment): JSWebAssemblyMemory {
    const memory = Reflect.construct(env.realm.WebAssemblyMemory, [descriptor]) as JSWebAssemblyMemory;
    // SPEC_CLASH(wasm-memory-initial-buffer-realm): Initialize the buffer now; V8 otherwise uses the first getter's realm.
    Reflect.apply(env.realm.webAssemblyMemoryBuffer, memory, []);
    return memory;
  }

  /** Allocate a native table from converted arguments; the engine owns reference validation and its object cache. */
  static createTable(descriptor: TableDescriptor, value: unknown, env: JSEnvironment): JSWebAssemblyTable {
    const table = Reflect.construct(env.realm.WebAssemblyTable, [descriptor, value]) as JSWebAssemblyTable;
    // SPEC_CLASH(wasm-empty-table-initializer): V8 skips value validation at size zero; Firefox, WebKit, and the draft require it.
    const zero = descriptor.address === 'i64' ? 0n : 0;
    if (value !== undefined && Reflect.apply(env.realm.webAssemblyTableLength, table, []) === zero) {
      // Native zero growth validates the value without adding entries or exposing an intermediate table.
      Reflect.apply(env.realm.webAssemblyTableGrow, table, [zero, value]);
    }
    return table;
  }

  /** Allocate a native Global from converted arguments; the engine owns typed storage and the Global object cache. */
  static createGlobal(descriptor: GlobalDescriptor, value: unknown, env: JSEnvironment): JSWebAssemblyGlobal {
    // SPEC_CLASH(wasm-global-undefined-initializer): Web IDL treats undefined as missing; V8 distinguishes argument count.
    const args = value === undefined ? [descriptor] : [descriptor, value];
    return Reflect.construct(env.realm.WebAssemblyGlobal, args) as JSWebAssemblyGlobal;
  }
}

/** The existing engine environment with the host callback lifecycle used by Wasm imports. */
export interface WebAssemblyEnvironment extends JSEnvironment {
  realm: WebIDLRealm;
}

/** Converted compile options; native validation owns the supported builtin/import types. */
export interface WebAssemblyCompileOptions {
  /** Names of builtin modules requested for this compilation. */
  builtins: string[];
  /** Import module whose string-valued globals are supplied by the engine. */
  importedStringConstants: string | null;
}

/** The retained native objects produced by byte-input instantiation. */
export interface WebAssemblyInstantiatedSource {
  module: JSWebAssemblyModule;
  instance: JSWebAssemblyInstance;
}

/** Converted Memory descriptor, including the threads proposal's existing shared-memory option. */
export interface MemoryDescriptor {
  /** Initial page count; the engine applies AddressValueToU64 after prototype selection. */
  initial: unknown;
  /** Optional maximum page count. */
  maximum?: unknown;
  /** Address representation, defaulting to i32 in the constructor algorithm. */
  address?: 'i32' | 'i64';
  /** Whether the engine allocates shared backing storage. */
  shared: boolean;
}

/** Converted Table descriptor; the engine converts AddressValue sizes and validates stored references. */
export interface TableDescriptor {
  /** Reference type stored in each entry. */
  element: 'externref' | 'anyfunc';
  /** Initial entry count, converted numerically by the engine after prototype selection. */
  initial: unknown;
  /** Optional maximum entry count. */
  maximum?: unknown;
  /** Address representation, defaulting to i32 in the constructor algorithm. */
  address?: 'i32' | 'i64';
}

/** Converted Global descriptor; native construction converts the initializer to this Wasm value type. */
export interface GlobalDescriptor {
  value: 'i32' | 'i64' | 'f32' | 'f64' | 'v128' | 'externref' | 'anyfunc';
  mutable: boolean;
}

const moduleType = implementationType<JSWebAssemblyModule>(reference('Module'));
const instanceType = implementationType<JSWebAssemblyInstance>(reference('Instance'));
const tagType = implementationType<JSWebAssemblyTag>(reference('Tag'));
const instantiatedSourceType = implementationType<WebAssemblyInstantiatedSource>(reference('WebAssemblyInstantiatedSource'));

/*
enum AddressType { "i32", "i64" };
typedef any AddressValue;
*/
export const webAssemblyAddressTypeIDL = defineEnumeration({ name: 'AddressType', values: ['i32', 'i64'] });
export const webAssemblyAddressValueIDL = defineTypedef({ name: 'AddressValue', type: idlType.any });

// Construction and customSections() use Binding; the reviewed imports()/exports() remain native.
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
export const webAssemblyModuleIDL = defineInterface<JSEnvironment>({
  name: 'Module', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  interfaceOverride: {
    isInstance: isWebAssemblyModule,
    getInterfaceObject: (env) => env.realm.WebAssemblyModule,
  },
  members: [
    // SPEC_CLASH(wasm-module-constructor-order): Binding converts arguments before reading newTarget.prototype, unlike V8.
    ctor(
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { overrideConstruct: ({ relevant: env }, bytes, options) => WebAssemblyImpl.createModule(bytes, options, env) },
    ),
    // SPEC_CLASH(wasm-custom-section-name): V8 rejects explicit undefined instead of converting it to "undefined".
    staticOp('customSections', sequence(idlType.ArrayBuffer),
      [arg('moduleObject', moduleType), arg('sectionName', idlType.DOMString)],
      {
        overrideInvoke: ({ relevant: env }, module, sectionName) => Reflect.apply(
          env.realm.webAssemblyModuleCustomSections, undefined, [module, sectionName],
        ) as ArrayBuffer[],
      },
    ),
  ],
});
// Construction uses Binding; the reviewed exports getter remains native (see ROADMAP.md).
// https://webassembly.github.io/spec/js-api/#instances
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Instance {
  constructor(Module module, optional object importObject);
  readonly attribute object exports;
};
*/
export const webAssemblyInstanceIDL = defineInterface<WebAssemblyEnvironment>({
  name: 'Instance', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  interfaceOverride: {
    isInstance: isWebAssemblyInstance,
    getInterfaceObject: (env) => env.realm.WebAssemblyInstance,
  },
  members: [
    // SPEC_CLASH(wasm-instance-constructor-order): Web IDL converts arguments before newTarget.prototype; V8 reads it first.
    ctor(
      [arg('module', moduleType), arg('importObject', idlType.object, { optional: true })],
      {
        // Wasm, not Web IDL, identifies the callbacks inside the opaque import object.
        overrideCapturesIncumbent: true,
        overrideConstruct: ({ relevant: env }, module, imports) => WebAssemblyImpl.createInstance(module, imports, env),
      },
    ),
  ],
});

// https://webassembly.github.io/spec/js-api/#memories
/*
dictionary MemoryDescriptor {
  required AddressValue initial;
  AddressValue maximum;
  AddressType address;
};
*/
export const webAssemblyMemoryDescriptorIDL = defineDictionary({
  name: 'MemoryDescriptor',
  members: [
    dictMember('initial', reference('AddressValue'), { required: true }),
    dictMember('maximum', reference('AddressValue')),
    dictMember('address', reference('AddressType')),
  ],
});

// The threads proposal adds shared to MemoryDescriptor; compose that contribution as a partial of the current draft.
// https://github.com/WebAssembly/threads/blob/main/document/js-api/index.bs#memories
/*
partial dictionary MemoryDescriptor {
  boolean shared = false;
};
*/
export const webAssemblySharedMemoryDescriptorIDL = definePartialDictionary({
  name: 'MemoryDescriptor', members: [dictMember('shared', idlType.boolean, { default: false })],
});

// Construction uses Binding; the instance members and backing storage remain native.
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Memory {
  constructor(MemoryDescriptor descriptor);
  AddressValue grow(AddressValue delta);
  ArrayBuffer toFixedLengthBuffer();
  ArrayBuffer toResizableBuffer();
  readonly attribute ArrayBuffer buffer;
};
*/
export const webAssemblyMemoryIDL = defineInterface<JSEnvironment>({
  name: 'Memory', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  interfaceOverride: {
    isInstance: isWebAssemblyMemory,
    getInterfaceObject: (env) => env.realm.WebAssemblyMemory,
  },
  members: [
    // SPEC_CLASH(wasm-memory-constructor-order): Web IDL reads the descriptor before prototype/size conversion; V8 interleaves them.
    ctor(
      [arg('descriptor', implementationType<MemoryDescriptor>(reference('MemoryDescriptor')))],
      { overrideConstruct: ({ relevant: env }, descriptor) => WebAssemblyImpl.createMemory(descriptor, env) },
    ),
  ],
});

// https://webassembly.github.io/spec/js-api/#tables
// SPEC_CLASH(wasm-table-kind-values): Bind the draft's two kinds; Chromium/Firefox additionally accept GC reference names.
/*
enum TableKind { "externref", "anyfunc" };
*/
export const webAssemblyTableKindIDL = defineEnumeration({ name: 'TableKind', values: ['externref', 'anyfunc'] });

/*
dictionary TableDescriptor {
  required TableKind element;
  required AddressValue initial;
  AddressValue maximum;
  AddressType address;
};
*/
export const webAssemblyTableDescriptorIDL = defineDictionary({
  name: 'TableDescriptor',
  members: [
    dictMember('element', reference('TableKind'), { required: true }),
    dictMember('initial', reference('AddressValue'), { required: true }),
    dictMember('maximum', reference('AddressValue')),
    dictMember('address', reference('AddressType')),
  ],
});

// Construction uses Binding; native instance members retain engine reference and growth behavior.
// SPEC_CLASH(wasm-table-undefined-value): Native grow/set distinguish missing from explicit undefined, matching all three browsers.
// SPEC_CLASH(wasm-table-set-error-order): Native set checks bounds before reference conversion, matching all three browsers.
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Table {
  constructor(TableDescriptor descriptor, optional any value);
  AddressValue grow(AddressValue delta, optional any value);
  any get(AddressValue index);
  undefined set(AddressValue index, optional any value);
  readonly attribute AddressValue length;
};
*/
export const webAssemblyTableIDL = defineInterface<JSEnvironment>({
  name: 'Table', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  interfaceOverride: {
    isInstance: isWebAssemblyTable,
    getInterfaceObject: (env) => env.realm.WebAssemblyTable,
  },
  members: [
    // SPEC_CLASH(wasm-table-constructor-order): Web IDL finishes descriptor conversion before prototype lookup and numeric sizes.
    ctor(
      [arg('descriptor', implementationType<TableDescriptor>(reference('TableDescriptor'))), arg('value', idlType.any, { optional: true })],
      { overrideConstruct: ({ relevant: env }, descriptor, value) => WebAssemblyImpl.createTable(descriptor, value, env) },
    ),
  ],
});

// https://webassembly.github.io/spec/js-api/#globals
// SPEC_CLASH(wasm-global-value-types): Bind the draft's seven types; V8 additionally accepts GC reference names.
/*
enum ValueType { "i32", "i64", "f32", "f64", "v128", "externref", "anyfunc" };
*/
export const webAssemblyValueTypeIDL = defineEnumeration({
  name: 'ValueType', values: ['i32', 'i64', 'f32', 'f64', 'v128', 'externref', 'anyfunc'],
});

/*
dictionary GlobalDescriptor {
  required ValueType value;
  boolean mutable = false;
};
*/
export const webAssemblyGlobalDescriptorIDL = defineDictionary({
  name: 'GlobalDescriptor',
  members: [
    dictMember('value', reference('ValueType'), { required: true }),
    dictMember('mutable', idlType.boolean, { default: false }),
  ],
});

// Construction uses Binding; the reviewed value accessor and valueOf() stay native.
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Global {
  constructor(GlobalDescriptor descriptor, optional any v);
  any valueOf();
  attribute any value;
};
*/
export const webAssemblyGlobalIDL = defineInterface<JSEnvironment>({
  name: 'Global', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  interfaceOverride: {
    isInstance: isWebAssemblyGlobal,
    getInterfaceObject: (env) => env.realm.WebAssemblyGlobal,
  },
  members: [
    // SPEC_CLASH(wasm-global-construction-order): Convert the descriptor before prototype lookup and native initializer conversion.
    ctor(
      [arg('descriptor', implementationType<GlobalDescriptor>(reference('GlobalDescriptor'))), arg('v', idlType.any, { optional: true })],
      { overrideConstruct: ({ relevant: env }, descriptor, value) => WebAssemblyImpl.createGlobal(descriptor, value, env) },
    ),
  ],
});

// JSTag needs native value recognition now; the full Tag interface is reviewed in §5.7.
// https://webassembly.github.io/spec/js-api/#tags
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Tag {
  constructor(TagType type);
};
*/
export const webAssemblyTagIDL = defineInterface({
  name: 'Tag', members: [], interfaceOverride: { isInstance: isWebAssemblyTag },
});

/*
dictionary WebAssemblyInstantiatedSource {
  required Module module;
  required Instance instance;
};
*/
export const webAssemblyInstantiatedSourceIDL = defineDictionary({
  name: 'WebAssemblyInstantiatedSource',
  members: [
    dictMember('module', moduleType, { required: true }),
    dictMember('instance', instanceType, { required: true }),
  ],
});

// https://webassembly.github.io/spec/js-api/#webassemblycompileoptions
/*
dictionary WebAssemblyCompileOptions {
  USVString? importedStringConstants = null;
  sequence<USVString> builtins = [];
};
*/
export const webAssemblyCompileOptionsIDL = defineDictionary({
  name: 'WebAssemblyCompileOptions',
  members: [
    dictMember('importedStringConstants', nullable(idlType.USVString), { default: null }),
    dictMember('builtins', sequence(idlType.USVString), { default: emptySequence }),
  ],
});

// WebAssembly JavaScript API §5. The remaining native namespace members are reviewed separately.
// https://webassembly.github.io/spec/js-api/#webassembly-namespace
/*
[Exposed=*]
namespace WebAssembly {
  boolean validate([AllowResizable] AllowSharedBufferSource bytes, optional WebAssemblyCompileOptions options = {});
  Promise<Module> compile([AllowResizable] AllowSharedBufferSource bytes, optional WebAssemblyCompileOptions options = {});

  Promise<WebAssemblyInstantiatedSource> instantiate(
    [AllowResizable] AllowSharedBufferSource bytes, optional object importObject, optional WebAssemblyCompileOptions options = {});

  Promise<Instance> instantiate(Module moduleObject, optional object importObject);

  readonly attribute Tag JSTag;
};
*/
export const webAssemblyIDL = defineNamespace<WebAssemblyEnvironment>({
  name: 'WebAssembly',
  exposed: '*',
  overrideNamespace: (env) => env.realm.WebAssembly,
  members: [
    op('validate', idlType.boolean,
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { overrideInvoke: ({ relevant: env }, bytes, options) => WebAssemblyImpl.validate(bytes, options, env) },
    ),
    op('compile', promise(moduleType),
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { overrideInvoke: ({ relevant: env }, bytes, options) => WebAssemblyImpl.compile(bytes, options, env) },
    ),
    op('instantiate', promise(instantiatedSourceType),
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('importObject', idlType.object, { optional: true }),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      {
        // Save the initiating caller before compilation moves import reads to a later task.
        overrideCapturesIncumbent: true,
        overrideInvoke: ({ relevant: env }, bytes, imports, options) => WebAssemblyImpl.instantiateBytes(bytes, imports, options, env),
      },
    ),
    op('instantiate', promise(instanceType),
      [arg('moduleObject', moduleType), arg('importObject', idlType.object, { optional: true })],
      {
        overrideCapturesIncumbent: true,
        overrideInvoke: ({ relevant: env }, module, imports) => WebAssemblyImpl.instantiateModule(module, imports, env),
      },
    ),
    // SPEC_CLASH(wasm-js-tag-descriptor): Install the draft's enumerable getter over V8's readonly data property.
    roAttr('JSTag', tagType, { overrideGet: ({ relevant: env }) => WebAssemblyImpl.getJSTag(env) }),
  ],
});
