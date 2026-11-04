import { afterEach, describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { Browlet } from '../../../src/browlet/browlet';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/policy';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import type { HTMLElementImpl } from '../../../src/browlet/dom/nodes/html/index';
import type { HTMLFormElementImpl } from '../../../src/browlet/dom/nodes/html/forms/index';
import type { HTMLElement as PlatformElement } from '../../../src/browlet/platform';

afterEach(() => vi.restoreAllMocks());

describe('lazy inline element event handlers', () => {
  it('compiles parser-supplied source on first dispatch and preserves the author callback', async () => {
    const browser = new Browlet({
      route: () => '<div id="target" onclick="this.title = event.type; return false;"></div>', reporting: false,
    });
    await browser.navigate('https://example.test/page');
    const realm = getRelevantRealm(browser.window);
    const compile = vi.spyOn(realm, 'compileFunction');
    const report = vi.spyOn(realm.env, 'reportException');
    const result = await browser.evaluate(() => {
      const element = document.getElementById('target')!;
      const before = element.title;
      const event = new Event('click', { cancelable: true });
      const result = element.dispatchEvent(event);
      const callback = element.onclick!;
      return [before, element.title, result, event.defaultPrevented,
        callback === element.onclick, callback.name, callback.length,
        Object.getPrototypeOf(callback) === Function.prototype];
    });
    expect(report.mock.calls).toEqual([]);
    expect(result).toEqual(['', 'click', false, true, true, 'onclick', 1, true]);
    expect(compile).toHaveBeenCalledOnce();
  });

  itPassesWith('namedFunctionSource')('retains exact named source through the platform Document scope', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('onclick', 'return 5;');
      return Function.prototype.toString.call(element.onclick);
    })).toBe('function onclick(event) {\nreturn 5;\n}');
  });

  it('uses live element, Document, and global scopes in that order, including unscopables', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      Reflect.set(window, 'foo', 'global');
      Reflect.set(document, 'foo', 'document');
      Reflect.set(element, 'foo', 'element');
      element.setAttribute('onclick', 'this.title = foo;');
      const callback = element.onclick;
      const values: string[] = [];
      const invoke = () => { element.dispatchEvent(new Event('click')); values.push(element.title); };
      invoke();
      Reflect.set(element, 'foo', 'changed');
      invoke();
      Object.defineProperty(element, Symbol.unscopables, { value: { foo: true } });
      invoke();
      Reflect.deleteProperty(document, 'foo');
      invoke();
      return [values, callback === element.onclick];
    })).toEqual([['element', 'changed', 'document', 'global'], true]);
  });

  it('keeps the Document method receiver and observes handler removal without a self-name binding', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      Reflect.set(document, 'inspect', function(this: Document) { return this; });
      element.setAttribute('onclick', 'return [inspect() === document, onclick];');
      const retained = element.onclick!;
      element.onclick = null;
      return Reflect.apply(retained, element, [new Event('click')]) as unknown;
    })).toEqual([true, null]);
  });

  it('passes one Event to element onerror and uses ordinary false cancellation', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      element.setAttribute('onerror', 'this.title = event.message + arguments.length; return false;');
      const event = new ErrorEvent('error', { message: 'failure', cancelable: true });
      const result = element.dispatchEvent(event);
      return [element.title, element.onerror!.length, result, event.defaultPrevented];
    })).toEqual(['failure1', 1, false, true]);
  });

  it('keeps body onclick on the element while forwarding body onerror to Window', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      document.body.setAttribute('onclick', 'this.title = "element";');
      document.body.setAttribute('onerror', 'globalThis.result = event; return true;');
      const errorHandler = document.body.onerror;
      document.body.dispatchEvent(new Event('click'));
      dispatchEvent(new ErrorEvent('error', { message: 'window' }));
      return [document.body.title, onclick, errorHandler === onerror, errorHandler!.length,
        Reflect.get(window, 'result') as unknown];
    })).toEqual(['element', null, true, 5, 'window']);
  });

  it('retains raw source in a Document without a browsing context until adoption', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate(() => {
      const documentWithoutWindow = document.implementation.createHTMLDocument();
      const element = documentWithoutWindow.createElement('div');
      element.setAttribute('onclick', 'this.title = URL;');
      const initial = element.onclick;
      document.adoptNode(element);
      element.dispatchEvent(new Event('click'));
      return [initial, element.title];
    })).toEqual([null, 'https://example.test/page']);
  });

  it.each(['before', 'after'])('uses the current node Document when setting source %s adoption, then retains the compiled scope', async (when) => {
    const browser = await createBrowser();
    const sibling = createSibling(browser);
    const element = browser.window.document.createElement('div') as PlatformElement;
    const source = 'this.title = foo + ":" + (window.event === event);';
    Reflect.set(browser.window, 'foo', 5);
    Reflect.set(sibling.window, 'foo', 7);
    if (when === 'before') element.setAttribute('onclick', source);
    sibling.window.document.adoptNode(element);
    if (when === 'after') element.setAttribute('onclick', source);
    // Dispatch without first reading the getter: metadata must follow the future callback realm too.
    element.dispatchEvent(new sibling.window.Event('click'));
    expect(element.title).toBe('7:true');
    const callback = element.onclick;
    expect(Object.getPrototypeOf(callback)).toBe(getRelevantRealm(sibling.window).Function.prototype);
    browser.window.document.adoptNode(element);
    element.dispatchEvent(new browser.window.Event('click'));
    expect(element.title).toBe('7:true');
    expect(element.onclick).toBe(callback);
  });

  it('inserts the discovered form between Document and element without copying its properties', async () => {
    const browser = await createBrowser();
    const element = browser.window.document.createElement('button') as PlatformElement;
    const form = browser.window.document.createElement('form');
    // Supply only the unfinished §4.10.18.3 discovery result; scopes and invocation use real bindings.
    vi.spyOn(unwrap<HTMLElementImpl>(element), 'getFormOwner').mockReturnValue(unwrap<HTMLFormElementImpl>(form));
    Reflect.set(browser.window.document, 'foo', 'document');
    Reflect.set(form, 'foo', 'form');
    Reflect.set(element, 'foo', 'element');
    element.setAttribute('onclick', 'this.title = foo;');
    element.dispatchEvent(new browser.window.Event('click'));
    expect(element.title).toBe('element');
    Reflect.deleteProperty(element, 'foo');
    element.dispatchEvent(new browser.window.Event('click'));
    expect(element.title).toBe('form');
    Reflect.deleteProperty(form, 'foo');
    element.dispatchEvent(new browser.window.Event('click'));
    expect(element.title).toBe('document');
  });

  it('keeps the previous callback when CSP blocks replacement, and clears it on removal', async () => {
    const browser = await createBrowser();
    const element = browser.window.document.createElement('div') as PlatformElement;
    element.setAttribute('onclick', 'return false;');
    const callback = element.onclick;
    getRelevantRealm(browser.window).getAssociatedDocument().policyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse("script-src-attr 'none'", 'header', 'enforce'),
    );
    element.setAttribute('onclick', 'return true;');
    expect(element.onclick).toBe(callback);
    element.removeAttribute('onclick');
    expect(element.onclick).toBeNull();
  });

  it('leaves form-owner discovery explicit without preventing assigned callbacks', async () => {
    const browser = await createBrowser();
    const element = browser.window.document.createElement('button') as PlatformElement;
    element.setAttribute('onclick', 'return false;');
    // §4.10.18.3 is deliberately a stub: no ancestor-form guess or missing scope.
    expect(() => element.onclick).toThrow('Form-owner association is not implemented');
    const callback = vi.fn(() => false);
    element.onclick = callback;
    expect(element.dispatchEvent(new browser.window.Event('click', { cancelable: true }))).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/page');
  return browser;
}

function createSibling(browser: Browlet) {
  // Same-agent Window composition until auxiliary browsing-context creation is connected.
  const sourceEnv = getRelevantRealm(browser.window).env;
  const env = sourceEnv.userAgent.createWindowEnvironment({
    agent: sourceEnv.realm.agent, userAgent: sourceEnv.userAgent,
    creationURL: sourceEnv.creationURL, origin: sourceEnv.origin, parent: null,
    topLevelCreationURL: sourceEnv.creationURL, topLevelOrigin: sourceEnv.origin,
  });
  const document = env.createDocument();
  document.origin = sourceEnv.origin;
  document.initializeCSP();
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  new TopLevelTraversable(createDocumentState(document));
  return { window: env.realm.windowProxy.platform };
}
