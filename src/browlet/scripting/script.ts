import { InternalError, type InternalPromise } from '../../infra/index';
import type {
  EngineCode, EngineScript, EngineModule, EngineWasmModule, JSWasmInstance,
} from '../../js-engine/index';
import { idlType } from '../../web-idl/core/index';
import { aboutBlankURL, copyURL, serializeURL, type URLRecord } from '../../url/index';
import { CSSStyleSheetImpl } from '../../stylelet/index';

import { WasmModuleImpl, wrapWasmInstance, type WasmInstanceImpl } from '../webassembly/index';
import type { BrowletEnvironment } from '../environment/index';

import type { BrowletRealm } from './realm';
import { JSExecutionContext } from './execution-context';
import { ModuleLoadingState, type ModuleDependencyLoader } from './module-loading-state';
import type { ScriptFetchOptions } from './script-fetch-options';
import type { ModuleRequest } from './module-request';

/** HTML's script state, distinct from its parsed ECMAScript record. */
// https://html.spec.whatwg.org/multipage/webappapis.html#script-structs
export type Script = ClassicScript | ModuleScript;

abstract class ScriptBase {
  env: BrowletEnvironment;
  /** Immediate parse failure; meaningful only when compiled is null. */
  parseError: unknown = null;
  /** Error preventing evaluation, including a dependency failure; null means none. */
  errorToRethrow: unknown = null;
  fetchOptions: ScriptFetchOptions | null = null;
  /** External script URL or the inline script's captured document base URL. */
  baseURL: URLRecord | null = null;
  compiled: CompiledScriptOrModule | null = null;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }
}

export class ClassicScript extends ScriptBase {
  declare compiled: CompiledScript | null;
  /** Suppress error details for a cross-origin classic script. */
  mutedErrors = false;
  /** Original request URL for Long Animation Frames attribution; null for inline scripts. */
  originalSourceURL: URLRecord | null = null;

  /** Create and parse a classic script without running it. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-classic-script
  constructor(
    source: string, env: BrowletEnvironment, baseURL: URLRecord, options: ScriptFetchOptions,
    mutedErrors = false, sourceURLForWindowScripts: URLRecord | null = null, bypassDisabledScripting = false,
  ) {
    super(env);
    if (mutedErrors) baseURL = copyURL(aboutBlankURL);
    if (!bypassDisabledScripting && !env.isScriptingEnabled()) source = '';
    this.baseURL = baseURL;
    this.fetchOptions = options;
    this.mutedErrors = mutedErrors;
    // https://w3c.github.io/long-animation-frames/#record-classic-script-creation-time
    this.originalSourceURL = sourceURLForWindowScripts;
    // TODO(Long Animation Frames): Create the classic-script entry point on the
    // document's frame timing info. Frame records and pending-script timing are not implemented.

    const result = env.realm.parseClassicScript(source, this);
    if (Array.isArray(result)) {
      this.parseError = result[0];
      this.errorToRethrow = result[0];
      return;
    }
    this.compiled = result;
  }

  /** Run this classic script, optionally rethrowing its exception to the caller. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#run-a-classic-script
  run(rethrowErrors = false): ScriptCompletion {
    const { env } = this;
    if (!env.canRunScript()) {
      return { type: 'normal', value: emptyCompletionValue };
    }
    // TODO(Long Animation Frames): Record classic script execution start time.
    // Frame timing info and pending script entry points are not implemented.
    const loop = env.responsibleEventLoop;
    loop.prepareToRunScript(env);
    let status: ScriptCompletion | null;
    try {
      if (this.errorToRethrow !== null) {
        status = { type: 'throw', value: this.errorToRethrow };
      } else {
        if (this.compiled === null) throw new InternalError('A classic script has no compiled code or error to rethrow');
        status = this.compiled.evaluate();
      }
      if (status?.type === 'throw' && !rethrowErrors) {
        // The prepared realm context has no script; parse failures have no record
        // either. Retain this script for muting while reporting before cleanup.
        env.reportException(status.value, false, this);
      }
    } finally {
      loop.cleanUpAfterRunningScript(env);
    }
    if (status === null) return { type: 'throw', value: env.createQuotaExceededError() };
    if (status.type === 'throw' && rethrowErrors) {
      if (this.mutedErrors) throw new env.DOMException('', 'NetworkError');
      throw status.value;
    }
    return status;
  }
}

/** Supported HTML module types; the response MIME distinguishes JavaScript from WebAssembly. */
export type ModuleType = 'javascript-or-wasm' | 'css' | 'json' | 'text';

export abstract class ModuleScript extends ScriptBase {
  declare compiled: CompiledSourceTextModule | CompiledSyntheticModule | CompiledWasmModule | null;

