import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { PageEvaluation } from '../../../src/browlet/automation/index';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { Navigable } from '../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import type { EventTargetImpl } from '../../../src/browlet/dom/events/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe.each(['body', 'frameset'] as const)('HTML %s event-handler targets', (tag) => {
  it('aliases the Window handler even when detached, preserving identity and listener order', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate((tag: 'body' | 'frameset') => {
      const element = tag === 'body' ? document.createElement('body') : document.createElement('frameset');
      const trace: string[] = [];
      const initial = element.onstorage;
      const first = () => { trace.push('first'); };
      const replacement = function(this: WindowEventHandlers, event: StorageEvent) {
        trace.push(this === window && event.currentTarget === window ? 'replacement' : 'wrong target');
        return false;
      };
      addEventListener('storage', () => { trace.push('before'); });
      element.onstorage = first;
      const aliasesWindow = window.onstorage === first;
      addEventListener('storage', () => { trace.push('after'); });
      window.onstorage = replacement;
      const aliasesElement = element.onstorage === replacement;
      element.dispatchEvent(new StorageEvent('storage'));
      const dispatchResult = dispatchEvent(new StorageEvent('storage', { cancelable: true }));
      element.onstorage = null;
      dispatchEvent(new StorageEvent('storage'));
      return {
        initial, connected: element.isConnected, aliasesWindow, aliasesElement, dispatchResult, trace,
        cleared: Reflect.get(window, 'onstorage') === null,
      };
    }, tag)).toEqual({
      initial: null, connected: false, aliasesWindow: true, aliasesElement: true, dispatchResult: false,
      trace: ['before', 'replacement', 'after', 'before', 'after'], cleared: true,
    });
  });

  it('ignores assignment in a Document without a browsing context, including later adoption', async () => {
    const browser = await createBrowser();
    expect(await browser.evaluate((tag: 'body' | 'frameset') => {
      const inactive = document.implementation.createHTMLDocument();
      const element = tag === 'body' ? inactive.createElement('body') : inactive.createElement('frameset');
      const callback = () => {};
      element.onstorage = callback;
      const inactiveValue = Reflect.get(element, 'onstorage') === null;
      document.adoptNode(element);
      const adoptedValue = Reflect.get(element, 'onstorage') === null;
      window.onstorage = callback;
      const activeAlias = element.onstorage === callback;
      inactive.adoptNode(element);
      element.onstorage = null;
      return {
        inactiveValue, adoptedValue, activeAlias, inactiveAgain: Reflect.get(element, 'onstorage') === null,
        windowUnchanged: window.onstorage === callback,
      };
    }, tag)).toEqual({
      inactiveValue: true, adoptedValue: true, activeAlias: true, inactiveAgain: true, windowUnchanged: true,
    });
  });

  it('resolves the current Document after adoption and through borrowed accessors', async () => {
    const browser = await createBrowser();
    const sibling = createSibling(browser);
    const element = browser.window.document.createElement(tag);
    const original = () => {};
    const replacement = () => {};
    Reflect.set(element, 'onstorage', original);
    sibling.window.document.adoptNode(element);
    expect(browser.window.onstorage).toBe(original);
    expect(Reflect.get(element, 'onstorage')).toBeNull();

    const prototype = tag === 'body' ? sibling.window.HTMLBodyElement.prototype : sibling.window.HTMLFrameSetElement.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow the accessors with an explicit receiver below.
    const { get, set } = Object.getOwnPropertyDescriptor(prototype, 'onstorage')!;
    Reflect.apply(set!, element, [replacement]);
    expect(Reflect.apply(get!, element, [])).toBe(replacement);
    expect(sibling.window.onstorage).toBe(replacement);
    expect(browser.window.onstorage).toBe(original);
    browser.window.document.adoptNode(element);
    expect(Reflect.get(element, 'onstorage')).toBe(original);
    expect(sibling.window.onstorage).toBe(replacement);
  });

  it('stops forwarding when navigation makes the owning Document inactive', async () => {
    const browser = await createBrowser();
    const element = browser.window.document.createElement(tag);
    const oldDocument = element.ownerDocument;
    const callback = () => {};
    Reflect.set(element, 'onstorage', callback);
    await browser.navigate('https://example.test/next');
    expect(browser.window.document).not.toBe(oldDocument);
    expect(Reflect.get(element, 'onstorage')).toBeNull();
    const replacement = () => {};
    browser.window.onstorage = replacement;
    Reflect.set(element, 'onstorage', null);
    expect(browser.window.onstorage).toBe(replacement);
  });

  it('keeps Window handlers when erasing the element and clears aliases when erasing the Window', async () => {
    const browser = await createBrowser();
    const element = browser.window.document.createElement(tag);
    const callback = vi.fn();
    const listener = vi.fn();
    Reflect.set(element, 'onstorage', callback);
    element.addEventListener('storage', listener);
    const implementation = unwrap<EventTargetImpl>(element);
    implementation.eraseAllEventListenersAndHandlers();

    expect(Reflect.get(element, 'onstorage')).toBe(callback);
    element.dispatchEvent(new browser.window.StorageEvent('storage'));
    browser.window.dispatchEvent(new browser.window.StorageEvent('storage'));
    expect(callback).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    getRelevantRealm(browser.window).env.window.eraseAllEventListenersAndHandlers();
    expect(Reflect.get(element, 'onstorage')).toBeNull();
  });

  it('uses active Document state rather than requiring the Document to be fully active', async () => {
    const browser = await createBrowser();
    const parentDocument = getRelevantRealm(browser.window).env.window.document;
    const [childContext, childDocument] = BrowsingContext.createTopLevel(parentDocument.env.userAgent);
    const container = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
    parentDocument.body!.appendChild(container);
    container.contentNavigable = new Navigable(DocumentState.create(childDocument), parentDocument.getNodeNavigable());
    const parentContext = parentDocument.browsingContext;
    parentDocument.browsingContext = null;
    try {
      expect(childDocument.getNodeNavigable()).not.toBeNull();
      expect(childDocument.isFullyActive()).toBe(false);
      const window = childContext.windowProxy.platform;
      const element = window.document.createElement(tag);
      const callback = () => {};
      Reflect.set(element, 'onstorage', callback);
      expect(window.onstorage).toBe(callback);
      expect(Reflect.get(element, 'onstorage')).toBe(callback);
    } finally {
      parentDocument.browsingContext = parentContext;
    }
  });

  it('keeps non-forwarding names on the element and leaves other targets unchanged', async () => {
    const browser = await createBrowser();
    const document = getRelevantRealm(browser.window).env.window.document;
    const element = document.createElement(tag);
    const other = document.createElement('div');
    // Window-reflecting names forward; ordinary names retain their original target.
    expect(element.getEventHandlerTarget('onclick')).toBe(element);
    expect(element.getEventHandlerTarget('onerror')).toBe(document.getRelevantGlobalObject());
    expect(other.getEventHandlerTarget('onstorage')).toBe(other);
    expect(document.getEventHandlerTarget('onstorage')).toBe(document);
    expect(document.getRelevantGlobalObject()!.getEventHandlerTarget('onstorage')).toBe(document.getRelevantGlobalObject());
    expect('onstorage' in browser.window.document.createElement('div')).toBe(false);
  });

  it('checks scripting policy on the actual Window target after adoption', async () => {
    const browser = await createBrowser();
    const sibling = createSibling(browser);
    const element = browser.window.document.createElement(tag);
    sibling.window.document.adoptNode(element);
    await sibling.evaluation.evaluate(() => {
      Reflect.set(globalThis, 'handler', () => false);
    });
    Reflect.set(element, 'onstorage', Reflect.get(sibling.window, 'handler'));
    const targetEnv = getRelevantRealm(sibling.window).env;
    const policy = vi.spyOn(targetEnv.userAgent, 'webDriverBiDiScriptingIsEnabled')
      .mockImplementation((env) => env !== targetEnv);
    expect(sibling.window.dispatchEvent(new sibling.window.StorageEvent('storage', { cancelable: true }))).toBe(true);
    expect(policy).toHaveBeenCalledExactlyOnceWith(targetEnv);
    policy.mockReturnValue(true);
    expect(sibling.window.dispatchEvent(new sibling.window.StorageEvent('storage', { cancelable: true }))).toBe(false);
  });
});

async function createBrowser() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://example.test/');
  return browser;
}

function createSibling(browser: Browlet) {
  // Compose same-agent Window bindings until auxiliary browsing-context creation is implemented.
  const sourceEnv = getRelevantRealm(browser.window).env;
  const env = sourceEnv.userAgent.createWindowEnvironment({
    agent: sourceEnv.realm.agent, userAgent: sourceEnv.userAgent,
    creationURL: sourceEnv.creationURL, origin: sourceEnv.origin, parent: null,
    topLevelCreationURL: sourceEnv.creationURL, topLevelOrigin: sourceEnv.origin,
  });
  const document = env.createDocument();
  document.origin = sourceEnv.origin;
  document.browsingContext = new BrowsingContext(env.realm.windowProxy);
  env.window.setAssociatedDocument(document);
  document.makeActive();
  const traversable = new TopLevelTraversable(DocumentState.create(document));
  return { window: env.realm.windowProxy.platform, evaluation: new PageEvaluation(traversable) };
}
