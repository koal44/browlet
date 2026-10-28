import { assert, describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { ReferrerPolicy } from '../../../../src/fetch/index';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { areSameOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

describe('Document ancestor origins', () => {
  it('retains separate empty lists for documents without a container', () => {
    const first = createTestDocument();
    const second = createTestDocument(first.env);
    expect(first.internalAncestorOriginObjectsList).toBeNull();
    expect(first.ancestorOriginsList).toBeNull();

    first.initializeAncestry('no-referrer', null);
    second.initializeAncestry('', null);

    expect(first.containerDocument).toBeNull();
    expect(first.internalAncestorOriginObjectsList).toEqual([]);
    expect(first.internalAncestorOriginObjectsList).not.toBe(second.internalAncestorOriginObjectsList);
    expect(strings(first)).toEqual([]);
    expect(first.ancestorOriginsList).not.toBe(second.ancestorOriginsList);
  });

  it.each<ReferrerPolicy>([
    '', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
    'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
  ])('keeps nearest-first origins for policy %j', (policy) => {
    const top = topDocument();
    const parent = childDocument(top, 'https://b.example/path', '');
    const child = childDocument(parent, 'https://c.example/path', policy);

    expect(strings(child)).toEqual(['https://b.example', 'https://a.example']);
    expect(child.internalAncestorOriginObjectsList).toEqual([parent.origin, top.origin]);
    expect(parent.internalAncestorOriginObjectsList).toEqual([top.origin]);
  });

  it('masks an immediate same-origin parent and preserves that masking in descendants', () => {
    const top = topDocument();
    const child = childDocument(top, 'https://a.example/child', 'no-referrer');
    const grandchild = childDocument(child, 'https://b.example/grandchild', '');

    expect(strings(child)).toEqual(['null']);
    expect(strings(grandchild)).toEqual(['https://a.example', 'null']);
    expect(grandchild.internalAncestorOriginObjectsList![1]).toBe(child.internalAncestorOriginObjectsList![0]);
  });

  it('masks the entire consecutive same-origin run using distinct opaque origins', () => {
    const top = topDocument();
    const parent = childDocument(top, 'https://a.example/parent', '');
    const child = childDocument(parent, 'https://b.example/child', 'no-referrer');
    const [first, second] = child.internalAncestorOriginObjectsList!;

    expect(strings(parent)).toEqual(['https://a.example']);
    expect(strings(child)).toEqual(['null', 'null']);
    expect(areSameOrigin(first!, second!)).toBe(false);
    expect(areSameOrigin(first!, parent.origin)).toBe(false);
  });

  it.each(['', 'no-referrer'] as const)('does not resume masking after a different origin (outer policy %j)', (policy) => {
    const top = topDocument();
    const child = childDocument(top, 'https://b.example/child', policy);
    const grandchild = childDocument(child, 'https://a.example/grandchild', '');
    const greatGrandchild = childDocument(grandchild, 'https://c.example/end', 'no-referrer');

    expect(strings(greatGrandchild)).toEqual([
      'null', 'https://b.example', policy === '' ? 'https://a.example' : 'null',
    ]);
  });

  it('masks same-origin policy only when the child origin differs', () => {
    const top = topDocument();
    const same = childDocument(top, 'https://a.example/child', 'same-origin');
    const different = childDocument(top, 'https://a.example:8443/child', 'same-origin');

    expect(strings(same)).toEqual(['https://a.example']);
    expect(strings(different)).toEqual(['null']);
    // Legacy document.domain relaxation does not change this same-origin check.
    if (top.origin.kind !== 'tuple' || different.origin.kind !== 'tuple') throw new Error('Expected tuple origins');
    top.origin.domain = { kind: 'domain', value: 'example' };
    different.origin.domain = { kind: 'domain', value: 'example' };
    different.initializeAncestry('same-origin', top);
    expect(strings(different)).toEqual(['null']);
  });

  it('compares opaque origin identity and preserves an already opaque ancestor', () => {
    const top = topDocument();
    top.origin = createOpaqueOrigin();
    const same = childDocument(top, 'about:blank', '');
    same.origin = top.origin;
    same.initializeAncestry('same-origin', top);
    const different = childDocument(top, 'about:blank', 'same-origin');

    expect(same.internalAncestorOriginObjectsList![0]).toBe(top.origin);
    expect(areSameOrigin(different.internalAncestorOriginObjectsList![0]!, top.origin)).toBe(false);
    expect(strings(same)).toEqual(['null']);
    expect(strings(different)).toEqual(['null']);
  });

  it('keeps the created string snapshot after origins and the parent list change', () => {
    const top = topDocument();
    const parent = childDocument(top, 'https://b.example/parent', '');
    const child = childDocument(parent, 'https://c.example/child', '');
    const list = child.ancestorOriginsList;
    if (parent.origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    parent.origin.port = 8443;
    parent.internalAncestorOriginObjectsList!.splice(0);
    child.internalAncestorOriginObjectsList!.push(createOpaqueOrigin());

    expect(child.ancestorOriginsList).toBe(list);
    expect(strings(child)).toEqual(['https://b.example', 'https://a.example']);
  });

  it('uses the embedding element document rather than the parent navigable active document', () => {
    const original = topDocument();
    const child = childDocument(original, 'https://b.example/child', '');
    const replacement = createTestDocument(original.env);
    replacement.browsingContext = original.browsingContext;
    const parent = original.getNodeNavigable()!;
    parent.activeSessionHistoryEntry = {
      ...parent.activeSessionHistoryEntry, documentState: createDocumentState(replacement),
    };

    expect(child.containerDocument).toBe(original);
    expect(original.containerDocument).toBeNull();
    expect(strings(child)).toEqual(['https://a.example']);
  });

  it('initializes the new document from its destination container before activation', () => {
    const top = topDocument();
    const current = childDocument(top, 'https://b.example/current', '');
    const pending = createTestDocument(current.env);
    pending.browsingContext = current.browsingContext;
    const navigable = current.getNodeNavigable()!;

    expect(pending.getNodeNavigable()).toBeNull();
    pending.initializeAncestry('no-referrer', navigable.containerDocument);

    expect(strings(pending)).toEqual(['null']);
    expect(navigable.activeDocument).toBe(current);
    expect(pending.getNodeNavigable()).toBeNull();
    expect(strings(current)).toEqual(['https://a.example']);
  });

  it('initializes an initial child from its embedder before a navigable exists', () => {
    const parent = topDocument();
    const embedder = parent.createElementNode('iframe', HTML_NAMESPACE);
    parent.documentElement!.appendChild(embedder);
    const document = createTestDocument(parent.env);
    document.browsingContext = new BrowsingContext();
    document.origin = parent.origin;

    document.initializeAncestry('', embedder.nodeDocument);

    expect(strings(document)).toEqual(['https://a.example']);
    expect(document.internalAncestorOriginObjectsList![0]).toBe(parent.origin);
    expect(document.browsingContext.navigable).toBeNull();
    expect(document.getNodeNavigable()).toBeNull();
  });
});

function topDocument(): DocumentImpl {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.window.document);
  document.origin = obtainURLOrigin(parseURL('https://a.example/top').url!);
  return document;
}

function childDocument(parent: DocumentImpl, url: string, policy: ReferrerPolicy): DocumentImpl {
  const document = createTestDocument(parent.env);
  document.type = 'html';
  document.populateWithHTMLHeadBody();
  document.origin = obtainURLOrigin(parseURL(url).url!);
  document.browsingContext = new BrowsingContext();
  const navigable = new Navigable(createDocumentState(document), parent.getNodeNavigable());
  const container = parent.createElementNode('iframe', HTML_NAMESPACE);
  assert.instanceOf(container, HTMLIFrameElementImpl);
  parent.documentElement!.appendChild(container);
  container.contentNavigable = navigable;
  document.initializeAncestry(policy, navigable.containerDocument);
  return document;
}

function strings(document: DocumentImpl): (string | null)[] {
  const list = document.ancestorOriginsList!;
  return Array.from({ length: list.length }, (_, index) => list.item(index));
}
