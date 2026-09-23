import { describe, expect, it } from 'vitest';

import { createDocument, getBindingContext, getRelevantRealm, retargetWindowProxy } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext } from '../../../src/browlet/browsing/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/session-history';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import type { WindowProxy } from '../../../src/browlet/browsing/window/window-proxy';
import { WindowAgent } from '../../../src/browlet/scripting/agents';
import { createWindowEnvironment } from '../../../src/browlet/bindings';
import { UserAgent } from '../../../src/browlet/user-agent';
import { createEnvironmentRecord } from '../../../src/browlet/scripting/environment';
import { StorageKey } from '../../../src/storage/keys';
import { createOpaqueOrigin } from '../../../src/url/origin';
import { determineRequestReferrer } from '../../../src/browlet/browsing/policy/referrer-policy';
import { FetchRequest, RequestImpl } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../src/url/url';

describe('Window environment cross-site ancestry', () => {
  it('has no cross-site ancestor in a top-level window', () => {
    const top = createEnvironment('https://example.com/');
    expect(top.environment.hasCrossSiteAncestor).toBe(false);
  });

  it('compares sites rather than origins for a child window', () => {
    const top = createEnvironment('https://a.example.com/');
    const child = createEnvironment('https://b.example.com:8443/', top.navigable);
    expect(child.environment.hasCrossSiteAncestor).toBe(false);
  });

  it.each(['https://other.test/', 'http://a.example.com/'])(
    'recognizes a cross-site parent for %s', (url) => {
      const top = createEnvironment('https://a.example.com/');
      const child = createEnvironment(url, top.navigable);
      expect(child.environment.hasCrossSiteAncestor).toBe(true);
    },
  );

  it('checks intermediate ancestors even when the top and child have the same site', () => {
    const top = createEnvironment('https://a.example.com/');
    const middle = createEnvironment('https://other.test/', top.navigable);
    const child = createEnvironment('https://b.example.com/', middle.navigable);
    expect(child.environment.hasCrossSiteAncestor).toBe(true);
  });

  it('reads the live ancestor chain rather than retaining the first answer', () => {
    const top = createEnvironment('https://a.example.com/');
    const middle = createEnvironment('https://a.example.com/', top.navigable);
    const child = createEnvironment('https://b.example.com/', middle.navigable);
    expect(child.environment.hasCrossSiteAncestor).toBe(false);

    middle.document.origin = obtainURLOrigin(parseURL('https://other.test/').url!);
    expect(child.environment.hasCrossSiteAncestor).toBe(true);
  });

  it('does not grant same-site cookie access to a Document without a current navigable', () => {
    const top = createEnvironment('https://example.com/');
    top.document.browsingContext = null;
    expect(top.environment.hasCrossSiteAncestor).toBe(true);
  });
});

describe('Fetch cookies through Window settings', () => {
  it('uses the real ancestor query and the user agent\'s shared cookie store', () => {
    const top = createEnvironment('https://a.example.com/');
    const sameSite = createEnvironment('https://b.example.com/', top.navigable);
    const middle = createEnvironment('https://other.test/', top.navigable);
    const crossSite = createEnvironment('https://b.example.com/', middle.navigable);
    const url = parseURL('https://a.example.com/').url!;
    const userAgent = top.environment.userAgent;
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'strict=1; SameSite=Strict; Secure');
    response.headerList.append('Set-Cookie', 'none=2; SameSite=None; Secure');
    response.parseAndStoreCookies(new FetchRequest(url, top.environment, userAgent));

    const allowed = new FetchRequest(url, sameSite.environment, sameSite.environment.userAgent);
    const restricted = new FetchRequest(url, crossSite.environment, crossSite.environment.userAgent);
    allowed.appendCookieHeader();
    restricted.appendCookieHeader();
    expect(allowed.headerList.get('Cookie')).toBe('strict=1; none=2');
    expect(restricted.headerList.get('Cookie')).toBe('none=2');

    const other = createEnvironment('https://a.example.com/');
    const isolated = new FetchRequest(url, other.environment, other.environment.userAgent);
    isolated.appendCookieHeader();
    expect(isolated.headerList.get('Cookie')).toBeNull();
  });
});

