import { assert, describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { unwrap } from '../../../support/browlet-binding';

describe('related navigable collections', () => {
  it('pairs parent and child links without deriving them from DOM order or connection', () => {
    const root = createRoot();
    const first = createChild(root.document, 'iframe');
    const second = createChild(root.document, 'object');
    const children = root.navigable.childNavigables;
    root.document.body!.insertBefore(second.container, first.container);

    expect([...children]).toEqual([first.navigable, second.navigable]);
    expect(root.document.getDocumentTreeChildNavigables()).toEqual([second.navigable, first.navigable]);
    first.navigable.parent = root.navigable;
    expect([...children]).toEqual([first.navigable, second.navigable]);
    first.navigable.parent = second.navigable;
    expect([...children]).toEqual([second.navigable]);
    expect([...second.navigable.childNavigables]).toEqual([first.navigable]);
    first.navigable.parent = null;
    expect([...second.navigable.childNavigables]).toEqual([]);
  });

  it('orders ancestors from the outermost parent and includes self only in the inclusive list', () => {
    const root = createRoot();
    const child = createChild(root.document, 'iframe');
    const grandchild = createChild(child.document, 'object');
    const leaf = createChild(grandchild.document, 'frame');

    expect(root.document.getAncestorNavigables()).toEqual([]);
    expect(root.document.getInclusiveAncestorNavigables()).toEqual([root.navigable]);
    expect(leaf.document.getAncestorNavigables()).toEqual([root.navigable, child.navigable, grandchild.navigable]);
    expect(leaf.document.getInclusiveAncestorNavigables())
      .toEqual([root.navigable, child.navigable, grandchild.navigable, leaf.navigable]);
  });

  it('collects parents before children through shadow trees and active child Documents', () => {
    const root = createRoot();
    root.document.body!.appendChild(root.document.createElement('iframe'));
    const first = createChild(root.document, 'iframe');
    const nested = createChild(first.document, 'object');
    const host = root.document.createElement('div');
    root.document.body!.appendChild(host);
    const shadow = host.attachShadow({
      mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const shadowChild = createChild(root.document, 'embed');
    shadow.appendChild(shadowChild.container);
    const shadowGrandchild = createChild(shadowChild.document, 'frame');
    const last = createChild(root.document, 'object');
    const descendants = [first.navigable, nested.navigable, shadowChild.navigable, shadowGrandchild.navigable, last.navigable];

    expect(root.document.getDescendantNavigables()).toEqual(descendants);
    expect(root.document.getInclusiveDescendantNavigables()).toEqual([root.navigable, ...descendants]);
    expect(root.document.getDocumentTreeChildNavigables()).toEqual([first.navigable, last.navigable]);
    expect(shadowChild.document.getAncestorNavigables()).toEqual([root.navigable]);
    expect(nested.document.getInclusiveDescendantNavigables()).toEqual([nested.navigable]);
  });

  it('returns fresh lists reflecting tree order, disconnection, and cleared associations', () => {
    const root = createRoot();
    const first = createChild(root.document, 'iframe');
    const second = createChild(root.document, 'embed');
    const children = root.document.getDocumentTreeChildNavigables();
    const descendants = root.document.getDescendantNavigables();
    root.document.body!.insertBefore(second.container, first.container);

    expect(root.document.getDocumentTreeChildNavigables()).toEqual([second.navigable, first.navigable]);
    expect(root.document.getDescendantNavigables()).toEqual([second.navigable, first.navigable]);
    root.document.body!.removeChild(first.container);
    expect(root.document.getDocumentTreeChildNavigables()).toEqual([second.navigable]);
    expect(root.document.getDescendantNavigables()).toEqual([second.navigable]);
    second.container.contentNavigable = null;
    expect(root.document.getDocumentTreeChildNavigables()).toEqual([]);
    expect(root.document.getInclusiveDescendantNavigables()).toEqual([root.navigable]);
    expect(children).toEqual([first.navigable, second.navigable]);
    expect(descendants).toEqual([first.navigable, second.navigable]);
  });

  it('retains ancestry and descendants when an ancestor Document is no longer active', async () => {
    const root = createRoot();
    const child = createChild(root.document, 'iframe');
    const grandchild = createChild(child.document, 'embed');

    await root.browser.navigate('https://example.test/replacement');

    expect(root.document.getNodeNavigable()).toBeNull();
    expect(child.document.isFullyActive()).toBe(false);
    expect(child.document.getNodeNavigable()).toBe(child.navigable);
    expect(child.document.getAncestorNavigables()).toEqual([root.navigable]);
    expect(child.document.getInclusiveAncestorNavigables()).toEqual([root.navigable, child.navigable]);
    expect(child.document.getInclusiveDescendantNavigables()).toEqual([child.navigable, grandchild.navigable]);
    expect(root.document.getDescendantNavigables()).toEqual([child.navigable, grandchild.navigable]);
    // Retained children remain discoverable independently of the parent's active Document.
    expect([...root.navigable.childNavigables]).toEqual([child.navigable]);
    expect(root.document.getDocumentTreeChildNavigables()).toEqual([]);
    expect(() => root.document.getAncestorNavigables()).toThrow('Ancestor collection requires a node navigable');
    expect(() => root.document.getInclusiveAncestorNavigables()).toThrow('Ancestor collection requires a node navigable');
    expect(() => root.document.getInclusiveDescendantNavigables()).toThrow('Inclusive descendant collection requires a node navigable');
  });

  it('follows the active child Document rather than an independently selected current entry', () => {
    const root = createRoot();
    const child = createChild(root.document, 'iframe');
    const previous = createChild(child.document, 'embed');
    const [, replacement] = BrowsingContext.createTopLevel(root.document.env.userAgent);
    child.navigable.currentSessionHistoryEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));

    expect(root.document.getDescendantNavigables()).toEqual([child.navigable, previous.navigable]);
    child.navigable.activeSessionHistoryEntry = child.navigable.currentSessionHistoryEntry;
    const next = createChild(replacement, 'object');

    expect(root.document.getInclusiveDescendantNavigables()).toEqual([root.navigable, child.navigable, next.navigable]);
    expect(child.document.getDescendantNavigables()).toEqual([previous.navigable]);
    expect(child.document.getDocumentTreeChildNavigables()).toEqual([]);
    expect(replacement.getInclusiveAncestorNavigables()).toEqual([root.navigable, child.navigable]);
  });

  it('requires a node navigable for ancestors and inclusive descendants, but not descendant-only collection', () => {
    const root = createRoot();
    const document = root.document.env.createDocument();

    expect(document.getNodeNavigable()).toBeNull();
    expect(document.getDescendantNavigables()).toEqual([]);
    expect(document.getDocumentTreeChildNavigables()).toEqual([]);
    expect(() => document.getAncestorNavigables()).toThrow('Ancestor collection requires a node navigable');
    expect(() => document.getInclusiveAncestorNavigables()).toThrow('Ancestor collection requires a node navigable');
    expect(() => document.getInclusiveDescendantNavigables()).toThrow('Inclusive descendant collection requires a node navigable');
  });
});

function createRoot() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  return { browser, document, navigable: document.getNodeNavigable()! };
}

function createChild(owner: DocumentImpl, tag: 'iframe' | 'object' | 'embed' | 'frame') {
  const container = owner.createElement(tag);
  assert(container.isNavigableContainer());
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  const navigable = new Navigable(DocumentState.create(document), owner.getNodeNavigable());
  // Supply the retained association while creator inheritance and child startup remain unfinished.
  container.contentNavigable = navigable;
  owner.body!.appendChild(container);
  return { container, document, navigable };
}
