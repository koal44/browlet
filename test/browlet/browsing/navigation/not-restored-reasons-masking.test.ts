import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NotRestoredReasonsImpl } from '../../../../src/browlet/browsing/navigation/diagnostics/index';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLIFrameElement, NotRestoredReasons } from '../../../../src/browlet/platform';
import { areSameOriginDomain, createOpaqueOrigin, obtainURLOrigin, parseURL, type TupleOrigin } from '../../../../src/url/index';
import { getBindingContext, project, unwrap } from '../../../support/browlet-binding';

describe('top-level restoration-diagnostic masking', () => {
  it('completes collection with empty lists when there are no descendants', () => {
    const { document, traversable } = fixture();
    expect(traversable.buildNotRestoredReasons()).toBeUndefined();
    expect(document.notRestoredReasons).toEqual({
      url: document.url, src: null, id: null, name: null, reasons: [], children: [],
    });
    expect(document.salvageable).toBe(true);
  });

  it('retains same-origin descendants and their own reasons without marking them masked', () => {
    const { document, traversable } = fixture();
    const current = child(document);
    current.document.makeUnsalvageable('fetch');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.reasons).toEqual([]);
    expect(document.notRestoredReasons!.children![0]).toMatchObject({
      url: current.document.url, reasons: [{ reason: 'fetch' }], children: [],
    });
    expect(document.salvageable).toBe(true);
  });

  it('hides foreign URL, reasons, and children even without a foreign blocker', () => {
    const { document, traversable } = fixture();
    const foreign = child(document, 'https://foreign.example/private');
    foreign.container.setAttribute('src', '/known-source');
    foreign.container.setAttribute('id', 'known-id');
    foreign.container.setAttribute('name', 'known-name');
    child(foreign.document, 'https://foreign.example/hidden');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.children![0]).toEqual({
      url: null, src: 'https://top.example/known-source', id: 'known-id', name: 'known-name', reasons: null, children: null,
    });
    expect(document.notRestoredReasons!.reasons).toEqual([]);
    expect(document.salvageable).toBe(true);
  });

  it('retains the masked reason in the root snapshot alongside existing reasons', () => {
    const { document, traversable } = fixture();
    document.makeUnsalvageable('navigation-failure');
    const foreign = child(document, 'https://foreign.example/private');
    foreign.document.makeUnsalvageable('fetch');
    foreign.document.makeUnsalvageable('websocket');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.reasons).toEqual([{ reason: 'navigation-failure' }, { reason: 'masked' }]);
    expect(document.notRestoredReasons!.reasons).toEqual([...document.bfcacheBlockingDetails]);
    expect(document.salvageable).toBe(false);
    expect(foreign.document.bfcacheBlockingDetails).toEqual(new Set([{ reason: 'fetch' }, { reason: 'websocket' }]));
    document.makeUnsalvageable('parser-aborted');
    expect(document.notRestoredReasons!.reasons).toHaveLength(2);
  });

  it('counts foreign grandchildren after their parent record loses its child list', () => {
    const { document, traversable } = fixture();
    const foreign = child(document, 'https://foreign.example/parent');
    const nested = child(foreign.document, 'https://third.example/private');
    nested.document.makeUnsalvageable('fetch');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.reasons).toEqual([{ reason: 'masked' }]);
    expect(foreign.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons)
      .toMatchObject({ url: null, reasons: null, children: null });
    expect(nested.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons)
      .toMatchObject({ url: null, reasons: null, children: null });
  });

  it('counts a same-origin blocker hidden behind a foreign ancestor', () => {
    const { document, traversable } = fixture();
    const foreign = child(document, 'https://foreign.example/parent');
    const nested = child(foreign.document, 'https://top.example/hidden');
    nested.container.setAttribute('id', 'secret-grandchild');
    nested.document.makeUnsalvageable('websocket');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.reasons).toEqual([{ reason: 'masked' }]);
    expect(document.salvageable).toBe(false);
    expect(document.notRestoredReasons!.children![0]!.children).toBeNull();
    // A same-origin descendant's own state is retained, but the foreign ancestor makes it unreachable from the exposed tree.
    expect(nested.navigable.activeSessionHistoryEntry.documentState.notRestoredReasons!.reasons)
      .toEqual([{ reason: 'websocket' }]);
    const exposed = expose(document);
    expect(exposed.children![0]!.children).toBeNull();
    expect(JSON.stringify(exposed)).not.toContain('secret-grandchild');
    expect(JSON.stringify(exposed)).not.toContain('websocket');
  });

  it('keeps a same-origin parent visible while masking its foreign child', () => {
    const { document, traversable } = fixture();
    const same = child(document);
    const foreign = child(same.document, 'https://foreign.example/private');
    foreign.document.makeUnsalvageable('fetch');
    traversable.buildNotRestoredReasons();
    const sameReasons = document.notRestoredReasons!.children![0]!;
    expect(sameReasons.url).toBe(same.document.url);
    expect(sameReasons.reasons).toEqual([]);
    expect(sameReasons.children![0]).toMatchObject({ url: null, reasons: null, children: null });
    expect(document.notRestoredReasons!.reasons).toEqual([{ reason: 'masked' }]);
  });

  it('compares Document origins rather than URL origins', () => {
    const { document, traversable } = fixture();
    const sandboxed = child(document);
    sandboxed.document.origin = createOpaqueOrigin();
    sandboxed.document.makeUnsalvageable('fetch');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.children![0]!.url).toBeNull();
    expect(document.notRestoredReasons!.reasons).toEqual([{ reason: 'masked' }]);
  });

  it('does not treat document.domain relaxation as same origin', () => {
    const { document, traversable } = fixture();
    const foreign = child(document, 'https://foreign.example/private');
    (document.origin as TupleOrigin).domain = { kind: 'domain', value: 'example' };
    (foreign.document.origin as TupleOrigin).domain = { kind: 'domain', value: 'example' };
    expect(areSameOriginDomain(document.origin, foreign.document.origin)).toBe(true);
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.children![0]!.url).toBeNull();
  });

  it.each(['open', 'closed'] as const)('collects and masks a foreign iframe in a shadow root with mode %s', (mode) => {
    const { browser, document, traversable } = fixture();
    const foreign = child(document, 'https://foreign.example/shadow');
    const host = browser.document.createElement('div');
    browser.document.body!.appendChild(host);
    host.attachShadow({ mode }).appendChild(project(foreign.container) as HTMLIFrameElement);
    foreign.document.makeUnsalvageable('fetch');
    traversable.buildNotRestoredReasons();
    expect(document.notRestoredReasons!.children).toHaveLength(1);
    expect(document.notRestoredReasons!.children![0]).toMatchObject({ url: null, reasons: null, children: null });
    expect(document.notRestoredReasons!.reasons).toEqual([{ reason: 'masked' }]);
  });

  it('stores only the active root history state and projects filtered frozen arrays', () => {
    const { document, traversable } = fixture();
    const foreign = child(document, 'https://foreign.example/private');
    foreign.document.makeUnsalvageable('fetch');
    const pending = DocumentState.create(document.env.createDocument());
    traversable.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, pending);
    traversable.buildNotRestoredReasons();
    expect(pending.notRestoredReasons).toBeNull();
    const value = expose(document);
    expect(value.reasons![0]!.reason).toBe('masked');
    expect(value.children![0]!.url).toBeNull();
    expect(value.children![0]!.reasons).toBeNull();
    expect(Object.isFrozen(value.children)).toBe(true);
    expect(Object.getPrototypeOf(value.children)).toBe(document.env.realm.Array.prototype);
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  document.url = parseURL('https://top.example/page').url!;
  document.origin = obtainURLOrigin(document.url);
  const traversable = document.getNodeNavigable() as TopLevelTraversable;
  return { browser, document, traversable };
}

/** Supply real child implementations without invoking unfinished element loading or BiDi hooks. */
function child(owner: DocumentImpl, url = 'https://top.example/child') {
  const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  document.url = parseURL(url).url!;
  document.origin = obtainURLOrigin(document.url);
  const navigable = new Navigable(DocumentState.create(document), owner.getNodeNavigable());
  container.contentNavigable = navigable;
  owner.body!.appendChild(container);
  return { container, document, navigable };
}

/** Exercise the real projection boundary with the completed, origin-filtered history record. */
function expose(document: DocumentImpl): NotRestoredReasons {
  const implementation = new NotRestoredReasonsImpl(document.notRestoredReasons!, document.env);
  return getBindingContext(document.env.realm).project(NotRestoredReasonsImpl, implementation) as NotRestoredReasons;
}
