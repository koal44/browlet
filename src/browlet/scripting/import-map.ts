import { InternalError, type InfraValue } from '../../infra/index';
import { copyURL, isSpecialURL, serializeURL, urlsEqual, type URLRecord } from '../../url/index';

import type { BrowletEnvironment } from '../environment';

import type { BrowletGlobalObject } from './global-object';
import type { Script } from './script';

/** Resolve using the referring script, or the supplied current environment when there is no script. */
// https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier
export function resolveModuleSpecifier(referringScript: Script | null, specifier: string, env: BrowletEnvironment): URLRecord {
  const targetEnv = referringScript?.env ?? env;
  const baseURL = referringScript === null ? targetEnv.apiBaseURL : referringScript.baseURL;
  if (baseURL === null) throw new InternalError('Module specifier resolution requires the referring script\'s base URL');
  const importMap = targetEnv.isWindow ? targetEnv.globalImplementation.importMap : new ImportMap();
  const serializedBaseURL = serializeURL(baseURL);
  const asURL = resolveURLLikeModuleSpecifier(specifier, baseURL, targetEnv);
  const normalizedSpecifier = asURL === null ? specifier : serializeURL(asURL);
  let result: URLRecord | null = null;

  for (const [scopePrefix, scopeImports] of importMap.scopes) {
    if (scopePrefix === serializedBaseURL || scopePrefix.endsWith('/') && serializedBaseURL.startsWith(scopePrefix)) {
      result = resolveImportsMatch(normalizedSpecifier, asURL, scopeImports, env);
      if (result !== null) break;
    }
  }
  result ??= resolveImportsMatch(normalizedSpecifier, asURL, importMap.imports, env);
  result ??= asURL;
  if (result === null) throw new env.exec.TypeError(`The module specifier '${specifier}' could not be resolved`);
  addModuleToResolvedModuleSet(targetEnv, serializedBaseURL, normalizedSpecifier, asURL);
  return result;
}

/** Module name mappings, scoped overrides, and integrity metadata for one global. */
// https://html.spec.whatwg.org/multipage/webappapis.html#import-map
export class ImportMap {
  imports: ModuleSpecifierMap = new Map();
  /** Scope normalization stores serialized URL prefixes, in descending order. */
  // SPEC_CLASH(import-map-scope-keys): The record definition says URLs; follow
  // the algorithms, which produce and consume serialized string keys.
  scopes: Map<string, ModuleSpecifierMap> = new Map();
  integrity: ModuleIntegrityMap = new Map();

  /** Parse and normalize imports, scopes, and integrity metadata against the supplied base URL. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#parse-an-import-map-string
  static parse(input: string, baseURL: URLRecord, env: BrowletEnvironment): ImportMap {
    const parsed = env.exec.parseJSONStringToInfra(input);
    if (!(parsed instanceof Map)) throw new env.exec.TypeError('An import map must be a JSON object');
    const result = new ImportMap();
    if (parsed.has('imports')) {
      const imports = parsed.get('imports');
      if (!(imports instanceof Map)) throw new env.exec.TypeError('The import map imports must be a JSON object');
      result.imports = sortAndNormalizeModuleSpecifierMap(imports, baseURL, env);
    }
    if (parsed.has('scopes')) {
      const scopes = parsed.get('scopes');
      if (!(scopes instanceof Map)) throw new env.exec.TypeError('The import map scopes must be a JSON object');
      result.scopes = sortAndNormalizeScopes(scopes, baseURL, env);
    }
    if (parsed.has('integrity')) {
      const integrity = parsed.get('integrity');
      if (!(integrity instanceof Map)) throw new env.exec.TypeError('The import map integrity must be a JSON object');
      result.integrity = normalizeModuleIntegrityMap(integrity, baseURL, env);
    }
    if ([...parsed.keys()].some((key) => key !== 'imports' && key !== 'scopes' && key !== 'integrity')) {
      env.reportConsoleWarning('An import map contains an unknown top-level key');
    }
    return result;
  }
}

/** Retains an import map or its parse error until registration; this is not a Script. */
// https://html.spec.whatwg.org/multipage/webappapis.html#import-map-parse-result
export class ImportMapParseResult {
  importMap: ImportMap | null = null;
  errorToRethrow: unknown = null;

