import { InternalError } from '../../infra/index';
import { DOMExceptionImpl } from '../../web-idl/core/index';
import { decode, utf8Decode, type Encoding } from '../../encoding/index';
import type { URLRecord } from '../../url/index';
import { getMIMETypeEssence, isJavaScriptMIMEType, isJSONMIMEType } from '../../mime/index';
import {
  fetch, FetchRequest, isFilteredResponse, isOkStatus, legacyExtractEncoding, parseReferrerPolicyFromHeader,
  type Destination, type FetchResponse, type RequestCredentials,
} from '../../fetch/index';

import type { CORSSettingsState } from '../dom/nodes/html/attributes/index';
import type { BrowletEnvironment } from '../environment/index';
import type { WorkerType } from '../workers/index';
import type { ModuleResponsesMap } from '../worklets/index';

import {
  ClassicScript, JSModuleScript, CSSModuleScript, JSONModuleScript, TextModuleScript, WasmModuleScript,
  type ModuleScript, type ModuleType,
} from './script';
import { getSupportedImportAttributes, type ModuleRequest } from './module-request';
import { ScriptFetchOptions } from './script-fetch-options';
import type { ModuleFetchCallback } from './module-map';
import type { ScriptEnvironment } from './environment';
import { StaticImport } from './import-handler';

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

/** Prepare an initial worker request without creating a script in the creator's realm. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-worker-script
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
export function createWorkerScriptRequest(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination,
  type: WorkerType, credentials: RequestCredentials,
): FetchRequest {
  const request = new FetchRequest(url, fetchClient);
  request.client = fetchClient;
  request.destination = destination;
  request.initiatorType = type === 'classic' ? 'other' : 'script';
  request.mode = 'same-origin';
  request.credentialsMode = type === 'classic' ? 'same-origin' : credentials;
  request.parserInserted = false;
  request.useURLCredentials = type === 'classic';
  return request;
}

/** Fetch a worker's initial classic script for these settings using its outside client. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-worker-script
export function fetchClassicWorkerScript(
  url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, env: BrowletEnvironment,
  onComplete: (script: ClassicScript | null) => void, performFetch?: PerformScriptFetch,
): void {
  const request = createWorkerScriptRequest(url, fetchClient, destination, 'classic', 'same-origin');

  const processResponseConsumeBody = (response: FetchResponse, bodyBytes: Uint8Array | null | 'failure') => {
    onComplete(createClassicWorkerScriptFromResponse(response, bodyBytes, env));
  };

  if (performFetch !== undefined) performFetch(request, true, processResponseConsumeBody);
  else fetch(request, { processResponseConsumeBody }, fetchClient);
}

/** Validate and parse a classic worker response; the fetch owner delivers the returned result. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-worker-script
export function createClassicWorkerScriptFromResponse(
  response: FetchResponse, bodyBytes: Uint8Array | null | 'failure', env: BrowletEnvironment,
): ClassicScript | null {
  if (isFilteredResponse(response)) response = response.internalResponse;
  if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) return null;

  const responseURL = response.url!;
  if (responseURL.scheme === 'http' || responseURL.scheme === 'https') {
    const mimeType = response.headerList.extractMIMEType();
    if (mimeType === null || !isJavaScriptMIMEType(mimeType)) return null;
  }

  return new ClassicScript(utf8Decode(bodyBytes), env, responseURL, new ScriptFetchOptions());
}

/** Fetch an importScripts() dependency; isolated startup supplies its independent synchronous host hook. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-worker-imported-script
export function fetchClassicWorkerImportedScript(
  url: URLRecord, env: BrowletEnvironment, performFetch?: PerformScriptFetch,
): ClassicScript {
  // Isolated startup connects browser-owned Fetch through performFetch. A local
  // environment still cannot block the same isolate that must finish its Fetch.
  if (performFetch === undefined) {
    throw new InternalError('Classic worker-imported script fetching requires synchronous pause (HTML §8.1.4.2)');
  }
  const request = new FetchRequest(url, env);
  request.client = env;
  request.destination = 'script';
  request.initiatorType = 'other';
  request.parserInserted = false;
  request.useURLCredentials = true;
  const result: { response: FetchResponse | null; bodyBytes: Uint8Array | null | 'failure'; } = {
    response: null, bodyBytes: null,
  };
  performFetch(request, true, (response, bodyBytes) => {
    result.bodyBytes = bodyBytes;
    result.response = response;
  });
  // A hook may complete synchronously (for example from a script resource map).
  // Otherwise the same independent host wait is still required; never pump jobs.
  if (result.response === null) {
    throw new InternalError('Classic worker-imported script fetching requires synchronous pause (HTML §8.1.4.2)');
  }
  return createClassicWorkerImportedScriptFromResponse(result.response, result.bodyBytes, env);
}

/** Validate an imported response and create its classic script, retaining cross-origin error muting. */
// Extracted from fetch a classic worker-imported script, after the synchronous wait.
export function createClassicWorkerImportedScriptFromResponse(
  response: FetchResponse, bodyBytes: Uint8Array | null | 'failure', env: BrowletEnvironment,
): ClassicScript {
  const mutedErrors = response.type === 'opaque' || response.type === 'opaqueredirect';
  if (isFilteredResponse(response)) response = response.internalResponse;
  const mimeType = response.headerList.extractMIMEType();
  // Imported scripts require JavaScript MIME for every scheme, unlike the root worker script.
  if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status) ||
    mimeType === null || !isJavaScriptMIMEType(mimeType)) {
    throw new DOMExceptionImpl('Failed to load a worker-imported script', 'NetworkError');
  }
  return new ClassicScript(utf8Decode(bodyBytes), env, response.url!, new ScriptFetchOptions(), mutedErrors);
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
  const script = new JSModuleScript(sourceText, env, baseURL, options);
  fetchDescendantsAndLink(script, env, 'script', onComplete);
}

