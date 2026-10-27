import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { ErrorEvent } from '../../../src/browlet/platform';
import * as ImportMaps from '../../../src/browlet/scripting/import-map';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

// HTML §8.1.4.8 lifecycle tests control the parser/merger results while using
// real Window bindings and error dispatch. import-maps.test.ts covers the
// §8.1.5 algorithms and registration with actual parsing and merging.
describe('import map parse results', () => {
  it('retains the parser result and passes the explicit base URL without registering it', () => {
    const { env, global } = fixture();
    const baseURL = env.parseURL('https://maps.test/captured/base/')!;
    const input = '{"imports":{"lib":"./lib.js"}}';
    const map = emptyMap();
    map.imports.set('lib', env.parseURL('./lib.js', baseURL));
    const original = global.importMap;
    const parse = vi.spyOn(ImportMaps.ImportMap, 'parse').mockReturnValue(map);
    const merge = vi.spyOn(global, 'mergeImportMap');

    const result = new ImportMaps.ImportMapParseResult(input, baseURL, env);

    expect(parse).toHaveBeenCalledExactlyOnceWith(input, baseURL, env);
    expect(result.importMap).toBe(map);
    expect(result.errorToRethrow).toBeNull();
    expect(global.importMap).toBe(original);
    expect(merge).not.toHaveBeenCalled();
  });

  it('retains the original parse exception without reporting it during creation', () => {
    const { env, window } = fixture();
    const error = new env.exec.TypeError('The top-level value must be an object');
    vi.spyOn(ImportMaps.ImportMap, 'parse').mockImplementation(() => { throw error; });
    const listener = vi.fn();
    window.addEventListener('error', listener);
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = new ImportMaps.ImportMapParseResult('[]', env.apiBaseURL, env);

    expect(result.importMap).toBeNull();
    expect(result.errorToRethrow).toBe(error);
    expect(listener).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it('does not turn an internal parser failure into an author parse error', () => {
    const { env } = fixture();
    const failure = new InternalError('parser unavailable');
    vi.spyOn(ImportMaps.ImportMap, 'parse').mockImplementation(() => { throw failure; });
    expect(() => new ImportMaps.ImportMapParseResult('{}', env.apiBaseURL, env)).toThrow(failure);
  });
});

describe('register an import map', () => {
  it('passes a successful parse result to the merger with the target Window', () => {
    const { env, global } = fixture();
    const map = emptyMap();
    vi.spyOn(ImportMaps.ImportMap, 'parse').mockReturnValue(map);
    const merge = vi.spyOn(global, 'mergeImportMap').mockImplementation(() => {});
    const report = vi.spyOn(env, 'reportException');
    const result = new ImportMaps.ImportMapParseResult('{}', env.apiBaseURL, env);

    global.registerImportMap(result);

    expect(merge).toHaveBeenCalledExactlyOnceWith(map);
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a parse error at the registering Window without merging or changing its map', () => {
    const source = fixture();
    const target = fixture();
    const error = new source.env.realm.intrinsics.syntaxError('Invalid import map JSON');
    vi.spyOn(ImportMaps.ImportMap, 'parse').mockImplementation(() => { throw error; });
    const merge = vi.spyOn(target.global, 'mergeImportMap');
    const result = new ImportMaps.ImportMapParseResult('{', source.env.apiBaseURL, source.env);
    const original = target.global.importMap;
    const events: ErrorEvent[] = [];
    target.window.addEventListener('error', (event) => {
      events.push(event as ErrorEvent);
      event.preventDefault();
    });
    const sourceListener = vi.fn();
    source.window.addEventListener('error', sourceListener);
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});

    target.global.registerImportMap(result);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ error, cancelable: true, isTrusted: true });
    expect(getRelevantRealm(events[0]!)).toBe(target.env.realm);
    expect(sourceListener).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
    expect(target.global.importMap).toBe(original);
  });

  it('reports an uncanceled parse error to the console', () => {
    const { env, global } = fixture();
    const error = new env.exec.TypeError('Invalid scopes');
    vi.spyOn(ImportMaps.ImportMap, 'parse').mockImplementation(() => { throw error; });
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = new ImportMaps.ImportMapParseResult('{"scopes":[]}', env.apiBaseURL, env);

    global.registerImportMap(result);

    expect(output).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('propagates an internal merge failure without disguising it as a parse error', () => {
    const { env, global, window } = fixture();
    vi.spyOn(ImportMaps.ImportMap, 'parse').mockReturnValue(emptyMap());
    const failure = new InternalError('merger unavailable');
    vi.spyOn(global, 'mergeImportMap').mockImplementation(() => { throw failure; });
    const listener = vi.fn();
    window.addEventListener('error', listener);
    const result = new ImportMaps.ImportMapParseResult('{}', env.apiBaseURL, env);

    expect(() => global.registerImportMap(result)).toThrow(failure);
    expect(listener).not.toHaveBeenCalled();
    expect(result.errorToRethrow).toBeNull();
  });
});

function emptyMap(): ImportMaps.ImportMap {
  return new ImportMaps.ImportMap();
}

function fixture() {
  const { window } = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(window).env;
  return { window, env, global: env.window };
}
