import { InternalError, internalType, type InternalPromise } from '../../infra/index';
import type { CompiledModule, ModuleRequestPhase } from '../../js-engine/index';
import { idlType } from '../../web-idl/core/index';
import type { URLRecord } from '../../url/index';

import type { BrowletEnvironment } from '../environment/index';

import { BrowletRealm } from './realm';
import { JSModuleRecord, JSSyntheticModuleRecord, type JSModuleRequest, type JSScriptRecord } from './script';
import type { ModuleGraphLoadingState } from './script-fetching';
import { ScriptFetchOptions } from './script-fetch-options';

/** Resolve and fetch an imported module, retaining HTML's first static-graph error when present. */
// https://html.spec.whatwg.org/multipage/webappapis.html#hostloadimportedmodule
export function loadImportedModule(
  referrer: ModuleReferrer, moduleRequest: JSModuleRequest,
  loadState: ModuleGraphLoadingState | undefined, payload: ModuleLoadingPayload,
): void {
  const script = referrer instanceof BrowletRealm ? null : referrer.script;
  // TODO(dynamic-import-executing-realm): Step 2 must use the current settings
  // before step 6 selects the referrer's settings. The native callback currently
  // supplies only the referrer; preserve this distinction when worker/worklet
  // globals and the executing-realm input are connected.
  const env = referrer instanceof BrowletRealm ? referrer.env : referrer.script.env;
  if (loadState === undefined && (env.isWorklet || env.isServiceWorker)) {
    finishLoadingImportedModule(referrer, moduleRequest, payload, {
      type: 'throw', value: new env.realm.TypeError('Dynamic import is not allowed in this global'),
    });
    return;
  }
  if (script !== null && (script.baseURL === null || script.fetchOptions === null)) {
    throw new InternalError('An importing script requires a base URL and fetch options');
  }
  const fail = (error: unknown): void => {
    if (loadState !== undefined && loadState.errorToRethrow === null) loadState.errorToRethrow = error;
    finishLoadingImportedModule(referrer, moduleRequest, payload, { type: 'throw', value: error });
  };

  // Step 7 validates every static request before fetching the first dependency.
  if (referrer instanceof JSModuleRecord &&
    moduleRequest === referrer.requestedModules[0]) {
    const supportedAttributes = getSupportedImportAttributes();
    for (const requested of referrer.requestedModules) {
      if (requested.attributes.some((attribute) => !supportedAttributes.includes(attribute.key))) {
        fail(new env.realm.SyntaxError('Unsupported import attribute'));
        return;
      }
      try { env.resolveModuleSpecifier(script, requested.specifier); }
      catch (error) {
        if (error instanceof InternalError) throw error;
        fail(error);
        return;
      }
      const moduleType = requested.getModuleType();
      if (moduleType === null || !env.isModuleTypeAllowed(moduleType)) {
        fail(new env.realm.TypeError('Unsupported module type'));
        return;
      }
    }
  }

  let url: URLRecord;
  try { url = env.resolveModuleSpecifier(script, moduleRequest.specifier); }
  catch (error) {
    if (error instanceof InternalError) throw error;
    fail(error);
    return;
  }
  const options = (script?.fetchOptions ?? new ScriptFetchOptions()).getDescendantOptions(url, env);
  env.fetchSingleImportedModuleScript(
    url, loadState?.fetchClient ?? env, loadState?.destination ?? 'script', options, script?.baseURL ?? 'client',
    moduleRequest, (moduleScript) => {
      if (moduleScript === null) {
        // Fetch failures reject the graph without setting HTML's ErrorToRethrow.
        finishLoadingImportedModule(referrer, moduleRequest, payload, {
          type: 'throw', value: new env.realm.TypeError('Module fetch failed'),
        });
      } else if (moduleScript.parseError !== null) {
        fail(moduleScript.parseError);
      } else {
        if (moduleScript.record === null) throw new InternalError('A parsed module has no record');
        finishLoadingImportedModule(referrer, moduleRequest, payload, { type: 'normal', value: moduleScript.record });
      }
    }, loadState?.performFetch ?? undefined,
  );
}

/** Attribute names accepted by the HTML host, independently of their values. */
// https://html.spec.whatwg.org/multipage/webappapis.html#hostgetsupportedimportattributes
export function getSupportedImportAttributes(): string[] {
  return ['type'];
}

/** One graph traversal, separate from HTML's optional static-fetch state. */
// https://tc39.es/ecma262/#table-graphloadingstate-record
export class JSModuleGraphLoadingState {
  /** Whether this traversal can still settle its completion. */
  isLoading = true;
  /** Outstanding module visits, including the initial root. */
  pendingModulesCount = 1;
  /** Cyclic records already visited by this traversal. */
  visited = new Set<JSModuleRecord>();
  /** Completion observed by HTML's fetch-descendants-and-link algorithm. */
  promise: InternalPromise<void>;
  /** HTML's ModuleGraphLoadingState, carried as ECMAScript's HostDefined value. */
  loadState: ModuleGraphLoadingState | undefined;
  #resolve: () => void;
  #reject: (reason: unknown) => void;

  constructor(loadState: ModuleGraphLoadingState | undefined, env: BrowletEnvironment) {
    this.loadState = loadState;
    const capability = env.InternalPromise.withResolvers(idlType.undefined);
    this.promise = capability.promise;
    this.#resolve = () => capability.resolve(undefined);
    this.#reject = capability.reject;
  }

