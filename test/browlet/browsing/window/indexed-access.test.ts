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
    expect(browser.window[0]?.[0]).toBe(grandchild.navigable.activeWindowProxy.platform);
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

describe('WindowProxy indexed reads', () => {
  it.each(['iframe', 'object', 'frame'] as const)('exposes the active %s child as an indexed own property', async (tag) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, tag);
    document.body!.appendChild(child.container);
    const proxy = child.navigable.activeWindowProxy.platform;

    expect(browser.window[0]).toBe(proxy);
    expect(browser.window.frames[0]).toBe(proxy);
    expect(browser.window[1]).toBeUndefined();
    expect(Reflect.getOwnPropertyDescriptor(browser.window, '0')).toEqual({
      value: proxy, writable: false, enumerable: true, configurable: true,
    });
    expect(Reflect.has(browser.window, '0')).toBe(true);
    expect(await browser.evaluate(() => [
      '0' in window,
      Object.hasOwn(window, '0'),
      window[0] === Object.getOwnPropertyDescriptor(window, '0')!.value,
    ])).toEqual([true, true, true]);
  });

  it('uses insertion order rather than current document tree order', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'object');
    const third = createChild(document, 'frame');
    document.body!.appendChild(first.container);
    document.body!.insertBefore(second.container, first.container);
    document.body!.insertBefore(third.container, second.container);

    expect(document.getDocumentTreeChildNavigables()).toEqual([third.navigable, second.navigable, first.navigable]);
    for (const [index, child] of [first, second, third].entries()) {
      expect(browser.window[index]).toBe(child.navigable.activeWindowProxy.platform);
    }
  });

  it('records a detached subtree when it enters the document, in subtree order', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'iframe');
    const existing = createChild(document, 'iframe');
    const section = document.createElement('section');
    section.appendChild(first.container);
    section.insertBefore(second.container, first.container);
    document.body!.appendChild(existing.container);
    document.body!.insertBefore(section, existing.container);

    for (const [index, child] of [existing, second, first].entries()) {
      expect(Reflect.get(browser.window, String(index))).toBe(child.navigable.activeWindowProxy.platform);
    }
  });

  it('retains order through a state-preserving move and refreshes it on reinsertion', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'iframe');
    document.body!.append(first.container, second.container);
    document.body!.moveBefore(second.container, first.container);

    expect(Reflect.get(browser.window, '0')).toBe(first.navigable.activeWindowProxy.platform);
    expect(Reflect.get(browser.window, '1')).toBe(second.navigable.activeWindowProxy.platform);
    document.body!.insertBefore(first.container, second.container);
    expect(Reflect.get(browser.window, '0')).toBe(second.navigable.activeWindowProxy.platform);
    expect(Reflect.get(browser.window, '1')).toBe(first.navigable.activeWindowProxy.platform);
  });

  it('records insertion before child creation and keeps order when the child association changes', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'iframe');
    const replacement = createChild(document, 'iframe');
    first.container.contentNavigable = null;
    document.body!.append(first.container, second.container);
    first.container.contentNavigable = first.navigable;

    expect(Reflect.get(browser.window, '0')).toBe(first.navigable.activeWindowProxy.platform);
    first.container.contentNavigable = replacement.navigable;
    expect(Reflect.get(browser.window, '0')).toBe(replacement.navigable.activeWindowProxy.platform);
    expect(Reflect.get(browser.window, '1')).toBe(second.navigable.activeWindowProxy.platform);
  });

  it('filters disconnected containers, absent children, and shadow trees on each read', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'iframe');
    const third = createChild(document, 'iframe');
    const shadowChild = createChild(document, 'iframe');
    const host = document.createElement('div');
    document.body!.appendChild(host);
    host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    }).appendChild(shadowChild.container);
    document.body!.append(first.container, second.container, third.container);

    expect(Reflect.get(browser.window, '0')).toBe(first.navigable.activeWindowProxy.platform);
    first.container.contentNavigable = null;
    expect(Reflect.get(browser.window, '0')).toBe(second.navigable.activeWindowProxy.platform);
    document.body!.removeChild(second.container);
    expect(browser.window.length).toBe(1);
    expect(Reflect.get(browser.window, '0')).toBe(third.navigable.activeWindowProxy.platform);
  });

  it('allows a valid index read from a different-origin caller', async () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(target.document);
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    // The initial Documents have distinct opaque origins and agents.
    Reflect.set(caller.window, 'foreignWindow', target.window);
    Reflect.set(caller.window, 'expectedChild', child.navigable.activeWindowProxy.platform);

    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as Window;
      const expectedChild: unknown = Reflect.get(window, 'expectedChild');
      const descriptor = Reflect.getOwnPropertyDescriptor(foreign, '0');
      return [foreign[0] === expectedChild, descriptor?.value === expectedChild, '0' in foreign];
    })).toEqual([true, true, true]);
  });

  it('leaves non-index property names and symbols on the ordinary path', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    for (const property of ['00', '-0', '0.0', '4294967295', Symbol('0')]) {
      Reflect.defineProperty(browser.window, property, { value: 'ordinary', configurable: true });
      expect(Reflect.get(browser.window, property)).toBe('ordinary');
      expect(Reflect.getOwnPropertyDescriptor(browser.window, property)!.value).toBe('ordinary');
    }
  });

  it('looks up children in the new associated Document after navigation', async () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const oldDocument = unwrap<DocumentImpl>(browser.document);
    const oldChild = createChild(oldDocument, 'iframe');
    oldDocument.body!.appendChild(oldChild.container);
    expect(proxy[0]).toBe(oldChild.navigable.activeWindowProxy.platform);

    await browser.navigate('https://example.test/next');
    const newDocument = unwrap<DocumentImpl>(browser.document);
    const newChild = createChild(newDocument, 'iframe');
    newDocument.body!.appendChild(newChild.container);
    expect(browser.window).toBe(proxy);
    expect(proxy[0]).toBe(newChild.navigable.activeWindowProxy.platform);
    expect(proxy[0] === oldChild.navigable.activeWindowProxy.platform).toBe(false);
  });
});

