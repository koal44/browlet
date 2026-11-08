import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import type { PolicyContainer } from '../../../../src/browlet/browsing/policy/index';
import { CSPList, ContentSecurityPolicy, type CSPDisposition } from '../../../../src/browlet/browsing/policy/csp/index';
import { BrowletEnvironmentBase } from '../../../../src/browlet/environment/index';
import { LinkProcessingOptions } from '../../../../src/browlet/loader/links/index';
import { FetchController, FetchHeaders, type HTTPTransportListener } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('Fetch navigation request CSP', () => {
  it.each(['GET', 'POST'])('rejects a blocked %s form before Fetch and reports on the source Document', async (method) => {
    const { entry, navigable, source, target, env, sourceDocument, sourcePlatform, events, transport } = fixture();
    if (method === 'POST') entry.documentState.resource = { requestBody: Uint8Array.of(1), requestContentType: 'text/plain' };
    const construct = vi.spyOn(entry, 'createNavigationRequest');
    const targetEvent = vi.fn();
    (project(navigable.activeDocument!) as Document).addEventListener('securitypolicyviolation', targetEvent);

    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'none', 'blocked', 'navigate', env);

    expect(result).toBeInstanceOf(env.userAgent.HostPromise);
    await expect(result).resolves.toBeNull();
    expect(transport).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    expect(entry.document).toBeNull();
    expect(construct).toHaveReturnedWith(expect.objectContaining({
      method, client: sourceDocument.env, policyContainer: source.sourcePolicyContainer,
      reservedClient: expect.any(BrowletEnvironmentBase) as unknown,
    }));
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.target).toBe(sourcePlatform);
    expect({
      documentURI: event.documentURI, blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective,
      disposition: event.disposition, statusCode: event.statusCode, isTrusted: event.isTrusted,
    }).toEqual({
      documentURI: 'https://source.test/page', blockedURI: 'https://destination.test/path',
      effectiveDirective: 'form-action', disposition: 'enforce', statusCode: 201, isTrusted: true,
    });
    expect(targetEvent).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
  });

  it('checks the captured source policy even if the live source policy changes', async () => {
    const { entry, navigable, source, target, env, sourceDocument } = fixture();
    sourceDocument.policyContainer.cspList = new CSPList(sourceDocument.origin);
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'none', null, 'navigate', env))
      .resolves.toBeNull();
  });

  it('reports both dispositions when an enforcing policy blocks', async () => {
    const { entry, navigable, source, target, env, sourceDocument, events } = fixture();
    source.sourcePolicyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("form-action 'none'", 'header', 'report'));
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'none', null, 'navigate', env))
      .resolves.toBeNull();
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(events.map((event) => event.disposition)).toEqual(['enforce', 'report']);
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(false);
  });

  it('reports a report-only policy and then fetches the response', async () => {
    const { entry, navigable, source, target, env, sourceDocument, events } = fixture("form-action 'none'", 'report');
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'none', null, 'navigate', env))
      .resolves.toBeInstanceOf(NavigationParams);
    expect(events).toHaveLength(0);
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(events.map((event) => event.disposition)).toEqual(['report']);
  });

  it.each([
    ["form-action 'none'", 'other'],
    ["default-src 'none'", 'form-submission'],
    ["default-src 'none'", 'other'],
    ["connect-src 'none'", 'form-submission'],
    ["connect-src 'none'", 'other'],
    ['form-action https://destination.test', 'form-submission'],
  ] as const)('allows %s for %s without reporting', async (policy, type) => {
    const { entry, navigable, source, target, env, sourceDocument, events } = fixture(policy);
    // Neither the target's policy nor later changes to the source replace the snapshot.
    for (const document of [navigable.activeDocument!, sourceDocument]) {
      document.policyContainer.cspList = new CSPList(document.origin);
      document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("form-action 'none'", 'header', 'enforce'));
    }
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, type, 'none', null, 'navigate', env))
      .resolves.toBeInstanceOf(NavigationParams);
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('does not borrow a Window policy for a browser-UI request without a source client', async () => {
    const { entry, navigable, target, env, events } = fixture();
    const source = new SourceSnapshotParams(null);
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'browser UI', null, 'navigate', env))
      .resolves.toBeInstanceOf(NavigationParams);
    expect(events).toHaveLength(0);
  });

  it('settles the browser-owned result even when the source Document is inactive and cannot run script', async () => {
    const { entry, navigable, source, target, env, sourceDocument } = fixture();
    sourceDocument.browsingContext = null;
    expect(sourceDocument.isFullyActive()).toBe(false);
    expect(sourceDocument.env.canRunScript()).toBe(false);
    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'form-submission', 'none', null, 'navigate', env);
    await expect(result).resolves.toBeNull();
    // The source's violation task remains gated by its Document; it cannot gate the fetch result.
    expect(sourceDocument.env.responsibleEventLoop.runTaskTurn()).toBe(false);
  });

  it('delivers a blocked result to population, leaving error-Document creation explicit', async () => {
    const { entry, navigable, source, target, env } = fixture();
    const queue = vi.spyOn(env, 'queueTask');
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { cspNavigationType: 'form-submission' });
    await expect.poll(() => queue.mock.calls.length).toBe(1);
    expect(queue).toHaveBeenCalledWith('navigation-and-traversal', expect.any(Function), { discardSteps: undefined });
    expect(() => env.responsibleEventLoop.runTaskTurn()).toThrow('Inline user-agent Document rendering is not implemented');
    expect(entry.document).toBeNull();
  });
});

