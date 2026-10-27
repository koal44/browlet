import { InternalError, type InternalPromise } from '../../infra/index';
import type { CompiledScript } from '../../js-engine/index';
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
}

/** Supported HTML module types; the response MIME distinguishes JavaScript from WebAssembly. */
export type ModuleType = 'javascript-or-wasm' | 'css' | 'json' | 'text';

export abstract class ModuleScript extends ScriptBase {
  declare record: JSSourceTextModuleRecord | JSSyntheticModuleRecord | JSWebAssemblyModuleRecord | null;
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
    try { value = env.exec.parseJSON(source); }
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
  hostDefined: Script | null;

  constructor(realm: BrowletRealm, hostDefined: Script | null) {
    this.realm = realm;
    this.hostDefined = hostDefined;
  }
}

// PROVISIONAL: Browlet-owned records; module parsing, linking, and evaluation remain unconnected.
// The kind tags retain distinct field types for each record class.
// TODO(HTML §§8.1.4.3–4): Connect parsing/evaluation and the remaining ECMAScript fields.
export class JSScriptRecord extends JSScriptOrModule {
  kind = 'script' as const;
  declare hostDefined: ClassicScript;
  code: CompiledScript;

  constructor(script: ClassicScript, code: CompiledScript) {
    super(script.env.realm, script);
    this.code = code;
  }

  /** Evaluate this retained record without reparsing its source. */
  // https://tc39.es/ecma262/#sec-runtime-semantics-scriptevaluation
  evaluate(): ScriptCompletion {
    // TODO(HTML §8.1.4.4): Execute the compiled artifact in its realm and supply
    // this record to the modeled script context. The addon exposes only source execution.
    throw new InternalError('Retained ScriptEvaluation is not implemented');
  }
}

/** The normal or abrupt completion produced by script evaluation and function calls. */
export type ScriptCompletion = { type: 'normal' | 'throw'; value: unknown; };

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
}

export class JSSourceTextModuleRecord extends JSModuleRecord {
  kind = 'source-text-module' as const;
  declare hostDefined: JavaScriptModuleScript;

  constructor(script: JavaScriptModuleScript) {
    super(script.env.realm, script);
  }
}

export class JSSyntheticModuleRecord extends JSModuleRecord {
  kind = 'synthetic-module' as const;
  declare hostDefined: SyntheticModuleScript;
  /** Value retained by CreateDefaultExportSyntheticModule's evaluation steps. */
  defaultExport: unknown;

  constructor(script: SyntheticModuleScript, defaultExport: unknown) {
    super(script.env.realm, script);
    this.defaultExport = defaultExport;
  }
}

export class JSWebAssemblyModuleRecord extends JSModuleRecord {
  kind = 'webassembly-module' as const;
  declare hostDefined: WebAssemblyModuleScript;

  constructor(script: WebAssemblyModuleScript) {
    super(script.env.realm, script);
  }
}