  /** Evaluate this module graph and report rejections unless the caller takes responsibility. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#run-a-module-script
  run(preventErrorReporting = false): InternalPromise<void> {
    const { env } = this;
    if (!env.canRunScript()) {
      return env.InternalPromise.resolve(undefined, idlType.undefined);
    }
    // TODO(Long Animation Frames): Record module script execution start time.
    // Frame timing info and pending script entry points are not implemented.
    const loop = env.responsibleEventLoop;
    loop.prepareToRunScript(env);
    try {
      let promise: InternalPromise<void>;
      if (this.errorToRethrow !== null) {
        promise = env.InternalPromise.reject(this.errorToRethrow, idlType.undefined);
      } else {
        if (this.compiled === null) throw new InternalError('A module script has no compiled code or error to rethrow');
        promise = this.compiled.evaluate() ?? env.InternalPromise.reject(env.createQuotaExceededError(), idlType.undefined);
      }
      if (!preventErrorReporting) {
        // Reporting is attached before cleanup can perform a microtask checkpoint.
        promise.observe(() => {}, (reason) => { env.reportException(reason); });
      }
      return promise;
    } finally {
      loop.cleanUpAfterRunningScript(env);
    }
  }
}

export class JSModuleScript extends ModuleScript {
  declare compiled: CompiledSourceTextModule | null;

  /** Initialize a JavaScript module and hand its source to the realm's parser. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-javascript-module-script
  constructor(
    source: string, env: BrowletEnvironment, baseURL: URLRecord, options: ScriptFetchOptions,
  ) {
    super(env);
    if (!env.isScriptingEnabled()) source = '';
    this.baseURL = baseURL;
    this.fetchOptions = options;
    const result = env.realm.parseModule(source, this);
    if (Array.isArray(result)) {
      this.parseError = result[0];
      return;
    }
    this.compiled = result;
  }
}

abstract class SyntheticModuleScript extends ModuleScript {
  declare compiled: CompiledSyntheticModule | null;
  declare fetchOptions: null;
  declare baseURL: null;
}

export class CSSModuleScript extends SyntheticModuleScript {
  /** Construct the module's sheet and retain it as the synthetic default export. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-css-module-script
  constructor(source: string, baseURL: URLRecord, env: BrowletEnvironment) {
    super(env);
    // SPEC_CLASH(css-module-base-url): Follow browsers and WPT by using the final
    // response URL; HTML's empty constructor options instead select the document base.
    // https://github.com/whatwg/html/issues/11629
    const sheet = CSSStyleSheetImpl.createConstructed(
      { baseURL: serializeURL(baseURL), media: '', disabled: false }, env.getAssociatedDocument()!, env,
    );
    try {
      // SPEC_CLASH(css-module-imports): Follow CSSOM's replaceSync, which discards
      // imports; HTML's creation note instead claims that imports throw.
      sheet.replaceSync(source);
    } catch (error) {
      if (error instanceof InternalError) throw error;
      this.parseError = error;
      return;
    }
    this.compiled = new CompiledSyntheticModule(this, env.project(sheet));
  }
}

export class JSONModuleScript extends SyntheticModuleScript {
  /** Parse JSON in the owning realm and retain its synthetic default export. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-json-module-script
  constructor(source: string, env: BrowletEnvironment) {
    super(env);
    let value: unknown;
    try { value = env.realm.parseJSON(source); }
    catch (error) {
      if (error instanceof InternalError) throw error;
      this.parseError = error;
      return;
    }
    this.compiled = new CompiledSyntheticModule(this, value);
  }
}

export class TextModuleScript extends SyntheticModuleScript {
  /** Retain text unchanged as the synthetic default export. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-text-module-script
  constructor(text: string, env: BrowletEnvironment) {
    super(env);
    this.compiled = new CompiledSyntheticModule(this, text);
  }
}

export class WasmModuleScript extends ModuleScript {
  declare compiled: CompiledWasmModule | null;

  /** Initialize a WebAssembly module and hand its bytes to the realm's ESM parser. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-webassembly-module-script
  constructor(
    bodyBytes: Uint8Array, env: BrowletEnvironment, baseURL: URLRecord, options: ScriptFetchOptions,
  ) {
    super(env);
    if (!env.isScriptingEnabled()) bodyBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    this.baseURL = baseURL;
    this.fetchOptions = options;
    try { this.compiled = env.realm.parseWebAssemblyModule(bodyBytes, this); }
    catch (error) {
      if (error instanceof InternalError) throw error;
      this.parseError = error;
    }
  }
}

/** Shared ownership and dependency associations of retained ECMAScript Script and Module records. */
export abstract class CompiledScriptOrModule {
  /** Compiled representations retained while their engine code remains reachable. */
  static #compiledByEngineCode = new WeakMap<EngineCode, CompiledScriptOrModule>();