describe('parallel navigation Fetch delivery and cancellation', () => {
  it.each(['reload', 'back_forward'] as const)('fetches a %s owned by traversal without inventing a navigation ID', async (timing) => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    navigable.ongoingNavigation = 'traversal';
    const result = await NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, timing, env);
    expect(result).toBeInstanceOf(NavigationParams);
    expect(result).toMatchObject({ id: null, navigationTimingType: timing, request: { webDriverNavigationId: null } });
    expect(transport).toHaveBeenCalledOnce();
    expect(navigable.ongoingNavigation).toBe('traversal');
  });

  it.each([
    { id: null, ongoing: 'different-request' },
    { id: 'original', ongoing: 'traversal' },
  ])('does not adopt unrelated ownership ($id, $ongoing)', async ({ id, ongoing }) => {
    const { entry, navigable, source, target, env } = fixture('');
    navigable.ongoingNavigation = ongoing;
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', id, 'back_forward', env))
      .resolves.toBeUndefined();
    expect(navigable.ongoingNavigation).toBe(ongoing);
  });

  it.each([
    { next: null, restore: false }, { next: 'replacement', restore: false }, { next: 'replacement', restore: true },
  ])('cancels pending traversal Fetch on $next, including later traversal reuse: $restore', async ({ next, restore }) => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const connected = Promise.withResolvers<HTTPTransportListener>();
    const abort = vi.fn();
    transport.mockImplementation((_request, listener) => {
      connected.resolve(listener);
      return { pause() {}, resume() {}, abort };
    });
    navigable.ongoingNavigation = 'traversal';
    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'back_forward', env);
    const listener = await connected.promise;
    navigable.ongoingNavigation = 'traversal';
    expect(abort).not.toHaveBeenCalled();
    navigable.ongoingNavigation = next;
    if (restore) navigable.ongoingNavigation = 'traversal';
    await expect(result).resolves.toBeUndefined();
    expect(abort).toHaveBeenCalledOnce();
    listener.onHeaders(200, 'OK', new FetchHeaders(), true);
    listener.onEnd();
    expect(entry.document).toBeNull();
  });

  it('delivers completed parameters without either Window task loop and retains the live controller', async () => {
    const { entry, navigable, source, target, env, sourceDocument, transport } = fixture('');
    const construct = vi.spyOn(entry, 'createNavigationRequest');
    const sourceQueue = vi.spyOn(sourceDocument.env, 'queueTask');
    const targetQueue = vi.spyOn(env, 'queueTask');
    const aborted = vi.spyOn(FetchController.prototype, 'abort');
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env))
      .resolves.toBeInstanceOf(NavigationParams);
    expect(transport).toHaveBeenCalledOnce();
    expect(sourceQueue).not.toHaveBeenCalled();
    expect(targetQueue).not.toHaveBeenCalled();
    expect(construct).toHaveReturnedWith(expect.objectContaining({ env: env.userAgent.sandbox }));
    expect(aborted).not.toHaveBeenCalled();
  });

  it('returns null for a network failure without substituting an incoming Document', async () => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    transport.mockImplementation((_request, listener) => {
      listener.onError(new Error('connection failed'));
      return { pause() {}, resume() {}, abort() {} };
    });
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env))
      .resolves.toBeNull();
    expect(entry.document).toBeNull();
  });

  it('keeps request and body execution on the browser owner after the source becomes inactive', async () => {
    const { entry, navigable, source, target, env, sourceDocument, transport } = fixture('');
    const connected = Promise.withResolvers<HTTPTransportListener>();
    transport.mockImplementation((_request, listener) => {
      connected.resolve(listener);
      return { pause() {}, resume() {}, abort() {} };
    });
    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env);
    const finished = expect(result).resolves.toBeInstanceOf(NavigationParams);
    const listener = await connected.promise;
    sourceDocument.browsingContext = null;
    expect(sourceDocument.env.canRunScript()).toBe(false);
    listener.onHeaders(200, 'OK', new FetchHeaders(), true);
    listener.onEnd();
    await finished;
  });

  it.each([null, 'traversal', 'replacement'])('aborts a waiting Fetch when direct assignment changes the navigation to %s', async (nextId) => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const connected = Promise.withResolvers<HTTPTransportListener>();
    const abort = vi.fn();
    transport.mockImplementation((_request, listener) => {
      connected.resolve(listener);
      return { pause() {}, resume() {}, abort };
    });
    navigable.ongoingNavigation = 'original';
    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', 'original', 'navigate', env);
    const listener = await connected.promise;
    navigable.ongoingNavigation = nextId;
    await expect(result).resolves.toBeUndefined();
    expect(abort).toHaveBeenCalledOnce();
    // A late transport notification cannot resume the canceled navigation.
    listener.onHeaders(200, 'OK', new FetchHeaders(), true);
    listener.onEnd();
    expect(entry.document).toBeNull();
    expect(navigable.ongoingNavigation).toBe(nextId);
  });

  it('aborts through setOngoingNavigation too, without treating a same-ID assignment as cancellation', async () => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const connected = Promise.withResolvers<void>();
    const abort = vi.fn();
    transport.mockImplementation(() => {
      connected.resolve();
      return { pause() {}, resume() {}, abort };
    });
    navigable.ongoingNavigation = 'original';
    const result = NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', 'original', 'navigate', env);
    await connected.promise;
    navigable.setOngoingNavigation('original', env);
    expect(abort).not.toHaveBeenCalled();
    navigable.setOngoingNavigation('replacement', env);
    await expect(result).resolves.toBeUndefined();
    expect(abort).toHaveBeenCalledOnce();
  });

  it('completes canceled population even if a later navigation reuses the null ID', async () => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const connected = Promise.withResolvers<void>();
    transport.mockImplementation(() => {
      connected.resolve();
      return { pause() {}, resume() {}, abort() {} };
    });
    const complete = vi.fn();
    const inline = vi.spyOn(navigable, 'createDocumentForInlineContent');
    const queue = vi.spyOn(env, 'queueTask');
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { completionSteps: complete });
    await connected.promise;
    navigable.ongoingNavigation = 'intervening';
    navigable.ongoingNavigation = null;
    await expect.poll(() => queue.mock.calls.length).toBe(1);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(inline).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
  });

  it('makes Early Hints processing an explicit dependency and aborts its transport on failure', async () => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const abort = vi.fn();
    transport.mockImplementation((_request, listener) => {
      listener.onHeaders(103, 'Early Hints', new FetchHeaders([['Link', '</asset.css>; rel=preload; as=style']]), true);
      return { pause() {}, resume() {}, abort };
    });
    await expect(NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env))
      .rejects.toThrow('Link preload fetching and Document commitment are not implemented');
    expect(abort).toHaveBeenCalledOnce();
  });

  it('processes only the first Early Hints response with the incoming reserved environment', async () => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const commit = vi.fn();
    const policies = vi.spyOn(env.userAgent, 'createPolicyContainerFromResponse');
    let earlyPolicy: PolicyContainer | undefined;
    const early = vi.spyOn(BrowletEnvironmentBase.prototype, 'processEarlyHintHeaders');
    // Run real header preparation; control only the explicitly unfinished resource operation.
    vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) {
      earlyPolicy = this.policyContainer;
      this.onDocumentReady = commit;
    });
    const construct = vi.spyOn(entry, 'createNavigationRequest');
    transport.mockImplementation((_request, listener) => {
      listener.onHeaders(103, 'Early Hints', new FetchHeaders([
        ['Link', '<first.css>; rel=preload; as=style'],
        ['Content-Security-Policy', "style-src 'self'"], ['Referrer-Policy', 'origin'],
      ]), true);
      listener.onHeaders(103, 'Early Hints', new FetchHeaders([['Link', '</second.css>; rel=preload; as=style']]), true);
      listener.onHeaders(200, 'OK', new FetchHeaders(), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    const params = await NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env);
    assert(params instanceof NavigationParams);
    expect(params.commitEarlyHints).toBe(early.mock.results[0]!.value);
    expect(early).toHaveBeenCalledOnce();
    expect(early.mock.calls[0]![0].headerList.get('Link')).toContain('first.css');
    expect(early.mock.calls[0]![0].url).toEqual(entry.url);
    expect(early.mock.contexts[0]).toBeInstanceOf(BrowletEnvironmentBase);
    expect(construct).toHaveReturnedWith(expect.objectContaining({ reservedClient: early.mock.contexts[0] }));
    expect(policies.mock.calls[0]).toEqual([early.mock.calls[0]![0], early.mock.contexts[0]]);
    assert(earlyPolicy);
    expect(earlyPolicy.cspList?.selfOrigin).toEqual(obtainURLOrigin(entry.url));
    expect(earlyPolicy.cspList?.policies[0]?.directives.has('style-src')).toBe(true);
    expect(earlyPolicy.referrerPolicy).toBe('origin');
    const finalPolicy = params.policyContainer;
    expect(finalPolicy).not.toBe(earlyPolicy);
    expect(finalPolicy.cspList?.policies).toEqual([]);
    // No final Referrer-Policy field: retain the parser's empty policy, whose fallback is selected by Fetch.
    expect(finalPolicy.referrerPolicy).toBe('');
    expect(commit).not.toHaveBeenCalled();
  });

  it.each([null, '<ignored>; rel=unknown', '<invalid>; rel=preload'])('retains the first hint callback without starting a resource: %s', async (link) => {
    const { entry, navigable, source, target, env, transport } = fixture('');
    const early = vi.spyOn(BrowletEnvironmentBase.prototype, 'processEarlyHintHeaders');
    transport.mockImplementation((_request, listener) => {
      listener.onHeaders(103, 'Early Hints', new FetchHeaders(link === null ? [] : [['Link', link]]), true);
      // This later valid preload must be ignored, rather than reaching the resource dependency.
      listener.onHeaders(103, 'Early Hints', new FetchHeaders([['Link', '</ignored.css>; rel=preload; as=style']]), true);
      listener.onHeaders(200, 'OK', new FetchHeaders(), true);
      listener.onEnd();
      return { pause() {}, resume() {}, abort() {} };
    });
    const params = await NavigationParams.fromFetch(entry, navigable, source, target, 'other', 'none', null, 'navigate', env);
    assert(params instanceof NavigationParams);
    expect(early).toHaveBeenCalledOnce();
    expect(params.commitEarlyHints).toBe(early.mock.results[0]!.value);
    expect(params.commitEarlyHints).toBeTypeOf('function');
  });
});

