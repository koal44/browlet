import { asciiLower, type InternalPromise, type InternalPromiseWithResolvers, type TaskSourceKey } from '../../infra/index';
import {
  getBufferSourceView,
  type JSBufferSource, type JSEnvironment, type JSWasmModule, type JSWasmInstance,
} from '../../js-engine/index';
import {
  annotated, arg, atArg, attr, ctor, impl, invokeWith, defineDictionary, defineEnumeration, defineInterface, defineNamespace, definePartialDictionary, definePartialNamespace,
  defineTypedef, dictMember, emptyDictionary, emptySequence,
  idlType, implementationType, nullable, op, promise, reference, roAttr, sequence, union, xattr,
  type WebIDLRealm,
} from '../../web-idl/index';
import { isOkStatus, type ResponseImpl } from '../../fetch/index';

import { WasmModuleImpl } from './module';
import { WasmExceptionImpl } from './exception';
import { WasmInstanceImpl, wrapWasmInstance } from './instance';
import { WasmMemoryImpl, WasmTableImpl, WasmGlobalImpl, WasmTagImpl, wrapWasmObject } from './objects';
import type { MemoryDescriptor, TableDescriptor, GlobalDescriptor, TagType, ExceptionOptions } from './types';
export type { MemoryDescriptor, TableDescriptor, GlobalDescriptor, TagType, ValueType, ExceptionOptions } from './types';

/** WebAssembly operations backed by the owning realm's native engine. */
// §6 builtin lookup, signature validation, allocation, and calls remain native.
// Browlet supplies option conversion and duplicate-set rejection.
// SPEC_CLASH(wasm-nonfunction-builtin-import): V8 treats builtin-named non-function imports
// as ordinary imports. Keep Chromium's behavior; the draft, Firefox, and WebKit reject them.
export class WasmImpl {
  /** Environment owning the namespace and its engine operations. */
  #env: WasmEnvironment;

