import type { InternalPromise } from '../../infra/index';
import {
  getBufferSourceView, isWebAssemblyModule, isWebAssemblyInstance,
  type JSBufferSource, type JSEnvironment, type JSWebAssemblyModule, type JSWebAssemblyInstance,
} from '../../js-engine/index';
import {
  annotated, arg, defineDictionary, defineInterface, defineNamespace, dictMember, emptyDictionary, emptySequence,
  idlType, implementationType, nullable, op, promise, reference, sequence, xattr,
} from '../../web-idl/index';

/** WebAssembly namespace operations backed by the owning realm's native engine. */
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
    bytes: JSBufferSource, imports: object | undefined, options: WebAssemblyCompileOptions, env: JSEnvironment,
  ): InternalPromise<WebAssemblyInstantiatedSource> {
    const result = env.InternalPromise.withResolvers(instantiatedSourceType);
    this.compile(bytes, options, env).observe((module) => {
      this.instantiateModule(module, imports, env).observe((instance) => {
        result.resolve({ module, instance });
      }, result.reject);
    }, result.reject);
    return result.promise;
  }

  /** Instantiate a converted native Module, retaining the invoked realm's Promise and Instance. */
  // SPEC_CLASH(wasm-module-start-timing): V8 still runs start synchronously while capturing imports.
  static instantiateModule(
    module: JSWebAssemblyModule, imports: object | undefined, env: JSEnvironment,
  ): InternalPromise<JSWebAssemblyInstance> {
    const result = Reflect.apply(env.realm.webAssemblyInstantiate, undefined, [module, imports]) as Promise<unknown>;
    return env.InternalPromise.fromNative(result, (value) => value as JSWebAssemblyInstance, instanceType);
  }
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

// Value recognition only: native constructors/members remain on the existing namespace for the §§5.1–5.2 audit.
export const webAssemblyModuleIDL = defineInterface({
  name: 'Module', members: [], interfaceOverride: { isInstance: isWebAssemblyModule },
});
export const webAssemblyInstanceIDL = defineInterface({
  name: 'Instance', members: [], interfaceOverride: { isInstance: isWebAssemblyInstance },
});

const moduleType = implementationType<JSWebAssemblyModule>(reference('Module'));
const instanceType = implementationType<JSWebAssemblyInstance>(reference('Instance'));
const instantiatedSourceType = implementationType<WebAssemblyInstantiatedSource>(reference('WebAssemblyInstantiatedSource'));

export const webAssemblyInstantiatedSourceIDL = defineDictionary({
  name: 'WebAssemblyInstantiatedSource',
  members: [
    dictMember('module', moduleType, { required: true }),
    dictMember('instance', instanceType, { required: true }),
  ],
});

// https://webassembly.github.io/spec/js-api/#webassemblycompileoptions
export const webAssemblyCompileOptionsIDL = defineDictionary({
  name: 'WebAssemblyCompileOptions',
  members: [
    dictMember('importedStringConstants', nullable(idlType.USVString), { default: null }),
    dictMember('builtins', sequence(idlType.USVString), { default: emptySequence }),
  ],
});

// WebAssembly JavaScript API §5. The remaining native namespace members are reviewed separately.
// https://webassembly.github.io/spec/js-api/#webassembly-namespace
export const webAssemblyIDL = defineNamespace<JSEnvironment>({
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
      { overrideInvoke: ({ callee: env }, bytes, options) => WebAssemblyImpl.validate(bytes, options, env) },
    ),
    op('compile', promise(moduleType),
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { overrideInvoke: ({ callee: env }, bytes, options) => WebAssemblyImpl.compile(bytes, options, env) },
    ),
    op('instantiate', promise(instantiatedSourceType),
      [
        arg('bytes', implementationType<JSBufferSource>(annotated(reference('AllowSharedBufferSource'), xattr('AllowResizable')))),
        arg('importObject', idlType.object, { optional: true }),
        arg('options', implementationType<WebAssemblyCompileOptions>(reference('WebAssemblyCompileOptions')), {
          optional: true, default: emptyDictionary,
        }),
      ],
      { overrideInvoke: ({ callee: env }, bytes, imports, options) => WebAssemblyImpl.instantiateBytes(bytes, imports, options, env) },
    ),
    op('instantiate', promise(instanceType),
      [arg('moduleObject', moduleType), arg('importObject', idlType.object, { optional: true })],
      { overrideInvoke: ({ callee: env }, module, imports) => WebAssemblyImpl.instantiateModule(module, imports, env) },
    ),
  ],
});