  /** Visit a source record once, or recursively load an evaluation graph. */
  // https://tc39.es/proposal-source-phase-imports/#sec-InnerModuleLoading
  // SPEC_MISMATCH: InnerModuleLoading(state, module, loadType)
  // The request phase directly selects single versus recursive loading.
  load(module: JSModuleRecord, phase: ModuleRequestPhase = 'evaluation'): void {
    if (!this.isLoading) throw new InternalError('Cannot visit a module after graph loading has finished');
    if (phase === 'evaluation' && !(module instanceof JSSyntheticModuleRecord) && !module.requestedModulesLoaded &&
      module.code.status === 'unlinked' && !this.visited.has(module)) {
      this.visited.add(module);
      this.pendingModulesCount += module.requestedModules.length;
      const supportedAttributes = getSupportedImportAttributes();
      for (const request of module.requestedModules) {
        if (request.phase === 'defer') {
          // TODO: Deferred evaluation needs its own graph and namespace lifecycle.
          throw new InternalError('Deferred module loading is not implemented');
        }
        if (request.attributes.some((attribute) => !supportedAttributes.includes(attribute.key))) {
          this.continue(request.phase, { type: 'throw', value: new module.realm.SyntaxError('Unsupported import attribute') });
        } else {
          const loaded = module.getLoadedModule(request);
          if (loaded !== undefined) this.load(loaded, request.phase);
          else loadImportedModule(module, request, this.loadState, this);
        }
        // Loading may synchronously re-enter continue() and settle this graph.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!this.isLoading) return;
      }
    }
    if (this.pendingModulesCount < 1) throw new InternalError('Module loading count underflow');
    this.pendingModulesCount--;
    if (this.pendingModulesCount === 0) {
      this.isLoading = false;
      for (const loaded of this.visited) loaded.requestedModulesLoaded = true;
      this.#resolve();
    }
  }

  /** Resume after a request completes, ignoring work arriving after settlement. */
  // https://tc39.es/proposal-source-phase-imports/#sec-ContinueModuleLoading
  continue(phase: ModuleRequestPhase, completion: ModuleLoadingCompletion): void {
    if (!this.isLoading) return;
    if (completion.type === 'normal') {
      this.load(completion.value, phase);
    } else {
      this.isLoading = false;
      this.#reject(completion.value);
    }
  }
}

/** Dynamic-import continuation; the VM boundary supplies the namespace or source object. */
export class DynamicModuleImport {
  /** Internal completion retains the engine Module, without adopting namespace exports. */
  promise: InternalPromise<CompiledModule>;
  #resolve: (module: CompiledModule) => void;
  #reject: (reason: unknown) => void;

  constructor(env: BrowletEnvironment) {
    const capability = env.InternalPromise.withResolvers(internalType<CompiledModule>());
    this.promise = capability.promise;
    this.#resolve = capability.resolve;
    this.#reject = capability.reject;
  }

  /** Return a source record directly, or load and evaluate an ordinary import's graph. */
  // https://tc39.es/proposal-source-phase-imports/#sec-ContinueDynamicImport
  // SPEC_MISMATCH: ContinueDynamicImport(promiseCapability, phase, moduleCompletion)
  // Node owns the import Promise and final namespace resolution. Our internal
  // completion supplies a Module, avoiding an extra namespace/source-object adoption.
  continue(phase: ModuleRequestPhase, completion: ModuleLoadingCompletion): void {
    if (completion.type === 'throw') {
      this.#reject(completion.value);
      return;
    }
    const module = completion.value;
    if (phase === 'source') {
      if (module.moduleSource === null) {
        this.#reject(new module.realm.SyntaxError('The imported module has no source object'));
      } else {
        this.#resolve(module.code);
      }
      return;
    }
    module.loadRequestedModules().observe(() => {
      try {
        module.link();
        const loop = module.script.env.responsibleEventLoop;
        // Model the Promise-job entry around native evaluation on every backend.
        // Do not add Script.run()'s admission/reporting steps to this ECMA operation.
        loop.prepareToRunScript(module.script.env);
        let evaluation;
        try { evaluation = module.evaluate(); }
        finally { loop.cleanUpAfterRunningScript(module.script.env); }
        if (evaluation === null) throw new InternalError('Dynamic module evaluation termination is not implemented');
        evaluation.observe(() => { this.#resolve(module.code); }, this.#reject);
      } catch (error) {
        if (error instanceof InternalError) throw error;
        this.#reject(error);
      }
    }, this.#reject);
  }
}

/** Referrers supplied by compilation metadata or the executing context's fallback. */
export type ModuleReferrer = JSScriptRecord | JSModuleRecord | BrowletRealm;
export type ModuleLoadingPayload = JSModuleGraphLoadingState | DynamicModuleImport;

/** Retain successful associations even after failure, then resume the static or dynamic caller. */
// https://tc39.es/ecma262/#sec-FinishLoadingImportedModule
export function finishLoadingImportedModule(
  referrer: ModuleReferrer, request: JSModuleRequest, payload: ModuleLoadingPayload, completion: ModuleLoadingCompletion,
): void {
  if (completion.type === 'normal') {
    let found = false;
    for (const [loadedRequest, module] of referrer.loadedModules) {
      if (!loadedRequest.equals(request)) continue;
      if (module !== completion.value) throw new InternalError('A module request resolved to different records');
      found = true;
      break;
    }
    if (!found) referrer.loadedModules.set(request, completion.value);
  }
  payload.continue(request.phase, completion);
}

/** The loaded record or exception passed to FinishLoadingImportedModule. */
export type ModuleLoadingCompletion =
  | { type: 'normal'; value: JSModuleRecord; }
  | { type: 'throw'; value: unknown; };
