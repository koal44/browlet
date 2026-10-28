/* eslint-disable @typescript-eslint/unbound-method -- Invoke retained IDL accessors with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl, HTMLObjectElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/legacy/frame';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('Window indexed-access foundations', () => {
  it('reports zero before any child navigables exist', () => {
    const browser = new Browlet({ route: () => '' });
    browser.document.body!.appendChild(browser.document.createElement('iframe'));
    expect(Reflect.get(browser.window, 'length')).toBe(0);
  });

  it('collects live iframe, object, and legacy frame navigables in document tree order', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'object');
    const third = createChild(document, 'frame');
    const section = document.createElement('section');
    document.body!.appendChild(section);
    section.appendChild(second.container);
    section.appendChild(first.container);
    document.body!.appendChild(third.container);

    expect(document.getDocumentTreeChildNavigables()).toEqual([second.navigable, first.navigable, third.navigable]);
    expect(browser.window.length).toBe(3);
    section.appendChild(second.container);
    expect(document.getDocumentTreeChildNavigables()).toEqual([first.navigable, second.navigable, third.navigable]);
    first.container.contentNavigable = null;
    expect(browser.window.length).toBe(2);
    document.body!.removeChild(third.container);
    expect(document.getDocumentTreeChildNavigables()).toEqual([second.navigable]);
    expect(browser.window.length).toBe(1);
  });

  it('excludes shadow trees and child Documents from the parent Document list', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, 'iframe');
    const shadowChild = createChild(document, 'iframe');
    const host = document.createElement('div');
    document.body!.appendChild(host);
    host.appendChild(child.container);
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    shadow.appendChild(shadowChild.container);
    const grandchild = createChild(child.document, 'iframe');
    child.document.body!.appendChild(grandchild.container);

    expect(document.getDocumentTreeChildNavigables()).toEqual([child.navigable]);
    expect(browser.window.length).toBe(1);
    expect(child.document.getDocumentTreeChildNavigables()).toEqual([grandchild.navigable]);
  });

  it('returns no children for a Document without a node navigable', () => {
    const browser = new Browlet({ route: () => '' });
    const window = browser.window;
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    expect(window.length).toBe(1);
    document.browsingContext = null;
    expect(document.getDocumentTreeChildNavigables()).toEqual([]);
    expect(window.length).toBe(0);
  });

  it('keeps a retained length getter tied to its inactive Window Document', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const previousRealm = getRelevantRealm(browser.window);
    const document = previousRealm.windowImplementation.document;
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    const getter = Object.getOwnPropertyDescriptor(previousRealm.globalObject, 'length')!.get!;
    expect(Reflect.apply(getter, previousRealm.globalObject, [])).toBe(1);

    await browser.navigate('https://example.test/second');

    expect(document.browsingContext).not.toBeNull();
    expect(document.getDocumentTreeChildNavigables()).toEqual([]);
    expect(Reflect.apply(getter, previousRealm.globalObject, [])).toBe(0);
    expect(browser.window.length).toBe(0);
  });

  it('exposes length as a replaceable accessor without replacing its underlying calculation', () => {
    const browser = new Browlet({ route: () => '' });
    const descriptor = Object.getOwnPropertyDescriptor(browser.window, 'length')!;
    expect(descriptor).toMatchObject({ configurable: true, enumerable: true });
    expect(typeof descriptor.get).toBe('function');
    expect(typeof descriptor.set).toBe('function');
    Reflect.set(browser.window, 'length', 'replacement');
    expect(Reflect.get(browser.window, 'length')).toBe('replacement');
    expect(Reflect.apply(descriptor.get!, browser.window, [])).toBe(0);
    Reflect.deleteProperty(browser.window, 'length');
    expect(Reflect.has(browser.window, 'length')).toBe(false);
  });

  it('permits cross-origin length reads through the binding but rejects replacement', () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(target.document);
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    const descriptor = Object.getOwnPropertyDescriptor(caller.window, 'length')!;

    expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(1);
    expect(() => { Reflect.apply(descriptor.set!, target.window, [9]); }).toThrow(caller.window.DOMException);
    expect(target.window.length).toBe(1);
  });
});

function createChild(document: DocumentImpl, localName: 'iframe' | 'object' | 'frame') {
  const container = document.createElement(localName) as HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLFrameElementImpl;
  const [, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
  const navigable = new Navigable(createDocumentState(childDocument), document.getNodeNavigable());
  // Child creation is unfinished; connect real implementations at the retained association.
  container.contentNavigable = navigable;
  return { container, navigable, document: childDocument };
}
