import { describe, expect, it } from 'vitest';

import { createDocument, getRelevantRealm } from '../../../src/browlet/bindings';
import { BrowsingContext } from '../../../src/browlet/browsing/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/session-history';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import type { WindowProxy } from '../../../src/browlet/browsing/window/window-proxy';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { createWindowEnvironment } from '../../../src/browlet/scripting/window-environment';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';

describe('Window environment cross-site ancestry', () => {
  it('has no cross-site ancestor in a top-level window', () => {
    const top = createEnvironment('https://example.com/');
    expect(top.settings.hasCrossSiteAncestor).toBe(false);
  });

  it('compares sites rather than origins for a child window', () => {
    const top = createEnvironment('https://a.example.com/');
    const child = createEnvironment('https://b.example.com:8443/', top.navigable);
    expect(child.settings.hasCrossSiteAncestor).toBe(false);
  });

  it.each(['https://other.test/', 'http://a.example.com/'])(
    'recognizes a cross-site parent for %s', (url) => {
      const top = createEnvironment('https://a.example.com/');
      const child = createEnvironment(url, top.navigable);
      expect(child.settings.hasCrossSiteAncestor).toBe(true);
    },
  );

  it('checks intermediate ancestors even when the top and child have the same site', () => {
    const top = createEnvironment('https://a.example.com/');
    const middle = createEnvironment('https://other.test/', top.navigable);
    const child = createEnvironment('https://b.example.com/', middle.navigable);
    expect(child.settings.hasCrossSiteAncestor).toBe(true);
  });

  it('reads the live ancestor chain rather than retaining the first answer', () => {
    const top = createEnvironment('https://a.example.com/');
    const middle = createEnvironment('https://a.example.com/', top.navigable);
    const child = createEnvironment('https://b.example.com/', middle.navigable);
    expect(child.settings.hasCrossSiteAncestor).toBe(false);

    middle.document.setOrigin(obtainURLOrigin(parseURL('https://other.test/').url!));
    expect(child.settings.hasCrossSiteAncestor).toBe(true);
  });

  it('does not grant same-site cookie access to a Document without a current navigable', () => {
    const top = createEnvironment('https://example.com/');
    top.document.setBrowsingContext(null);
    expect(top.settings.hasCrossSiteAncestor).toBe(true);
  });
});

describe('Fetch cookies through Window settings', () => {
  it('uses the real ancestor query and the user agent\'s shared cookie store', () => {
    const top = createEnvironment('https://a.example.com/');
    const sameSite = createEnvironment('https://b.example.com/', top.navigable);
    const middle = createEnvironment('https://other.test/', top.navigable);
    const crossSite = createEnvironment('https://b.example.com/', middle.navigable);
    const url = parseURL('https://a.example.com/').url!;
    const userAgent = top.settings.userAgent;
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'strict=1; SameSite=Strict; Secure');
    response.headerList.append('Set-Cookie', 'none=2; SameSite=None; Secure');
    response.parseAndStoreCookies(new FetchRequest(url, top.settings, userAgent));

    const allowed = new FetchRequest(url, sameSite.settings, sameSite.settings.userAgent);
    const restricted = new FetchRequest(url, crossSite.settings, crossSite.settings.userAgent);
    allowed.appendCookieHeader();
    restricted.appendCookieHeader();
    expect(allowed.headerList.get('Cookie')).toBe('strict=1; none=2');
    expect(restricted.headerList.get('Cookie')).toBe('none=2');

    const other = createEnvironment('https://a.example.com/');
    const isolated = new FetchRequest(url, other.settings, other.settings.userAgent);
    isolated.appendCookieHeader();
    expect(isolated.headerList.get('Cookie')).toBeNull();
  });
});

// Compose real Window settings and navigables without requiring the iframe loader.
function createEnvironment(url: string, parent: Navigable | null = null) {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const parentSettings = parent === null ? null : getRelevantRealm(parent.activeDocument!).hostDefined!;
  const { window, settings } = createWindowEnvironment(new WindowAgent(), {
    userAgent: parentSettings?.userAgent ?? new UserAgent(),
    creationURL, origin, parent: parent?.activeWindow ?? null,
    topLevelCreationURL: parentSettings?.topLevelCreationURL ?? creationURL,
    topLevelOrigin: parentSettings?.topLevelOrigin ?? origin,
  });
  const realm = settings.realmExecutionContext.realm;
  const document = createDocument(realm);
  document.setURL(creationURL);
  document.setOrigin(origin);
  document.setBrowsingContext(new BrowsingContext(realm.globalThis as WindowProxy));
  window.setAssociatedDocument(document);
  const navigable = parent === null ? new TopLevelTraversable() : new Navigable();
  navigable.initialize(createDocumentState(document), parent);
  return { navigable, document, settings };
}