  realm: BrowletRealm;
  /** The HTML script retained in ECMAScript's [[HostDefined]] field. */
  script: Script;
  /** Dependencies retained for this record, independently of the script's URL. */
  // SPEC_MISMATCH: [[LoadedModules]] -> List of LoadedModuleRequest Records
  loadedModules = new Map<ModuleRequest, CompiledModule>();

  protected constructor(script: Script, code?: EngineCode) {
    this.realm = script.env.realm;
    this.script = script;
    if (code !== undefined) CompiledScriptOrModule.#compiledByEngineCode.set(code, this);
  }

  /** Recover the HTML association of code observed at an engine boundary. */
  static fromEngineCode(code: EngineCode): CompiledScriptOrModule | null {
    return CompiledScriptOrModule.#compiledByEngineCode.get(code) ?? null;
  }

  isModule(): this is CompiledModule { return false; }

  /** Add a loaded module, requiring equivalent requests to retain the same module identity. */
  // The successful-association step of FinishLoadingImportedModule; the caller continues loading.
  // https://tc39.es/ecma262/#sec-FinishLoadingImportedModule
  addLoadedModule(request: ModuleRequest, module: CompiledModule): void {
    for (const [loadedRequest, loaded] of this.loadedModules) {
      if (!loadedRequest.equals(request)) continue;
      if (loaded !== module) throw new InternalError('A module request resolved to different modules');
      return;
    }
    this.loadedModules.set(request, module);
  }
}

/** Retained compiled classic code and its HTML script association. */
export class CompiledScript extends CompiledScriptOrModule {
  declare script: ClassicScript;
  code: EngineScript;

  constructor(script: ClassicScript, code: EngineScript) {
    super(script, code);
    this.code = code;
  }

  /** Evaluate this retained record; null denotes termination without a completion. */
  // https://tc39.es/ecma262/#sec-runtime-semantics-scriptevaluation
  // SPEC_MISMATCH: ScriptEvaluation(scriptRecord) -> Completion Record
  evaluate(): ScriptCompletion | null {
    // TODO(HTML §8.1.4.5): Coordinate actual termination and modeled-state cleanup
    // before returning null. JavaScript throws remain throw completions.
    const loop = this.realm.agent.eventLoop;
    const context = new JSExecutionContext({ realm: this.realm, scriptOrModule: this });
    loop.executionContextStack.push(context);
    let completion: ScriptCompletion;
    try {
      completion = { type: 'normal', value: this.realm.runScript(this.code) };
    } catch (error) {
      completion = { type: 'throw', value: error };
    }
    if (loop.runningExecutionContext !== context) {
      throw new InternalError('Script execution contexts were cleaned up out of order');
    }
    loop.executionContextStack.pop();
    return completion;
  }
}

/** The normal or abrupt completion produced by script evaluation and function calls. */
export type ScriptCompletion = { type: 'normal' | 'throw'; value: unknown; };

/** ECMAScript's empty completion value, distinct from the JavaScript value undefined. */
export const emptyCompletionValue = Symbol('empty completion value');

/** Engine module plus the dependency associations supplied by HTML's loader. */
export abstract class CompiledModule extends CompiledScriptOrModule {
  declare script: ModuleScript;
  /** Retained module bound to this record's realm. */
  abstract code: EngineModule;
  /** [[ModuleSource]], retained as an implementation until the engine import boundary projects it. */
  moduleSource: WasmModuleImpl | null = null;
  /** Engine-reported dependencies, in their linking order. */
  requestedModules: ModuleRequest[] = [];
  /** Whether a successful traversal completed this record's dependency loading. */
  // Node's "unlinked" status covers ECMAScript's new and unlinked states; this
  // flag retains the loading transition that the VM module API does not expose.
  requestedModulesLoaded = false;

  override isModule(): this is CompiledModule { return true; }

  isSynthetic(): this is CompiledSyntheticModule { return false; }

  /** Load this graph with the host's import handler and an internal completion promise. */
  // https://tc39.es/ecma262/#sec-LoadRequestedModules
  // HTML uses an internal completion; native dynamic import is adapted at the VM callback boundary.
  loadRequestedModules(imports: ModuleDependencyLoader): InternalPromise<void> {
    const loading = new ModuleLoadingState(imports, this.script.env);
    loading.load(this);
    return loading.promise;
  }

  /** Find the retained record for an equivalent request, including a fresh request object. */
  getLoadedModule(request: ModuleRequest): CompiledModule | undefined {
    for (const [loadedRequest, module] of this.loadedModules) {
      if (loadedRequest.equals(request)) return module;
    }
    return undefined;
  }

