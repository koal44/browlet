/* eslint-disable @typescript-eslint/unbound-method -- Invoke retained IDL accessors with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { parseURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

const barNames = ['locationbar', 'menubar', 'personalbar', 'scrollbars', 'statusbar', 'toolbar'] as const;

describe('Historical Window interface APIs', () => {
  it('retains six distinct BarProp objects with realm-owned prototypes', () => {
    const browser = new Browlet({ route: () => '' });
    const bars = barNames.map((name) => browser.window[name]);
    expect(new Set(bars).size).toBe(6);
    for (const [index, name] of barNames.entries()) {
      expect(browser.window[name]).toBe(bars[index]);
      expect(bars[index]).toBeInstanceOf(browser.window.BarProp);
      expect(bars[index]!.visible).toBe(true);
    }
    const realm = getRelevantRealm(browser.window);
    const BarProp = browser.window.BarProp as unknown as new() => unknown;
    expect(() => { Reflect.construct(BarProp, []); }).toThrow(realm.TypeError);
  });

  it.each(barNames)('makes %s replaceable without replacing its retained object', (name) => {
    const browser = new Browlet({ route: () => '' });
    const global = getRelevantRealm(browser.window).globalObject;
    const original = browser.window[name];
    const descriptor = Object.getOwnPropertyDescriptor(global, name)!;
    expect(descriptor).toMatchObject({ configurable: true, enumerable: true });
    Reflect.set(global, name, 42);
    expect(Reflect.get(global, name)).toBe(42);
    expect(Reflect.apply(descriptor.get!, global, [])).toBe(original);
    Reflect.deleteProperty(global, name);
    expect(Reflect.has(global, name)).toBe(false);
  });

  it('uses the top-level popup state for every bar, including child Windows', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const context = document.browsingContext!;
    const container = document.createElement('iframe') as HTMLIFrameElementImpl;
    const [childContext, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
    container.contentNavigable = new Navigable(createDocumentState(childDocument), document.getNodeNavigable());
    document.body!.appendChild(container);
    const childWindow = childContext.windowProxy.platform;
    childContext.isPopup = true;
    for (const name of barNames) expect(childWindow[name].visible).toBe(true);
    context.isPopup = true;
    for (const name of barNames) {
      expect(browser.window[name].visible).toBe(false);
      expect(childWindow[name].visible).toBe(false);
    }
    context.isPopup = false;
    for (const name of barNames) expect(childWindow[name].visible).toBe(true);
  });

  it('returns true for retained bars after their Window loses its browsing context', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const bars = barNames.map((name) => browser.window[name]);
    document.browsingContext!.isPopup = true;
    expect(bars.every((bar) => !bar.visible)).toBe(true);
    document.browsingContext = null;
    expect(bars.every((bar) => bar.visible)).toBe(true);
  });

  it('leaves the null top-level context specification gap explicit', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const [context, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
    new Navigable(createDocumentState(childDocument), document.getNodeNavigable());
    // This child's container/creation lifecycle has not made it fully active.
    expect(context.topLevelBrowsingContext).toBeNull();
    expect(() => context.windowProxy.platform.menubar.visible).toThrow(
      'BarProp visibility with an inactive browsing context is unspecified',
    );
  });

  it('uses the receiver bar environment when its visible getter is borrowed', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    getRelevantRealm(second.window).windowImplementation.browsingContext!.isPopup = true;
    const getter = Object.getOwnPropertyDescriptor(first.window.BarProp.prototype, 'visible')!.get!;
    expect(Reflect.apply(getter, first.window.menubar, [])).toBe(true);
    expect(Reflect.apply(getter, second.window.menubar, [])).toBe(false);
    expect(() => { Reflect.apply(getter, {}, []); }).toThrow(getRelevantRealm(first.window).TypeError);
  });

  it('stores only the converted status string and protects Window bar and status access', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(browser.window.status).toBe('');
    expect(await browser.evaluate(() => {
      let conversions = 0;
      Reflect.set(window, 'status', { toString() { conversions++; return 'hello'; } });
      return { status, conversions };
    })).toEqual({ status: 'hello', conversions: 1 });
    Reflect.set(browser.window, 'status', null);
    expect(browser.window.status).toBe('null');
    const other = new Browlet({ route: () => '' });
    for (const name of [...barNames, 'status'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(browser.window, name)!;
      expect(() => { Reflect.apply(descriptor.get!, other.window, []); }).toThrow(browser.window.DOMException);
      expect(() => Reflect.apply(descriptor.set!, other.window, ['replacement'])).toThrow(browser.window.DOMException);
    }
  });

  it('retains bars and status when initial-about:blank navigation reuses its Window', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const bars = barNames.map((name) => browser.window[name]);
    browser.window.status = 'retained';
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(parseURL('about:blank?replacement').url!);
    params.origin = window.document.origin;
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    expect(document.getRelevantGlobalObject()).toBe(window);
    for (const [index, name] of barNames.entries()) expect(browser.window[name]).toBe(bars[index]);
    expect(browser.window.status).toBe('retained');
  });
});
