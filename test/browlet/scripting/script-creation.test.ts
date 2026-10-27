import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalError } from '../../../src/infra/index';
import { Browlet } from '../../../src/browlet/browlet';
import {
  ClassicScript, CSSModuleScript, JavaScriptModuleScript, JSONModuleScript, TextModuleScript,
  WebAssemblyModuleScript, JSScriptRecord, JSSourceTextModuleRecord, JSSyntheticModuleRecord,
  JSWebAssemblyModuleRecord,
} from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { CSSStyleSheetImpl } from '../../../src/stylelet/index';
import { serializeURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('create a classic script', () => {
  it('compiles without executing or creating global bindings', () => {
    const { env, baseURL, options } = fixture();
    const script = new ClassicScript('var creationSideEffect = 1; throw new Error("not yet");', env, baseURL, options);

    expect(script.record).toBeInstanceOf(JSScriptRecord);
    expect(script.record!.script).toBe(script);
    expect(script.record!.realm).toBe(env.realm);
    expect(script.record!.code).toBeDefined();
    expect(script.env).toBe(env);
    expect(script.baseURL).toBe(baseURL);
    expect(script.fetchOptions).toBe(options);
    expect(script.parseError).toBeNull();
    expect(script.errorToRethrow).toBeNull();
    expect(script.mutedErrors).toBe(false);
    expect(script.originalSourceURL).toBeNull();
    expect(Reflect.has(env.global, 'creationSideEffect')).toBe(false);
  });

  it.each(['let duplicate; let duplicate;', 'return 1;', 'export default 1;', 'const ='])('retains a realm-owned syntax error for %s', (source) => {
    const { env, baseURL, options } = fixture();
    const script = new ClassicScript(source, env, baseURL, options);
    expect(script.record).toBeNull();
    expect(script.parseError).toBeInstanceOf(env.realm.intrinsics.syntaxError);
    expect(script.errorToRethrow).toBe(script.parseError);
  });

  it('uses about:blank for muted errors while retaining the original request URL for timing', () => {
    const { env, baseURL, options } = fixture();
    const originalURL = env.parseURL('https://other.test/request.js')!;
    const script = new ClassicScript('', env, baseURL, options, true, originalURL);
    expect(serializeURL(script.baseURL!)).toBe('about:blank');
    expect(serializeURL(baseURL)).toBe('https://scripts.test/script.js');
    expect(script.originalSourceURL).toBe(originalURL);
    expect(script.mutedErrors).toBe(true);
  });

  it('parses empty source when scripting is disabled, unless explicitly bypassed', () => {
    const { env, baseURL, options } = fixture();
    env.userAgent.scriptingEnabled = false;
    const disabled = new ClassicScript('const =', env, baseURL, options);
    const bypassed = new ClassicScript('const =', env, baseURL, options, false, null, true);
    expect(disabled.record).toBeInstanceOf(JSScriptRecord);
    expect(disabled.parseError).toBeNull();
    expect(bypassed.record).toBeNull();
    expect(bypassed.parseError).toBeInstanceOf(env.realm.intrinsics.syntaxError);
  });

  it('takes the first parser error and does not absorb internal compiler failures', () => {
    const { env, baseURL, options } = fixture();
    const first = new env.realm.intrinsics.syntaxError('first');
    const second = new env.realm.intrinsics.syntaxError('second');
    const parse = vi.spyOn(env.realm, 'parseScript').mockReturnValue([first, second]);
    const script = new ClassicScript('', env, baseURL, options);
    expect(script.parseError).toBe(first);
    expect(script.errorToRethrow).toBe(first);
    const failure = new InternalError('compiler unavailable');
    parse.mockImplementation(() => { throw failure; });
    expect(() => new ClassicScript('', env, baseURL, options)).toThrow(failure);
  });
});

describe('create synthetic module scripts', () => {
  it('parses JSON with the target realm intrinsic despite author replacement', async () => {
    const { browser, env } = fixture();
    await browser.evaluate(() => { JSON.parse = () => { throw new Error('replaced'); }; });
    const script = new JSONModuleScript('{"items":[1]}', env);
    const value = script.record!.defaultExport as { items: number[]; };
    expect(Object.getPrototypeOf(value)).toBe(env.realm.intrinsics.objectPrototype);
    expect(Object.getPrototypeOf(value.items)).toBe(env.realm.intrinsics.array.prototype);
    expect(value.items[0]).toBe(1);
    expect(script.record).toBeInstanceOf(JSSyntheticModuleRecord);
    expect(script.record!.script).toBe(script);
    expect(script.record!.realm).toBe(env.realm);
    expect(script.baseURL).toBeNull();
    expect(script.fetchOptions).toBeNull();
    expect(script.parseError).toBeNull();
    expect(script.errorToRethrow).toBeNull();
  });

  it.each(['null', 'false', '17', '"text"'])('retains a primitive JSON default export from %s', (source) => {
    const { env } = fixture();
    const script = new JSONModuleScript(source, env);
    expect(script.record!.defaultExport).toEqual(JSON.parse(source));
    expect(script.parseError).toBeNull();
  });

  it('retains JSON parse failure without setting the later rethrow field', () => {
    const { env } = fixture();
    const script = new JSONModuleScript('{', env);
    expect(script.record).toBeNull();
    expect(script.parseError).toBeInstanceOf(env.realm.intrinsics.syntaxError);
    expect(script.errorToRethrow).toBeNull();
  });

  it('retains text verbatim, including newlines and a leading BOM', () => {
    const { env } = fixture();
    const text = '\uFEFFhello\r\n\0world';
    const script = new TextModuleScript(text, env);
    expect(script.record!.defaultExport).toBe(text);
    expect(script.baseURL).toBeNull();
    expect(script.fetchOptions).toBeNull();
    expect(script.parseError).toBeNull();
    expect(script.errorToRethrow).toBeNull();
  });

  it('constructs a CSS sheet without adopting it, discarding imports as replaceSync requires', () => {
    const { browser, env } = fixture();
    const script = new CSSModuleScript('@import "not-fetched.css"; div { color: red; }', env);
    const sheet = script.record!.defaultExport as CSSStyleSheetImpl;
    expect(sheet).toBeInstanceOf(CSSStyleSheetImpl);
    expect(sheet.cssRules.length).toBe(1);
    expect(sheet.cssRules.item(0)!.cssText).toBe('div { color: red; }');
    expect(sheet.isConstructedFor(env.getAssociatedDocument()!)).toBe(true);
    expect(browser.document.adoptedStyleSheets).toHaveLength(0);
    expect(sheet.ownerNode).toBeNull();
    expect(sheet.parentStyleSheet).toBeNull();
    expect(script.baseURL).toBeNull();
    expect(script.fetchOptions).toBeNull();
    expect(script.parseError).toBeNull();
  });

  it('retains a replacement exception, but propagates implementation failures', () => {
    const { env } = fixture();
    const failure = new env.exec.DOMException('replacement failed', 'NotAllowedError');
    const replace = vi.spyOn(CSSStyleSheetImpl.prototype, 'replaceSync').mockImplementation(() => { throw failure; });
    const script = new CSSModuleScript('', env);
    expect(script.record).toBeNull();
    expect(script.parseError).toBe(failure);
    expect(script.errorToRethrow).toBeNull();
    const internal = new InternalError('replacement implementation missing');
    replace.mockImplementation(() => { throw internal; });
    expect(() => new CSSModuleScript('', env)).toThrow(internal);
  });

  it('does not blank CSS, JSON, or text when scripting is disabled', () => {
    const { env } = fixture();
    env.userAgent.scriptingEnabled = false;
    expect(new JSONModuleScript('42', env).record!.defaultExport).toBe(42);
    expect(new TextModuleScript('kept', env).record!.defaultExport).toBe('kept');
    const css = new CSSModuleScript('div { color: red; }', env);
    expect((css.record!.defaultExport as CSSStyleSheetImpl).cssRules.length).toBe(1);
  });
});

// The parser operations below are the explicit unfinished dependencies. These tests
// cover HTML's preparation/error handling, not JavaScript or WebAssembly parsing.
describe('module parser handoffs', () => {
  it.each([true, false])('prepares source-text modules with scripting enabled = %s', (enabled) => {
    const { env, baseURL, options } = fixture();
    env.userAgent.scriptingEnabled = enabled;
    const parse = vi.spyOn(env.realm, 'parseModule').mockImplementation((_source, script) => {
      expect(script.baseURL).toBe(baseURL);
      expect(script.fetchOptions).toBe(options);
      return new JSSourceTextModuleRecord(script);
    });
    const script = new JavaScriptModuleScript('export default 1;', env, baseURL, options);
    expect(parse).toHaveBeenCalledExactlyOnceWith(enabled ? 'export default 1;' : '', script);
    expect(script.record!.script).toBe(script);
    expect(script.parseError).toBeNull();
    expect(script.errorToRethrow).toBeNull();
  });

  it('retains only the first module syntax error, leaving rethrow to graph loading', () => {
    const { env, baseURL, options } = fixture();
    const first = new env.realm.intrinsics.syntaxError('first');
    vi.spyOn(env.realm, 'parseModule').mockReturnValue([first, new env.realm.intrinsics.syntaxError('second')]);
    const script = new JavaScriptModuleScript('', env, baseURL, options);
    expect(script.record).toBeNull();
    expect(script.parseError).toBe(first);
    expect(script.errorToRethrow).toBeNull();
  });

  it.each([true, false])('prepares WebAssembly modules with scripting enabled = %s', (enabled) => {
    const { env, baseURL, options } = fixture();
    env.userAgent.scriptingEnabled = enabled;
    const bytes = new Uint8Array([10, 20, 30]);
    const parse = vi.spyOn(env.realm, 'parseWebAssemblyModule').mockImplementation((_bytes, script) => {
      expect(script.baseURL).toBe(baseURL);
      expect(script.fetchOptions).toBe(options);
      return new JSWebAssemblyModuleRecord(script);
    });
    const script = new WebAssemblyModuleScript(bytes, env, baseURL, options);
    expect(parse).toHaveBeenCalledExactlyOnceWith(enabled ? bytes : new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), script);
    if (enabled) expect(parse.mock.calls[0]![0]).toBe(bytes);
    expect(bytes).toEqual(new Uint8Array([10, 20, 30]));
    expect(script.record!.script).toBe(script);
    expect(script.parseError).toBeNull();
  });

  it('retains a WebAssembly parse exception without hiding a missing parser', () => {
    const { env, baseURL, options } = fixture();
    const failure = new env.realm.intrinsics.error('bad module');
    const parse = vi.spyOn(env.realm, 'parseWebAssemblyModule').mockImplementation(() => { throw failure; });
    const script = new WebAssemblyModuleScript(new Uint8Array(), env, baseURL, options);
    expect(script.record).toBeNull();
    expect(script.parseError).toBe(failure);
    expect(script.errorToRethrow).toBeNull();
    const internal = new InternalError('parser unavailable');
    parse.mockImplementation(() => { throw internal; });
    expect(() => new WebAssemblyModuleScript(new Uint8Array(), env, baseURL, options)).toThrow(internal);
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  return { browser, env, baseURL: env.parseURL('https://scripts.test/script.js')!, options: new ScriptFetchOptions() };
}