  link(): void {
    const graph = new Map<EngineModule, EngineModule[]>();
    const visit = (compiled: CompiledModule): void => {
      if (graph.has(compiled.code)) return;
      const dependencies: EngineModule[] = [];
      graph.set(compiled.code, dependencies);
      for (const request of compiled.requestedModules) {
        if (request.phase === 'defer') {
          throw new InternalError('Deferred module loading is not implemented');
        }
        const dependency = compiled.getLoadedModule(request);
        if (dependency === undefined) throw new InternalError('Module dependency loading is not implemented');
        if (request.phase === 'source' && dependency.moduleSource === null) {
          throw new compiled.realm.SyntaxError('The imported module has no source object');
        }
        dependencies.push(dependency.code);
        if (request.phase === 'evaluation') visit(dependency);
      }
    };
    visit(this);
    this.realm.linkModule(this.code, graph);
  }

  /** Evaluate this linked graph; null denotes termination before a promise is returned. */
  // https://tc39.es/ecma262/#sec-moduleevaluation
  // SPEC_MISMATCH: ModuleRecord.Evaluate() -> Promise
  evaluate(): InternalPromise<void> | null {
    // V8 owns dependency execution and top-level await. The prepared realm context
    // supplies HTML's entry; module-specific context entry and async restoration
    // still need engine hooks. Do not attribute every dependency to the root script.
    return this.script.env.InternalPromise.fromNative(this.realm.evaluateModule(this.code), () => undefined, idlType.undefined);
  }
}

export class CompiledSourceTextModule extends CompiledModule {
  declare script: JSModuleScript;
  code: EngineModule;

  constructor(script: JSModuleScript, code: EngineModule, requests: ModuleRequest[] = []) {
    super(script, code);
    this.code = code;
    this.requestedModules = requests;
  }

  /** Supply this module's URL and resolver when the engine first creates import.meta. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#hostgetimportmetaproperties
  getImportMetaProperties(): { key: string; value: unknown; }[] {
    const { script, realm } = this;
    if (script.baseURL === null) throw new InternalError('A JavaScript module requires a base URL');
    const urlString = serializeURL(script.baseURL);
    const resolve = realm.createFunction((_receiver, [specifier]) => {
      // ToString rejects primitive Symbols; String() has a special case for
      // them. All other conversion, including author hooks and realm-owned
      // failures, is performed by the captured constructor.
      if (typeof specifier === 'symbol') throw new realm.TypeError('Cannot convert a Symbol value to a string');
      const url = script.env.resolveModuleSpecifier(script, realm.String(specifier));
      return serializeURL(url);
    }, { name: 'resolve', length: 1 });
    return [{ key: 'url', value: urlString }, { key: 'resolve', value: resolve }];
  }
}

export class CompiledSyntheticModule extends CompiledModule {
  declare script: SyntheticModuleScript;
  /** Value retained by CreateDefaultExportSyntheticModule's evaluation steps. */
  defaultExport: unknown;
  code: EngineModule;

  constructor(script: SyntheticModuleScript, defaultExport: unknown) {
    super(script);
    this.defaultExport = defaultExport;
    this.code = this.realm.createDefaultExportModule(defaultExport);
  }

  override isSynthetic(): this is CompiledSyntheticModule { return true; }
}

export class CompiledWasmModule extends CompiledModule {
  declare moduleSource: WasmModuleImpl;
  declare script: WasmModuleScript;
  code: EngineWasmModule;
  /** Implementation retained for the namespace and its public exports. */
  instance!: WasmInstanceImpl;

  constructor(script: WasmModuleScript, code: EngineWasmModule, requests: ModuleRequest[] = []) {
    super(script, code);
    this.code = code;
    this.moduleSource = new WasmModuleImpl(code.source);
    this.requestedModules = requests;
  }

  /** Instantiate at this record's execution entry, preserving HTML callback and result-conversion scopes. */
  createInstance(imports: object): JSWasmInstance {
    const loop = this.realm.agent.eventLoop;
    // ACCOMMODATION(node-v8-execution-contexts): The bridge's private helper is a
    // host function. This entry identifies the exact Wasm record, even when V8
    // reaches it as a dependency or after top-level await. Do not substitute the
    // root module's context or capture whichever host happened to parse the bytes.
    const context = new JSExecutionContext({ realm: this.realm, scriptOrModule: this });
    loop.executionContextStack.push(context);
    try {
      // SPEC_CLASH(wasm-esm-import-subtyping): Keep Core/JS API import matching; ESM §10.5 reverses the subtype operands.
      const backing = this.moduleSource.createInstance(imports, this.script.env);
      this.instance = wrapWasmInstance(backing, this.script.env);
      return backing;
    } finally {
      if (loop.runningExecutionContext !== context) {
        // eslint-disable-next-line no-unsafe-finally -- Stack corruption is an internal error even if the author callback threw.
        throw new InternalError('WebAssembly execution contexts were cleaned up out of order');
      }
      loop.executionContextStack.pop();
    }
  }
}