/** Fetch a worker's module graph using its creator's client and its own target settings. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-module-worker-script-tree
export function fetchModuleWorkerScriptGraph(
  url: URLRecord, fetchClient: ScriptEnvironment, destination: Destination, credentialsMode: RequestCredentials,
  env: BrowletEnvironment, onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  fetchWorkletModuleWorkerScriptGraph(url, fetchClient, destination, credentialsMode, env, onComplete, performFetch);
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
        env.queueTask('network', { run: () => processCustomFetchResponse(...result) });
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
  url: URLRecord, fetchClient: ScriptEnvironment, destination: Destination, credentialsMode: RequestCredentials,
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
  script: ModuleScript, fetchClient: ScriptEnvironment, destination: Destination,
  onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  const imports = new StaticImport(script, { destination, performFetch: performFetch ?? null, fetchClient });
  imports.fetchDescendantsAndLink(onComplete);
}

/** Fetch one module for these settings, sharing in-flight work and retained results. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
// Worker/worklet startup fetches with the creator's client but stores and creates modules in env.
export function fetchSingleModuleScript(
  url: URLRecord, fetchClient: ScriptEnvironment, destination: Destination, options: ScriptFetchOptions,
  env: BrowletEnvironment, referrer: URLRecord | 'client' | 'no-referrer', moduleRequest: ModuleRequest | undefined,
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

  // Remove failures or publish success before callbacks can request the same module again.
  const complete = (script: ModuleScript | null) => {
    if (script === null) moduleMap.delete(url, moduleType);
    else moduleMap.set(url, moduleType, script);
    for (const callback of callbacks) callback(script);
  };
  const processResponseConsumeBody = (response: FetchResponse, bodyBytes: Uint8Array | null | 'failure') => {
    complete(createModuleScriptFromResponse(response, bodyBytes, moduleType, options, env));
  };

  const requestDestination = fetchDestinationFromModuleType(destination, moduleType);
  fetchClient.fetchModuleSource(url, requestDestination, options, referrer, isTopLevel, processResponseConsumeBody, performFetch);
}

/** Prepare one module request in its Fetch client's isolate, before any network or policy processing. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
export function createModuleScriptRequest(
  url: URLRecord, destination: Destination, options: ScriptFetchOptions,
  referrer: URLRecord | 'client' | 'no-referrer', isWorkerRoot: boolean, env: BrowletEnvironment,
): FetchRequest {
  const request = isWorkerRoot
    ? createWorkerScriptRequest(url, env, destination, 'module', options.credentialsMode)
    : new FetchRequest(url, env);
  if (!isWorkerRoot) request.mode = 'cors';
  request.referrer = referrer === 'client' ? undefined : referrer === 'no-referrer' ? null : referrer;
  request.client = env;
  request.destination = destination;
  request.initiatorType = 'script';
  options.setUpModuleRequest(request);
  return request;
}

/** Validate and parse one module response; the fetch owner retains module-map and callback ordering. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script
export function createModuleScriptFromResponse(
  response: FetchResponse, bodyBytes: Uint8Array | null | 'failure', moduleType: ModuleType,
  options: ScriptFetchOptions, env: BrowletEnvironment,
): ModuleScript | null {
  if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) return null;

  const mimeType = response.headerList.extractMIMEType();
  const essence = mimeType === null ? null : getMIMETypeEssence(mimeType);
  const referrerPolicy = parseReferrerPolicyFromHeader(response);
  if (referrerPolicy !== '') options.referrerPolicy = referrerPolicy;

  if (essence === 'application/wasm' && moduleType === 'javascript-or-wasm') {
    return new WasmModuleScript(bodyBytes, env, response.url!, options);
  }

  const source = utf8Decode(bodyBytes);
  if (moduleType === 'text') return new TextModuleScript(source, env);
  if (moduleType === 'javascript-or-wasm' && mimeType !== null && isJavaScriptMIMEType(mimeType)) {
    return new JSModuleScript(source, env, response.url!, options);
  }
  if (moduleType === 'css' && essence === 'text/css') return new CSSModuleScript(source, response.url!, env);
  if (moduleType === 'json' && mimeType !== null && isJSONMIMEType(mimeType)) return new JSONModuleScript(source, env);
  return null;
}

/** Validate an imported module's attributes and fetch it as a descendant. */
// https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-imported-module-script
export function fetchSingleImportedModuleScript(
  url: URLRecord, fetchClient: ScriptEnvironment, destination: Destination, options: ScriptFetchOptions,
  env: BrowletEnvironment, referrer: URLRecord | 'client' | 'no-referrer', moduleRequest: ModuleRequest,
  onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
): void {
  const supportedAttributes = getSupportedImportAttributes();
  if (moduleRequest.attributes.some((attribute) => !supportedAttributes.includes(attribute.key))) {
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
