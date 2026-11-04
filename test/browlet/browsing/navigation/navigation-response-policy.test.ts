import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { OpenerPolicy, SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchController, FetchHeaders, FetchResponse, type HTTPTransportListener } from '../../../../src/fetch/index';
import { areSameOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('Fetch navigation response policies', () => {
  it('parses incoming policies with the reserved environment and unions the captured sandbox flags', async () => {
    const { begin, headers, target, document, env, construct, enforce } = fixture();
    headers.append('Content-Security-Policy', 'sandbox allow-same-origin allow-scripts');
    headers.append('Content-Security-Policy-Report-Only', 'sandbox');
    headers.append('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.append('Referrer-Policy', 'no-referrer');
    target.sandboxingFlags.add('sandboxed-scripts');
    document.activeSandboxingFlagSet.add('sandboxed-origin');
    const policy = vi.spyOn(env.userAgent, 'createPolicyContainerFromResponse');
    const origin = vi.spyOn(BrowsingContext, 'determineOrigin');

    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);

    expect(policy).toHaveBeenCalledOnce();
    const reserved = policy.mock.calls[0]![1];
    expect(construct).toHaveReturnedWith(expect.objectContaining({ reservedClient: reserved }));
    expect(reserved).not.toBe(env);
    const result = policy.mock.results[0]!;
    if (result.type !== 'return') throw new Error('Policy creation did not return');
    const container = result.value;
    expect(container.embedderPolicy.value).toBe('require-corp');
    expect(container.referrerPolicy).toBe('no-referrer');
    expect(container.cspList!.policies).toHaveLength(2);
    const flags = origin.mock.calls[0]![1];
    expect(flags).not.toBe(target.sandboxingFlags);
    expect(flags.has('sandboxed-forms')).toBe(true);
    expect(flags.has('sandboxed-scripts')).toBe(true);
    expect(flags.has('sandboxed-origin')).toBe(false);
    expect(target.sandboxingFlags).toEqual(new SandboxingFlagSet(['sandboxed-scripts']));
    expect(enforce.mock.calls[0]![1].kind).toBe('tuple');
  });

  it('determines an opaque response origin from enforced CSP sandboxing', async () => {
    const { begin, headers, enforce } = fixture();
    headers.append('Content-Security-Policy', 'sandbox');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(enforce.mock.calls[0]![1].kind).toBe('opaque');
  });

  it.each([false, true])('captures the departing COOP inputs before Fetch (initiating Document: %s)', async (initiating) => {
    const { begin, entry, document, enforce, transport, headers } = fixture();
    const previous = { url: document.url, origin: document.origin, openerPolicy: document.openerPolicy };
    if (initiating) entry.documentState.initiatorOrigin = document.origin;
    const connected = Promise.withResolvers<HTTPTransportListener>();
    transport.mockImplementation((_request, listener) => {
      connected.resolve(listener);
      return { pause() {}, resume() {}, abort() {} };
    });

    const pending = expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    const listener = await connected.promise;
    document.setURL(parseURL('https://later.test/').url!);
    document.origin = obtainURLOrigin(document.url);
    document.openerPolicy = new OpenerPolicy();
    listener.onHeaders(200, 'OK', headers, true);
    listener.onEnd();
    await pending;

    expect(enforce.mock.calls[0]![3]).toEqual({
      ...previous, currentContextIsNavigationSource: initiating,
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    });
  });

  it('does not treat relaxed document.domain values as the same navigation source', async () => {
    const { begin, entry, document, enforce } = fixture();
    const initiator = obtainURLOrigin(parseURL('https://other.test/').url!);
    if (initiator.kind !== 'tuple' || document.origin.kind !== 'tuple') throw new Error('Expected tuple origins');
    initiator.domain = document.origin.domain = { kind: 'domain', value: 'test' };
    entry.documentState.initiatorOrigin = initiator;
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(enforce.mock.calls[0]![3].currentContextIsNavigationSource).toBe(false);
  });

  it('enforces COOP with response COEP promotion, the reserved environment, and the request referrer', async () => {
    const { begin, headers, construct, enforce } = fixture();
    headers.append('Cross-Origin-Opener-Policy', 'same-origin');
    headers.append('Cross-Origin-Embedder-Policy', 'require-corp');
    const obtain = vi.spyOn(OpenerPolicy, 'obtain');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(construct).toHaveReturnedWith(expect.objectContaining({
      reservedClient: obtain.mock.calls[0]![1], referrer: enforce.mock.calls[0]![4],
    }));
    expect(enforce.mock.calls[0]![2].value).toBe('same-origin-plus-COEP');
    expect(enforce).toHaveReturnedWith(expect.objectContaining({ needsBrowsingContextGroupSwitch: true }));
  });

  it.each(['snapshot', 'response'])('rejects enforced COOP combined with %s sandbox flags', async (kind) => {
    const { begin, headers, target, enforce, abort } = fixture();
    headers.append('Cross-Origin-Opener-Policy', 'same-origin');
    if (kind === 'snapshot') target.sandboxingFlags.add('sandboxed-forms');
    else headers.append('Content-Security-Policy', 'sandbox allow-same-origin');
    await expect(begin()).resolves.toBeNull();
    expect(enforce).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
  });

  it('does not turn report-only COOP into a sandbox rejection', async () => {
    const { begin, headers, target, enforce } = fixture();
    headers.append('Cross-Origin-Opener-Policy-Report-Only', 'same-origin');
    target.sandboxingFlags.add('sandboxed-forms');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(enforce.mock.results[0]!.value).toMatchObject({
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: true,
    });
  });

  it('ignores COOP on an insecure response even if its target is sandboxed', async () => {
    const { begin, headers, target, entry, enforce } = fixture();
    entry.url = parseURL('http://incoming.test/').url!;
    headers.append('Cross-Origin-Opener-Policy', 'same-origin');
    target.sandboxingFlags.add('sandboxed-forms');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(enforce.mock.calls[0]![2].value).toBe('unsafe-none');
  });

  it('preserves the URL-scoped COOP reporting dependency and releases Fetch when it throws', async () => {
    const { begin, headers, document, sourceDocument, abort } = fixture();
    document.browsingContext!.group!.browsingContextSet.add(sourceDocument.browsingContext!);
    headers.append('Cross-Origin-Opener-Policy', 'same-origin; report-to="coop"');
    await expect(begin()).rejects.toThrow('COOP navigation reporting requires a URL-scoped Reporting queue');
    expect(abort).toHaveBeenCalledOnce();
  });

  it('uses each response URL for policy and origin as Location is followed', async () => {
    const { begin, headers, transport, entry, enforce } = fixture();
    headers.append('Location', 'https://redirected.test/final');
    transport.mockImplementation((request, listener) => {
      const initial = request.url.host?.kind === 'domain' && request.url.host.value === 'incoming.test';
      listener.onHeaders(initial ? 302 : 200, initial ? 'Found' : 'OK', initial ? headers : new FetchHeaders(), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    const state = entry.documentState;
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(serializeURL(enforce.mock.calls[0]![0])).toBe('https://incoming.test/path#fragment');
    expect(areSameOrigin(enforce.mock.calls[0]![1], obtainURLOrigin(parseURL('https://incoming.test/').url!))).toBe(true);
    expect(serializeURL(enforce.mock.calls[1]![0])).toBe('https://redirected.test/final#fragment');
    expect(areSameOrigin(enforce.mock.calls[1]![1], obtainURLOrigin(entry.url))).toBe(true);
    expect(entry.documentState).not.toBe(state);
    expect(entry.document).toBeNull();
  });

  it('inherits the initiator origin for about:blank without an HTTP request', async () => {
    const { begin, entry, sourceDocument, enforce, transport } = fixture();
    entry.url = parseURL('about:blank').url!;
    entry.documentState.initiatorOrigin = sourceDocument.origin;
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(transport).not.toHaveBeenCalled();
    expect(enforce.mock.calls[0]![1]).toBe(sourceDocument.origin);
  });

  it('does not apply a parent CORP check to a top-level response', async () => {
    const { begin, headers } = fixture();
    headers.append('Cross-Origin-Resource-Policy', 'same-origin');
    const corp = vi.spyOn(FetchResponse.prototype, 'isBlockedByCORP');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(corp).not.toHaveBeenCalled();
  });
});

describe('child navigation response CORP', () => {
  it.each(['require-corp', 'credentialless'] as const)('checks the parent %s policy, not the source or departing child', async (value) => {
    const { begin, parentDocument, document, sourceDocument, enforce, abort } = fixture(true);
    parentDocument.policyContainer.embedderPolicy.value = value;
    document.origin = sourceDocument.origin;
    const corp = vi.spyOn(FetchResponse.prototype, 'isBlockedByCORP');
    const obtain = vi.spyOn(OpenerPolicy, 'obtain');
    await expect(begin()).resolves.toBeNull();
    expect(corp).toHaveBeenCalledWith(
      parentDocument.origin, parentDocument.policyContainer.embedderPolicy, 'iframe', true, parentDocument.env,
    );
    expect(enforce).not.toHaveBeenCalled();
    expect(obtain).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });

  it.each(['same-origin', 'cross-origin permission'])('admits a child with %s under require-corp', async (permission) => {
    const { begin, parentDocument, headers, entry } = fixture(true);
    parentDocument.policyContainer.embedderPolicy.value = 'require-corp';
    if (permission === 'same-origin') parentDocument.origin = obtainURLOrigin(entry.url);
    else headers.append('Cross-Origin-Resource-Policy', 'cross-origin');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
  });

  it('reports through the parent environment without enforcing its report-only policy', async () => {
    const { begin, parentDocument, sourceDocument, env } = fixture(true);
    const policy = parentDocument.policyContainer.embedderPolicy;
    policy.reportOnlyValue = 'require-corp';
    policy.reportOnlyReportingEndpoint = 'parent-reports';
    const report = vi.spyOn(parentDocument.env, 'queueReport');
    const sourceReport = vi.spyOn(sourceDocument.env, 'queueReport');
    const childReport = vi.spyOn(env, 'queueReport');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(report).toHaveBeenCalledWith('coep', 'parent-reports', {
      type: 'corp', blockedURL: 'https://incoming.test/path', destination: 'iframe', disposition: 'reporting',
    });
    expect(sourceReport).not.toHaveBeenCalled();
    expect(childReport).not.toHaveBeenCalled();
  });

  it('ignores a lone CORP header when the parent does not require it for navigation', async () => {
    const { begin, headers } = fixture(true);
    headers.append('Cross-Origin-Resource-Policy', 'same-origin');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
  });

  it('does not apply HTTP CORP to a data response', async () => {
    const { begin, parentDocument, entry, transport } = fixture(true);
    parentDocument.policyContainer.embedderPolicy.value = 'require-corp';
    entry.url = parseURL('data:text/html,hello').url!;
    const corp = vi.spyOn(FetchResponse.prototype, 'isBlockedByCORP');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(corp).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

function fixture(child = false) {
  const userAgent = createManualUserAgent();
  const sourceNavigable = TopLevelTraversable.create(userAgent, null, 'source');
  const sourceDocument = sourceNavigable.activeDocument!;
  sourceDocument.setURL(parseURL('https://incoming.test/source').url!);
  sourceDocument.origin = obtainURLOrigin(sourceDocument.url);
  vi.spyOn(sourceNavigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(sourceDocument);
  const top = TopLevelTraversable.create(userAgent, null, 'target');
  const parentDocument = top.activeDocument!;
  parentDocument.setURL(parseURL('https://departing.test/').url!);
  parentDocument.origin = obtainURLOrigin(parentDocument.url);
  let navigable: Navigable = top;
  if (child) {
    const iframe = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
    const [, childDocument] = BrowsingContext.create(parentDocument, iframe, parentDocument.browsingContext!.group!);
    navigable = new Navigable(DocumentState.create(childDocument), top);
    iframe.contentNavigable = navigable;
    parentDocument.body!.appendChild(iframe);
  }
  const document = navigable.activeDocument!;
  const env = document.env;
  const entry = env.createSessionHistoryEntry(parseURL('https://incoming.test/path#fragment').url!, new DocumentState());
  const target = navigable.snapshotTargetParams();
  const headers = new FetchHeaders();
  const transport = mockHTTPTransport(userAgent, (_request, listener) => {
    listener.onHeaders(200, 'OK', headers, true);
    listener.onEnd();
  });
  const construct = vi.spyOn(entry, 'createNavigationRequest');
  const enforce = vi.spyOn(navigable.activeBrowsingContext!, 'enforceResponseOpenerPolicy');
  const abort = vi.spyOn(FetchController.prototype, 'abort');
  const begin = () => NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env);
  return { begin, entry, document, parentDocument, sourceDocument, env, headers, target, transport, construct, enforce, abort };
}
