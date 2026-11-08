import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { CSPList, ContentSecurityPolicy, CSPViolation } from '../../../../src/browlet/browsing/policy/csp/index';
import { PolicyContainer } from '../../../../src/browlet/browsing/policy/index';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment/index';
import { LinkProcessingOptions } from '../../../../src/browlet/loader/links/index';
import { FetchController, FetchHeaders, type HTTPTransportListener } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('navigation manual redirects', () => {
  it('continues the existing controller, inherits fragments, and retains a same-origin reservation', async () => {
    const { begin, transport, entry, env, next, abort } = fixture();
    const policies = vi.spyOn(env.userAgent, 'createPolicyContainerFromResponse');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(serializeURL(entry.url)).toBe('https://source.test/next#original');
    expect(policies.mock.calls[0]![1]).toBe(policies.mock.calls[1]![1]);
    expect(policies.mock.calls[0]![1]!.discarded).toBe(false);
  });

  it('separates redirected history state without changing neighboring entries or Navigation state', async () => {
    const { begin, entry, env, sourceDocument } = fixture();
    const old = entry.documentState;
    old.historyPolicyContainer = new PolicyContainer();
    old.historyPolicyContainer.referrerPolicy = 'no-referrer';
    old.requestReferrer = sourceDocument.url;
    old.requestReferrerPolicy = 'origin';
    old.initiatorOrigin = old.origin = sourceDocument.origin;
    old.aboutBaseURL = sourceDocument.url;
    old.everPopulated = old.reloadPending = true;
    old.navigableTargetName = 'retained-name';
    old.nestedHistories.push({ id: Symbol('child'), entries: [] });
    const diagnostics = old.notRestoredReasons = {
      src: null, id: null, name: null, url: sourceDocument.url,
      reasons: [{ reason: 'masked' }], children: [],
    };
    const peer = env.createSessionHistoryEntry(parseURL('https://source.test/start#peer').url!, old);
    entry.classicHistoryAPIState = env.serializeForStorage({ old: true });
    const navigationState = entry.navigationAPIState = env.serializeForStorage({ keep: true });

    // This deliberately supplied history policy cannot be restored for an HTTP URL;
    // the redirect must still copy it before the final policy-selection assertion.
    await expect(begin()).rejects.toThrow('This URL cannot restore policies from history');

    const state = entry.documentState;
    expect(state).not.toBe(old);
    expect(peer.documentState).toBe(old);
    expect(state.historyPolicyContainer).not.toBe(old.historyPolicyContainer);
    expect(state.historyPolicyContainer).toEqual(old.historyPolicyContainer);
    expect(state.requestReferrer).toBe(old.requestReferrer);
    expect(state.requestReferrerPolicy).toBe('origin');
    expect(state.initiatorOrigin).toBe(old.initiatorOrigin);
    expect(state.origin).toBe(old.origin);
    expect(state.aboutBaseURL).toBe(old.aboutBaseURL);
    expect(state.everPopulated).toBe(true);
    expect(state.navigableTargetName).toBe('retained-name');
    expect(state.document).toBeNull();
    expect(state.nestedHistories).toEqual([]);
    expect(state.notRestoredReasons).toBeNull();
    expect(peer.documentState.notRestoredReasons).toBe(diagnostics);
    expect(state.reloadPending).toBe(false);
    expect(old.reloadPending).toBe(true);
    expect(old.nestedHistories).toHaveLength(1);
    expect(env.deserialize(entry.classicHistoryAPIState)).toBeNull();
    expect(entry.navigationAPIState).toBe(navigationState);
  });

  it.each([301, 302, 303, 307, 308])('lets Fetch handle POST rewriting for %s and retains only replayable history data', async (status) => {
    const { begin, entry, transport } = fixture('/next#replacement', status);
    const resource = entry.documentState.resource = { requestBody: Uint8Array.of(1, 2, 3), requestContentType: 'text/plain' };
    const preserve = status === 307 || status === 308;
    let replayed: Uint8Array | null = null;
    transport.mockImplementation((request, listener) => {
      const initial = serializeURL(request.url, true).endsWith('/start');
      const respond = () => {
        listener.onHeaders(initial ? status : 200, initial ? 'Redirect' : 'OK',
          new FetchHeaders(initial ? [['Location', '/next#replacement']] : []), true);
        listener.onEnd();
      };
      if (!initial && preserve) {
        const body = request.body;
        if (body === null || body instanceof Uint8Array) throw new Error('Expected a replayed upload source');
        body.read().observe((bytes) => { replayed = bytes; respond(); }, (error) => listener.onError(error));
      } else { respond(); }
      return { pause() {}, resume() {}, abort() {} };
    });
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    expect(transport.mock.calls[0]![0].method).toBe('POST');
    const second = transport.mock.calls[1]![0];
    expect(second.method).toBe(preserve ? 'POST' : 'GET');
    expect(second.headers.get('Content-Type')).toBe(preserve ? 'text/plain' : null);
    expect(entry.documentState.resource).toBe(preserve ? resource : null);
    expect(serializeURL(entry.url)).toBe('https://source.test/next#replacement');
    if (preserve) {
      expect(replayed).toEqual(Uint8Array.of(1, 2, 3));
    } else {
      expect(second.body).toBeNull();
    }
  });

  it('discards a cross-origin reservation and reselects secure-context policy for the new response', async () => {
    const { begin, env, entry } = fixture('http://elsewhere.test/next');
    const policies = vi.spyOn(env.userAgent, 'createPolicyContainerFromResponse');
    const discard = vi.spyOn(BrowletEnvironmentBase.prototype, 'discard');
    await expect(begin()).resolves.toBeInstanceOf(NavigationParams);
    const first = policies.mock.calls[0]![1]!;
    const second = policies.mock.calls[1]![1]!;
    expect(first).not.toBe(second);
    expect(first.discarded).toBe(true);
    expect(second.discarded).toBe(false);
    expect(discard.mock.contexts).toEqual([first]);
    expect(second.creationURL).toBe(entry.url);
    expect(first.isSecureContext).toBe(true);
    expect(second.isSecureContext).toBe(false);
  });

  it.each([false, true])('retains Early Hints only across same-origin redirects (cross-origin: %s)', async (crossOrigin) => {
    const { begin, navigable, transport } = fixture(crossOrigin ? 'https://elsewhere.test/next' : '/next');
    const early = vi.spyOn(BrowletEnvironmentBase.prototype, 'processEarlyHintHeaders');
    const committed: string[] = [];
    vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) {
      this.onDocumentReady = () => { committed.push(this.href); };
    });
    transport.mockImplementation((request, listener) => {
      const initial = serializeURL(request.url, true).endsWith('/start');
      listener.onHeaders(103, 'Early Hints', new FetchHeaders([['Link', `${initial ? '</first>' : '</second>'}; rel=preload; as=script`]]), true);
      listener.onHeaders(initial ? 302 : 200, initial ? 'Found' : 'OK', new FetchHeaders(initial
        ? [['Location', crossOrigin ? 'https://elsewhere.test/next' : '/next']] : []), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    const params = await begin();
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    expect(early).toHaveBeenCalledTimes(crossOrigin ? 2 : 1);
    expect(params.commitEarlyHints).toBe(early.mock.results.at(-1)!.value);
    expect(params.reservedEnv).toBe(early.mock.contexts.at(-1));
    if (crossOrigin) expect(early.mock.contexts[1]).not.toBe(early.mock.contexts[0]);
    expect(early.mock.calls.map(([response]) => response.urlList.map((url) => serializeURL(url))))
      .toEqual(crossOrigin ? [
        ['https://source.test/start#original'],
        ['https://source.test/start#original', 'https://elsewhere.test/next#original'],
      ] : [['https://source.test/start#original']]);
    expect(committed).toEqual([]);
    params.commitEarlyHints!(navigable.activeDocument!);
    expect(committed).toEqual([crossOrigin ? '/second' : '/first']);
  });

  it('keeps both COOP switch results across a chain instead of restarting from the departing Document', async () => {
    const { begin, navigable, transport } = fixture();
    const enforce = vi.spyOn(navigable.activeBrowsingContext!, 'enforceResponseOpenerPolicy');
    transport.mockImplementation((request, listener) => {
      const initial = serializeURL(request.url, true).endsWith('/start');
      const headers = new FetchHeaders(initial ? [
        ['Location', '/next'], ['Cross-Origin-Opener-Policy', 'same-origin'],
        ['Cross-Origin-Opener-Policy-Report-Only', 'same-origin'],
      ] : []);
      listener.onHeaders(initial ? 302 : 200, initial ? 'Found' : 'OK', headers, true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    const params = await begin();
    if (!(params instanceof NavigationParams)) throw new Error('Expected navigation params');
    expect(params.coopEnforcementResult).toMatchObject({
      needsBrowsingContextGroupSwitch: true, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: true,
    });
    expect(params.openerPolicy.value).toBe('unsafe-none');
    const first = enforce.mock.results[0]!;
    if (first.type !== 'return') throw new Error('COOP enforcement did not return');
    expect(enforce.mock.calls[1]![3]).toBe(first.value);
    expect(first.value.needsBrowsingContextGroupSwitch).toBe(true);
    expect(first.value.wouldNeedBrowsingContextGroupSwitchDueToReportOnly).toBe(true);
  });

  it('rejects invalid Location without replacing history metadata', async () => {
    const { begin, entry, next, transport } = fixture('https://[invalid');
    const state = entry.documentState;
    const classic = entry.classicHistoryAPIState = entry.navigationAPIState;
    await expect(begin()).resolves.toBeNull();
    expect(next).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledOnce();
    expect(entry.documentState).toBe(state);
    expect(entry.classicHistoryAPIState).toBe(classic);
  });

  it('applies the final response\'s COOP/sandbox rejection after following an allowed redirect', async () => {
    const { begin, target, transport } = fixture();
    target.sandboxingFlags.add('sandboxed-forms');
    transport.mockImplementation((request, listener) => {
      const initial = serializeURL(request.url, true).endsWith('/start');
      listener.onHeaders(initial ? 302 : 200, initial ? 'Found' : 'OK', new FetchHeaders(initial
        ? [['Location', '/next']] : [['Cross-Origin-Opener-Policy', 'same-origin']]), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    await expect(begin()).resolves.toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(['about:blank', 'data:text/html,hi', 'blob:https://source.test/id', 'file:///local.html'])(
    'rejects a redirect to the non-HTTP Fetch scheme %s', async (url) => {
      const { begin, entry, next, transport } = fixture(url);
      entry.documentState.resource = { requestBody: Uint8Array.of(1), requestContentType: 'text/plain' };
      const old = entry.documentState;
      await expect(begin()).resolves.toBeNull();
      expect(next).not.toHaveBeenCalled();
      expect(transport).toHaveBeenCalledOnce();
      expect(entry.documentState).not.toBe(old);
      expect(entry.documentState.resource).toBeNull();
    },
  );

  it('returns non-fetch parameters with the last response origin and captured source/target inputs', async () => {
    const { begin, entry, source, target, transport, next } = fixture('mailto:user@example.test');
    source.hasTransientActivation = true;
    target.sandboxingFlags.add('sandboxed-origin');
    entry.documentState.resource = { requestBody: Uint8Array.of(1), requestContentType: 'text/plain' };
    const result = await begin();
    expect(result).toMatchObject({
      id: null, userInvolvement: 'none', navigationTimingType: 'navigate',
      sourceSnapshotHasTransientActivation: true, initiatorOrigin: { kind: 'opaque' },
    });
    if (result === null || result === undefined || result instanceof NavigationParams) throw new Error('Expected non-fetch params');
    expect(serializeURL(result.url)).toBe('mailto:user@example.test#original');
    expect(result.targetSnapshotSandboxingFlags).toBe(target.sandboxingFlags);
    expect(next).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledOnce();
    expect(entry.documentState.resource).toBeNull();
  });

  it('keeps Fetch\'s redirect limit instead of restarting Fetch for each response', async () => {
    const { begin, next, transport } = fixture();
    transport.mockImplementation((_request, listener) => {
      listener.onHeaders(302, 'Found', new FetchHeaders([['Location', `/hop-${transport.mock.calls.length}`]]), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    await expect(begin()).resolves.toBeNull();
    expect(transport).toHaveBeenCalledTimes(21);
    expect(next).toHaveBeenCalledTimes(21);
  });

  it('attributes a non-fetch handoff to the last redirect response instead of the initiating Document', async () => {
    const { begin, transport } = fixture();
    transport.mockImplementation((request, listener) => {
      const initial = serializeURL(request.url, true).endsWith('/start');
      listener.onHeaders(302, 'Found', new FetchHeaders([
        ['Location', initial ? 'https://elsewhere.test/next' : 'mailto:user@example.test'],
      ]), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    const result = await begin();
    expect(result).toMatchObject({ initiatorOrigin: obtainURLOrigin(parseURL('https://elsewhere.test/').url!) });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('wakes and aborts while waiting for a redirect response, including away-and-back ID changes', async () => {
    const { begin, transport, navigable, abort } = fixture();
    const waiting = Promise.withResolvers<HTTPTransportListener>();
    transport.mockImplementation((request, listener) => {
      if (serializeURL(request.url, true).endsWith('/start')) {
        listener.onHeaders(302, 'Found', new FetchHeaders([['Location', '/next']]), true);
        listener.onEnd();
      } else { waiting.resolve(listener); }
      return { pause() {}, resume() {}, abort() {} };
    });
    const pending = begin();
    const late = await waiting.promise;
    navigable.ongoingNavigation = 'replacement';
    navigable.ongoingNavigation = null;
    await expect(pending).resolves.toBeUndefined();
    expect(abort).toHaveBeenCalledOnce();
    late.onHeaders(200, 'OK', new FetchHeaders(), true);
    late.onEnd();
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe('navigation redirect CSP', () => {
  it.each([302, 307])('checks the pending target before sending a %s redirect', async (status) => {
    const { begin, transport, source, entry, next } = fixture('https://elsewhere.test/next', status);
    source.sourcePolicyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("form-action 'self'", 'header', 'enforce'));
    entry.documentState.resource = { requestBody: Uint8Array.of(1), requestContentType: 'text/plain' };
    await expect(begin('form-submission')).resolves.toBeNull();
    expect(transport).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it('reports a forbidden redirect without blocking under report-only policy', async () => {
    const { begin, transport, source } = fixture('https://elsewhere.test/next');
    source.sourcePolicyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("form-action 'self'", 'header', 'report'));
    const report = vi.spyOn(CSPViolation.prototype, 'report');
    await expect(begin('form-submission')).resolves.toBeInstanceOf(NavigationParams);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.contexts[0]).toMatchObject({ effectiveDirective: 'form-action', policy: { disposition: 'report' } });
  });

  it('rechecks a later redirect rather than validating only the first hop', async () => {
    const { begin, source, transport, next } = fixture();
    source.sourcePolicyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("form-action 'self'", 'header', 'enforce'));
    transport.mockImplementation((request, listener) => {
      const initial = serializeURL(request.url, true).endsWith('/start');
      listener.onHeaders(302, 'Found', new FetchHeaders([
        ['Location', initial ? '/allowed' : 'https://elsewhere.test/forbidden'],
      ]), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    await expect(begin('form-submission')).resolves.toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledOnce();
  });

  it('ignores form-action path restrictions after a redirect using the pending redirect count', async () => {
    const { begin, source, transport } = fixture();
    source.sourcePolicyContainer.cspList!.policies.push(
      ContentSecurityPolicy.parse('form-action https://source.test/start', 'header', 'enforce'),
    );
    await expect(begin('form-submission')).resolves.toBeInstanceOf(NavigationParams);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

function fixture(location = '/next', status = 302) {
  const userAgent = createManualUserAgent();
  const sourceNavigable = TopLevelTraversable.create(userAgent, null, 'source');
  const sourceDocument = sourceNavigable.activeDocument!;
  sourceDocument.setURL(parseURL('https://source.test/initiator').url!);
  sourceDocument.origin = obtainURLOrigin(sourceDocument.url);
  sourceDocument.policyContainer.cspList = new CSPList(sourceDocument.origin);
  vi.spyOn(sourceNavigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(sourceDocument);
  const navigable = TopLevelTraversable.create(userAgent, null, 'target');
  const env = navigable.activeDocument!.env;
  const entry = env.createSessionHistoryEntry(parseURL('https://source.test/start#original').url!, new DocumentState());
  const target = navigable.snapshotTargetParams();
  const transport = mockHTTPTransport(userAgent, (request, listener) => {
    const initial = serializeURL(request.url, true).endsWith('/start');
    listener.onHeaders(initial ? status : 200, initial ? 'Redirect' : 'OK',
      new FetchHeaders(initial ? [['Location', location]] : []), true);
    listener.onEnd();
  });
  const next = vi.spyOn(FetchController.prototype, 'processNextManualRedirect');
  const abort = vi.spyOn(FetchController.prototype, 'abort');
  const begin = (type: 'form-submission' | 'other' = 'other') =>
    NavigationParams.fromFetch(entry, navigable, source, target, type, 'none', null, 'navigate', env);
  return { begin, entry, navigable, source, sourceDocument, target, env, transport, next, abort };
}
