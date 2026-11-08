import { InternalError, internalType, type InternalPromise } from '../../infra/index';
import type { DynamicImportHandler, EngineModule, ModuleRequestPhase } from '../../js-engine/index';

import type { BrowletEnvironment } from '../environment/index';

import { fetchImportedModule, type ImportedModuleFetchOptions } from './module-loading';
import type { ModuleLoadingCompletion } from './module-loading-state';
import type { ModuleFetchCallback } from './module-map';
import { ModuleRequest, getSupportedImportAttributes } from './module-request';
import type { CompiledModule, CompiledScriptOrModule, ModuleScript, Script } from './script';

/** Shared dependency loading for static graphs and dynamic-import handlers. */
export abstract class ImportHandler {
  protected env: BrowletEnvironment;
  #options: ImportedModuleFetchOptions | undefined;

  protected constructor(env: BrowletEnvironment, options?: ImportedModuleFetchOptions) {
    this.env = env;
    this.#options = options;
  }

  /** Retain successful associations before delivering the dependency completion. */
  load(
    referrer: CompiledScriptOrModule | null, request: ModuleRequest,
    complete: (loaded: ModuleLoadingCompletion) => void,
  ): void {
    fetchImportedModule(referrer, request, this.#options, (loaded) => {
      if (loaded.type === 'module') {
        (referrer ?? this.env.realm).addLoadedModule(request, loaded.module);
        complete({ type: 'normal', value: loaded.module });
      } else {
        if (loaded.type === 'script-error') this.retainScriptError(loaded.error);
        complete({ type: 'throw', value: loaded.error });
      }
    }, referrer?.script.env ?? this.env);
  }

  /** Static graph loading retains script errors for its HTML root's later evaluation. */
  protected retainScriptError(_error: unknown): void {}
}

/** One HTML root's descendant loading, fetch policy, and first script error. */
export class StaticImport extends ImportHandler {
  #script: ModuleScript;
  #errorToRethrow: unknown = null;

  constructor(script: ModuleScript, options: ImportedModuleFetchOptions) {
    super(script.env, options);
    this.#script = script;
  }

  /** Load and link the root, preserving parse/link errors for later evaluation. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#fetch-the-descendants-of-and-link-a-module-script
  fetchDescendantsAndLink(onComplete: ModuleFetchCallback): void {
    const script = this.#script;
    const compiled = script.compiled;
    if (compiled === null) {
      script.errorToRethrow = script.parseError;
      onComplete(script);
      return;
    }
    compiled.loadRequestedModules(this).observe(() => {
      try { compiled.link(); }
      catch (error) {
        if (error instanceof InternalError) throw error;
        script.errorToRethrow = error;
      }
      onComplete(script);
    }, () => {
      if (this.#errorToRethrow !== null) {
        script.errorToRethrow = this.#errorToRethrow;
        onComplete(script);
      } else {
        onComplete(null);
      }
    });
  }

  protected override retainScriptError(error: unknown): void {
    // Retain even a late error: the graph's rejection observer may not have run yet.
    if (this.#errorToRethrow === null) this.#errorToRethrow = error;
  }
}

/** Import handler retained by compiled code; each invocation owns its completion. */
export class DynamicImport extends ImportHandler implements DynamicImportHandler {
  #script: Script | null;

  constructor(script: Script | null, env: BrowletEnvironment) {
    super(env);
    this.#script = script;
  }

  /** Load the requested source or evaluated module for the engine's import Promise. */
  importModule(specifier: string, attributes: Record<string, string>, phase: ModuleRequestPhase): Promise<EngineModule> {
    const { env } = this;
    // EvaluateImportCall already performed expression evaluation, ToString, and
    // attribute-value conversion. Node's VM API leaves supported-key policy to us.
    // TODO(dynamic-import-executing-realm): A borrowed Function constructor can
    // execute in a different realm from this retained referrer. Node's callback
    // does not supply that realm: unsupported-key TypeErrors currently use the
    // referrer's realm. Keep the approved regression until that boundary is resolved.
    const supported = getSupportedImportAttributes();
    if (Object.keys(attributes).some((key) => !supported.includes(key))) {
      throw new env.realm.TypeError('Unsupported import attribute');
    }
    if (phase === 'defer') throw new InternalError('Deferred dynamic imports are not implemented');
    const referrer = this.#script?.compiled ?? null;
    if (this.#script !== null && referrer === null) {
      throw new InternalError('An importing script must have compiled code');
    }
    const request = new ModuleRequest(specifier, Object.entries(attributes).map(([key, value]) => ({ key, value })), phase);
    const completion = env.InternalPromise.withResolvers(internalType<CompiledModule>());
    // Observe on the browser queue before starting. Node owns the author's
    // Promise and adopts the namespace's then only after this engine-Module bridge.
    const result = new env.realm.NativePromise<EngineModule>((resolve, reject) => {
      completion.promise.observe((module) => { resolve(module.code); }, reject);
    });
    // https://tc39.es/proposal-source-phase-imports/#sec-ContinueDynamicImport
    this.load(referrer, request, (loaded) => {
      if (loaded.type === 'throw') {
        completion.reject(loaded.value);
        return;
      }
      const module = loaded.value;
      if (phase === 'source') {
        if (module.moduleSource === null) {
          completion.reject(new module.realm.SyntaxError('The imported module has no source object'));
        } else {
          completion.resolve(module);
        }
        return;
      }
      module.loadRequestedModules(this).observe(() => {
        try {
          this.#linkAndEvaluate(module).observe(() => { completion.resolve(module); }, completion.reject);
        } catch (error) {
          if (error instanceof InternalError) throw error;
          completion.reject(error);
        }
      }, completion.reject);
    });
    return result;
  }

  #linkAndEvaluate(module: CompiledModule): InternalPromise<void> {
    module.link();
    const loop = module.script.env.responsibleEventLoop;
    // Model the Promise-job entry without HTML Script.run()'s admission/reporting.
    loop.prepareToRunScript(module.script.env);
    let evaluation;
    try { evaluation = module.evaluate(); }
    finally { loop.cleanUpAfterRunningScript(module.script.env); }
    if (evaluation === null) throw new InternalError('Dynamic module evaluation termination is not implemented');
    return evaluation;
  }
}
