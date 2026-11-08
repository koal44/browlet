import { InternalError } from '../../infra/index';
import type { URLRecord } from '../../url/index';
import type { Destination } from '../../fetch/index';

import type { BrowletEnvironment } from '../environment/index';

import type { ScriptEnvironment } from './environment';
import type { CompiledModule, CompiledScriptOrModule } from './script';
import { getSupportedImportAttributes, type ModuleRequest } from './module-request';
import type { PerformScriptFetch } from './script-fetching';
import { ScriptFetchOptions } from './script-fetch-options';

/**
 * Resolve and fetch one imported module, reporting its result without changing caller bookkeeping.
 * The caller supplies the referrer's environment, or the import environment when there is no referrer.
 */
// https://html.spec.whatwg.org/multipage/webappapis.html#hostloadimportedmodule
export function fetchImportedModule(
  referrer: CompiledScriptOrModule | null, moduleRequest: ModuleRequest,
  options: ImportedModuleFetchOptions | undefined, onComplete: (result: ImportedModuleResult) => void,
  env: BrowletEnvironment,
): void {
  const script = referrer?.script ?? null;
  // TODO(dynamic-import-executing-realm): Step 2 must use the current settings
  // before step 6 selects the referrer's settings. The native callback currently
  // supplies the referring record or its captured realm, not a separate executing
  // realm. Preserve this distinction when that engine input is connected.
  if (options === undefined && (env.isWorklet || env.isServiceWorker)) {
    onComplete({ type: 'fetch-error', error: new env.realm.TypeError('Dynamic import is not allowed in this global') });
    return;
  }
  if (script !== null && (script.baseURL === null || script.fetchOptions === null)) {
    throw new InternalError('An importing script requires a base URL and fetch options');
  }
  const fail = (error: unknown): void => {
    onComplete({ type: 'script-error', error });
  };

  // Step 7 validates every static request before fetching the first dependency.
  if (referrer?.isModule() &&
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
  const fetchOptions = (script?.fetchOptions ?? new ScriptFetchOptions()).getDescendantOptions(url, env);
  env.fetchSingleImportedModuleScript(
    url, options?.fetchClient ?? env, options?.destination ?? 'script', fetchOptions, script?.baseURL ?? 'client',
    moduleRequest, (moduleScript) => {
      if (moduleScript === null) {
        // Fetch failures reject the graph without setting HTML's ErrorToRethrow.
        onComplete({ type: 'fetch-error', error: new env.realm.TypeError('Module fetch failed') });
      } else if (moduleScript.parseError !== null) {
        fail(moduleScript.parseError);
      } else {
        if (moduleScript.compiled === null) throw new InternalError('A parsed module has no compiled code');
        onComplete({ type: 'module', module: moduleScript.compiled });
      }
    }, options?.performFetch ?? undefined,
  );
}

/** Inputs retained by HTML's descendant-loading operation; absent for dynamic import. */
export interface ImportedModuleFetchOptions {
  destination: Destination;
  performFetch: PerformScriptFetch | null;
  fetchClient: ScriptEnvironment;
}

/** HTML distinguishes a failed fetch from a script error retained for later evaluation. */
export type ImportedModuleResult =
  | { type: 'module'; module: CompiledModule; }
  | { type: 'fetch-error' | 'script-error'; error: unknown; };
