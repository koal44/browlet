import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type NavigableContainer } from '../../../../src/browlet/browsing/navigation/navigable';
import { NotRestoredReasonsImpl } from '../../../../src/browlet/browsing/navigation/diagnostics/index';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElement, NotRestoredReasons } from '../../../../src/browlet/platform';
import { getEncoding } from '../../../../src/encoding/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { getBindingContext, project, unwrap } from '../../../support/browlet-binding';

describe('Document restoration-diagnostic collection', () => {
  it('stores the top-level URL, null container fields, and empty lists', () => {
    const { document } = fixture();
    expect(document.buildNotRestoredReasonsForDocumentState()).toBeUndefined();
    expect(document.notRestoredReasons).toEqual({
      src: null, id: null, name: null, url: document.url, reasons: [], children: [],
    });
    expect(document.notRestoredReasons!.url).toBe(document.url);
    expect(document.salvageable).toBe(true);
  });

  it('clones blocking-detail membership without cloning the details', () => {
    const { document } = fixture();
    document.makeUnsalvageable('fetch');
    document.makeUnsalvageable('parser-aborted');
    const details = [...document.bfcacheBlockingDetails];
    document.buildNotRestoredReasonsForDocumentState();
    const collected = document.notRestoredReasons!;
    expect(collected.reasons).toEqual(details);
    expect(collected.reasons![0]).toBe(details[0]);
    document.makeUnsalvageable('websocket');
    expect(collected.reasons).toHaveLength(2);
    expect(document.salvageable).toBe(false);
  });

  it('collects children recursively in document tree order, retaining their history records', () => {
    const { document } = fixture();
    const first = child(document);
    const second = child(document);
    const nested = child(first.document);
    document.body!.insertBefore(second.container, first.container);
    second.document.makeUnsalvageable('fetch');
    nested.document.makeUnsalvageable('parser-aborted');

    document.buildNotRestoredReasonsForDocumentState();
    const children = document.notRestoredReasons!.children!;
    expect(children).toHaveLength(2);
    expect(children[0]).toBe(second.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons);
    expect(children[1]).toBe(first.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons);
    expect(children[0]!.reasons).toEqual([{ reason: 'fetch' }]);
    expect(children[1]!.children![0]).toBe(nested.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons);
    expect(children[1]!.children![0]!.reasons).toEqual([{ reason: 'parser-aborted' }]);
    // The top-level-only Document accessor is deliberately not used for recursive collection.
    expect(first.document.notRestoredReasons).toBeNull();
    expect(nested.document.notRestoredReasons).toBeNull();
  });

  it('uses active Documents and active history state, not the pending traversal entry', () => {
    const { document } = fixture();
    const current = child(document);
    const active = current.navigable.activeSessionHistoryEntry.documentState;
    const pending = DocumentState.create(document.env.createDocument());
    current.navigable.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, pending);
    document.buildNotRestoredReasonsForDocumentState();
    expect(active.notRestoredReasons).not.toBeNull();
    expect(active.notRestoredReasons!.url).toBe(current.document.url);
    expect(pending.notRestoredReasons).toBeNull();
    expect(document.notRestoredReasons!.children![0]).toBe(active.notRestoredReasons);
  });

  it('rebuilds records without changing an earlier collected tree', () => {
    const { document } = fixture();
    const current = child(document);
    document.buildNotRestoredReasonsForDocumentState();
    const previous = document.notRestoredReasons!;
    current.container.setAttribute('id', 'later');
    current.document.url = parseURL('https://example.test/later').url!;
    current.document.makeUnsalvageable('fetch');
    document.buildNotRestoredReasonsForDocumentState();
    expect(document.notRestoredReasons).not.toBe(previous);
    expect(previous.children![0]!.id).toBe('');
    expect(serializeURL(previous.children![0]!.url!)).toBe('about:blank');
    expect(previous.children![0]!.reasons).toEqual([]);
    expect(document.notRestoredReasons!.children![0]!.id).toBe('later');
    expect(document.notRestoredReasons!.children![0]!.reasons).toEqual([{ reason: 'fetch' }]);
  });

  it.each([
    [null, ''], ['', 'https://example.test/owner/page'],
    ['../child?q=é', 'https://example.test/child?q=%C3%A9'], ['http://[invalid', 'http://[invalid'],
    ['http://[\uD800', 'http://[\uFFFD'],
  ])('collects iframe src %j using HTML parsing and scalar-string rules', (src, expected) => {
    const { document } = fixture();
    const current = child(document);
    if (src !== null) current.container.setAttribute('src', src);
    current.document.buildNotRestoredReasonsForDocumentState();
    expect(current.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons!.src).toBe(expected);
  });

  it('parses iframe src against its container Document base and encoding', () => {
    const { document } = fixture();
    const base = document.createElement('base');
    base.setAttribute('href', 'https://example.test/resources/');
    document.head!.appendChild(base);
    document.encoding = getEncoding('windows-1252')!;
    const current = child(document);
    current.document.url = parseURL('https://other.test/child/').url!;
    current.container.setAttribute('src', 'target?q=é');
    current.document.buildNotRestoredReasonsForDocumentState();
    expect(current.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons!.src)
      .toBe('https://example.test/resources/target?q=%E9');
  });

  it('uses empty missing iframe metadata and preserves DOMString id/name text', () => {
    const { document } = fixture();
    const current = child(document);
    current.document.buildNotRestoredReasonsForDocumentState();
    expect(current.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons)
      .toMatchObject({ src: '', id: '', name: '' });
    current.container.setAttribute('id', '\uD800');
    current.container.setAttribute('name', 'child-name');
    current.document.buildNotRestoredReasonsForDocumentState();
    expect(current.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons)
      .toMatchObject({ id: '\uD800', name: 'child-name' });
  });

  it('includes shadow-tree containers but excludes containers with no child navigable', () => {
    const { browser, document } = fixture();
    const current = child(document);
    const host = browser.document.createElement('div');
    browser.document.body!.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.appendChild(project(current.container) as HTMLIFrameElement);
    document.body!.appendChild(document.createElement('iframe'));
    // Window's light-tree child lookup keeps its separate specified behavior.
    expect(document.getDocumentTreeChildNavigables()).toEqual([]);
    document.buildNotRestoredReasonsForDocumentState();
    expect(document.notRestoredReasons!.children).toHaveLength(1);
    expect(current.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons).not.toBeNull();
    expect(document.notRestoredReasons!.children![0]).toBe(current.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons);
  });

  it.each(['object', 'embed', 'frame'] as const)('keeps %s container metadata null while collecting its Document', (tag) => {
    const { document } = fixture();
    const current = child(document, tag);
    current.container.setAttribute('id', 'other-container');
    current.container.setAttribute('name', 'other-name');
    current.container.setAttribute('src', '/other');
    document.buildNotRestoredReasonsForDocumentState();
    expect(document.notRestoredReasons!.children![0]).toEqual({
      src: null, id: null, name: null, url: current.document.url, reasons: [], children: [],
    });
  });

  it('collects foreign descendants without prematurely masking or projecting their records', () => {
    const { document } = fixture();
    const current = child(document);
    current.document.url = parseURL('https://foreign.test/child').url!;
    current.document.origin = obtainURLOrigin(current.document.url);
    current.document.makeUnsalvageable('fetch');
    document.buildNotRestoredReasonsForDocumentState();
    expect(document.notRestoredReasons!.children![0]).toMatchObject({
      url: current.document.url, reasons: [{ reason: 'fetch' }], children: [],
    });
  });

  it('projects a collected same-origin tree with the existing realm-owned frozen arrays', () => {
    const { document } = fixture();
    const current = child(document);
    current.document.makeUnsalvageable('fetch');
    document.buildNotRestoredReasonsForDocumentState();
    // Collection is internal; production projection still requires the top-level privacy step.
    const implementation = new NotRestoredReasonsImpl(document.notRestoredReasons!, document.env);
    const value = getBindingContext(document.env.realm).project(NotRestoredReasonsImpl, implementation) as NotRestoredReasons;
    expect(Object.getPrototypeOf(value.children)).toBe(document.env.realm.Array.prototype);
    expect(Object.isFrozen(value.children)).toBe(true);
    expect(value.children).toBe(value.children);
    expect(value.children![0]!.reasons![0]!.reason).toBe('fetch');
    expect(Object.isFrozen(value.children![0]!.reasons)).toBe(true);
    expect(Object.isFrozen(value.children![0]!.children)).toBe(true);
  });

  it('requires an active owning navigable rather than overwriting another Document state', () => {
    const { document } = fixture();
    const detached = document.env.createDocument();
    expect(() => detached.buildNotRestoredReasonsForDocumentState())
      .toThrow('Restoration-diagnostic collection requires a node navigable');
    expect(document.notRestoredReasons).toBeNull();
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  document.url = parseURL('https://example.test/owner/page').url!;
  document.origin = obtainURLOrigin(document.url);
  return { browser, document };
}

/** Supply retained child relationships without exercising unfinished element loading or BiDi hooks. */
function child(owner: DocumentImpl, tag: 'iframe' | 'object' | 'embed' | 'frame' = 'iframe') {
  const container = owner.createElement(tag) as NavigableContainer;
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  document.origin = owner.origin;
  const navigable = new Navigable(DocumentState.create(document), owner.getNodeNavigable());
  container.contentNavigable = navigable;
  owner.body!.appendChild(container);
  return { container, document, navigable };
}