function fixture(policy = "form-action 'none'", disposition: CSPDisposition = 'enforce') {
  const userAgent = createManualUserAgent();
  const transport = mockHTTPTransport(userAgent, (_request, listener) => {
    listener.onHeaders(200, 'OK', new FetchHeaders(), true);
    listener.onEnd();
  });
  const sourceNavigable = TopLevelTraversable.create(userAgent, null, 'source');
  const sourceDocument = sourceNavigable.activeDocument!;
  sourceDocument.setURL(parseURL('https://source.test/page#fragment').url!);
  sourceDocument.origin = obtainURLOrigin(sourceDocument.url);
  sourceDocument.httpStatus = 201;
  sourceDocument.policyContainer.cspList = new CSPList(sourceDocument.origin);
  sourceDocument.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse(policy, 'header', disposition));
  vi.spyOn(sourceNavigable.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const source = new SourceSnapshotParams(sourceDocument);
  const navigable = TopLevelTraversable.create(userAgent, null, 'target');
  const env = navigable.activeDocument!.env;
  const entry = env.createSessionHistoryEntry(parseURL('https://destination.test/path#entry').url!, new DocumentState());
  const target = navigable.snapshotTargetParams();
  const events: SecurityPolicyViolationEvent[] = [];
  const sourcePlatform = project(sourceDocument) as Document;
  sourcePlatform.addEventListener('securitypolicyviolation', (event) => events.push(event));
  return { entry, navigable, source, target, env, sourceDocument, sourcePlatform, events, transport };
}
