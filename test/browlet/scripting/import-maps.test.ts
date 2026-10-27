import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { ImportMap, ImportMapParseResult } from '../../../src/browlet/scripting/import-map';
import { ClassicScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('parse an import map', () => {
  it('normalizes URL keys and addresses and sorts by descending code units', () => {
    const { parse } = fixture();
    const map = parse({
      imports: {
        pkg: './pkg.js', 'pkg/': './packages/', 'pkg/deep/': './specific/',
        './old/../app.js': './first.js', 'https://MAPS.test:443/app/app.js': './second.js',
      },
    });
    expect([...map.imports.keys()]).toEqual(['pkg/deep/', 'pkg/', 'pkg', 'https://maps.test/app/app.js']);
    expect(serializeURL(map.imports.get('https://maps.test/app/app.js')!)).toBe('https://maps.test/app/second.js');
    expect(map.scopes.size).toBe(0);
    expect(map.integrity.size).toBe(0);
  });

  it.each(['null', '[]', 'true', '"text"', '{"imports":[]}', '{"scopes":null}', '{"integrity":0}', '{"scopes":{"/":[]}}'])(
    'rejects invalid map structure %s with a realm-owned TypeError', (input) => {
      const { env, baseURL } = fixture();
      expect(() => ImportMap.parse(input, baseURL, env)).toThrow(env.realm.TypeError);
    },
  );

  it('preserves intrinsic JSON SyntaxErrors', () => {
    const { env, baseURL } = fixture();
    expect(() => ImportMap.parse('{', baseURL, env)).toThrow(env.realm.SyntaxError);
  });

  it('ignores empty keys and blocks non-string, bare, invalid, and mismatched prefix addresses', () => {
    const { env, parse } = fixture();
    const warning = vi.spyOn(env, 'reportConsoleWarning');
    const map = parse({
      imports: {
        '': './empty.js', blocked: null, list: [], bare: 'node_modules/helper/index.mjs',
        invalid: 'https://[invalid', 'pkg/': './not-a-prefix.js', valid: './ok.js',
      }, extension: {},
    });
    expect(map.imports.has('')).toBe(false);
    for (const key of ['blocked', 'list', 'bare', 'invalid', 'pkg/']) expect(map.imports.get(key)).toBeNull();
    expect(serializeURL(map.imports.get('valid')!)).toBe('https://maps.test/app/ok.js');
    expect(warning).toHaveBeenCalledTimes(7);
  });

  it('normalizes scopes against the map base and their mappings against that same base', () => {
    const { env, parse } = fixture();
    const warning = vi.spyOn(env, 'reportConsoleWarning');
    const map = parse({
      scopes: {
        './deep/': { lib: './lib.js' }, '/': { lib: '/root.js' },
        'https://[invalid': {}, 'bare-scope/': {},
      },
    });
    expect([...map.scopes.keys()]).toEqual([
      'https://maps.test/app/deep/', 'https://maps.test/app/bare-scope/', 'https://maps.test/',
    ]);
    expect(serializeURL(map.scopes.get('https://maps.test/app/deep/')!.get('lib')!)).toBe('https://maps.test/app/lib.js');
    expect(warning).toHaveBeenCalledTimes(1);
    // Invalid scope values throw even when the scope URL itself would be skipped.
    expect(() => parse({ scopes: { 'https://[invalid': null } })).toThrow(env.realm.TypeError);
  });

  it('normalizes integrity aliases by URL value and feeds descendant integrity lookup', () => {
    const { env, global, parse } = fixture();
    const warning = vi.spyOn(env, 'reportConsoleWarning');
    global.importMap = parse({
      integrity: {
        './lib.js': 'sha256-first', 'https://MAPS.test:443/app/lib.js': 'sha384-last',
        'bare.js': 'sha256-bare', './not-string.js': 12, 'https://[invalid': 'sha256-invalid',
      },
    });
    expect(global.importMap.integrity.size).toBe(1);
    expect(env.resolveModuleIntegrityMetadata(env.parseURL('https://maps.test/app/lib.js')!)).toBe('sha384-last');
    expect(warning).toHaveBeenCalledTimes(3);
  });

  it('keeps prototype-like specifiers as map entries', () => {
    const { env, baseURL } = fixture();
    const map = ImportMap.parse('{"imports":{"__proto__":"./proto.js","constructor":"./ctor.js"}}', baseURL, env);
    expect(serializeURL(map.imports.get('__proto__')!)).toBe('https://maps.test/app/proto.js');
    expect(serializeURL(map.imports.get('constructor')!)).toBe('https://maps.test/app/ctor.js');
  });

  it('uses the captured JSON intrinsic without consulting author array iterators', async () => {
    const { browser, parse } = fixture();
    await browser.evaluate(() => {
      JSON.parse = () => { throw new Error('author JSON.parse'); };
      Array.prototype[Symbol.iterator] = () => { throw new Error('author iterator'); };
    });
    const map = parse({ imports: { invalid: [1, { nested: [2] }], valid: './valid.js' } });
    expect(map.imports.get('invalid')).toBeNull();
    expect(serializeURL(map.imports.get('valid')!)).toBe('https://maps.test/app/valid.js');
  });
});

describe('resolve a module specifier', () => {
  it('resolves URL-like specifiers and rejects bare names without implicit trimming', () => {
    const { env, resolve } = fixture();
    expect(resolve('./lib.js')).toBe('https://maps.test/app/lib.js');
    expect(resolve('../lib.js')).toBe('https://maps.test/lib.js');
    expect(resolve('//other.test/lib.js')).toBe('https://other.test/lib.js');
    expect(resolve('data:text/javascript,export{}')).toBe('data:text/javascript,export{}');
    for (const specifier of ['bare', ' ./lib.js', '?query', '#fragment', 'https://[invalid']) {
      expect(() => resolve(specifier)).toThrow(env.realm.TypeError);
    }
  });

  it('selects exact matches and the most specific package prefix', () => {
    const { install, resolve } = fixture();
    install({ imports: { pkg: '/pkg.js', 'pkg/': '/packages/', 'pkg/deep/': '/specific/', './lib.js': '/mapped.js' } });
    expect(resolve('pkg')).toBe('https://maps.test/pkg.js');
    expect(resolve('pkg/entry.js')).toBe('https://maps.test/packages/entry.js');
    expect(resolve('pkg/deep/entry.js')).toBe('https://maps.test/specific/entry.js');
    expect(resolve('./unused/../lib.js')).toBe('https://maps.test/mapped.js');
  });

  it('tries the exact-file scope, matching directory scopes, and finally top-level imports', () => {
    const { env, global, parse, resolve } = fixture();
    global.importMap = parse({
      imports: { top: '/top.js', lib: '/top-lib.js' },
      scopes: {
        '/app/': { outer: '/outer.js' }, '/app/deep/': { lib: '/deep.js' },
        '/app/deep/page.html': { exact: '/exact.js' }, '/app/deep': { top: '/not-a-prefix.js' },
      },
    });
    env.window.document.url = env.parseURL('https://maps.test/app/deep/page.html')!;
    expect(resolve('exact')).toBe('https://maps.test/exact.js');
    expect(resolve('lib')).toBe('https://maps.test/deep.js');
    expect(resolve('outer')).toBe('https://maps.test/outer.js');
    expect(resolve('top')).toBe('https://maps.test/top.js');
  });

  it('stops on blocked exact or prefix mappings without falling back', () => {
    const { env, install, resolve, global } = fixture();
    install({ imports: { lib: '/lib.js', 'pkg/': '/pkg/' }, scopes: { '/app/': { lib: null, 'pkg/': null } } });
    expect(() => resolve('lib')).toThrow(env.realm.TypeError);
    expect(() => resolve('pkg/entry.js')).toThrow(env.realm.TypeError);
    expect(global.resolvedModuleSet.size).toBe(0);
  });

  it('allows prefix mappings for special URLs and only exact mappings for other schemes', () => {
    const { install, resolve } = fixture();
    install({ imports: { 'file:///packages/': '/file/', 'custom:/packages/': '/custom/', 'custom:/exact': '/exact.js' } });
    expect(resolve('file:///packages/lib.js')).toBe('https://maps.test/file/lib.js');
    expect(resolve('custom:/packages/lib.js')).toBe('custom:/packages/lib.js');
    expect(resolve('custom:/exact')).toBe('https://maps.test/exact.js');
  });

  it('rejects invalid suffixes and backtracking outside the mapped package', () => {
    const { env, install, resolve, global } = fixture();
    install({ imports: { 'pkg/': '/packages/', 'opaque/': 'data:text/javascript,/' } });
    for (const specifier of ['pkg/../escape.js', 'pkg/%2e%2e/escape.js', 'pkg//outside.js', 'pkg/https://[invalid', 'opaque/child']) {
      expect(() => resolve(specifier)).toThrow(env.realm.TypeError);
    }
    expect(global.resolvedModuleSet.size).toBe(0);
    expect(resolve('pkg/deep/../entry.js')).toBe('https://maps.test/packages/entry.js');
  });

  it('retains normalized source specifiers, rather than remapped destinations', () => {
    const { global, install, resolve } = fixture();
    install({ imports: { './lib.js': '/target.js', bare: '/bare.js' } });
    resolve('./unused/../lib.js');
    resolve('bare');
    const [url, bare] = [...global.resolvedModuleSet];
    expect(url).toMatchObject({ serializedBaseURL: 'https://maps.test/app/page.html', specifier: 'https://maps.test/app/lib.js' });
    expect(serializeURL(url!.specifierAsURL!)).toBe('https://maps.test/app/lib.js');
    expect(bare).toEqual({ serializedBaseURL: 'https://maps.test/app/page.html', specifier: 'bare', specifierAsURL: null });
  });

  it('uses the referring script map and captured base while allocating errors in the current realm', () => {
    const source = fixture();
    const current = fixture();
    source.install({ imports: { lib: '/source.js' } });
    current.install({ imports: { lib: '/current.js' } });
    const script = new ClassicScript('', source.env, source.env.parseURL('https://maps.test/captured/main.js')!, new ScriptFetchOptions());
    expect(serializeURL(current.env.resolveModuleSpecifier(script, './child.js'))).toBe('https://maps.test/captured/child.js');
    expect(serializeURL(current.env.resolveModuleSpecifier(script, 'lib'))).toBe('https://maps.test/source.js');
    expect(source.global.resolvedModuleSet.size).toBe(2);
    expect(current.global.resolvedModuleSet.size).toBe(0);
    expect(() => current.env.resolveModuleSpecifier(script, 'missing')).toThrow(current.env.realm.TypeError);
  });

  it('does not require import-map state on a non-Window environment', () => {
    const { env, baseURL } = fixture();
    const sandbox = env.userAgent.sandbox;
    const script = new ClassicScript('', sandbox, baseURL, new ScriptFetchOptions(), false, null, true);
    // Sandbox's globalImplementation getter throws: non-Window resolution must not consult it.
    expect(serializeURL(sandbox.resolveModuleSpecifier(script, './child.js'))).toBe('https://maps.test/app/child.js');
    expect(() => sandbox.resolveModuleSpecifier(script, 'missing')).toThrow(sandbox.realm.TypeError);
  });
});

describe('merge import maps', () => {
  it('keeps earlier definitions including blocked entries and does not mutate the new map', () => {
    const { env, global, parse, install, resolve } = fixture();
    install({ imports: { lib: '/old.js', blocked: null }, scopes: { '/app/': { scoped: '/old-scoped.js' } } });
    const original = global.importMap;
    const map = parse({
      imports: { lib: '/new.js', blocked: '/unblocked.js', added: '/added.js' }, scopes: {
        '/app/': { scoped: '/new-scoped.js', extra: '/extra.js' }, '/another/': { lib: '/other.js' },
      },
    });
    global.mergeImportMap(map);
    expect(global.importMap).toBe(original);
    expect(resolve('lib')).toBe('https://maps.test/old.js');
    expect(resolve('scoped')).toBe('https://maps.test/old-scoped.js');
    expect(resolve('extra')).toBe('https://maps.test/extra.js');
    expect(() => resolve('blocked')).toThrow(env.realm.TypeError);
    expect(serializeURL(map.imports.get('lib')!)).toBe('https://maps.test/new.js');
    expect(global.importMap.imports.get('added')).not.toBe(map.imports.get('added'));
    expect(global.importMap.scopes.get('https://maps.test/another/')).not.toBe(map.scopes.get('https://maps.test/another/'));
    expect(global.importMap.scopes.get('https://maps.test/another/')!.get('lib')).not.toBe(map.scopes.get('https://maps.test/another/')!.get('lib'));
  });

  it('protects completed resolutions while allowing unrelated names and new, more-specific prefixes', () => {
    // Approved Chromium/WebKit behavior; Firefox rejects f/foo/ and keeps the older pkg/ match.
    const { install, resolve } = fixture();
    install({ imports: { foo: '/foo.js', 'pkg/': '/old/' } });
    resolve('foo');
    resolve('https://maps.test/untouched/a.js');
    install({
      imports: {
        f: '/f.js', 'foo/': '/foo-sub/', 'https://maps.test/untouched/': '/changed/', 'pkg/deep/': '/specific/',
      },
    });
    expect(resolve('f')).toBe('https://maps.test/f.js');
    expect(resolve('foo/x.js')).toBe('https://maps.test/foo-sub/x.js');
    expect(resolve('https://maps.test/untouched/a.js')).toBe('https://maps.test/untouched/a.js');
    expect(resolve('pkg/deep/x.js')).toBe('https://maps.test/specific/x.js');
  });

  it('orders newly merged scopes and scoped mappings before broader existing matches', () => {
    const { install, resolve } = fixture();
    install({ scopes: { '/': { lib: '/root.js' }, '/app/': { 'pkg/': '/broad/' } } });
    install({ scopes: { '/app/': { 'pkg/deep/': '/specific/' }, '/app/page.html': { lib: '/page.js' } } });
    expect(resolve('lib')).toBe('https://maps.test/page.js');
    expect(resolve('pkg/deep/a.js')).toBe('https://maps.test/specific/a.js');
  });

  it('suppresses mappings that would change resolutions in a matching scope only', () => {
    const { env, global, parse, install, resolve } = fixture();
    resolve('./fixed.js');
    const map = parse({
      scopes: {
        '/app/': { './fixed.js': '/changed.js', './': '/changed/', fresh: '/fresh.js' },
        '/other/': { './fixed.js': '/other.js' },
      },
    });
    global.mergeImportMap(map);
    expect(resolve('./fixed.js')).toBe('https://maps.test/app/fixed.js');
    expect(resolve('fresh')).toBe('https://maps.test/fresh.js');
    expect(map.scopes.get('https://maps.test/app/')!.has('https://maps.test/app/fixed.js')).toBe(true);
    env.window.document.url = env.parseURL('https://maps.test/other/page.html')!;
    expect(resolve('https://maps.test/app/fixed.js')).toBe('https://maps.test/other.js');
    expect(() => resolve('previously-missing')).toThrow(env.realm.TypeError);
    install({ imports: { 'previously-missing': '/now-present.js' } });
    expect(resolve('previously-missing')).toBe('https://maps.test/now-present.js');
  });

  it('does not discard an ineffective scoped prefix for a previously resolved non-special URL', () => {
    const { global, install, resolve } = fixture();
    resolve('custom:/pkg/a.js');
    install({ scopes: { '/app/': { 'custom:/pkg/': '/mapped/', 'custom:/pkg/a.js': '/changed.js' } } });
    const scope = global.importMap.scopes.get('https://maps.test/app/')!;
    expect(scope.has('custom:/pkg/')).toBe(true);
    expect(scope.has('custom:/pkg/a.js')).toBe(false);
    expect(resolve('custom:/pkg/a.js')).toBe('custom:/pkg/a.js');
  });

  it('retains the first integrity metadata by URL value, but permits new integrity after resolution', () => {
    const { env, install, resolve } = fixture();
    install({ integrity: { './lib.js': 'sha256-first' } });
    resolve('./other.js');
    install({ integrity: { 'https://MAPS.test:443/app/lib.js': 'sha384-second', './other.js': 'sha384-other' } });
    expect(env.resolveModuleIntegrityMetadata(env.parseURL('./lib.js', env.apiBaseURL)!)).toBe('sha256-first');
    expect(env.resolveModuleIntegrityMetadata(env.parseURL('./other.js', env.apiBaseURL)!)).toBe('sha384-other');
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  const baseURL = env.parseURL('https://maps.test/app/page.html')!;
  env.window.document.url = baseURL;
  const global = env.window;
  const parse = (input: unknown) => ImportMap.parse(JSON.stringify(input), baseURL, env);
  const install = (input: unknown) => global.registerImportMap(new ImportMapParseResult(JSON.stringify(input), baseURL, env));
  const resolve = (specifier: string) => serializeURL(env.resolveModuleSpecifier(null, specifier));
  return { browser, env, global, baseURL, parse, install, resolve };
}
