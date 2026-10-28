import { InternalError, type InternalPromise } from '../../infra/index';
import type { CompiledScript, CompiledModule, ModuleRequest } from '../../js-engine/index';
import { idlType } from '../../web-idl/core/index';
import { aboutBlankURL, copyURL, serializeURL, type URLRecord } from '../../url/index';
import { CSSStyleSheetImpl } from '../../stylelet/index';

import type { BrowletEnvironment } from '../environment';

import type { BrowletRealm } from './realm';
import { JSExecutionContext } from './execution-context';
import type { ScriptFetchOptions } from './script-fetch-options';
import type { ModuleGraphLoadingState } from './script-fetching';

/** HTML's script state, distinct from its parsed ECMAScript record. */
// https://html.spec.whatwg.org/multipage/webappapis.html#script-structs
export type Script = ClassicScript | ModuleScript;

abstract class ScriptBase {
  env: BrowletEnvironment;
  /** Immediate parse failure; meaningful only when record is null. */
  parseError: unknown = null;
  /** Error preventing evaluation, including a dependency failure; null means none. */
  errorToRethrow: unknown = null;
  fetchOptions: ScriptFetchOptions | null = null;
  /** External script URL or the inline script's captured document base URL. */
  baseURL: URLRecord | null = null;
  record: JSScriptOrModule | null = null;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }
}

export class ClassicScript extends ScriptBase {
  declare record: JSScriptRecord | null;
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

    const result = env.realm.parseScript(source, serializeURL(baseURL));
    if (Array.isArray(result)) {
      this.parseError = result[0];
      this.errorToRethrow = result[0];
      return;
    }
    this.record = new JSScriptRecord(this, result);
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
        if (this.record === null) throw new InternalError('A classic script has no record or error to rethrow');
        status = this.record.evaluate();
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
  declare record: JSSourceTextModuleRecord | JSSyntheticModuleRecord | JSWebAssemblyModuleRecord | null;

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
        if (this.record === null) throw new InternalError('A module script has no record or error to rethrow');
        promise = this.record.evaluate() ?? env.InternalPromise.reject(env.createQuotaExceededError(), idlType.undefined);
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

export class JavaScriptModuleScript extends ModuleScript {
  declare record: JSSourceTextModuleRecord | null;

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
    this.record = result;
  }
}

abstract class SyntheticModuleScript extends ModuleScript {
  declare record: JSSyntheticModuleRecord | null;
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
    this.record = new JSSyntheticModuleRecord(this, env.projectCSSStyleSheet(sheet));
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
    this.record = new JSSyntheticModuleRecord(this, value);
  }
}

export class TextModuleScript extends SyntheticModuleScript {
  /** Retain text unchanged as the synthetic default export. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-text-module-script
  constructor(text: string, env: BrowletEnvironment) {
    super(env);
    this.record = new JSSyntheticModuleRecord(this, text);
  }
}

export class WebAssemblyModuleScript extends ModuleScript {
  declare record: JSWebAssemblyModuleRecord | null;

  /** Initialize a WebAssembly module and hand its bytes to the realm's ESM parser. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-webassembly-module-script
  constructor(
    bodyBytes: Uint8Array, env: BrowletEnvironment, baseURL: URLRecord, options: ScriptFetchOptions,
  ) {
    super(env);
    if (!env.isScriptingEnabled()) bodyBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    this.baseURL = baseURL;
    this.fetchOptions = options;
    try { this.record = env.realm.parseWebAssemblyModule(bodyBytes, this); }
    catch (error) {
      if (error instanceof InternalError) throw error;
      this.parseError = error;
    }
  }
}

/** ECMAScript's requested specifier, import attributes, and phase. */
// https://tc39.es/ecma262/#modulerequest-record
export class JSModuleRequest {
  specifier: string;
  attributes: { key: string; value: string; }[];
  /** Whether the request needs source or evaluation; deferred loading remains unfinished. */
  phase: ModuleRequest['phase'];

  constructor(
    specifier: string, attributes: { key: string; value: string; }[] = [], phase: ModuleRequest['phase'] = 'evaluation',
  ) {
    this.specifier = specifier;
    this.attributes = attributes;
    this.phase = phase;
  }