describe('WindowProxy child-index enumeration', () => {
  it('prefixes child indices before ordinary string and symbol keys', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    for (const property of ['00', '-0', '0.0', '4294967295', Symbol('index-like')]) {
      Reflect.defineProperty(browser.window, property, { value: 'ordinary', configurable: true });
    }
    Reflect.defineProperty(browser.window, 'enumerationProbe', {
      get() { throw new Error('Enumeration must not invoke getters'); },
      enumerable: true, configurable: true,
    });
    const ordinaryKeys = Reflect.ownKeys(browser.window);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'object');
    document.body!.appendChild(first.container);
    document.body!.insertBefore(second.container, first.container);

    const keys = Reflect.ownKeys(browser.window);
    expect(keys.slice(0, 2)).toEqual(['0', '1']);
    expect(keys.slice(2)).toEqual(ordinaryKeys);
    expect(await browser.evaluate(() => [
      Object.keys(window).slice(0, 2),
      Object.getOwnPropertyNames(window).slice(0, 2),
      Reflect.ownKeys(window).slice(0, 2),
    ])).toEqual([['0', '1'], ['0', '1'], ['0', '1']]);
  });

  it('recomputes the dense index prefix as child associations and connections change', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const ordinaryKeys = Reflect.ownKeys(browser.window);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'object');
    const third = createChild(document, 'frame');
    document.body!.append(first.container, second.container, third.container);
    Reflect.defineProperty(browser.window, 'length', {
      get() { throw new Error('Enumeration must count the actual child navigables'); },
      configurable: true,
    });

    expect(Reflect.ownKeys(browser.window).slice(0, 3)).toEqual(['0', '1', '2']);
    document.body!.removeChild(second.container);
    expect(Reflect.ownKeys(browser.window)).toEqual(['0', '1', ...ordinaryKeys]);
    first.container.contentNavigable = null;
    expect(Reflect.ownKeys(browser.window)).toEqual(['0', ...ordinaryKeys]);
    third.container.contentNavigable = null;
    expect(Reflect.ownKeys(browser.window)).toEqual(ordinaryKeys);
    first.container.contentNavigable = first.navigable;
    expect(Reflect.ownKeys(browser.window)).toEqual(['0', ...ordinaryKeys]);
  });

  it('includes the same index prefix for a foreign caller', async () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(target.document);
    const first = createChild(document, 'iframe');
    const second = createChild(document, 'frame');
    document.body!.append(first.container, second.container);
    Reflect.set(caller.window, 'foreignWindow', target.window);

    // Only the origin-independent prefix is covered; filtering the remaining keys is unfinished.
    expect(await caller.evaluate(() => {
      const foreign = Reflect.get(window, 'foreignWindow') as object;
      return Reflect.ownKeys(foreign).slice(0, 2);
    })).toEqual(['0', '1']);
  });

  it('enumerates the replacement Document after navigation preserves the proxy', async () => {
    const browser = new Browlet({ route: () => '' });
    const proxy = browser.window;
    const oldDocument = unwrap<DocumentImpl>(browser.document);
    oldDocument.body!.append(
      createChild(oldDocument, 'iframe').container,
      createChild(oldDocument, 'iframe').container,
    );
    expect(Reflect.ownKeys(proxy).slice(0, 2)).toEqual(['0', '1']);

    await browser.navigate('https://example.test/next');
    const ordinaryKeys = Reflect.ownKeys(proxy);
    expect(ordinaryKeys).not.toContain('0');
    const newDocument = unwrap<DocumentImpl>(browser.document);
    newDocument.body!.appendChild(createChild(newDocument, 'object').container);
    expect(browser.window).toBe(proxy);
    expect(Reflect.ownKeys(proxy)).toEqual(['0', ...ordinaryKeys]);
  });

  it('does not duplicate an index already present on the stock Window target', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    // The unfinished define/set traps and direct stock-VM global can still leave ordinary indices.
    Reflect.defineProperty(getRelevantRealm(browser.window).globalObject, '0', {
      value: 'ordinary target value', configurable: true,
    });
    document.body!.append(
      createChild(document, 'iframe').container,
      createChild(document, 'iframe').container,
    );

    const keys = Reflect.ownKeys(browser.window);
    expect(keys.slice(0, 2)).toEqual(['0', '1']);
    expect(keys.filter((key) => key === '0')).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Reflect.get(browser.window, '0')).toBe(document.getIndexedChildNavigable(0)!.activeWindowProxy.platform);
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
