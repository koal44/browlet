import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type NavigableContainer } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment/index';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchHeaders } from '../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';

afterEach(() => { vi.restoreAllMocks(); });

describe('Fetch navigation request construction', () => {
  it('keeps the source client and captured policy separate from the destination and execution owner', () => {
    const { navigable, entry, sourceDocument, source, env } = fixture();
    const referrer = parseURL('https://source.test/retained').url!;
    const initiatorOrigin = obtainURLOrigin(referrer);
    entry.documentState.requestReferrer = referrer;
    entry.documentState.requestReferrerPolicy = 'same-origin';
    entry.documentState.initiatorOrigin = initiatorOrigin;
    entry.documentState.origin = createOpaqueOrigin();
    source.sourcePolicyContainer.referrerPolicy = 'origin';
    sourceDocument.policyContainer.referrerPolicy = 'unsafe-url';
    navigable.activeDocument!.policyContainer.referrerPolicy = 'no-referrer';

    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    expect(request.client).toBe(sourceDocument.env);
    expect(request.env).toBe(env.userAgent.sandbox);
    expect(request.env).not.toBe(request.client);
    expect(request.env).not.toBe(env);
    expect(request.policyContainer).toBe(source.sourcePolicyContainer);
    expect(request.policyContainer.referrerPolicy).toBe('origin');
    expect(request.referrer).toBe(referrer);
    expect(request.referrerPolicy).toBe('same-origin');
    expect(request.origin).toBeUndefined(); // Fetch resolves the client origin later.
    expect(request.topLevelNavigationInitiatorOrigin).toBe(initiatorOrigin);
    expect(request.replacesClientId).toBe(env.id);
    expect(request.replacesClientId).not.toBe(sourceDocument.env.id);
    expect(request.traversableForUserPrompts).toBe(navigable);
    expect(request).toMatchObject({
      method: 'GET', body: null, destination: 'document', mode: 'navigate',
      credentialsMode: 'include', useURLCredentials: true, redirectMode: 'manual', initiatorType: null,
    });
    expect(serializeURL(request.url)).toBe(serializeURL(entry.url));
    expect(request.url).not.toBe(entry.url);
    request.url.fragment = 'redirect';
    expect(entry.url.fragment).toBe('entry');
  });

  it.each(['client', 'none', 'url'] as const)('retains a %s referrer without resolving it from the destination', (kind) => {
    const { navigable, entry, source, env } = fixture();
    const referrer = kind === 'client' ? undefined : kind === 'none' ? null : parseURL('https://source.test/').url!;
    entry.documentState.requestReferrer = referrer;
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    expect(request.referrer).toBe(referrer);
  });

  it.each([false, true])('creates a fresh opaque request origin for a null client, with retained initiator %s', (retained) => {
    const { navigable, entry, env } = fixture();
    const source = new SourceSnapshotParams(null);
    const initiator = retained ? createOpaqueOrigin() : null;
    entry.documentState.initiatorOrigin = initiator;
    entry.documentState.requestReferrer = parseURL('https://old.test/private').url!;
    entry.documentState.origin = createOpaqueOrigin();

    const first = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    const second = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    expect(first.client).toBeNull();
    expect(first.origin?.kind).toBe('opaque');
    expect(first.origin).not.toBe(second.origin);
    expect(first.origin).not.toBe(entry.documentState.origin);
    expect(first.origin).not.toBe(initiator);
    expect(first.topLevelNavigationInitiatorOrigin).toBe(initiator);
    expect(first.referrer).toBeNull();
    expect(first.allowServiceWorkerInterception).toBe(true);
    expect(first.userActivation).toBe(true);
  });

  it.each(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'] as const)(
    'replays stored %s POST bytes without consuming or re-encoding them', (type) => {
      const { navigable, entry, source, env } = fixture();
      const bytes = Uint8Array.of(0, 128, 255, 13, 10);
      const resource = { requestBody: bytes, requestContentType: type };
      entry.documentState.resource = resource;

      const first = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
      const second = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

      expect(first.method).toBe('POST');
      expect(first.headerList.get('Content-Type')).toBe(type);
      expect(first.body).toBe(bytes);
      expect(second.body).toBe(bytes);
      expect(first.clone().body).toEqual(bytes);
      expect(entry.documentState.resource).toBe(resource);
      expect(bytes).toEqual(Uint8Array.of(0, 128, 255, 13, 10));
    },
  );

  it('keeps an empty POST body distinct from a GET request', () => {
    const { navigable, entry, source, env } = fixture();
    entry.documentState.resource = { requestBody: new Uint8Array(), requestContentType: 'text/plain' };
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    expect(request.method).toBe('POST');
    expect(request.body).toEqual(new Uint8Array());
    expect(request.headerList.get('Content-Type')).toBe('text/plain');
  });

  it.each([
    [false, false, false, false], [false, true, false, true],
    [true, false, true, false], [true, true, true, false],
  ])('selects flags for reloadPending %s and everPopulated %s', (reloadPending, everPopulated, reload, history) => {
    const { navigable, entry, source, env } = fixture();
    entry.documentState.reloadPending = reloadPending;
    entry.documentState.everPopulated = everPopulated;
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    expect(request.reloadNavigation).toBe(reload);
    expect(request.historyNavigation).toBe(history);
    expect(request.cacheMode).toBe(reload ? 'no-cache' : 'default');
    expect(entry.documentState.reloadPending).toBe(reloadPending);
    expect(entry.documentState.everPopulated).toBe(everPopulated);
  });

  it('uses captured activation and the retained client after its source Document becomes inactive', () => {
    const { navigable, entry, sourceNavigable, sourceDocument, activation, env } = fixture();
    activation.mockReturnValue(true);
    const source = new SourceSnapshotParams(sourceDocument);
    activation.mockReturnValue(false);
    sourceNavigable.activeSessionHistoryEntry.documentState.document = null;
    expect(sourceDocument.isFullyActive()).toBe(false);

    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    expect(request.client).toBe(sourceDocument.env);
    expect(request.userActivation).toBe(true);
    expect(request.env).toBe(env.userAgent.sandbox);
  });

  it.each(['iframe', 'frame', 'object', 'embed'] as const)('uses %s destination and reports a container-initiated request', (tag) => {
    const { navigable: parent, entry, env } = fixture();
    const { navigable } = createChild(parent, tag);
    vi.spyOn(parent.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
    const source = new SourceSnapshotParams(parent.activeDocument);
    entry.documentState.initiatorOrigin = createOpaqueOrigin();

    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    expect(request.destination).toBe(tag);
    expect(request.initiatorType).toBe(tag);
    expect(request.origin).toBeUndefined();
    expect(request.topLevelNavigationInitiatorOrigin).toBeNull();
    expect(request.replacesClientId).toBe(navigable.activeDocument!.env.id);
    expect(request.traversableForUserPrompts).toBe(parent);
    request.populateFromClient();
    expect(request.origin).toBe(parent.activeDocument!.origin);
    expect(request.cacheMode).toBe('default');

    entry.documentState.reloadPending = true;
    const reload = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    expect(reload.destination).toBe(tag);
    expect(reload.reloadNavigation).toBe(true);
    expect(reload.cacheMode).toBe('no-cache');
  });

  it('does not label another source as container-initiated or replace its client', () => {
    const { navigable: parent, entry, source, env } = fixture();
    const { navigable } = createChild(parent, 'iframe');
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    expect(request.initiatorType).toBeNull();
    expect(request.origin).toBeUndefined();
    expect(request.client).toBe(source.fetchClient);
  });

  it('rejects resources routed to srcdoc or failed-POST handling before a request can escape', () => {
    const { navigable, entry, source, env } = fixture();
    entry.documentState.resource = '';
    expect(() => entry.createNavigationRequest(navigable, source, env.userAgent.sandbox))
      .toThrow('Srcdoc resources do not create navigation requests');
    entry.documentState.resource = { requestBody: 'failure', requestContentType: 'text/plain' };
    expect(() => entry.createNavigationRequest(navigable, source, env.userAgent.sandbox))
      .toThrow('Navigation requests require available POST bytes');
  });

  it.each([
    ['form-submission', 'form', true], ['other', 'ordinary', false], ['other', null, false],
  ] as const)('constructs and dispatches the request in fromFetch with CSP type %s and ID %s', async (type, id, form) => {
    const { navigable, entry, source, env } = fixture();
    const construct = vi.spyOn(entry, 'createNavigationRequest');
    const target = { sandboxingFlags: new SandboxingFlagSet(), iframeReferrerPolicy: '' } as const;

    navigable.ongoingNavigation = id;
    const result = NavigationParams.fromFetch(entry, navigable, source, target, type, 'none', id, 'navigate', env);
    expect(construct).toHaveBeenCalledExactlyOnceWith(navigable, source, env.userAgent.sandbox);
    // A GET form is still a form submission; the reservation exists before Fetch can complete.
    expect(construct).toHaveReturnedWith(expect.objectContaining({
      webDriverNavigationId: id, isFormSubmission: form, method: 'GET', done: false,
      reservedClient: expect.any(BrowletEnvironmentBase) as unknown,
    }));
    await expect(result).resolves.toBeInstanceOf(NavigationParams);
  });
});

describe('navigation request Origin headers', () => {
  it.each([
    { hosts: ['a', 'b'] }, { hosts: ['a', 'b', 'b'] }, { hosts: ['a', 'b', 'a'] },
    { hosts: ['a', 'a', 'b'] }, { hosts: ['a', 'b', 'c', 'b'] },
  ])('retains the initiating origin through ancestry $hosts', ({ hosts }) => {
    const { navigable, document, entry, source, env } = originFixture(hosts);
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    expect(request.origin).toBeUndefined();

    request.populateFromClient();
    request.appendOriginHeader();

    expect(request.origin).toBe(document.origin);
    expect(request.headerList.get('Origin')).toBe(`https://${hosts.at(-1)!}.test`);
    expect(request.initiatorType).toBeNull();
  });

  it('uses the initiating child rather than the parent when posting to a same-origin sibling', () => {
    const { root, document, entry, source, env } = originFixture(['a', 'b']);
    const { navigable: sibling } = createChild(root, 'iframe');
    sibling.activeDocument!.origin = document.origin;
    const request = entry.createNavigationRequest(sibling, source, env.userAgent.sandbox);

    request.populateFromClient();
    request.appendOriginHeader();

    expect(request.origin).toBe(document.origin);
    expect(request.headerList.get('Origin')).toBe('https://b.test');
    expect(request.replacesClientId).toBe(sibling.activeDocument!.env.id);
    expect(request.initiatorType).toBeNull();
  });

  it('preserves an opaque source instead of granting it the container Document\'s origin', () => {
    const { navigable, document, entry, source, env } = originFixture(['a', 'b']);
    document.origin = createOpaqueOrigin();
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    request.populateFromClient();
    request.appendOriginHeader();

    expect(request.origin).toBe(document.origin);
    expect(request.headerList.get('Origin')).toBe('null');
  });

  it('preserves a null client\'s fresh opaque origin for a contained request', () => {
    const { navigable, entry, env } = originFixture(['a', 'b']);
    const source = new SourceSnapshotParams(null);
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);
    const origin = request.origin;

    request.populateFromClient();
    request.appendOriginHeader();

    expect(origin?.kind).toBe('opaque');
    expect(request.origin).toBe(origin);
    expect(request.headerList.get('Origin')).toBe('null');
    expect(request.client).toBeNull();
  });

  it.each(['no-referrer', 'same-origin'] as const)('applies %s to the header without replacing the source origin', (policy) => {
    const { navigable, document, entry, source, env } = originFixture(['a', 'b']);
    entry.documentState.requestReferrerPolicy = policy;
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    request.populateFromClient();
    request.appendOriginHeader();

    expect(request.origin).toBe(document.origin);
    expect(request.headerList.get('Origin')).toBe('null');
  });

  it('omits the Origin header for an ordinary GET beneath a foreign ancestor', () => {
    const { navigable, document, entry, source, env } = originFixture(['a', 'b', 'b']);
    entry.documentState.resource = null;
    const request = entry.createNavigationRequest(navigable, source, env.userAgent.sandbox);

    request.populateFromClient();
    request.appendOriginHeader();

    expect(request.method).toBe('GET');
    expect(request.origin).toBe(document.origin);
    expect(request.headerList.get('Origin')).toBeNull();
  });

  it('dispatches a contained request before reaching the explicit unfinished response processing', async () => {
    const { navigable, entry, source, env } = originFixture(['a', 'b']);
    const construct = vi.spyOn(entry, 'createNavigationRequest');
    const target = { sandboxingFlags: new SandboxingFlagSet(), iframeReferrerPolicy: '' } as const;

    mockHTTPTransport(env.userAgent, (_request, listener) => {
      listener.onHeaders(200, 'OK', new FetchHeaders(), true);
      listener.onEnd();
    });
    navigable.ongoingNavigation = 'child';
    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'none', 'child', 'navigate', env);
    expect(construct).toHaveReturnedWith(expect.objectContaining({
      destination: 'iframe', client: env, origin: env.origin, isFormSubmission: true, webDriverNavigationId: 'child',
      reservedClient: expect.objectContaining({
        userAgent: env.userAgent, creationURL: entry.url,
        targetBrowsingContext: navigable.activeBrowsingContext, executionReady: false,
      }) as unknown,
    }));
    await expect(result).resolves.toBeInstanceOf(NavigationParams);
  });
});

