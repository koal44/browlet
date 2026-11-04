import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext, DocumentState, Navigable } from '../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLObjectElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/object';
import type { HTMLFrameElementImpl } from '../../../src/browlet/dom/nodes/html/legacy/frame';
import { createOpaqueOrigin } from '../../../src/url/index';
import { unwrap } from '../../support/browlet-binding';

describe('Transient activation consumption', () => {
  it('consumes every active Window in the top-level tree while preserving never-activated and history timestamps', async () => {
    const { document, window } = await fixture();
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    const neverActivated = createChild(child.document, 'object');
    child.document.body!.appendChild(neverActivated.container);
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const shadowChild = createChild(document, 'frame');
    shadow.appendChild(shadowChild.container);
    const detached = createChild(document, 'iframe');
    const other = await fixture();
    window.lastActivationTimestamp = 12;
    window.lastHistoryActionActivationTimestamp = 7;
    child.window.lastActivationTimestamp = 5;
    child.document.origin = createOpaqueOrigin();
    shadowChild.window.lastActivationTimestamp = -Infinity;
    detached.window.lastActivationTimestamp = 20;
    other.window.lastActivationTimestamp = 30;

    child.window.consumeUserActivation();

    expect(window.lastActivationTimestamp).toBe(-Infinity);
    expect(child.window.lastActivationTimestamp).toBe(-Infinity);
    expect(shadowChild.window.lastActivationTimestamp).toBe(-Infinity);
    expect(neverActivated.window.lastActivationTimestamp).toBe(Infinity);
    expect(window.lastHistoryActionActivationTimestamp).toBe(7);
    expect(child.window.lastHistoryActionActivationTimestamp).toBe(Infinity);
    expect(detached.window.lastActivationTimestamp).toBe(20);
    expect(other.window.lastActivationTimestamp).toBe(30);
  });

  it('does not consume a retained Window after replacement removes its navigable', async () => {
    const { browser, window } = await fixture();
    window.lastActivationTimestamp = 12;
    await browser.navigate('https://example.test/replacement');

    window.consumeUserActivation();

    expect(window.lastActivationTimestamp).toBe(12);
    expect(unwrap<DocumentImpl>(browser.document).getRelevantGlobalObject()!.lastActivationTimestamp).toBe(Infinity);
  });
});

describe('History-action activation', () => {
  it('starts unavailable, compares retained timestamps, and consumes independently of transient activation', async () => {
    const { window } = await fixture();
    expect(window.lastActivationTimestamp).toBe(Infinity);
    expect(window.lastHistoryActionActivationTimestamp).toBe(Infinity);
    expect(window.hasHistoryActionActivation()).toBe(false);
    window.lastActivationTimestamp = 10;
    expect(window.hasHistoryActionActivation()).toBe(true);
    window.consumeHistoryActionUserActivation();
    expect(window.hasHistoryActionActivation()).toBe(false);
    expect(window.lastActivationTimestamp).toBe(10);
    expect(window.lastHistoryActionActivationTimestamp).toBe(10);
    window.lastActivationTimestamp = 20;
    expect(window.hasHistoryActionActivation()).toBe(true);
    // The timestamp producer and transient duration/expiry are separate unfinished §6.4 work.
    expect(() => window.hasTransientActivation()).toThrow('Window transient activation is not implemented');
  });

  it('consumes across nested, cross-origin, and shadow-tree navigables in the same top-level traversable', async () => {
    const { document, window, navigable } = await fixture();
    const first = createChild(document, 'iframe');
    document.body!.appendChild(first.container);
    const nested = createChild(first.document, 'object');
    first.document.body!.appendChild(nested.container);
    nested.document.origin = createOpaqueOrigin();
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false });
    const shadowChild = createChild(document, 'frame');
    shadow.appendChild(shadowChild.container);
    const detached = createChild(document, 'iframe');
    document.body!.appendChild(document.createElement('iframe'));
    const other = await fixture();
    const included = [window, first.window, nested.window, shadowChild.window];
    for (const [index, owner] of [...included, detached.window, other.window].entries()) owner.lastActivationTimestamp = index + 1;
    expect(document.getDescendantNavigables()).toEqual([first.navigable, nested.navigable, shadowChild.navigable]);
    expect(document.getDocumentTreeChildNavigables()).toEqual([first.navigable]);
    expect(nested.navigable.topLevelTraversable).toBe(navigable);
    nested.window.consumeHistoryActionUserActivation();
    expect(included.map((owner) => owner.hasHistoryActionActivation())).toEqual([false, false, false, false]);
    expect(included.map((owner) => owner.lastActivationTimestamp)).toEqual([1, 2, 3, 4]);
    expect(detached.window.hasHistoryActionActivation()).toBe(true);
    expect(other.window.hasHistoryActionActivation()).toBe(true);
  });

  it('consumes parents before their descendants', async () => {
    const { document, window } = await fixture();
    const child = createChild(document, 'iframe');
    document.body!.appendChild(child.container);
    const grandchild = createChild(child.document, 'object');
    child.document.body!.appendChild(grandchild.container);
    const visited: string[] = [];
    for (const [name, owner] of [['top', window], ['child', child.window], ['grandchild', grandchild.window]] as const) {
      Object.defineProperty(owner, 'lastActivationTimestamp', {
        get() { visited.push(name); return 1; },
      });
    }

    window.consumeHistoryActionUserActivation();

    expect(visited).toEqual(['top', 'child', 'grandchild']);
  });

  it('retains activation when an old Window no longer has a navigable', async () => {
    const { browser, window } = await fixture();
    window.lastActivationTimestamp = 10;
    await browser.navigate('https://example.test/replacement');
    expect(window.navigable).toBeNull();
    window.consumeHistoryActionUserActivation();
    expect(window.hasHistoryActionActivation()).toBe(true);
    expect(window.lastHistoryActionActivationTimestamp).toBe(Infinity);
    expect(unwrap<DocumentImpl>(browser.document).getRelevantGlobalObject()!.hasHistoryActionActivation()).toBe(false);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  return { browser, document, window: document.getRelevantGlobalObject()!, navigable: document.getNodeNavigable()! };
}

function createChild(document: DocumentImpl, tag: 'iframe' | 'object' | 'frame') {
  const container = document.createElement(tag) as HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLFrameElementImpl;
  const [, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
  const navigable = new Navigable(DocumentState.create(childDocument), document.getNodeNavigable());
  // Child navigation/startup is unfinished; provide the association used by the actual descendant traversal.
  container.contentNavigable = navigable;
  return { container, document: childDocument, navigable, window: childDocument.getRelevantGlobalObject()! };
}
