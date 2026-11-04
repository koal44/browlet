import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchResponse } from '../../../../src/fetch/index';
import { parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

describe('navigation target snapshots', () => {
  it('captures an independent popup flag set and no iframe referrer policy', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const navigable = document.getNodeNavigable()!;
    const context = navigable.activeBrowsingContext!;
    context.popupSandboxingFlagSet.add('sandboxed-forms');

    const snapshot = navigable.snapshotTargetParams();
    context.popupSandboxingFlagSet.add('sandboxed-scripts');

    expect([...snapshot.sandboxingFlags]).toEqual(['sandboxed-forms']);
    expect(snapshot.sandboxingFlags).not.toBe(context.popupSandboxingFlagSet);
    expect(snapshot.iframeReferrerPolicy).toBe('');
  });

  it('retains target restrictions and referrer policy across changes before response preparation', () => {
    const { document, child, iframe } = fixture();
    document.setActiveSandboxingFlagSet(new SandboxingFlagSet(['sandboxed-forms']));
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    iframe.setAttribute('referrerpolicy', 'NO-REFERRER');
    const snapshot = child.snapshotTargetParams();

    iframe.removeAttribute('sandbox');
    iframe.setAttribute('referrerpolicy', 'unsafe-url');
    document.setActiveSandboxingFlagSet(new SandboxingFlagSet());
    const params = child.createNavigationParams(response(), snapshot);

    expect(params.finalSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-forms')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-scripts')).toBe(false);
    expect(params.iframeReferrerPolicy).toBe('no-referrer');
    expect(params.origin.kind).toBe('opaque');
    const next = child.snapshotTargetParams();
    expect(next.sandboxingFlags.size).toBe(0);
    expect(next.iframeReferrerPolicy).toBe('unsafe-url');
  });

  it('combines response CSP with a copy of the captured restrictions', () => {
    const { child } = fixture();
    const snapshot = child.snapshotTargetParams();
    const restricted = response();
    restricted.headerList.append('Content-Security-Policy', 'sandbox allow-same-origin allow-forms');

    const params = child.createNavigationParams(restricted, snapshot);
    expect(params.finalSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(params.finalSandboxingFlagSet).not.toBe(snapshot.sandboxingFlags);
    expect(snapshot.sandboxingFlags.size).toBe(0);
    const next = child.createNavigationParams(response(), snapshot);
    expect(next.finalSandboxingFlagSet.size).toBe(0);
    expect(next.finalSandboxingFlagSet).not.toBe(params.finalSandboxingFlagSet);
  });

  it('uses the embedding element\'s current node Document after adoption', () => {
    const { document, child, iframe } = fixture();
    const adopter = new Browlet({ route: () => '' });
    const adoptedDocument = unwrap<DocumentImpl>(adopter.document);
    document.setActiveSandboxingFlagSet(new SandboxingFlagSet(['sandboxed-forms']));
    adoptedDocument.setActiveSandboxingFlagSet(new SandboxingFlagSet(['sandboxed-downloads']));
    adopter.document.adoptNode(iframe);

    expect([...child.snapshotTargetParams().sandboxingFlags]).toEqual(['sandboxed-downloads']);
  });

  it('requires an active browsing context', () => {
    const { child } = fixture();
    child.activeDocument!.browsingContext = null;

    expect(() => child.snapshotTargetParams()).toThrow('Target snapshot requires an active browsing context');
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  const parent = document.getNodeNavigable()!;
  const [, childDocument] = BrowsingContext.create(null, null, parent.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(childDocument), parent);
  const iframe = browser.document.createElement('iframe');
  unwrap<HTMLIFrameElementImpl>(iframe).contentNavigable = child;
  return { document, child, iframe };
}

function response(): FetchResponse {
  const result = new FetchResponse();
  result.urlList.push(parseURL('https://child.test/').url!);
  return result;
}