function fixture() {
  const userAgent = new UserAgent();
  mockHTTPTransport(userAgent, (_request, listener) => {
    listener.onHeaders(200, 'OK', new FetchHeaders(), true);
    listener.onEnd();
  });
  const navigable = TopLevelTraversable.create(userAgent, null, '');
  const sourceNavigable = TopLevelTraversable.create(userAgent, null, 'source');
  const sourceDocument = sourceNavigable.activeDocument!;
  const activation = vi.spyOn(sourceNavigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(sourceDocument);
  const env = navigable.activeDocument!.env;
  const entry = env.createSessionHistoryEntry(parseURL('https://destination.test/path#entry').url!, new DocumentState());
  return { navigable, entry, sourceNavigable, sourceDocument, activation, source, env };
}

function createChild(parent: Navigable, tag: 'iframe' | 'frame' | 'object' | 'embed') {
  const owner = parent.activeDocument!;
  const container = owner.createElement(tag) as NavigableContainer;
  owner.body!.appendChild(container);
  // Resource setup for non-iframe containers is unfinished; associate a real context directly.
  const embedder = container instanceof HTMLIFrameElementImpl ? container : null;
  const [, document] = BrowsingContext.create(owner, embedder, parent.topLevelTraversable.activeBrowsingContext!.group!);
  const navigable = new Navigable(DocumentState.create(document), parent);
  container.contentNavigable = navigable;
  return { container, navigable };
}

function originFixture(hosts: string[]) {
  const root = TopLevelTraversable.create(new UserAgent(), null, '');
  let navigable: Navigable = root;
  for (const [index, host] of hosts.entries()) {
    if (index !== 0) navigable = createChild(navigable, 'iframe').navigable;
    const document = navigable.activeDocument!;
    // Document loading is unfinished; give real context Documents the origins/URLs under test.
    const url = parseURL(`https://${host}.test/source`).url!;
    document.setURL(url);
    document.origin = obtainURLOrigin(url);
  }
  const document = navigable.activeDocument!;
  const env = document.env;
  vi.spyOn(navigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(document);
  const entry = env.createSessionHistoryEntry(parseURL('https://destination.test/').url!, new DocumentState());
  entry.documentState.resource = { requestBody: Uint8Array.of(1), requestContentType: 'text/plain' };
  entry.documentState.requestReferrerPolicy = 'unsafe-url';
  return { root, navigable, document, entry, source, env };
}
