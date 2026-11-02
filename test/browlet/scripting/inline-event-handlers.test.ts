import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/policy';
import type { HTMLBodyElement as PlatformBody } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('lazy inline Window event handlers', () => {
  it('retains handler attributes supplied by the HTML parser', async () => {
    const browser = new Browlet({ route: () => '<body onstorage="globalThis.result = 5;">', reporting: false });
    await browser.navigate('https://example.test/page');
    expect(await browser.evaluate(() => {
      dispatchEvent(new StorageEvent('storage'));
      return Reflect.get(window, 'result') as unknown;
    })).toBe(5);
  });

  it.each(['body', 'frameset'])('compiles a %s attribute once on first read, preserving callback identity and realm', async (tag) => {
    const browser = await createBrowser();
    const realm = getRelevantRealm(browser.window);
    const compile = vi.spyOn(realm, 'compileFunction');
    const element = browser.window.document.createElement(tag) as PlatformBody;
    element.setAttribute('onstorage', 'globalThis.seen = [this === window, event.type, window.event === event];');
    expect(compile).not.toHaveBeenCalled();
    expect(Reflect.get(browser.window, 'seen')).toBeUndefined();
    const callback = element.onstorage;
    expect(compile).toHaveBeenCalledOnce();
    expect(Object.getPrototypeOf(callback)).toBe(realm.Function.prototype);
    expect(callback?.name).toBe('onstorage');
    expect(callback?.length).toBe(1);
    expect(browser.window.onstorage).toBe(callback);
    expect(element.onstorage).toBe(callback);
    expect(compile).toHaveBeenCalledOnce();
    await browser.evaluate(() => { dispatchEvent(new StorageEvent('storage')); });
    expect(Reflect.get(browser.window, 'seen')).toEqual([true, 'storage', true]);
  });

  it('compiles on dispatch and uses Window scope, without the forwarding body scope', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      Reflect.set(window, 'foo', 5);
      Reflect.set(document.body, 'foo', 9);
      document.body.setAttribute('onstorage', 'globalThis.result = foo; return false;');
      const event = new StorageEvent('storage', { cancelable: true });
      const dispatched = dispatchEvent(event);
      return [Reflect.get(window, 'result') as unknown, dispatched, event.defaultPrevented];
    })).toEqual([5, false, true]);
  });

  it('reports a syntax error lazily once and preserves the listener position', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const trace: string[] = [];
      let errors = 0;
      let realmMatches = false;
      onerror = (_message, _source, _line, _column, error) => {
        errors++;
        realmMatches = error instanceof SyntaxError;
        return true;
      };
      addEventListener('storage', () => { trace.push('before'); });
      document.body.setAttribute('onstorage', 'return }');
      const beforeRead = errors;
      addEventListener('storage', () => { trace.push('after'); });
      const first = onstorage;
      const second = onstorage;
      onstorage = () => { trace.push('handler'); };
      dispatchEvent(new StorageEvent('storage'));
      return { beforeRead, errors, realmMatches, first, second, trace };
    })).toEqual({
      beforeRead: 0, errors: 1, realmMatches: true, first: null, second: null,
      trace: ['before', 'handler', 'after'],
    });
  });

  it('does not run a replacement installed while reporting the initial parse error', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      let calls = 0;
      onerror = () => { onstorage = () => { calls++; }; return true; };
      document.body.setAttribute('onstorage', '}');
      dispatchEvent(new StorageEvent('storage'));
      const first = calls;
      dispatchEvent(new StorageEvent('storage'));
      return [first, calls];
    })).toEqual([0, 1]);
  });

  it('replaces cached callbacks on attribute writes and deactivates on removal', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const body = document.body as HTMLBodyElement;
      body.setAttribute('onstorage', 'return false;');
      const first = body.onstorage;
      body.setAttribute('onstorage', 'return false;');
      const second = body.onstorage;
      body.setAttributeNS('urn:other', 'x:onstorage', '}');
      const namespaced = body.onstorage;
      body.removeAttribute('onstorage');
      const cleared = onstorage;
      return [first !== second, second === namespaced, cleared,
        dispatchEvent(new StorageEvent('storage', { cancelable: true }))];
    })).toEqual([true, true, null, true]);
  });

  it('keeps a blocked attribute in the DOM without replacing its previous handler', async () => {
    const browser = await createBrowser();
    const document = getRelevantRealm(browser.window).getAssociatedDocument();
    browser.window.document.body!.setAttribute('onstorage', 'return false;');
    const original = browser.window.onstorage;
    document.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("script-src-attr 'none'", 'header', 'enforce'));
    browser.window.document.body!.setAttribute('onstorage', 'return true;');
    expect(browser.window.document.body!.getAttribute('onstorage')).toBe('return true;');
    expect(browser.window.onstorage).toBe(original);
    browser.window.document.body!.removeAttribute('onstorage');
    expect(browser.window.onstorage).toBeNull();
  });

  it('allows report-only attributes and does not apply eval policy to host compilation', async () => {
    const browser = await createBrowser();
    const documentImpl = getRelevantRealm(browser.window).getAssociatedDocument();
    documentImpl.policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("script-src 'none'; script-src-attr 'unsafe-inline'", 'header', 'enforce'),
      ContentSecurityPolicy.parse("script-src-attr 'none'", 'header', 'report'),
    );
    expect(await browser.evaluate(() => {
      document.body.setAttribute('onstorage', 'globalThis.result = 5;');
      dispatchEvent(new StorageEvent('storage'));
      return Reflect.get(window, 'result') as unknown;
    })).toBe(5);
  });

  it('retains uncompiled source while sandboxing prevents compilation', async () => {
    const browser = await createBrowser();
    const realm = getRelevantRealm(browser.window);
    const document = realm.getAssociatedDocument();
    const compile = vi.spyOn(realm, 'compileFunction');
    browser.window.document.body!.setAttribute('onstorage', 'return false;');
    document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(browser.window.onstorage).toBeNull();
    expect(compile).not.toHaveBeenCalled();
    document.activeSandboxingFlagSet.delete('sandboxed-scripts');
    expect(typeof browser.window.onstorage).toBe('function');
    expect(compile).toHaveBeenCalledOnce();
  });

  it('checks the scripting gate before lazy compilation on dispatch', async () => {
    const browser = await createBrowser();
    const realm = getRelevantRealm(browser.window);
    const gate = vi.spyOn(realm.env.userAgent, 'webDriverBiDiScriptingIsEnabled').mockReturnValue(false);
    const compile = vi.spyOn(realm, 'compileFunction');
    browser.window.document.body!.setAttribute('onstorage', 'return }');
    browser.window.dispatchEvent(new browser.window.StorageEvent('storage'));
    expect(compile).not.toHaveBeenCalled();
    gate.mockRestore();
    browser.window.onerror = () => true;
    expect(browser.window.onstorage).toBeNull();
    expect(compile).toHaveBeenCalledOnce();
  });

  it('uses the document environment as callback context and restores it on invocation', async () => {
    const browser = await createBrowser();
    const realm = getRelevantRealm(browser.window);
    const capture = vi.spyOn(realm.callbacks, 'captureEnvironment');
    browser.window.document.body!.setAttribute('onstorage', 'return false;');
    const callback = browser.window.onstorage;
    expect(capture).not.toHaveBeenCalled();
    expect(callback).not.toBeNull();
    const prepare = vi.spyOn(realm.callbacks, 'prepareToRunCallback');
    browser.window.dispatchEvent(new browser.window.StorageEvent('storage'));
    expect(prepare).toHaveBeenCalledWith(realm.env);
  });

  it('creates the five-argument Window error handler from a body attribute', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      document.body.setAttribute('onerror',
        'globalThis.details = [event, source, lineno, colno, error, this === window]; return true;');
      const event = new ErrorEvent('error', {
        message: 'failure', filename: 'example.js', lineno: 2, colno: 3, error: 5, cancelable: true,
      });
      dispatchEvent(event);
      return [onerror!.length, Reflect.get(window, 'details') as unknown, event.defaultPrevented];
    })).toEqual([5, ['failure', 'example.js', 2, 3, 5, true], true]);
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/page');
  return browser;
}