  constructor(env: WasmEnvironment) { this.#env = env; }

  get JSTag(): WasmTagImpl { return wrapWasmObject(this.#env.realm.webAssemblyJSTag, this.#env) as WasmTagImpl; }

  /** Validate already-converted bytes and options using the owner's native engine. */
  // SPEC_CLASH(wasm-validate-bindings): Apply Web IDL conversion before native byte access; see ROADMAP.md.
  validate(bytes: JSBufferSource, options: WebAssemblyCompileOptions, env: JSEnvironment): boolean {
    // Options may mutate or detach the source. Only inspect it after their conversion.
    const view = getBufferSourceView(bytes);
    if (new Set(options.builtins).size !== options.builtins.length) return false;
    return Reflect.apply(env.realm.webAssemblyValidate, undefined, [view, options]) as boolean;
  }

  /** Compile already-converted input, projecting a Module through ordinary Binding. */
  // SPEC_CLASH(wasm-validate-bindings): The same native input-conversion gaps affect compile().
  compile(bytes: JSBufferSource, options: WebAssemblyCompileOptions, env: JSEnvironment): InternalPromise<WasmModuleImpl> {
    const result = env.InternalPromise.withResolvers(moduleType);
    this.#compile(bytes, options, 'engine', result, env);
    return result.promise;
  }

  /** Consume a converted Response Promise, then compile its bytes on the networking task source. */
  // https://webassembly.github.io/spec/web-api/#compile-a-potential-webassembly-response
  // Whole-body consumption is the specification's model; incremental compilation is optional.
  compileStreaming(
    source: InternalPromise<ResponseImpl>, options: WebAssemblyCompileOptions, env: JSEnvironment,
  ): InternalPromise<WasmModuleImpl> {
    const result = env.InternalPromise.withResolvers(moduleType);
    source.observe((response) => {
      const record = response.getResponse();
      const mime = record.headerList.get('Content-Type');
      if (mime === null || asciiLower(mime.replace(/^[\t ]+|[\t ]+$/g, '')) !== 'application/wasm') {
        result.reject(new env.realm.TypeError('WebAssembly response Content-Type must be application/wasm without parameters'));
        return;
      }
      if ((record.type !== 'default' && record.type !== 'basic' && record.type !== 'cors') || !isOkStatus(record.status)) {
        result.reject(new env.realm.TypeError('WebAssembly response must be CORS-same-origin with an ok status'));
        return;
      }
      const url = response.url;
      response.arrayBuffer().observe((bytes) => {
        // Resolve this API's Promise directly: adopting an intermediate public
        // Module Promise would repeat the author's then getter.
        try { this.#compile(bytes, options, 'network', result, env, url); }
        catch (reason) { result.reject(reason); }
      }, result.reject);
    }, result.reject);
    return result.promise;
  }

  /** Instantiate the Module compiled from a Response using the existing import/callback adapter. */
  instantiateStreaming(
    source: InternalPromise<ResponseImpl>, imports: object | undefined, options: WebAssemblyCompileOptions, call: WasmInvocation,
  ): InternalPromise<WebAssemblyInstantiatedSource> {
    return this.#instantiatePromiseOfModule(this.compileStreaming(source, options, call.env), imports, call);
  }

  /** Instantiate converted bytes through the native compiler and its Module Promise. */
  instantiateBytes(
    bytes: JSBufferSource, imports: object | undefined, options: WebAssemblyCompileOptions, call: WasmInvocation,
  ): InternalPromise<WebAssemblyInstantiatedSource> {
    return this.#instantiatePromiseOfModule(this.compile(bytes, options, call.env), imports, call);
  }

  /** Instantiate a converted Module implementation in the invoked realm. */
  // SPEC_CLASH(wasm-module-start-timing): V8 still runs start synchronously while capturing imports.
  instantiateModule(
    module: WasmModuleImpl, imports: object | undefined, call: WasmInvocation,
  ): InternalPromise<WasmInstanceImpl> {
    const { env } = call;
    const incumbent = call.incumbent ?? env;
    env.realm.callbacks.prepareToRunCallback(incumbent);
    try {
      const native = module.instantiate(imports, env);
      const result = env.InternalPromise.withResolvers(instanceType);
      env.realm.observePromise(native, (value) => {
        result.resolve(wrapWasmInstance(value as JSWasmInstance, env));
      }, result.reject);
      return result.promise;
    } finally {
      env.realm.callbacks.cleanUpAfterRunningCallback(incumbent);
    }
  }

  /** Return the existing Instance behind a Wasm module namespace, without instantiating again. */
  // https://webassembly.github.io/esm-integration/js-api/#dom-webassembly-namespaceinstance
  namespaceInstance(namespace: object, env: WasmEnvironment): WasmInstanceImpl {
    return wrapWasmInstance(env.realm.getWebAssemblyNamespaceInstance(namespace), env);
  }

  /** Start native compilation with the task source required by the calling API. */
  // The realm's Wasm compilation hook enforces CSP independently of Fetch checks.
  #compile(
    bytes: JSBufferSource, options: WebAssemblyCompileOptions, source: TaskSourceKey,
    compiled: InternalPromiseWithResolvers<WasmModuleImpl>, env: JSEnvironment, responseURL?: string,
  ): void {
    // Converted options contain no author accessors; native compilation copies this view now.
    const view = getBufferSourceView(bytes);
    if (new Set(options.builtins).size !== options.builtins.length) {
      env.queueTask(source, () => {
        compiled.reject(new env.realm.WebAssemblyCompileError('Duplicate WebAssembly builtin names'));
      });
      return;
    }
    const result = env.realm.compileWebAssembly(view, options, source, responseURL);
    // The native compiler resolves its private engine object. Resolve a typed
    // implementation Promise so Binding projects the author-facing Module once.
    env.realm.observePromise(result,
      (value) => {
        // Promise observation runs a microtask. The public resolution, including
        // author Module.prototype.then access, belongs to the API's task source.
        env.queueTask(source, () => { compiled.resolve(new WasmModuleImpl(value as JSWasmModule)); });
      },
      (reason) => {
        env.queueTask(source, () => {
          // Correct only private native compilation failures. Public then getters
          // run during compiled.resolve(), after this boundary, and keep their errors.
          compiled.reject(responseURL === undefined ? reason : env.realm.realizeWebAssemblyCompilationError(reason));
        });
      },
    );
  }

  /** Preserve the initiating incumbent while waiting for compilation before reading imports. */
  // https://webassembly.github.io/spec/js-api/#instantiate-a-promise-of-a-module
  #instantiatePromiseOfModule(
    promise: InternalPromise<WasmModuleImpl>, imports: object | undefined, call: WasmInvocation,
  ): InternalPromise<WebAssemblyInstantiatedSource> {
    const { env } = call;
    const result = env.InternalPromise.withResolvers(instantiatedSourceType);
    promise.observe((module) => {
      // The initiating settings survive compilation and are restored while imports are read.
      try {
        this.instantiateModule(module, imports, call).observe((instance) => {
          result.resolve({ module, instance });
        }, result.reject);
      } catch (reason) { result.reject(reason); }
    }, result.reject);
    return result.promise;
  }
}

/** Incumbent saved by the ordinary argument-injection path before conversion. */
export interface WasmInvocation {
  env: WasmEnvironment;
  incumbent?: WasmEnvironment;
}

/** The existing engine environment with the host callback lifecycle used by Wasm imports. */
export interface WasmEnvironment extends JSEnvironment {
  realm: WebIDLRealm;
  /** Project an implementation nested in an opaque export object. */
  project(implInst: object): object | null;
  /** Resolve a platform value inside an opaque import object without coercion. */
  unwrap(platformObject: object): object | undefined;
}

/** Converted compile options; native validation owns the supported builtin/import types. */
export interface WebAssemblyCompileOptions {
  /** Names of builtin modules requested for this compilation. */
  builtins: string[];
  /** Import module whose string-valued globals are supplied by the engine. */
  importedStringConstants: string | null;
}

/** The implementations produced by byte-input instantiation. */
export interface WebAssemblyInstantiatedSource {
  module: WasmModuleImpl;
  instance: WasmInstanceImpl;
}

const moduleType = reference(WasmModuleImpl);
const instanceType = reference(WasmInstanceImpl);
const tagType = reference(WasmTagImpl);
const instantiatedSourceType = implementationType<WebAssemblyInstantiatedSource>(reference('WebAssemblyInstantiatedSource'));

/*
enum AddressType { "i32", "i64" };
typedef any AddressValue;
*/
export const wasmAddressTypeIDL = defineEnumeration({ name: 'AddressType', values: ['i32', 'i64'] });
export const wasmAddressValueIDL = defineTypedef({ name: 'AddressValue', type: idlType.any });

// Construction and the exports getter use ordinary implementation/platform binding.
// https://webassembly.github.io/spec/js-api/#instances
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Instance {
  constructor(Module module, optional object importObject);
  readonly attribute object exports;
};
*/
export const wasmInstanceIDL = defineInterface<WasmEnvironment>({
  name: 'Instance', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmInstanceImpl, { constructWith: [atArg<WasmEnvironment>(2, (env, _callee, incumbent) => ({ env, incumbent }))] }),
  members: [
    // SPEC_CLASH(wasm-instance-constructor-order): Web IDL converts arguments before newTarget.prototype; V8 reads it first.
    ctor([arg('module', moduleType), arg('importObject', idlType.object, { optional: true })]),
    roAttr('exports', idlType.object),
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
export const wasmMemoryDescriptorIDL = defineDictionary({
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
export const wasmSharedMemoryDescriptorIDL = definePartialDictionary({
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
export const wasmMemoryIDL = defineInterface<WasmEnvironment>({
  name: 'Memory', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmMemoryImpl, { constructWith: [atArg<WasmEnvironment>(1, (env) => env)] }),
  members: [
    // SPEC_CLASH(wasm-memory-constructor-order): Web IDL reads the descriptor before prototype/size conversion; V8 interleaves them.
    ctor(
      [arg('descriptor', implementationType<MemoryDescriptor>(reference('MemoryDescriptor')))],

    ),
    op('grow', reference('AddressValue'), [arg('delta', reference('AddressValue'))],
      invokeWith(atArg<WasmEnvironment>(1, (_env, callee) => callee)),
    ),
    // The threads proposal also returns SharedArrayBuffer; retain the native methods and capability gaps.
    op('toFixedLengthBuffer', union(idlType.ArrayBuffer, idlType.SharedArrayBuffer), [],
      invokeWith(atArg<WasmEnvironment>(0, (_env, callee) => callee)),
    ),
    op('toResizableBuffer', union(idlType.ArrayBuffer, idlType.SharedArrayBuffer), [],
      invokeWith(atArg<WasmEnvironment>(0, (_env, callee) => callee)),
    ),
    roAttr('buffer', union(idlType.ArrayBuffer, idlType.SharedArrayBuffer)),
  ],
});

// https://webassembly.github.io/spec/js-api/#tables
// SPEC_CLASH(wasm-table-kind-values): Bind the draft's two kinds; Chromium/Firefox additionally accept GC reference names.
/*
enum TableKind { "externref", "anyfunc" };
*/
export const wasmTableKindIDL = defineEnumeration({ name: 'TableKind', values: ['externref', 'anyfunc'] });

/*
dictionary TableDescriptor {
  required TableKind element;
  required AddressValue initial;
  AddressValue maximum;
  AddressType address;
};
*/
export const wasmTableDescriptorIDL = defineDictionary({
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
export const wasmTableIDL = defineInterface<WasmEnvironment>({
  name: 'Table', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmTableImpl, { constructWith: [atArg<WasmEnvironment>(2, (env) => env)] }),
  members: [
    // SPEC_CLASH(wasm-table-constructor-order): Web IDL finishes descriptor conversion before prototype lookup and numeric sizes.
    ctor(
      [arg('descriptor', implementationType<TableDescriptor>(reference('TableDescriptor'))), arg('value', idlType.any, { optional: true })],

    ),
    // Arity overloads retain the accepted native difference between omitted and explicit undefined.
    // An optional `any` argument normalizes both to undefined before the implementation runs.
    op('grow', reference('AddressValue'), [arg('delta', reference('AddressValue'))], { method: 'growDefault', ...invokeWith(atArg<WasmEnvironment>(1, (_env, callee) => callee)) }),
    op('grow', reference('AddressValue'),
      [arg('delta', reference('AddressValue')), arg('value', idlType.any)],
      invokeWith(atArg<WasmEnvironment>(2, (_env, callee) => callee)),
    ),
    op('get', idlType.any, [arg('index', reference('AddressValue'))],
      invokeWith(atArg<WasmEnvironment>(1, (_env, callee) => callee)),
    ),
    op('set', idlType.undefined, [arg('index', reference('AddressValue'))], { method: 'setDefault', ...invokeWith(atArg<WasmEnvironment>(1, (_env, callee) => callee)) }),
    op('set', idlType.undefined,
      [arg('index', reference('AddressValue')), arg('value', idlType.any)],
      invokeWith(atArg<WasmEnvironment>(2, (_env, callee) => callee)),
    ),
    roAttr('length', reference('AddressValue')),
  ],
});

// https://webassembly.github.io/spec/js-api/#globals
// SPEC_CLASH(wasm-global-value-types): Bind the draft's seven types; V8 additionally accepts GC reference names.
/*
enum ValueType { "i32", "i64", "f32", "f64", "v128", "externref", "anyfunc" };
*/
export const wasmValueTypeIDL = defineEnumeration({
  name: 'ValueType', values: ['i32', 'i64', 'f32', 'f64', 'v128', 'externref', 'anyfunc'],
});

/*
dictionary GlobalDescriptor {
  required ValueType value;
  boolean mutable = false;
};
*/
export const wasmGlobalDescriptorIDL = defineDictionary({
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
export const wasmGlobalIDL = defineInterface<WasmEnvironment>({
  name: 'Global', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmGlobalImpl, { constructWith: [atArg<WasmEnvironment>(2, (env) => env)] }),
  members: [
    // SPEC_CLASH(wasm-global-construction-order): Convert the descriptor before prototype lookup and native initializer conversion.
    ctor(
      [arg('descriptor', implementationType<GlobalDescriptor>(reference('GlobalDescriptor'))), arg('v', idlType.any, { optional: true })],

    ),
    op('valueOf', idlType.any, [], invokeWith(atArg<WasmEnvironment>(0, (_env, callee) => callee))),
    // Native value access may materialize a funcref or throw in the borrowed accessor's realm.
    attr('value', idlType.any, {
      overrideGet({ callee }) { return (this as WasmGlobalImpl).getValue(callee); },
      overrideSet({ callee }, value) { (this as WasmGlobalImpl).setValue(value, callee); },
    }),
  ],
});

// https://webassembly.github.io/spec/js-api/#tags
/*
dictionary TagType {
  required sequence<ValueType> parameters;
};
*/
export const wasmTagTypeIDL = defineDictionary({
  name: 'TagType',
  members: [dictMember('parameters', sequence(reference('ValueType')), { required: true })],
});

/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Tag {
  constructor(TagType type);
};
*/
// SPEC_CLASH(wasm-esm-exposure): Keep the main JS API's Exposed=*; the ESM fork restricts Tag/Exception to Window, Worker, Worklet.
export const wasmTagIDL = defineInterface<WasmEnvironment>({
  name: 'Tag', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmTagImpl, { constructWith: [atArg<WasmEnvironment>(1, (env) => env)] }),
  members: [
    // SPEC_CLASH(wasm-tag-constructor): Follow Web IDL iterable conversion and newTarget; V8 reads array-like input and discards derived prototypes.
    // ValueType also excludes engine reference-kind extensions, as for Global construction.
    ctor(
      [arg('type', implementationType<TagType>(reference('TagType')))],

    ),
  ],
});

// https://webassembly.github.io/spec/js-api/#exceptions
/*
dictionary ExceptionOptions {
  boolean traceStack = false;
};
*/
export const wasmExceptionOptionsIDL = defineDictionary({
  name: 'ExceptionOptions',
  members: [dictMember('traceStack', idlType.boolean, { default: false })],
});

// Exception's binding uses the native object as the platform object, with a
// separate implementation, so engine-created exceptions and tagged rethrows work.
// SPEC_CLASH(wasm-exception-index-range): Web IDL truncates before checking the range; Chromium checks the fraction first.
// SPEC_CLASH(wasm-exception-stack): Target V8/Chromium's own traced stack; the prototype getter returns undefined.
/*
[LegacyNamespace=WebAssembly, Exposed=*]
interface Exception {
  constructor(Tag exceptionTag, sequence<any> payload, optional ExceptionOptions options = {});
  any getArg(Tag exceptionTag, [EnforceRange] unsigned long index);
  boolean is(Tag exceptionTag);
  readonly attribute (DOMString or undefined) stack;
};
*/
// SPEC_CLASH(wasm-esm-exposure): Keep the main JS API's Exposed=* rather than the ESM fork's narrower global list.
export const wasmExceptionIDL = defineInterface<JSEnvironment>({
  name: 'Exception', exposed: '*',
  ...xattr(['LegacyNamespace', 'WebAssembly']),
  implementation: impl(WasmExceptionImpl, { constructWith: [atArg<JSEnvironment>(3, (env) => env)] }),
  members: [
    // SPEC_CLASH(wasm-exception-constructor): Follow Web IDL iterable/options conversion and newTarget; V8 reads array-like input and discards derived prototypes.
    ctor(
      [
        arg('exceptionTag', tagType), arg('payload', sequence(idlType.any)),
        arg('options', implementationType<ExceptionOptions>(reference('ExceptionOptions')), { optional: true, default: emptyDictionary }),
      ],
    ),
    op('getArg', idlType.any,
      [arg('exceptionTag', tagType), arg('index', annotated(idlType.unsignedLong, xattr('EnforceRange')))],
      invokeWith(atArg<JSEnvironment>(2, (_env, methodEnv) => methodEnv)),
    ),
    op('is', idlType.boolean,
      [arg('exceptionTag', tagType)],
      invokeWith(atArg<JSEnvironment>(1, (_env, methodEnv) => methodEnv)),
    ),
    roAttr('stack', union(idlType.DOMString, idlType.undefined)),
  ],
});

/*
dictionary WebAssemblyInstantiatedSource {
  required Module module;
  required Instance instance;
};
*/
export const wasmInstantiatedSourceIDL = defineDictionary({
  name: 'WebAssemblyInstantiatedSource',
  members: [
    dictMember('module', moduleType, { required: true }),
    dictMember('instance', instanceType, { required: true }),
  ],
});

// https://webassembly.github.io/spec/js-api/#webassemblycompileoptions
// SPEC_CLASH(wasm-esm-option-defaults): The ESM fork omits these defaults while
// still reading both members unconditionally. Keep the main JS API's null/[] defaults.
/*
dictionary WebAssemblyCompileOptions {
  USVString? importedStringConstants = null;
  sequence<USVString> builtins = [];
};
*/
export const wasmCompileOptionsIDL = defineDictionary({
  name: 'WebAssemblyCompileOptions',
  members: [
    dictMember('importedStringConstants', nullable(idlType.USVString), { default: null }),
    dictMember('builtins', sequence(idlType.USVString), { default: emptySequence }),
  ],
});

// WebAssembly JavaScript API §5. The remaining native namespace members are reviewed separately.
// https://webassembly.github.io/spec/js-api/#webassembly-namespace
// https://webassembly.github.io/esm-integration/js-api/#webassembly-namespace
/*
[Exposed=*]
namespace WebAssembly {
  boolean validate([AllowResizable] AllowSharedBufferSource bytes, optional WebAssemblyCompileOptions options = {});
  Promise<Module> compile([AllowResizable] AllowSharedBufferSource bytes, optional WebAssemblyCompileOptions options = {});

  Promise<WebAssemblyInstantiatedSource> instantiate(
    [AllowResizable] AllowSharedBufferSource bytes, optional object importObject, optional WebAssemblyCompileOptions options = {});

  Promise<Instance> instantiate(Module moduleObject, optional object importObject);

  Instance namespaceInstance(object moduleNamespace);

  readonly attribute Tag JSTag;
};
*/
export const wasmIDL = defineNamespace<WasmEnvironment>({
  name: 'WebAssembly',
  exposed: '*',
  implementation: impl(WasmImpl, { constructWith: [atArg<WasmEnvironment>(0, (env) => env)] }),
  members: [
    op('validate', idlType.boolean,
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      invokeWith(atArg<WasmEnvironment>(2, (env) => env)),
    ),
    op('compile', promise(moduleType),
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      invokeWith(atArg<WasmEnvironment>(2, (env) => env)),
    ),
    op('instantiate', promise(instantiatedSourceType),
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('importObject', idlType.object, { optional: true }),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { method: 'instantiateBytes', ...invokeWith(atArg<WasmEnvironment>(3, (env, _callee, incumbent) => ({ env, incumbent }))) },
    ),
    op('instantiate', promise(instanceType),
      [arg('moduleObject', moduleType), arg('importObject', idlType.object, { optional: true })],
      { method: 'instantiateModule', ...invokeWith(atArg<WasmEnvironment>(2, (env, _callee, incumbent) => ({ env, incumbent }))) },
    ),
    op('namespaceInstance', instanceType,
      [arg('moduleNamespace', idlType.object)],
      invokeWith(atArg<WasmEnvironment>(1, (env) => env)),
    ),
    // SPEC_CLASH(wasm-js-tag-descriptor): Install the draft's enumerable getter over V8's readonly data property.
    roAttr('JSTag', tagType),
  ],
});

// Web API §2 contributes to the existing native namespace and its implementation.
/*
[Exposed=(Window,Worker)]
partial namespace WebAssembly {
  Promise<Module> compileStreaming(Promise<Response> source, optional WebAssemblyCompileOptions options = {});
  Promise<WebAssemblyInstantiatedSource> instantiateStreaming(
      Promise<Response> source, optional object importObject, optional WebAssemblyCompileOptions options = {});
};
*/
export const wasmStreamingIDL = definePartialNamespace<WasmEnvironment>({
  name: 'WebAssembly', exposed: ['Window', 'Worker'],
  members: [
    op('compileStreaming', promise(moduleType),
      [
        arg('source', promise(implementationType<ResponseImpl>(reference('Response')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      invokeWith(atArg<WasmEnvironment>(2, (env) => env)),
    ),
    op('instantiateStreaming', promise(instantiatedSourceType),
      [
        arg('source', promise(implementationType<ResponseImpl>(reference('Response')))),
        arg('importObject', idlType.object, { optional: true }),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { method: 'instantiateStreaming', ...invokeWith(atArg<WasmEnvironment>(3, (env, _callee, incumbent) => ({ env, incumbent }))) },
    ),
  ],
});