  /** Select a supported module type, or null for an invalid type attribute. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#module-type-from-module-request
  // Recognize supported names here; the environment separately checks realm exposure.
  // SPEC_MISMATCH: module type from module request(moduleRequest) -> string or null
  getModuleType(): ModuleType | null {
    const type = this.attributes.find((attribute) => attribute.key === 'type');
    if (type === undefined) return 'javascript-or-wasm';
    if (type.value === 'css' || type.value === 'json' || type.value === 'text') return type.value;
    return null;
  }
}

/** The portion of ECMAScript Script and Module records used by HTML's context model. */
// TODO(HTML §§8.1.4.3–4): Supply complete records from script creation and evaluation.
export class JSScriptOrModule {
  realm: BrowletRealm;
  /** The HTML script; null for a provisional entry without a parsed HTML script. */
  // ECMAScript's [[HostDefined]] field.
  script: Script | null;

  constructor(realm: BrowletRealm, script: Script | null) {
    this.realm = realm;
    this.script = script;
  }
}

/** Retained compiled classic code and its HTML script association. */
export class JSScriptRecord extends JSScriptOrModule {
  kind = 'script' as const;
  declare script: ClassicScript;
  code: CompiledScript;

  constructor(script: ClassicScript, code: CompiledScript) {
    super(script.env.realm, script);
    this.code = code;
  }

  /** Evaluate this retained record; null denotes termination without a completion. */
  // https://tc39.es/ecma262/#sec-runtime-semantics-scriptevaluation
  // SPEC_MISMATCH: ScriptEvaluation(scriptRecord) -> Completion Record
  evaluate(): ScriptCompletion | null {
    // TODO(HTML §8.1.4.5): Coordinate actual termination and modeled-state cleanup
    // before returning null. JavaScript throws remain throw completions.
    const loop = this.realm.agent.eventLoop;
    const context = new JSExecutionContext(this.realm);
    context.scriptOrModule = this;
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
export abstract class JSModuleRecord extends JSScriptOrModule {
  declare script: ModuleScript;
  /** Retained module bound to this record's realm. */
  abstract code: CompiledModule;
  /** Engine-reported dependencies, in their linking order. */
  requestedModules: JSModuleRequest[] = [];
  /** Loaded records keyed by this record's requests; filled by the host module loader. */
  // SPEC_MISMATCH: [[LoadedModules]] -> List of LoadedModuleRequest Records
  loadedModules = new Map<JSModuleRequest, JSModuleRecord>();

  loadRequestedModules(_state: ModuleGraphLoadingState): InternalPromise<void> {
    if (this.requestedModules.length === 0) {
      return this.script.env.InternalPromise.resolve(undefined, idlType.undefined);
    }
    // TODO(HTML §8.1.6.5): Connect dependency discovery and HostLoadImportedModule.
    throw new InternalError('Module dependency loading is not implemented');
  }

  link(): void {
    const graph = new Map<CompiledModule, CompiledModule[]>();
    const visit = (record: JSModuleRecord): void => {
      if (graph.has(record.code)) return;
      const dependencies: CompiledModule[] = [];
      graph.set(record.code, dependencies);
      for (const request of record.requestedModules) {
        if (request.phase !== 'evaluation') {
          throw new InternalError('Source and deferred module loading are not implemented');
        }
        const dependency = record.loadedModules.get(request);
        if (dependency === undefined) throw new InternalError('Module dependency loading is not implemented');
        dependencies.push(dependency.code);
        visit(dependency);
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

export class JSSourceTextModuleRecord extends JSModuleRecord {
  kind = 'source-text-module' as const;
  declare script: JavaScriptModuleScript;
  code: CompiledModule;

  constructor(script: JavaScriptModuleScript, code: CompiledModule, requests: JSModuleRequest[] = []) {
    super(script.env.realm, script);
    this.code = code;
    this.requestedModules = requests;
  }
}

export class JSSyntheticModuleRecord extends JSModuleRecord {
  kind = 'synthetic-module' as const;
  declare script: SyntheticModuleScript;
  /** Value retained by CreateDefaultExportSyntheticModule's evaluation steps. */
  defaultExport: unknown;
  code: CompiledModule;

  constructor(script: SyntheticModuleScript, defaultExport: unknown) {
    super(script.env.realm, script);
    this.defaultExport = defaultExport;
    this.code = this.realm.createDefaultExportModule(defaultExport);
  }
}

export class JSWebAssemblyModuleRecord extends JSModuleRecord {
  kind = 'webassembly-module' as const;
  declare script: WebAssemblyModuleScript;

  constructor(script: WebAssemblyModuleScript) {
    super(script.env.realm, script);
  }

  get code(): CompiledModule {
    throw new InternalError('WebAssembly ESM parsing is not implemented');
  }
}
