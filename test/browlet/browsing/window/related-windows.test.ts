/* eslint-disable @typescript-eslint/unbound-method -- Invoke retained IDL accessors with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl, HTMLObjectElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/legacy/frame';
import type { TupleOrigin } from '../../../../src/url/index';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

describe('Window related-window access', () => {
  it('returns the immediate parent and outermost WindowProxy', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document);
    const grandchild = createChild(child.document);

    expect(browser.window.parent).toBe(browser.window);
    expect(browser.window.top).toBe(browser.window);
    expect(child.proxy.parent).toBe(browser.window);
    expect(child.proxy.top).toBe(browser.window);
    expect(grandchild.proxy.parent).toBe(child.proxy);
    expect(grandchild.proxy.top).toBe(browser.window);
  });

  it('makes parent replaceable without resurrecting it after deletion', () => {
    const browser = new Browlet({ route: () => '' });
    const global = getRelevantRealm(browser.window).globalObject;
    const descriptor = Object.getOwnPropertyDescriptor(global, 'parent')!;
    expect(descriptor).toMatchObject({ configurable: true, enumerable: true });
    Reflect.set(global, 'parent', 'replacement');
    expect(Reflect.get(global, 'parent')).toBe('replacement');
    expect(Reflect.apply(descriptor.get!, global, [])).toBe(browser.window);
    expect(Reflect.deleteProperty(browser.window, 'parent')).toBe(true);
    expect(Reflect.has(browser.window, 'parent')).toBe(false);
    expect(Reflect.get(browser.window, 'parent')).toBeUndefined();
  });

  it('makes top unforgeable on the underlying Window', () => {
    const browser = new Browlet({ route: () => '' });
    const global = getRelevantRealm(browser.window).globalObject;
    expect(Object.getOwnPropertyDescriptor(global, 'top')).toMatchObject({
      set: undefined, configurable: false, enumerable: true,
    });
    expect(Reflect.deleteProperty(global, 'top')).toBe(false);
  });

  it('returns null for detached relationships while retaining the realm proxy aliases', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const window = browser.window;
    document.browsingContext = null;
    expect(window.top).toBeNull();
    expect(window.parent).toBeNull();
    expect(window.opener).toBeNull();
    expect(window.frameElement).toBeNull();
    expect(window.window).toBe(window);
  });

  it('distinguishes an inactive Window navigable from its retained browsing context', async () => {
    const browser = new Browlet({ route: () => '' });
    const opener = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const realm = getRelevantRealm(browser.window);
    realm.windowImplementation.browsingContext!.openerBrowsingContext = getRelevantRealm(opener.window).windowImplementation.browsingContext;
    const top = Object.getOwnPropertyDescriptor(realm.globalObject, 'top')!.get!;
    const parent = Object.getOwnPropertyDescriptor(realm.globalObject, 'parent')!.get!;
    const openerGetter = Object.getOwnPropertyDescriptor(realm.globalObject, 'opener')!.get!;
    await browser.navigate('https://example.test/second');

    expect(Reflect.apply(top, realm.globalObject, [])).toBeNull();
    expect(Reflect.apply(parent, realm.globalObject, [])).toBeNull();
    expect(Reflect.apply(openerGetter, realm.globalObject, [])).toBe(opener.window);
  });

  it('reads and disowns the opener through the browsing context', () => {
    const browser = new Browlet({ route: () => '' });
    const opener = new Browlet({ route: () => '' });
    const context = getRelevantRealm(browser.window).windowImplementation.browsingContext!;
    expect(browser.window.opener).toBeNull();
    context.openerBrowsingContext = getRelevantRealm(opener.window).windowImplementation.browsingContext;
    expect(browser.window.opener).toBe(opener.window);
    browser.window.opener = null;
    expect(browser.window.opener).toBeNull();
    expect(context.openerBrowsingContext).toBeNull();
    expect(Object.getOwnPropertyDescriptor(browser.window, 'opener')!.get).toBeTypeOf('function');
  });

  it.each([undefined, false, 0, '', { custom: true }])('replaces opener for the non-null value %j', (value) => {
    const browser = new Browlet({ route: () => '' });
    const opener = new Browlet({ route: () => '' });
    const context = getRelevantRealm(browser.window).windowImplementation.browsingContext!;
    const openerContext = getRelevantRealm(opener.window).windowImplementation.browsingContext!;
    context.openerBrowsingContext = openerContext;
    browser.window.opener = value;
    expect(Object.getOwnPropertyDescriptor(browser.window, 'opener')).toEqual({
      value, writable: true, enumerable: true, configurable: true,
    });
    expect(context.openerBrowsingContext).toBe(openerContext);
    browser.window.opener = null;
    expect(context.openerBrowsingContext).toBe(openerContext);
  });

  it('throws in the setter realm if opener cannot be replaced', () => {
    const browser = new Browlet({ route: () => '' });
    const global = getRelevantRealm(browser.window).globalObject;
    const setter = Object.getOwnPropertyDescriptor(global, 'opener')!.set!;
    Object.defineProperty(global, 'opener', { configurable: false });
    expect(() => Reflect.apply(setter, global, ['replacement'])).toThrow(getRelevantRealm(browser.window).TypeError);
    expect(() => Reflect.apply(setter, global, [null])).not.toThrow();
  });

  it('applies a borrowed opener setter to the receiver Window', () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    unwrap<DocumentImpl>(target.document).origin = unwrap<DocumentImpl>(caller.document).origin;
    const setter = Object.getOwnPropertyDescriptor(caller.window, 'opener')!.set!;
    const value = { retained: true };
    Reflect.apply(setter, target.window, [value]);
    expect(target.window.opener).toBe(value);
    expect(caller.window.opener).toBeNull();
  });

  it('allows borrowed related-window getters across origins, but protects their setters', () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    for (const name of ['top', 'parent', 'opener'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(caller.window, name)!;
      expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(name === 'opener' ? null : target.window);
      if (descriptor.set) expect(() => Reflect.apply(descriptor.set!, target.window, [null])).toThrow(caller.window.DOMException);
    }
  });

  it.each(['iframe', 'object', 'frame'] as const)('returns the %s container and observes association changes', (tag) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, tag);
    expect(browser.window.frameElement).toBeNull();
    expect(child.proxy.frameElement).toBe(project(child.container));
    expect(child.navigable.container).toBe(child.container);
    child.container.contentNavigable = null;
    expect(child.proxy.frameElement).toBeNull();
    expect(child.navigable.container).toBeNull();
  });

  it('checks the getter realm against the container document using same origin-domain', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const parentOrigin = tupleOrigin('parent.example.com');
    document.origin = parentOrigin;
    const child = createChild(document);
    const childOrigin = tupleOrigin('child.example.com');
    child.document.origin = childOrigin;
    expect(child.proxy.frameElement).toBeNull();
    const parentGetter = Object.getOwnPropertyDescriptor(browser.window, 'frameElement')!.get!;
    const childGetter = Object.getOwnPropertyDescriptor(child.proxy, 'frameElement')!.get!;
    expect(() => { Reflect.apply(parentGetter, child.proxy, []); }).toThrow(browser.window.DOMException);
    parentOrigin.domain = { kind: 'domain', value: 'example.com' };
    expect(child.proxy.frameElement).toBeNull();
    childOrigin.domain = { kind: 'domain', value: 'example.com' };
    expect(Reflect.apply(parentGetter, child.proxy, [])).toBe(project(child.container));
    expect(Reflect.apply(childGetter, child.proxy, [])).toBe(project(child.container));

    const grandchild = createChild(child.document);
    child.document.origin = tupleOrigin('other.test');
    // The receiver and getter realms still match, but this container's document does not.
    grandchild.document.origin = document.origin;
    expect(Reflect.apply(parentGetter, grandchild.proxy, [])).toBeNull();
  });

  it('keeps reverse associations unique when a content navigable moves or is replaced', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document);
    const second = createChild(document, 'object');
    first.container.contentNavigable = second.navigable;
    expect(first.navigable.container).toBeNull();
    expect(second.container.contentNavigable).toBeNull();
    expect(second.navigable.container).toBe(first.container);
    expect(second.proxy.frameElement).toBe(project(first.container));
  });

  it('uses the actual container document for full activity after the parent navigates', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const child = createChild(unwrap<DocumentImpl>(browser.document));
    expect(child.document.isFullyActive()).toBe(true);
    await browser.navigate('https://example.test/second');
    expect(child.document.isFullyActive()).toBe(false);
    expect(child.navigable.containerDocument).toBe(child.container.nodeDocument);
  });
});

function createChild(document: DocumentImpl, tag: 'iframe' | 'object' | 'frame' = 'iframe') {
  const container = document.createElement(tag) as HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLFrameElementImpl;
  const [context, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
  childDocument.origin = document.origin;
  const navigable = new Navigable(createDocumentState(childDocument), document.getNodeNavigable());
  container.contentNavigable = navigable;
  document.body!.appendChild(container);
  return { container, document: childDocument, navigable, proxy: context.windowProxy.platform };
}

function tupleOrigin(host: string): TupleOrigin {
  return { kind: 'tuple', scheme: 'https', host: { kind: 'domain', value: host }, port: null, domain: null };
}
