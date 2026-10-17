import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/element';
import type { FocusableArea } from '../../../../src/browlet/interaction/focus';
import { browletDOM } from '../../../../src/browlet/integration/dom';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('DocumentOrShadowRoot.activeElement', () => {
  it('declares a readonly getter on both includers', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      return [Document.prototype, ShadowRoot.prototype].map((prototype) => {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'activeElement');
        return [typeof descriptor?.get, typeof descriptor?.set, descriptor?.enumerable, descriptor?.configurable];
      });
    })).toEqual([
      ['function', 'undefined', true, true],
      ['function', 'undefined', true, true],
    ]);
  });

  it('uses body, frameset, document element, and null for a document anchor', async () => {
    const browser = new Browlet({ route: () => '' });
    const documentImpl = unwrap<DocumentImpl>(browser.window.document);
    supplyFocusedArea(documentImpl, documentImpl);

    expect(await browser.evaluate(() => {
      const body = document.activeElement === document.body;
      document.body.remove();
      const html = document.activeElement === document.documentElement;
      const frameset = document.createElement('frameset');
      document.documentElement.append(frameset);
      const frame = document.activeElement === frameset;
      document.documentElement.remove();
      return [body, html, frame, document.activeElement];
    })).toEqual([true, true, true, null]);
  });

  it('uses an XML document element without requiring a browsing context', () => {
    const browser = new Browlet({ route: () => '' });
    const xml = browser.window.document.implementation.createDocument('urn:test', 'root');
    const document = unwrap<DocumentImpl>(xml);
    supplyFocusedArea(document, document);

    expect(xml.activeElement).toBe(xml.documentElement);
    xml.documentElement!.remove();
    expect(xml.activeElement).toBeNull();
  });

  it('shares the focused anchor with implementation consumers and rejects a different tree', async () => {
    const browser = new Browlet({ route: () => '' });
    const documentImpl = unwrap<DocumentImpl>(browser.window.document);
    const target = browser.window.document.createElement('input');
    browser.window.document.body!.append(target);
    const targetImpl = unwrap<ElementImpl>(target);
    supplyFocusedArea(documentImpl, targetImpl);

    expect(browletDOM.activeElement(documentImpl)).toBe(targetImpl);
    expect(await browser.evaluate(() => {
      const target = document.getElementsByTagName('input')[0]!;
      const focused = document.activeElement === target;
      target.remove();
      return [focused, document.activeElement];
    })).toEqual([true, null]);
    // Removal focus-fixup is not implemented; the supplied area deliberately retains its detached anchor.
  });

  it('retargets through nested open and closed shadow roots without exposing unrelated focus', () => {
    const browser = new Browlet({ route: () => '' });
    const document = browser.window.document;
    const outerHost = document.createElement('div');
    document.body!.append(outerHost);
    const outerRoot = outerHost.attachShadow({ mode: 'open' });
    const innerHost = document.createElement('span');
    outerRoot.append(innerHost);
    const innerRoot = innerHost.attachShadow({ mode: 'closed' });
    const target = document.createElement('input');
    innerRoot.append(target);
    const otherHost = document.createElement('div');
    document.body!.append(otherHost);
    const otherRoot = otherHost.attachShadow({ mode: 'open' });
    supplyFocusedArea(unwrap<DocumentImpl>(document), unwrap<ElementImpl>(target));

    expect(document.activeElement).toBe(outerHost);
    expect(outerRoot.activeElement).toBe(innerHost);
    expect(innerRoot.activeElement).toBe(target);
    expect(otherRoot.activeElement).toBeNull();
  });

  it('returns null for a shadow root when the focused area is the document viewport', async () => {
    const browser = new Browlet({ route: () => '' });
    const documentImpl = unwrap<DocumentImpl>(browser.window.document);
    supplyFocusedArea(documentImpl, documentImpl);
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      document.body.append(host);
      return host.attachShadow({ mode: 'open' }).activeElement;
    })).toBeNull();
  });

  it('reads the current node document after a shadow host is adopted', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const host = first.window.document.createElement('div');
    first.window.document.body!.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const target = first.window.document.createElement('input');
    root.append(target);
    supplyFocusedArea(unwrap<DocumentImpl>(first.window.document), unwrap<ElementImpl>(target));
    const secondDocument = unwrap<DocumentImpl>(second.window.document);
    const secondArea = supplyFocusedArea(secondDocument, secondDocument);
    expect(root.activeElement).toBe(target);

    second.window.document.body!.append(second.window.document.adoptNode(host));
    expect(root.activeElement).toBeNull();
    secondArea.domAnchor = unwrap<ElementImpl>(target);
    expect(root.activeElement).toBe(target);
    expect(second.window.document.activeElement).toBe(host);
  });

  it('uses the receiver document and preserves its element identity when the getter is borrowed', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const document = second.window.document;
    const target = document.createElement('input');
    document.body!.append(target);
    supplyFocusedArea(unwrap<DocumentImpl>(document), unwrap<ElementImpl>(target));
    const descriptor = Object.getOwnPropertyDescriptor(first.window.Document.prototype, 'activeElement')!;

    expect(descriptor.get!.call(document)).toBe(target);
    expect(target).toBeInstanceOf(second.window.HTMLInputElement);
    expect(target).not.toBeInstanceOf(first.window.HTMLInputElement);
  });
});

/** Supply only the missing focus-state dependency; DOM algorithms and platform bindings remain real. */
function supplyFocusedArea(document: DocumentImpl, domAnchor: DocumentImpl | ElementImpl): FocusableArea {
  const area: FocusableArea = { domAnchor };
  vi.spyOn(document, 'focusedArea', 'get').mockReturnValue(area);
  return area;
}