  /** Parse without registering the map or reporting a parse error. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#create-an-import-map-parse-result
  constructor(input: string, baseURL: URLRecord, env: BrowletEnvironment) {
    try {
      this.importMap = ImportMap.parse(input, baseURL, env);
    } catch (error) {
      // An unfinished implementation is not an author parse error.
      if (error instanceof InternalError) throw error;
      this.errorToRethrow = error;
    }
  }
}

/** Update the global's existing map using copies of new mappings, preserving completed resolutions. */
// https://html.spec.whatwg.org/multipage/webappapis.html#merge-existing-and-new-import-maps
export function mergeExistingAndNewImportMaps(global: BrowletGlobalObject, newImportMap: ImportMap): void {
  const newScopes = new Map<string, ModuleSpecifierMap>();
  for (const [scopePrefix, scopeImports] of newImportMap.scopes) {
    newScopes.set(scopePrefix, copyModuleSpecifierMap(scopeImports));
  }
  const oldImportMap = global.importMap;
  const newImports = copyModuleSpecifierMap(newImportMap.imports);
  for (const [scopePrefix, scopeImports] of newScopes) {
    const prefixScope = scopePrefix.endsWith('/');
    for (const record of global.resolvedModuleSet) {
      const baseURL = record.serializedBaseURL;
      if (baseURL === null || scopePrefix !== baseURL && !(prefixScope && baseURL.startsWith(scopePrefix))) continue;
      const allowsPrefix = record.specifierAsURL === null || isSpecialURL(record.specifierAsURL);
      for (const specifierKey of scopeImports.keys()) {
        if (specifierKey === record.specifier ||
          allowsPrefix && specifierKey.endsWith('/') && record.specifier.startsWith(specifierKey)) {
          scopeImports.delete(specifierKey);
        }
      }
    }
    const oldScope = oldImportMap.scopes.get(scopePrefix);
    oldImportMap.scopes.set(scopePrefix, oldScope === undefined ? scopeImports : mergeModuleSpecifierMaps(scopeImports, oldScope));
  }
  for (const [url, integrity] of newImportMap.integrity) {
    if (![...oldImportMap.integrity.keys()].some((key) => urlsEqual(key, url))) oldImportMap.integrity.set(url, integrity);
  }
  for (const record of global.resolvedModuleSet) {
    for (const specifier of newImports.keys()) {
      // SPEC_CLASH(import-map-resolved-prefix): Use Chromium/WebKit's exact or
      // slash-delimited prefixes of the resolved name. HTML reverses the prefix
      // check; Firefox's reversal also removes unrelated partial bare names.
      if (specifier === record.specifier || specifier.endsWith('/') && record.specifier.startsWith(specifier)) {
        newImports.delete(specifier);
      }
    }
  }
  oldImportMap.imports = mergeModuleSpecifierMaps(newImports, oldImportMap.imports);
  // SPEC_CLASH(import-map-merge-order): Preserve most-specific-first resolution
  // after merging, as Chromium/WebKit do. HTML's merge steps omit this sorting.
  oldImportMap.scopes = sortDescending(oldImportMap.scopes);
  // Console warnings about ignored merge entries are optional in HTML.
}

/** Normalized module specifiers mapped to URLs, or null to block resolution. */
export type ModuleSpecifierMap = Map<string, URLRecord | null>;

/** Integrity metadata indexed by resolved module URLs. */
export type ModuleIntegrityMap = Map<URLRecord, string>;

/** A completed resolution that later import maps must not change. */
// https://html.spec.whatwg.org/multipage/webappapis.html#specifier-resolution-record
export interface SpecifierResolutionRecord {
  serializedBaseURL: string | null;
  specifier: string;
  specifierAsURL: URLRecord | null;
}

// https://html.spec.whatwg.org/multipage/webappapis.html#resolving-an-imports-match
function resolveImportsMatch(
  normalizedSpecifier: string, asURL: URLRecord | null, specifierMap: ModuleSpecifierMap, env: BrowletEnvironment,
): URLRecord | null {
  const allowsPrefix = asURL === null || isSpecialURL(asURL);
  for (const [specifierKey, resolutionResult] of specifierMap) {
    if (specifierKey === normalizedSpecifier) {
      if (resolutionResult === null) throw new env.exec.TypeError(`The module specifier '${specifierKey}' is blocked`);
      return resolutionResult;
    }
    if (!allowsPrefix || !specifierKey.endsWith('/') || !normalizedSpecifier.startsWith(specifierKey)) continue;
    if (resolutionResult === null) throw new env.exec.TypeError(`The module specifier prefix '${specifierKey}' is blocked`);
    const afterPrefix = normalizedSpecifier.slice(specifierKey.length);
    const url = env.parseURL(afterPrefix, resolutionResult);
    if (url === null) throw new env.exec.TypeError(`The module specifier '${normalizedSpecifier}' has an invalid suffix`);
    if (!serializeURL(url).startsWith(serializeURL(resolutionResult))) {
      throw new env.exec.TypeError(`The module specifier '${normalizedSpecifier}' backtracks above '${specifierKey}'`);
    }
    return url;
  }
  return null;
}

// https://html.spec.whatwg.org/multipage/webappapis.html#resolving-a-url-like-module-specifier
function resolveURLLikeModuleSpecifier(specifier: string, baseURL: URLRecord, env: BrowletEnvironment): URLRecord | null {
  const relative = specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../');
  return env.parseURL(specifier, relative ? baseURL : null);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#add-module-to-resolved-module-set
function addModuleToResolvedModuleSet(
  env: BrowletEnvironment, serializedBaseURL: string, normalizedSpecifier: string, asURL: URLRecord | null,
): void {
  if (!env.isWindow) return;
  env.globalImplementation.resolvedModuleSet.add({ serializedBaseURL, specifier: normalizedSpecifier, specifierAsURL: asURL });
}

// https://html.spec.whatwg.org/multipage/webappapis.html#merge-module-specifier-maps
function mergeModuleSpecifierMaps(newMap: ModuleSpecifierMap, oldMap: ModuleSpecifierMap): ModuleSpecifierMap {
  const mergedMap = copyModuleSpecifierMap(oldMap);
  for (const [specifier, url] of newMap) {
    if (!oldMap.has(specifier)) mergedMap.set(specifier, url);
  }
  // SPEC_CLASH(import-map-merge-order): Restore the ordering required by resolution.
  return sortDescending(mergedMap);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#sorting-and-normalizing-a-module-specifier-map
function sortAndNormalizeModuleSpecifierMap(
  originalMap: Map<string, InfraValue>, baseURL: URLRecord, env: BrowletEnvironment,
): ModuleSpecifierMap {
  const normalized: ModuleSpecifierMap = new Map();
  for (const [specifierKey, value] of originalMap) {
    const key = normalizeSpecifierKey(specifierKey, baseURL, env);
    if (key === null) continue;
    if (typeof value !== 'string') {
      env.reportConsoleWarning(`The import map address for '${specifierKey}' must be a string`);
      normalized.set(key, null);
      continue;
    }
    // SPEC_CLASH(import-map-bare-address-example): Follow the algorithm, which
    // rejects bare addresses; the normalization example instead accepts one.
    const address = resolveURLLikeModuleSpecifier(value, baseURL, env);
    if (address === null || specifierKey.endsWith('/') && !serializeURL(address).endsWith('/')) {
      env.reportConsoleWarning(`The import map address for '${specifierKey}' is invalid`);
      normalized.set(key, null);
      continue;
    }
    normalized.set(key, address);
  }
  return sortDescending(normalized);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#sorting-and-normalizing-scopes
function sortAndNormalizeScopes(
  originalMap: Map<string, InfraValue>, baseURL: URLRecord, env: BrowletEnvironment,
): Map<string, ModuleSpecifierMap> {
  const normalized = new Map<string, ModuleSpecifierMap>();
  for (const [scopePrefix, value] of originalMap) {
    if (!(value instanceof Map)) throw new env.exec.TypeError(`The import map scope '${scopePrefix}' must be a JSON object`);
    const scopeURL = env.parseURL(scopePrefix, baseURL);
    if (scopeURL === null) {
      env.reportConsoleWarning(`The import map scope '${scopePrefix}' is not a URL`);
      continue;
    }
    normalized.set(serializeURL(scopeURL), sortAndNormalizeModuleSpecifierMap(value, baseURL, env));
  }
  return sortDescending(normalized);
}

// https://html.spec.whatwg.org/multipage/webappapis.html#normalizing-a-module-integrity-map
// SPEC_MISMATCH: (originalMap) -> module integrity map
// The algorithm uses baseURL without declaring it; its caller already supplies it.
function normalizeModuleIntegrityMap(
  originalMap: Map<string, InfraValue>, baseURL: URLRecord, env: BrowletEnvironment,
): ModuleIntegrityMap {
  const normalized: ModuleIntegrityMap = new Map();
  for (const [key, value] of originalMap) {
    const url = resolveURLLikeModuleSpecifier(key, baseURL, env);
    if (url === null) {
      env.reportConsoleWarning(`The import map integrity key '${key}' is not a URL-like specifier`);
      continue;
    }
    if (typeof value !== 'string') {
      env.reportConsoleWarning(`The import map integrity value for '${key}' must be a string`);
      continue;
    }
    const existing = [...normalized.keys()].find((entry) => urlsEqual(entry, url));
    normalized.set(existing ?? url, value);
  }
  return normalized;
}

// https://html.spec.whatwg.org/multipage/webappapis.html#normalizing-a-specifier-key
function normalizeSpecifierKey(specifierKey: string, baseURL: URLRecord, env: BrowletEnvironment): string | null {
  if (specifierKey === '') {
    env.reportConsoleWarning('Import map specifier keys must not be empty');
    return null;
  }
  const url = resolveURLLikeModuleSpecifier(specifierKey, baseURL, env);
  return url === null ? specifierKey : serializeURL(url);
}

function copyModuleSpecifierMap(map: ModuleSpecifierMap): ModuleSpecifierMap {
  const copy: ModuleSpecifierMap = new Map();
  for (const [specifier, url] of map) copy.set(specifier, url === null ? null : copyURL(url));
  return copy;
}

function sortDescending<Value>(map: Map<string, Value>): Map<string, Value> {
  return new Map([...map].sort(([a], [b]) => a < b ? 1 : a > b ? -1 : 0));
}
