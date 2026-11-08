import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { PolicyContainer } from '../../../../src/browlet/browsing/policy/index';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchHeaders, type HTTPTransportListener } from '../../../../src/fetch/index';
import { internalType } from '../../../../src/infra/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('completed Fetch navigation parameters', () => {
  it('retains the request, response, reservation, policy results, and captured navigation inputs', async () => {
    const { begin, entry, navigable, source, target, headers, env } = fixture();
    headers.append('Cross-Origin-Opener-Policy', 'same-origin');
    headers.append('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.append('Referrer-Policy', 'no-referrer');
    target.iframeReferrerPolicy = 'origin';
    entry.documentState.aboutBaseURL = parseURL('https://source.test/base/').url!;
    const activeEntry = navigable.activeSessionHistoryEntry;
    const params = await begin();
    expect(params).toBeInstanceOf(NavigationParams);
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    expect(params.id).toBe('assembled');
    expect(params.request!.client).toBe(source.fetchClient);
    expect(params.request!.env).toBe(env.userAgent.sandbox);
    expect(params.reservedEnv).toBe(params.request!.reservedClient);
    expect(params.reservedEnv!.executionReady).toBe(false);
    expect(params.reservedEnv!.discarded).toBe(false);
    expect(params.origin).toEqual(obtainURLOrigin(entry.url));
    expect(params.openerPolicy.value).toBe('same-origin-plus-COEP');
    expect(params.coopEnforcementResult!.openerPolicy).toBe(params.openerPolicy);
    expect(params.policyContainer.embedderPolicy.value).toBe('require-corp');
    expect(params.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(params.policyContainer).not.toBe(source.sourcePolicyContainer);
    expect(params.finalSandboxingFlagSet).toEqual(target.sandboxingFlags);
    expect(params.finalSandboxingFlagSet).not.toBe(target.sandboxingFlags);
    expect(params.aboutBaseURL).toBe(entry.documentState.aboutBaseURL);
    expect(params.iframeReferrerPolicy).toBe('origin');
    expect(params.navigationTimingType).toBe('back_forward');
    expect(params.userInvolvement).toBe('activation');
    expect(params.startTime).toBe(params.fetchController!.extractFullTimingInfo().startTime);
    expect(params.startTime).toBeGreaterThan(0);
    expect(params.commitEarlyHints).toBeNull();
    expect(params.cookieURL).toEqual(params.url);
    expect(params.cookieURL).not.toBe(params.url);
    expect(entry.document).toBeNull();
    expect(navigable.activeSessionHistoryEntry).toBe(activeEntry);
  });

  it('hands off a live body and controller, removing its temporary navigation-change listener', async () => {
    const { begin, transport, navigable } = fixture();
    const connected = Promise.withResolvers<HTTPTransportListener>();
    const abort = vi.fn();
    transport.mockImplementation((_request, listener) => {
      connected.resolve(listener);
      return { pause() {}, resume() {}, abort };
    });
    const pending = begin();
    const listener = await connected.promise;
    listener.onHeaders(200, 'OK', new FetchHeaders([['Content-Type', 'text/html']]), true);
    const params = await pending;
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    expect(params.fetchController!.state).toBe('ongoing');
    expect(abort).not.toHaveBeenCalled();
    navigable.ongoingNavigation = 'later';
    expect(abort).not.toHaveBeenCalled();
    const bytes = Promise.withResolvers<Uint8Array>();
    params.response.body!.readAll(bytes.resolve, bytes.reject);
    listener.onData(Uint8Array.of(60, 112, 62));
    listener.onEnd();
    await expect(bytes.promise).resolves.toEqual(Uint8Array.of(60, 112, 62));
    expect(abort).not.toHaveBeenCalled();
  });

  it.each([false, true])('selects local-URL policy from the initiator or history (history: %s)', async (history) => {
    const { begin, entry, source, transport } = fixture();
    entry.url = parseURL('data:text/html,hello').url!;
    source.sourcePolicyContainer.referrerPolicy = 'origin';
    const stored = new PolicyContainer();
    stored.referrerPolicy = 'no-referrer';
    entry.documentState.historyPolicyContainer = history ? stored : null;
    const params = await begin();
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    expect(params.policyContainer.referrerPolicy).toBe(history ? 'no-referrer' : 'origin');
    expect(params.policyContainer).not.toBe(history ? stored : source.sourcePolicyContainer);
    params.policyContainer.referrerPolicy = 'unsafe-url';
    expect(stored.referrerPolicy).toBe('no-referrer');
    expect(source.sourcePolicyContainer.referrerPolicy).toBe('origin');
    expect(params.origin.kind).toBe('opaque');
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([false, true])('clears iframe fallback timing only when Fetch permits normal reporting (allowed: %s)', async (allowed) => {
    const { begin, iframe, headers } = fixture(true);
    expect(iframe!.pendingResourceTimingStartTime).toBeNull();
    iframe!.pendingResourceTimingStartTime = 43;
    headers.append('Cross-Origin-Opener-Policy', 'same-origin');
    if (allowed) headers.append('Timing-Allow-Origin', '*');
    const params = await begin();
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    expect(params.response.timingAllowPassed).toBe(allowed);
    expect(iframe!.pendingResourceTimingStartTime).toBe(allowed ? null : 43);
    expect(params.openerPolicy.value).toBe('unsafe-none');
    expect(params.request!.destination).toBe('iframe');
    expect(params.startTime).toBe(params.fetchController!.extractFullTimingInfo().startTime);
  });

  it.each([false, true])('carries the real redirect chain into Document timing (all hops authorize: %s)', async (allowed) => {
    const { begin, navigable, transport } = fixture();
    transport.mockImplementation((request, listener) => {
      const url = serializeURL(request.url);
      const headers = new FetchHeaders();
      if (url === 'https://incoming.test/page') {
        headers.append('Location', 'https://other.test/hop');
        headers.append('Timing-Allow-Origin', '*');
      } else if (url === 'https://other.test/hop') {
        headers.append('Location', 'https://incoming.test/final');
        if (allowed) headers.append('Timing-Allow-Origin', 'https://incoming.test');
      }
      listener.onHeaders(headers.has('Location') ? 302 : 200, 'OK', headers, true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });

    const params = await begin();
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);

    expect(transport).toHaveBeenCalledTimes(3);
    expect(params.request!.redirectCount).toBe(2);
    expect(params.request!.referrer).not.toBeNull();
    expect(params.response.redirectTaint).toBe('cross-site');
    expect(document.navigationTimingEntry?.redirectCount).toBe(allowed ? 2 : 0);
    expect(document.navigationTimingEntry?.timingInfo).toBe(params.fetchController!.extractFullTimingInfo());
  });

  it('delivers the completed parameters on the target task before saving a returned Document', async () => {
    const { entry, navigable, source, target, env } = fixture();
    const loaded = env.createDocument();
    loaded.setURL(entry.url);
    loaded.origin = obtainURLOrigin(entry.url);
    const load = vi.spyOn(navigable, 'loadDocument').mockReturnValue(env.userAgent.HostPromise.resolve(loaded, internalType<DocumentImpl | null>()));
    const queue = vi.spyOn(env, 'queueTask');
    const complete = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'activation', {
      navigationId: 'assembled', completionSteps: complete,
    });
    await expect.poll(() => queue.mock.calls.length).toBe(1);
    expect(load).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(load).not.toHaveBeenCalled();
    await expect.poll(() => queue.mock.calls.length).toBe(2);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    const params = load.mock.calls[0]![0];
    expect(params).toBeInstanceOf(NavigationParams);
    expect(serializeURL(params.url)).toBe('https://incoming.test/page');
    expect(params.fetchController!.state).toBe('ongoing');
    expect(load.mock.calls[0]![1]).toBe(source);
    await expect.poll(() => env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(entry.document).toBe(loaded);
    expect(entry.documentState.everPopulated).toBe(true);
    expect(entry.documentState.origin).toBe(loaded.origin);
    expect(complete).toHaveBeenCalledOnce();
    expect(navigable.activeDocument).not.toBe(loaded);
  });
});

function fixture(child = false) {
  const userAgent = createManualUserAgent();
  const sourceNavigable = TopLevelTraversable.create(userAgent, null, 'source');
  const sourceDocument = sourceNavigable.activeDocument!;
  sourceDocument.setURL(parseURL('https://source.test/page').url!);
  sourceDocument.origin = obtainURLOrigin(sourceDocument.url);
  vi.spyOn(sourceNavigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(sourceDocument);
  let navigable: Navigable = TopLevelTraversable.create(userAgent, null, 'target');
  let iframe: HTMLIFrameElementImpl | null = null;
  if (child) {
    const parent = navigable.activeDocument!;
    iframe = parent.createElement('iframe') as HTMLIFrameElementImpl;
    const [, document] = BrowsingContext.create(parent, iframe, parent.browsingContext!.group!);
    const nested = new Navigable(DocumentState.create(document), navigable);
    iframe.contentNavigable = nested;
    parent.body!.appendChild(iframe);
    navigable = nested;
  }
  const env = navigable.activeDocument!.env;
  navigable.ongoingNavigation = 'assembled';
  const entry = env.createSessionHistoryEntry(parseURL('https://incoming.test/page').url!, new DocumentState());
  const target = navigable.snapshotTargetParams();
  const headers = new FetchHeaders();
  const transport = mockHTTPTransport(userAgent, (_request, listener) => {
    listener.onHeaders(200, 'OK', headers, true);
    listener.onEnd();
  });
  const begin = () => NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'activation', 'assembled', 'back_forward', env);
  return { begin, entry, navigable, iframe, source, target, headers, env, transport };
}
