import { InternalError, type InternalPromise } from '../../infra/index';
import type { CompiledScript } from '../../js-engine/index';
import { idlType } from '../../web-idl/core/index';
import { aboutBlankURL, copyURL, serializeURL, type URLRecord } from '../../url/index';
import { CSSStyleSheetImpl } from '../../stylelet/index';

import type { BrowletEnvironment } from '../environment';

import type { BrowletRealm } from './realm';
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
  constructor(source: string, env: BrowletEnvironment) {
    super(env);
    const sheet = CSSStyleSheetImpl.createConstructed(
      { baseURL: null, media: '', disabled: false }, env.getAssociatedDocument()!, env,
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
    // SPEC_MISMATCH: CreateDefaultExportSyntheticModule(value) -> Synthetic Module Record
    // Retain the implementation here; module execution must project the sheet
    // through this realm's binding before exposing its default export to authors.
    this.record = new JSSyntheticModuleRecord(this, sheet);
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

/** ECMAScript's requested specifier and import attributes; parser integration remains pending. */
// https://tc39.es/ecma262/#modulerequest-record
export class JSModuleRequest {
  specifier: string;
  attributes: { key: string; value: string; }[];

  constructor(specifier: string, attributes: { key: string; value: string; }[] = []) {
    this.specifier = specifier;
    this.attributes = attributes;
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

// PROVISIONAL: Browlet-owned records; module parsing, linking, and evaluation remain unconnected.
// The kind tags retain distinct field types for each record class.
// TODO(HTML §§8.1.4.3–4): Connect parsing/evaluation and the remaining ECMAScript fields.
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
    // TODO(HTML §8.1.4.4): Execute the compiled artifact in its realm and supply
    // this record to the modeled script context. The addon exposes only source execution.
    // TODO(HTML §8.1.4.5): Coordinate actual termination and modeled-state cleanup
    // before returning null. JavaScript throws remain throw completions.
    throw new InternalError('Retained ScriptEvaluation is not implemented');
  }
}

/** The normal or abrupt completion produced by script evaluation and function calls. */
export type ScriptCompletion = { type: 'normal' | 'throw'; value: unknown; };

/** ECMAScript's empty completion value, distinct from the JavaScript value undefined. */
export const emptyCompletionValue = Symbol('empty completion value');

/** Module-record operations required by HTML's graph loader; engine integration remains pending. */
export abstract class JSModuleRecord extends JSScriptOrModule {
  loadRequestedModules(_state: ModuleGraphLoadingState): InternalPromise<void> {
    // TODO(HTML §8.1.6.5): Connect dependency discovery and HostLoadImportedModule.
    throw new InternalError('Module dependency loading is not implemented');
  }

  link(): void {
    // TODO(HTML §8.1.4.3): Connect the parsed module record and its Link operation.
    throw new InternalError('Module linking is not implemented');
  }

  /** Evaluate this linked graph; null denotes termination before a promise is returned. */
  // https://tc39.es/ecma262/#sec-moduleevaluation
  // SPEC_MISMATCH: ModuleRecord.Evaluate() -> Promise
  evaluate(): InternalPromise<void> | null {
    // TODO: Supply engine module evaluation, including dependency execution, top-level
    // await, and script-context entry/restoration. Do not simulate it with export inputs.
    throw new InternalError('Module evaluation is not implemented');
  }
}

export class JSSourceTextModuleRecord extends JSModuleRecord {
  kind = 'source-text-module' as const;
  declare script: JavaScriptModuleScript;

  constructor(script: JavaScriptModuleScript) {
    super(script.env.realm, script);
  }
}

export class JSSyntheticModuleRecord extends JSModuleRecord {
  kind = 'synthetic-module' as const;
  declare script: SyntheticModuleScript;
  /** Value retained by CreateDefaultExportSyntheticModule's evaluation steps. */
  defaultExport: unknown;

  constructor(script: SyntheticModuleScript, defaultExport: unknown) {
    super(script.env.realm, script);
    this.defaultExport = defaultExport;
  }
}

export class JSWebAssemblyModuleRecord extends JSModuleRecord {
  kind = 'webassembly-module' as const;
  declare script: WebAssemblyModuleScript;

  constructor(script: WebAssemblyModuleScript) {
    super(script.env.realm, script);
  }
}