describe('Window environment referrer sources', () => {
  it('uses the live Document URL, independently of creation and base URLs', () => {
    const { document, environment } = createEnvironment('https://example.test/initial');
    const url = parseURL('https://example.test/current?q=1#fragment').url!;
    document.url = url;
    const root = document.createElement('html');
    const base = document.createElement('base');
    base.setAttribute('href', 'https://different.test/base/');
    document.appendChild(root);
    root.appendChild(base);
    expect(serializeURL(environment.apiBaseURL)).toBe('https://different.test/base/');
    expect(environment.getReferrerSource()).toBe(url);

    const request = new FetchRequest(parseURL('https://example.test/target').url!, environment, environment.userAgent);
    request.referrerPolicy = 'same-origin';
    const referrer = determineRequestReferrer(request);
    expect(referrer === null ? null : serializeURL(referrer)).toBe('https://example.test/current?q=1');
    expect(document.URL).toBe('https://example.test/current?q=1#fragment');
  });

  it('does not disclose the URL of an opaque-origin Document', () => {
    const { document, environment } = createEnvironment('https://example.test/');
    document.origin = obtainURLOrigin(parseURL('data:,opaque').url!);
    expect(environment.getReferrerSource()).toBeNull();
  });

  it('exposes the stored srcdoc flag rather than inferring it from the URL', () => {
    const { document } = createEnvironment('about:srcdoc');
    expect(document.isIframeSrcdocDocument).toBe(false);
    document.isIframeSrcdocDocument = true;
    expect(document.isIframeSrcdocDocument).toBe(true);
  });

  // Iframe creation must eventually supply the content navigable and its container.
  it.fails('selects the embedding Document URL for a loaded srcdoc iframe', async () => {
    const browlet = new Browlet({ route: () => '<iframe srcdoc="<p>child</p>"></iframe>' });
    await browlet.navigate('https://example.test/parent');
    const iframe = browlet.document.getElementsByTagName('iframe').item(0)!;
    const document = iframe.contentDocument;
    expect(document).toBeTruthy();
    const environment = getRelevantRealm(document!).environment;
    const request = new FetchRequest(parseURL('https://example.test/target').url!, environment, environment.userAgent);
    request.referrerPolicy = 'unsafe-url';
    const referrer = determineRequestReferrer(request);
    expect(referrer === null ? null : serializeURL(referrer)).toBe('https://example.test/parent');
  });
});

describe('Window environment reporting sources', () => {
  it('uses the live Document URL independently of the base URL and creation URL', () => {
    const { document, environment } = createEnvironment('https://example.test/initial');
    const url = parseURL('https://example.test/current#fragment').url!;
    document.url = url;
    const root = document.createElement('html');
    const base = document.createElement('base');
    base.setAttribute('href', 'https://different.test/base/');
    document.appendChild(root);
    root.appendChild(base);
    expect(serializeURL(environment.apiBaseURL)).toBe('https://different.test/base/');
    expect(environment.getReportingSource()).toBe(url);
  });

  it('reports the srcdoc Document itself even when its origin prevents a referrer', () => {
    const { document, environment } = createEnvironment('about:srcdoc');
    document.isIframeSrcdocDocument = true;
    expect(environment.getReferrerSource()).toBeNull();
    expect(environment.getReportingSource()).toBe(document.url);
  });
});

