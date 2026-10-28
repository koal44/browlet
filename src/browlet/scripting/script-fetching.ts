import { InternalError } from '../../infra/index';
import { decode, utf8Decode, type Encoding } from '../../encoding/index';
import type { URLRecord } from '../../url/index';
import { getMIMETypeEssence, isJavaScriptMIMEType, isJSONMIMEType } from '../../mime/index';
import {
  fetch, FetchRequest, isFilteredResponse, isOkStatus, legacyExtractEncoding, parseReferrerPolicyFromHeader,
  type Destination, type FetchResponse, type RequestCredentials,
} from '../../fetch/index';

import type { CORSSettingsState } from '../dom/nodes/html/attributes/index';
import type { BrowletEnvironment } from '../environment';
import type { ModuleResponsesMap } from '../worklets/index';

import {
  ClassicScript, JavaScriptModuleScript, CSSModuleScript, JSONModuleScript, TextModuleScript, WebAssemblyModuleScript,
  type JSModuleRequest, type ModuleScript, type ModuleType,
} from './script';
import { ScriptFetchOptions } from './script-fetch-options';
import type { ModuleFetchCallback } from './module-map';

/** Fetch and decode a classic script, then hand its source to script creation. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-script
export function fetchClassicScript(
  url: URLRecord, env: BrowletEnvironment, options: ScriptFetchOptions,
  corsSetting: CORSSettingsState, encoding: Encoding, onComplete: (script: ClassicScript | null) => void,
): void {
  const request = env.userAgent.createPotentialCORSRequest(url, 'script', corsSetting);
  request.client = env;
  request.initiatorType = 'script';
  options.setUpClassicRequest(request);

  fetch(request, {
    processResponseConsumeBody: (response, bodyBytes) => {
      const mutedErrors = response.type === 'opaque' || response.type === 'opaqueredirect';
      if (isFilteredResponse(response)) response = response.internalResponse;
      if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) {
        onComplete(null);
        return;
      }

      // Classic scripts use a declared charset regardless of MIME essence.
      const mimeType = response.headerList.extractMIMEType();
      const sourceText = decode(bodyBytes, legacyExtractEncoding(mimeType, encoding));
      const script = new ClassicScript(sourceText, env, response.url!, options, mutedErrors, url);
      onComplete(script);
    },
  }, env);
}

/** Fetch a worker's initial classic script for these settings using its outside client. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-worker-script
export function fetchClassicWorkerScript(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, env: BrowletEnvironment,
  onComplete: (script: ClassicScript | null) => void, performFetch?: PerformScriptFetch,
): void {
  const request = new FetchRequest(url, fetchClient);
  request.client = fetchClient;
  request.destination = destination;
  request.initiatorType = 'other';
  request.mode = 'same-origin';
  request.credentialsMode = 'same-origin';
  request.parserInserted = false;
  request.useURLCredentials = true;

  const processResponseConsumeBody = (response: FetchResponse, bodyBytes: Uint8Array | null | 'failure') => {
    if (isFilteredResponse(response)) response = response.internalResponse;
    if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) {
      onComplete(null);
      return;
    }

    const responseURL = response.url!;
    if (responseURL.scheme === 'http' || responseURL.scheme === 'https') {
      const mimeType = response.headerList.extractMIMEType();
      if (mimeType === null || !isJavaScriptMIMEType(mimeType)) {
        onComplete(null);
        return;
      }
    }

    const sourceText = utf8Decode(bodyBytes);
    const script = new ClassicScript(sourceText, env, responseURL, new ScriptFetchOptions());
    onComplete(script);
  };

  if (performFetch !== undefined) performFetch(request, true, processResponseConsumeBody);
  else fetch(request, { processResponseConsumeBody }, fetchClient);
}

/** Synchronously fetch an importScripts() dependency; the required pause is unfinished. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-worker-imported-script
export function fetchClassicWorkerImportedScript(
  _url: URLRecord, _env: BrowletEnvironment, _performFetch?: PerformScriptFetch,
): ClassicScript {
  // TODO(HTML §8.1.4.2): Fetch, pause until its response/body arrives, enforce JavaScript MIME,
  // throw NetworkError on failure, then create the script with the response's muted-error state.
  // Do not start asynchronous work until the synchronous continuation can actually be resumed.
  throw new InternalError('Classic worker-imported script fetching requires synchronous pause (HTML §8.1.4.2)');
}

/** Fetch an external root, then load its descendants and link the complete graph. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-module-script-tree
export function fetchExternalModuleScriptGraph(
  url: URLRecord, env: BrowletEnvironment, options: ScriptFetchOptions, onComplete: ModuleFetchCallback,
): void {
  fetchSingleModuleScript(url, env, 'script', options, env, 'client', undefined, true, (script) => {
    if (script === null) onComplete(null);
    else fetchDescendantsAndLink(script, env, 'script', onComplete);
  });
}

/** Report the preloaded root before starting the permitted descendant preloading. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-modulepreload-module-script-graph
export function fetchModulepreloadModuleScriptGraph(
  url: URLRecord, destination: Destination, env: BrowletEnvironment,
  options: ScriptFetchOptions, onComplete: ModuleFetchCallback,
): void {
  fetchSingleModuleScript(url, env, destination, options, env, 'client', undefined, true, (script) => {
    onComplete(script);
    if (!env.realm.globalNames.has('Window')) throw new InternalError('Modulepreload requires Window settings');
    // Take HTML's optional descendant-preloading branch; its completion does not notify the owner again.
    if (script !== null) fetchDescendantsAndLink(script, env, destination, () => {});
  });
}

/** Create an inline root, then load its descendants and link the complete graph. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-an-inline-module-script-graph
export function fetchInlineModuleScriptGraph(
  sourceText: string, baseURL: URLRecord, env: BrowletEnvironment,
  options: ScriptFetchOptions, onComplete: ModuleFetchCallback,
): void {
  const script = new JavaScriptModuleScript(sourceText, env, baseURL, options);
  fetchDescendantsAndLink(script, env, 'script', onComplete);
}

/** Fetch a worker's module graph using its creator's client and its own target settings. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-module-worker-script-tree
export function fetchModuleWorkerScriptGraph(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, credentialsMode: RequestCredentials,
  env: BrowletEnvironment, onComplete: ModuleFetchCallback,
): void {
  fetchWorkletModuleWorkerScriptGraph(url, fetchClient, destination, credentialsMode, env, onComplete);
}

/** Fetch a worklet graph, sharing downloaded responses while creating modules in this global. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-worklet-script-graph
export function fetchWorkletScriptGraph(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, credentialsMode: RequestCredentials,
  env: BrowletEnvironment, moduleResponsesMap: ModuleResponsesMap, onComplete: ModuleFetchCallback,
): void {
  const performFetch: PerformScriptFetch = (request, _isTopLevel, processCustomFetchResponse) => {
    const requestURL = request.url;
    const cached = moduleResponsesMap.get(requestURL);
    if (cached === 'fetching') {
      moduleResponsesMap.whenReady(requestURL, (result) => {
        env.queueTask('network', () => processCustomFetchResponse(...result));
      });
      return;
    }
    if (cached !== undefined) {
      processCustomFetchResponse(...cached);
      return;
    }

    moduleResponsesMap.set(requestURL, 'fetching');
    fetch(request, {
      processResponseConsumeBody: (response, bodyBytes) => {
        moduleResponsesMap.set(requestURL, [response, bodyBytes]);
        processCustomFetchResponse(response, bodyBytes);
      },
    }, fetchClient);
  };
  fetchWorkletModuleWorkerScriptGraph(url, fetchClient, destination, credentialsMode, env, onComplete, performFetch);
}

/** Fetch the root and descendants shared by the worker and worklet graph entry points. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-worklet/module-worker-script-graph
export function fetchWorkletModuleWorkerScriptGraph(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, credentialsMode: RequestCredentials,
  env: BrowletEnvironment, onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  const options = new ScriptFetchOptions();
  options.credentialsMode = credentialsMode;
  fetchSingleModuleScript(url, fetchClient, destination, options, env, 'client', undefined, true, (script) => {
    if (script === null) onComplete(null);
    else fetchDescendantsAndLink(script, fetchClient, destination, onComplete, performFetch);
  }, performFetch);
}

/** Load a module's dependencies and link, preserving parse/link errors for later evaluation. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-the-descendants-of-and-link-a-module-script
export function fetchDescendantsAndLink(
  script: ModuleScript, fetchClient: BrowletEnvironment, destination: Destination,
  onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  const record = script.record;
  if (record === null) {
    script.errorToRethrow = script.parseError;
    onComplete(script);
    return;
  }

  const state: ModuleGraphLoadingState = {
    errorToRethrow: null, destination, performFetch: performFetch ?? null, fetchClient,
  };
  const loadingPromise = record.loadRequestedModules(state);
  loadingPromise.observe(() => {
    try { record.link(); }
    catch (error) {
      // An unfinished implementation must not masquerade as an author module error.
      if (error instanceof InternalError) throw error;
      script.errorToRethrow = error;
    }
    onComplete(script);
  }, () => {
    if (state.errorToRethrow !== null) {
      script.errorToRethrow = state.errorToRethrow;
      onComplete(script);
    } else {
      onComplete(null);
    }
  });
}

/** Fetch one module for these settings, sharing in-flight work and retained results. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
// Worker/worklet startup fetches with the creator's client but stores and creates modules in env.
export function fetchSingleModuleScript(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, options: ScriptFetchOptions,
  env: BrowletEnvironment, referrer: URLRecord | 'client' | 'no-referrer', moduleRequest: JSModuleRequest | undefined,
  isTopLevel: boolean, onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  const moduleType = moduleRequest === undefined ? 'javascript-or-wasm' : moduleRequest.getModuleType();
  if (moduleType === null || !env.isModuleTypeAllowed(moduleType)) {
    throw new InternalError('Module type must be allowed before fetching a single module script');
  }

  const moduleMap = env.moduleMap;
  const cached = moduleMap.get(url, moduleType);
  if (cached !== undefined) {
    if (Array.isArray(cached)) cached.push(onComplete);
    else onComplete(cached);
    return;
  }
  const callbacks = [onComplete];
  moduleMap.set(url, moduleType, callbacks);

  const request = new FetchRequest(url, fetchClient);
  request.mode = 'cors';
  request.referrer = referrer === 'client' ? undefined : referrer === 'no-referrer' ? null : referrer;
  request.client = fetchClient;
  request.destination = fetchDestinationFromModuleType(destination, moduleType);
  if (isTopLevel && (destination === 'worker' || destination === 'sharedworker' || destination === 'serviceworker')) {
    request.mode = 'same-origin';
  }
  request.initiatorType = 'script';
  options.setUpModuleRequest(request);

  // Remove failures or publish success before callbacks can request the same module again.
  const complete = (script: ModuleScript | null) => {
    if (script === null) moduleMap.delete(url, moduleType);
    else moduleMap.set(url, moduleType, script);
    for (const callback of callbacks) callback(script);
  };
  const processResponseConsumeBody = (response: FetchResponse, bodyBytes: Uint8Array | null | 'failure') => {
    if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) {
      complete(null);
      return;
    }

    const mimeType = response.headerList.extractMIMEType();
    const essence = mimeType === null ? null : getMIMETypeEssence(mimeType);
    let script: ModuleScript | null = null;
    const referrerPolicy = parseReferrerPolicyFromHeader(response);
    if (referrerPolicy !== '') options.referrerPolicy = referrerPolicy;

    if (essence === 'application/wasm' && moduleType === 'javascript-or-wasm') {
      script = new WebAssemblyModuleScript(bodyBytes, env, response.url!, options);
    } else {
      const source = utf8Decode(bodyBytes);
      if (moduleType === 'text') {
        script = new TextModuleScript(source, env);
      } else if (moduleType === 'javascript-or-wasm' && mimeType !== null && isJavaScriptMIMEType(mimeType)) {
        script = new JavaScriptModuleScript(source, env, response.url!, options);
      } else if (moduleType === 'css' && essence === 'text/css') {
        script = new CSSModuleScript(source, response.url!, env);
      } else if (moduleType === 'json' && mimeType !== null && isJSONMIMEType(mimeType)) {
        script = new JSONModuleScript(source, env);
      }
    }
    complete(script);
  };

  if (performFetch !== undefined) performFetch(request, isTopLevel, processResponseConsumeBody);
  else fetch(request, { processResponseConsumeBody }, fetchClient);
}

/** Validate an imported module's attributes and fetch it as a descendant. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-imported-module-script
export function fetchSingleImportedModuleScript(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, options: ScriptFetchOptions,
  env: BrowletEnvironment, referrer: URLRecord | 'client' | 'no-referrer', moduleRequest: JSModuleRequest,
  onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  if (moduleRequest.attributes.some((attribute) => attribute.key !== 'type')) {
    throw new InternalError('Unsupported import attributes must be rejected before fetching an imported module');
  }
  const moduleType = moduleRequest.getModuleType();
  if (moduleType === null || !env.isModuleTypeAllowed(moduleType)) {
    onComplete(null);
    return;
  }
  fetchSingleModuleScript(url, fetchClient, destination, options, env, referrer, moduleRequest, false, onComplete, performFetch);
}

/** Select the resource destination without changing the caller's default for JavaScript/Wasm. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-destination-from-module-type
export function fetchDestinationFromModuleType(defaultDestination: Destination, moduleType: ModuleType): Destination {
  if (moduleType === 'json') return 'json';
  if (moduleType === 'css') return 'style';
  if (moduleType === 'text') return 'text';
  return defaultDestination;
}

/** Customize fetching while preserving the algorithm's request setup and response checks. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetching-scripts-perform-fetch
// SPEC_CLASH(script-fetch-hook-failure): The hook preamble permits only null or bytes; the worklet algorithm also passes failure.
// Follow the worklet algorithm and retain Fetch's failure value through the shared response map.
export type PerformScriptFetch = (
  request: FetchRequest,
  isTopLevel: boolean,
  processCustomFetchResponse: (response: FetchResponse, body: Uint8Array | null | 'failure') => void,
) => void;

/** HTML's host state passed through LoadRequestedModules to HostLoadImportedModule. */
export interface ModuleGraphLoadingState {
  errorToRethrow: unknown;
  destination: Destination;
  performFetch: PerformScriptFetch | null;
  fetchClient: BrowletEnvironment;
}