describe('Window environment prompt targets', () => {
  it('selects the window\'s own traversable', () => {
    const top = createEnvironment('https://example.test/');
    expect(top.environment.getTraversableForUserPrompts()).toBe(top.navigable);
  });

  it('selects the containing traversable across cross-origin ancestors', () => {
    const top = createEnvironment('https://top.test/');
    const middle = createEnvironment('https://middle.test/', top.navigable);
    const child = createEnvironment('https://child.test/', middle.navigable);
    expect(child.environment.getTraversableForUserPrompts()).toBe(top.navigable);
  });

  it('retains a populated child request\'s target independently of the top document\'s origin', () => {
    const top = createEnvironment('https://top.test/');
    const child = createEnvironment('https://child.test/', top.navigable);
    const realm = child.environment.realm;
    const context = getBindingContext(realm);
    const window = realm.globalObject as Window & typeof globalThis;
    const source = new window.Request('https://resource.test/');
    context.unwrap(source, RequestImpl)!.getRequest().populateFromClient();
    top.document.origin = obtainURLOrigin(parseURL('https://changed.test/').url!);
    const copy = context.unwrap(new window.Request(source), RequestImpl)!.getRequest();
    expect(copy.traversableForUserPrompts).toBe(top.navigable);
    expect(copy.origin).toBe(child.environment.origin);
  });

  it('has no prompt target when its document has no navigable', () => {
    const top = createEnvironment('https://example.test/');
    top.document.browsingContext = null;
    expect(top.environment.getTraversableForUserPrompts()).toBeNull();
  });
});

describe('storage keys from browser environments', () => {
  it('uses a Window\'s actual security origin, including an inherited about:blank origin', () => {
    const { document, environment } = createEnvironment('about:blank');
    document.origin = obtainURLOrigin(parseURL('https://creator.test/').url!);
    const key = StorageKey.obtain(environment)!;
    expect(key.origin).toBe(document.origin);

    document.origin = createOpaqueOrigin();
    expect(StorageKey.obtain(environment)).toBeNull();
    expect(StorageKey.obtainForNonStoragePurposes(environment).origin).toBe(document.origin);
    expect(key.origin.kind).toBe('tuple');
  });

  it('uses the creation URL of a reserved environment before any realm exists', () => {
    const userAgent = new UserAgent();
    const creationURL = parseURL('https://reserved.test/').url!;
    const record = createEnvironmentRecord({
      userAgent, creationURL, topLevelCreationURL: creationURL,
      topLevelOrigin: obtainURLOrigin(creationURL), targetBrowsingContext: null, isSecureContext: true,
    });
    const key = StorageKey.obtain(record)!;
    expect(key.equals(new StorageKey(obtainURLOrigin(creationURL)))).toBe(true);

    userAgent.storageEnabled = false;
    expect(StorageKey.obtain(record)).toBeNull();
    expect(StorageKey.obtainForNonStoragePurposes(record).equals(key)).toBe(true);
  });

  it('reads the UserAgent preference while preserving non-storage access checks', () => {
    const { environment } = createEnvironment('https://example.test/');
    const key = StorageKey.obtain(environment)!;
    environment.userAgent.storageEnabled = false;
    expect(StorageKey.obtain(environment)).toBeNull();
    expect(StorageKey.obtainForNonStoragePurposes(environment).equals(key)).toBe(true);
    environment.userAgent.storageEnabled = true;
    expect(StorageKey.obtain(environment)?.equals(key)).toBe(true);
  });
});

// Compose real Window settings and navigables without requiring the iframe loader.
function createEnvironment(url: string, parent: Navigable | null = null) {
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const parentSettings = parent === null ? null : getRelevantRealm(parent.activeDocument!).environment;
  const environment = createWindowEnvironment({
    agent: new WindowAgent(), userAgent: parentSettings?.userAgent ?? new UserAgent(),
    creationURL, origin, parent: parent?.activeWindow ?? null,
    topLevelCreationURL: parentSettings?.topLevelCreationURL ?? creationURL,
    topLevelOrigin: parentSettings?.topLevelOrigin ?? origin,
  });
  const { window } = environment;
  const realm = environment.realm;
  const proxy = realm.globalThis as WindowProxy;
  const document = createDocument(realm);
  document.url = creationURL;
  document.origin = origin;
  document.browsingContext = new BrowsingContext(proxy);
  window.setAssociatedDocument(document);
  retargetWindowProxy(proxy, window);
  const documentState = createDocumentState(document);
  const navigable = parent === null
    ? new TopLevelTraversable(documentState)
    : new Navigable(documentState, parent);
  return { navigable, document, environment };
}
