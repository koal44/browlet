import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type PopulateHistoryEntryOptions } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams, type NonFetchSchemeNavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams, type PostResource } from '../../../../src/browlet/browsing/navigation/state/index';
import { PolicyContainer } from '../../../../src/browlet/browsing/policy/index';
import { ContentSecurityPolicy, CSPList, CSPViolation } from '../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { BrowletEnvironmentBase, type BrowletEnvironment } from '../../../../src/browlet/environment/index';
import { ResourceReader } from '../../../../src/browlet/loader/resource-reader';
import type { PerformanceNavigationTiming, Window } from '../../../../src/browlet/platform';
import { FetchHeaders, FetchRequest, FetchResponse } from '../../../../src/fetch/index';
import { internalType } from '../../../../src/infra/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

const htmlLoaderDependency = 'HTML document loading requires response-reader setup and parser script preparation';

describe('history-entry population selection and delivery', () => {
  it('delivers a traversal-owned response with a null navigation ID to its Document loader', async () => {
    const { navigable, entry, source, target, failures } = await fixture();
    const params = suppliedParams(navigable);
    const load = vi.spyOn(navigable, 'loadDocument');
    const complete = vi.fn();
    const failed = vi.fn();
    navigable.ongoingNavigation = 'traversal';
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'none', {
      navigationParams: params, completionSteps: complete, failureSteps: failed,
    });
    await expect.poll(() => complete.mock.calls.length + failed.mock.calls.length + failures.length).toBe(1);
    expect(load).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: htmlLoaderDependency }));
    expect(failures).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(params.id).toBeNull();
  });

  it.each([null, 'replacement'])('cancels queued traversal response delivery when ownership changes to %s', async (next) => {
    const { navigable, entry, source, target, failures } = await fixture();
    const params = suppliedParams(navigable);
    const load = vi.spyOn(navigable, 'loadDocument');
    const complete = vi.fn();
    navigable.ongoingNavigation = 'traversal';
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'none', {
      navigationParams: params, completionSteps: complete,
    });
    navigable.ongoingNavigation = next;
    await expect.poll(() => complete.mock.calls.length + failures.length).toBe(1);
    expect(complete).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(failures).toEqual([]);
  });

  it('uses a supplied response even when the retained resource would select srcdoc', async () => {
    const { navigable, entry, source, target, env, failures, queue } = await fixture();
    entry.documentState.resource = 'ignored';
    const params = suppliedParams(navigable);
    const srcdoc = vi.spyOn(NavigationParams, 'fromSrcdoc');
    const fetch = vi.spyOn(NavigationParams, 'fromFetch');
    const load = vi.spyOn(navigable, 'loadDocument');
    const complete = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    expect(queue).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function), { discardSteps: undefined });
    expect(srcdoc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(env.responsibleEventLoop.currentlyRunningTask).toBeNull();
    await expect.poll(() => failures.length).toBe(1);
    expect(load).toHaveBeenCalledExactlyOnceWith(params, source, entry.documentState.initiatorOrigin, expect.any(ResourceReader));
    expect(failures[0]).toEqual(expect.objectContaining({ message: htmlLoaderDependency }));
    expect(entry.document).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['https://example.test/next', 'mailto:somebody@example.test'])('selects a string resource before the %s scheme', async (url) => {
    const { navigable, entry, source, target, env, failures } = await fixture();
    entry.url = parseURL(url).url!;
    entry.documentState.resource = '';
    // Parameter contents are covered below; this isolates selection on a top-level fixture.
    const params = suppliedParams(navigable);
    const srcdoc = vi.spyOn(NavigationParams, 'fromSrcdoc').mockReturnValue(params);
    const fetch = vi.spyOn(NavigationParams, 'fromFetch');
    const external = vi.spyOn(navigable, 'attemptToCreateNonFetchSchemeDocument');
    navigable.ongoingNavigation = 'srcdoc';
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'activation', { navigationId: 'srcdoc' });
    expect(srcdoc).toHaveBeenCalledExactlyOnceWith(entry, navigable, target, 'activation', 'srcdoc', 'back_forward', env);
    expect(fetch).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: htmlLoaderDependency }));
  });

  it.each([
    [null, undefined, true], [null, false, true], ['bytes', undefined, false],
    ['bytes', false, false], ['bytes', true, true], ['failure', true, false], ['failure', false, false],
  ] as const)('selects Fetch for resource %s, allowPOST %s: %s', async (body, allowPOST, shouldFetch) => {
    const { navigable, entry, source, target, env, failures, queue } = await fixture();
    const resource: PostResource | null = body === null ? null : {
      requestBody: body === 'failure' ? 'failure' : Uint8Array.of(10, 20), requestContentType: 'text/plain',
    };
    entry.documentState.resource = resource;
    const pending = env.userAgent.HostPromise.withResolvers(internalType<NavigationParams | NonFetchSchemeNavigationParams | null>());
    const fetch = vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const complete = vi.fn();
    navigable.ongoingNavigation = 'fetch';
    navigable.populateHistoryEntryDocument(entry, 'reload', source, target, 'browser UI', {
      navigationId: 'fetch', cspNavigationType: 'form-submission', allowPOST, completionSteps: complete,
    });
    if (shouldFetch) {
      expect(fetch).toHaveBeenCalledExactlyOnceWith(entry, navigable, source, target, 'form-submission', 'browser UI', 'fetch', 'reload', env);
      expect(queue).not.toHaveBeenCalled();
      pending.resolve(null);
    } else {
      expect(fetch).not.toHaveBeenCalled();
    }
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Inline user-agent Document creation is not implemented' }));
    expect(entry.documentState.resource).toBe(resource);
    expect(resource?.requestBody).toEqual(body === 'failure' ? 'failure' : body === null ? undefined : Uint8Array.of(10, 20));
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not treat any non-fetch scheme as an implicit Fetch request, even with POST data', async () => {
    const { navigable, entry, source, target, env, failures, queue } = await fixture();
    entry.url = parseURL('mailto:somebody@example.test').url!;
    entry.documentState.resource = { requestBody: 'failure', requestContentType: 'text/plain' };
    source.hasTransientActivation = false;
    target.sandboxingFlags.add('sandboxed-downloads');
    const fetch = vi.spyOn(NavigationParams, 'fromFetch');
    const handoff = vi.spyOn(navigable, 'attemptToCreateNonFetchSchemeDocument').mockReturnValue(null);
    const complete = vi.fn(() => { expect(env.responsibleEventLoop.currentlyRunningTask).not.toBeNull(); });
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'none', { allowPOST: true, completionSteps: complete });
    expect(handoff).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(queue).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function), { discardSteps: undefined });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(handoff).toHaveBeenCalledExactlyOnceWith({
      id: null, url: entry.url, targetSnapshotSandboxingFlags: target.sandboxingFlags,
      sourceSnapshotHasTransientActivation: false, initiatorOrigin: entry.documentState.initiatorOrigin,
      navigationTimingType: 'back_forward', userInvolvement: 'none',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(entry.documentState.everPopulated).toBe(false);
    expect(failures).toEqual([]);
  });

  it('routes a non-fetch Fetch redirect with its supplied origin and captures the completion callback', async () => {
    const { navigable, entry, source, target, env, failures } = await fixture();
    const pending = env.userAgent.HostPromise.withResolvers(internalType<NavigationParams | NonFetchSchemeNavigationParams | null>());
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const select = vi.spyOn(env.userAgent, 'shouldHandleURLExternally').mockReturnValue(true);
    const handoff = vi.spyOn(env.userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});
    const complete = vi.fn();
    const replacement = vi.fn();
    const options = { completionSteps: complete };
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', options);
    options.completionSteps = replacement;
    const redirect: NonFetchSchemeNavigationParams = {
      id: null, url: parseURL('custom:destination').url!, targetSnapshotSandboxingFlags: target.sandboxingFlags,
      sourceSnapshotHasTransientActivation: true, initiatorOrigin: obtainURLOrigin(parseURL('https://redirector.test/').url!),
      navigationTimingType: 'navigate', userInvolvement: 'none',
    };
    pending.resolve(redirect);
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(select).toHaveBeenCalledExactlyOnceWith(redirect.url);
    expect(handoff).toHaveBeenCalledExactlyOnceWith(redirect.url, navigable, true, redirect.initiatorOrigin, undefined);
    expect(replacement).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(failures).toEqual([]);
  });

  it('queues a delayed result on the newly active Window even after the original Document becomes inactive', async () => {
    const { document, navigable, entry, source, target, env, failures, queue } = await fixture();
    const pending = env.userAgent.HostPromise.withResolvers(internalType<NavigationParams | NonFetchSchemeNavigationParams | null>());
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const complete = vi.fn();
    navigable.ongoingNavigation = 'original';
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', {
      navigationId: 'original', completionSteps: complete,
    });
    const [, replacement] = BrowsingContext.create(document, null, navigable.activeBrowsingContext!.group!);
    const replacementQueue = vi.spyOn(replacement.env, 'queueTask');
    const replacementEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));
    navigable.activeSessionHistoryEntry = replacementEntry;
    navigable.ongoingNavigation = 'replacement';
    expect(document.isFullyActive()).toBe(false);
    pending.resolve(null);
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(replacementQueue).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function), { discardSteps: undefined });
    expect(queue).not.toHaveBeenCalled();
    expect(navigable.activeSessionHistoryEntry).toBe(replacementEntry);
    expect(entry.document).toBeNull();
    expect(failures).toEqual([]);
  });

  it('reports an internal Fetch failure without converting it into an error page or successful completion', async () => {
    const { navigable, entry, source, target, env, failures, queue } = await fixture();
    const failure = new Error('Fetch owner failure');
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(
      env.userAgent.HostPromise.reject(failure, internalType<NavigationParams | NonFetchSchemeNavigationParams | null>()),
    );
    const turns: (() => void)[] = [];
    vi.spyOn(env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
    const complete = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { completionSteps: complete });
    await expect.poll(() => turns.length).toBe(1);
    expect(turns[0]).toThrow(failure);
    expect(queue).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(failures).toEqual([]);
  });

  it.each(['direct', 'fetch'] as const)('completes superseded %s work without processing a response or changing history', async (kind) => {
    const { navigable, entry, source, target, env, failures } = await fixture();
    const pending = env.userAgent.HostPromise.withResolvers(internalType<NavigationParams | NonFetchSchemeNavigationParams | null>());
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(pending.promise);
    const external = vi.spyOn(navigable, 'attemptToCreateNonFetchSchemeDocument');
    const active = navigable.activeSessionHistoryEntry;
    const complete = vi.fn();
    const params = kind === 'direct' ? suppliedParams(navigable) : undefined;
    navigable.ongoingNavigation = 'original';
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', {
      navigationId: 'original', navigationParams: params, completionSteps: complete,
    });
    navigable.ongoingNavigation = 'replacement';
    if (kind === 'fetch') pending.resolve(null);
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(external).not.toHaveBeenCalled();
    expect(navigable.activeSessionHistoryEntry).toBe(active);
    expect(navigable.currentSessionHistoryEntry).toBe(active);
    expect(entry.document).toBeNull();
    expect(entry.documentState.everPopulated).toBe(false);
    expect(failures).toEqual([]);
  });

  it('marks a returned non-fetch Document populated without overwriting retained state or committing it', async () => {
    const { document, navigable, entry, source, target, failures } = await fixture();
    entry.url = parseURL('custom:page').url!;
    const origin = entry.documentState.origin;
    const policy = entry.documentState.historyPolicyContainer = new PolicyContainer();
    const active = navigable.activeSessionHistoryEntry;
    vi.spyOn(navigable, 'attemptToCreateNonFetchSchemeDocument').mockReturnValue(document);
    const complete = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(entry.document).toBe(document);
    expect(entry.documentState.everPopulated).toBe(true);
    expect(entry.documentState.origin).toBe(origin);
    expect(entry.documentState.historyPolicyContainer).toBe(policy);
    expect(entry.documentState.requestReferrer).toBeUndefined();
    expect(navigable.activeSessionHistoryEntry).toBe(active);
    expect(navigable.currentSessionHistoryEntry).toBe(active);
    expect(failures).toEqual([]);
  });

  it('dispatches Fetch while Document loading and external handler selection remain explicit boundaries', async () => {
    const { navigable, entry, source, target, env, failures } = await fixture();
    mockHTTPTransport(env.userAgent, (_, listener) => {
      listener.onHeaders(200, 'OK', new FetchHeaders([['Content-Type', 'text/html']]), true);
      listener.onEnd();
    });
    const runInParallel = env.userAgent.runInParallel.bind(env.userAgent);
    vi.spyOn(env.userAgent, 'runInParallel').mockImplementation((steps) => runInParallel(() => {
      try { steps(); } catch (error) { failures.push(error); }
    }));
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none');
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: htmlLoaderDependency }));
    entry.url = parseURL('custom:destination').url!;
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none');
    await expect.poll(() => failures.length).toBe(2);
    expect(failures[1]).toEqual(expect.objectContaining({ message: 'External URL handler selection is not implemented' }));
  });
});

describe('history-entry response admission', () => {
  it('runs incoming CSP before COEP and X-Frame-Options on the target task', async () => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    const list = params.policyContainer.cspList!;
    list.policies.push(ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'enforce'));
    params.response.headerList.append('X-Frame-Options', 'DENY');
    const check = vi.spyOn(list, 'isNavigationResponseBlocked');
    const coep = vi.spyOn(child, 'checkResponseEmbedderPolicy');
    const xfo = vi.spyOn(child, 'checkResponseFrameOptions');
    const report = vi.spyOn(CSPViolation.prototype, 'report');
    const inline = vi.spyOn(child, 'createDocumentForInlineContent');
    const complete = vi.fn();
    const options: PopulateHistoryEntryOptions = { navigationParams: params, cspNavigationType: 'form-submission', completionSteps: complete };
    child.populateHistoryEntryDocument(entry, 'reload', source, target, 'activation', options);
    options.cspNavigationType = 'other';
    expect(check).not.toHaveBeenCalled();
    await expect.poll(() => failures.length).toBe(1);
    expect(check).toHaveBeenCalledExactlyOnceWith(null, params.response, 'form-submission', child, env.userAgent);
    expect(report).toHaveBeenCalledOnce();
    expect(coep).not.toHaveBeenCalled();
    expect(xfo).not.toHaveBeenCalled();
    expect(inline).toHaveBeenCalledExactlyOnceWith(null, 'reload', 'activation');
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Inline user-agent Document creation is not implemented' }));
    expect(complete).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(params.reservedEnv!.discarded).toBe(false);
  });

  it('continues through COEP and X-Frame-Options after a report-only CSP violation', async () => {
    const { child, entry, source, target, failures, params } = await responseFixture();
    const list = params.policyContainer.cspList!;
    list.policies.push(ContentSecurityPolicy.parse("frame-ancestors 'none'", 'header', 'report'));
    const check = vi.spyOn(list, 'isNavigationResponseBlocked');
    const coep = vi.spyOn(child, 'checkResponseEmbedderPolicy');
    const xfo = vi.spyOn(child, 'checkResponseFrameOptions');
    const report = vi.spyOn(CSPViolation.prototype, 'report');
    const inline = vi.spyOn(child, 'createDocumentForInlineContent');
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params });
    await expect.poll(() => failures.length).toBe(1);
    expect(check).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledOnce();
    expect(coep).toHaveBeenCalledExactlyOnceWith(params.response, params.policyContainer.embedderPolicy);
    expect(xfo).toHaveBeenCalledExactlyOnceWith(params.response, list);
    expect(check.mock.invocationCallOrder[0]).toBeLessThan(coep.mock.invocationCallOrder[0]!);
    expect(coep.mock.invocationCallOrder[0]).toBeLessThan(xfo.mock.invocationCallOrder[0]!);
    expect(inline).not.toHaveBeenCalled();
    expect(failures[0]).toEqual(expect.objectContaining({ message: htmlLoaderDependency }));
    expect(params.reservedEnv!.discarded).toBe(false);
  });

  it.each(['enforce', 'report'] as const)('honors %s frame-ancestors precedence over X-Frame-Options', async (disposition) => {
    const { child, entry, source, target, failures, params } = await responseFixture();
    params.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse('frame-ancestors *', 'header', disposition));
    params.response.headerList.append('X-Frame-Options', 'DENY');
    const inline = vi.spyOn(child, 'createDocumentForInlineContent');
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params });
    await expect.poll(() => failures.length).toBe(1);
    expect(inline).toHaveBeenCalledTimes(disposition === 'enforce' ? 0 : 1);
    expect(failures[0]).toEqual(expect.objectContaining({
      message: disposition === 'enforce' ? htmlLoaderDependency
        : 'Inline user-agent Document creation is not implemented',
    }));
  });

  it.each([false, true])('runs COEP only with a reserved environment (reserved: %s)', async (reserved) => {
    const { document, child, entry, source, target, failures, params } = await responseFixture();
    document.policyContainer.embedderPolicy.value = 'require-corp';
    if (!reserved) params.reservedEnv = null;
    const coep = vi.spyOn(child, 'checkResponseEmbedderPolicy');
    const xfo = vi.spyOn(child, 'checkResponseFrameOptions');
    const inline = vi.spyOn(child, 'createDocumentForInlineContent');
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params });
    await expect.poll(() => failures.length).toBe(1);
    expect(coep).toHaveBeenCalledTimes(reserved ? 1 : 0);
    expect(xfo).toHaveBeenCalledTimes(reserved ? 0 : 1);
    expect(inline).toHaveBeenCalledTimes(reserved ? 1 : 0);
    expect(failures[0]).toEqual(expect.objectContaining({
      message: reserved ? 'Inline user-agent Document creation is not implemented'
        : htmlLoaderDependency,
    }));
  });

  it.each([undefined, null, 'https://retained.test/'])(
    'retains error-page history metadata and resolves only an unset request referrer (%s)', async (retainedReferrer) => {
      const { document, child, entry, source, target, env, failures, params } = await responseFixture();
      const { errorDocument, inline } = provideInlineDocument(child, document);
      params.response.headerList.append('X-Frame-Options', 'DENY');
      const request = params.request = new FetchRequest(params.url, env);
      request.client = document.env;
      request.referrer = parseURL('https://source.test/submitted').url!;
      const referrer = entry.documentState.requestReferrer = typeof retainedReferrer === 'string'
        ? parseURL(retainedReferrer).url! : retainedReferrer;
      const policy = entry.documentState.historyPolicyContainer = new PolicyContainer();
      const origin = entry.documentState.origin;
      const active = child.activeSessionHistoryEntry;
      const reserved = params.reservedEnv!;
      const discard = vi.spyOn(reserved, 'discard');
      const failed = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationFailed').mockImplementation((navigable, status) => {
        expect(navigable).toBe(child);
        expect(status).toEqual({ id: 'failed', status: 'canceled', url: params.url });
        expect(entry.document).toBe(errorDocument);
        expect(errorDocument.salvageable).toBe(false);
        expect(reserved.discarded).toBe(true);
        expect(entry.documentState.everPopulated).toBe(false);
      });
      const complete = vi.fn();
      child.ongoingNavigation = 'failed';
      params.id = 'different-params-id';
      child.populateHistoryEntryDocument(entry, 'reload', source, target, 'activation', {
        navigationId: 'failed', navigationParams: params, completionSteps: complete,
      });
      await expect.poll(() => complete.mock.calls.length).toBe(1);
      expect(inline).toHaveBeenCalledExactlyOnceWith(null, 'reload', 'activation');
      expect(discard).toHaveBeenCalledOnce();
      expect(failed).toHaveBeenCalledOnce();
      expect(errorDocument.bfcacheBlockingDetails).toContainEqual({ reason: 'navigation-failure' });
      expect(entry.documentState.everPopulated).toBe(true);
      expect(entry.documentState.origin).toBe(origin);
      expect(entry.documentState.origin).not.toBe(errorDocument.origin);
      expect(entry.documentState.historyPolicyContainer).toBe(policy);
      expect(entry.documentState.requestReferrer).toBe(referrer === undefined ? request.referrer : referrer);
      expect(child.activeSessionHistoryEntry).toBe(active);
      expect(child.currentSessionHistoryEntry).toBe(active);
      expect(failures).toEqual([]);
    },
  );

  it('completes a null Fetch result without inventing response or reserved-environment metadata', async () => {
    const { document, child, entry, source, target, env, failures, params } = await responseFixture();
    const { errorDocument } = provideInlineDocument(child, document);
    vi.spyOn(NavigationParams, 'fromFetch').mockReturnValue(
      env.userAgent.HostPromise.resolve(null, internalType<NavigationParams | NonFetchSchemeNavigationParams | null>()),
    );
    const coep = vi.spyOn(child, 'checkResponseEmbedderPolicy');
    const xfo = vi.spyOn(child, 'checkResponseFrameOptions');
    const failed = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationFailed');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(entry.document).toBe(errorDocument);
    expect(entry.documentState.everPopulated).toBe(true);
    expect(entry.documentState.requestReferrer).toBeUndefined();
    expect(errorDocument.salvageable).toBe(false);
    expect(coep).not.toHaveBeenCalled();
    expect(xfo).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(params.reservedEnv!.discarded).toBe(false);
    expect(failures).toEqual([]);
  });

  it('preserves a synthetic response\'s null reservation and reports its null navigation ID', async () => {
    const { document, child, entry, source, target, env, failures, params } = await responseFixture();
    provideInlineDocument(child, document);
    params.reservedEnv = null;
    params.response.headerList.append('X-Frame-Options', 'DENY');
    entry.documentState.requestReferrer = null;
    const discard = vi.spyOn(env, 'discard');
    const failed = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationFailed');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(discard).not.toHaveBeenCalled();
    expect(params.reservedEnv).toBeNull();
    expect(entry.documentState.requestReferrer).toBeNull();
    expect(failed).toHaveBeenCalledExactlyOnceWith(child, { id: null, status: 'canceled', url: params.url });
    expect(failures).toEqual([]);
  });

  it('keeps unresolved synthetic history-referrer persistence explicit', async () => {
    const { document, child, entry, source, target, failures, params } = await responseFixture();
    provideInlineDocument(child, document);
    params.reservedEnv = null;
    params.response.headerList.append('X-Frame-Options', 'DENY');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Synthetic navigation history referrer capture is not implemented' }));
    expect(entry.documentState.requestReferrer).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('history-entry responses without a Document', () => {
  it.each([204, 205])('completes %s on the target task without changing history or discarding the reservation', async (status) => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.status = status;
    const active = child.activeSessionHistoryEntry;
    const state = { ...entry.documentState };
    const policy = vi.spyOn(env.userAgent, 'isNavigationDownloadAllowed');
    const download = vi.spyOn(env.userAgent, 'handleAsDownload');
    const failed = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationFailed');
    const complete = vi.fn(() => {
      expect(env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      expect(entry.document).toBeNull();
    });
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    expect(complete).not.toHaveBeenCalled();
    await expect.poll(() => complete.mock.calls.length + failures.length).toBe(1);
    expect(failures).toEqual([]);
    expect(complete).toHaveBeenCalledOnce();
    expect(policy).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(entry.documentState).toEqual(state);
    expect(child.activeSessionHistoryEntry).toBe(active);
    expect(child.currentSessionHistoryEntry).toBe(active);
    expect(params.reservedEnv!.discarded).toBe(false);
  });

  it.each([
    { sourceAllows: false, targetAllows: true },
    { sourceAllows: true, targetAllows: false },
    { sourceAllows: false, targetAllows: false },
  ])('completes a sandbox-blocked attachment (source: $sourceAllows, target: $targetAllows)', async ({ sourceAllows, targetAllows }) => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.headerList.append('Content-Disposition', 'attachment');
    source.allowsDownloading = sourceAllows;
    if (!targetAllows) params.finalSandboxingFlagSet.add('sandboxed-downloads');
    const policy = vi.spyOn(env.userAgent, 'isNavigationDownloadAllowed');
    const download = vi.spyOn(env.userAgent, 'handleAsDownload');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(policy).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(entry.documentState.everPopulated).toBe(false);
    expect(failures).toEqual([]);
  });

  it('completes when browser download policy declines an attachment', async () => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.headerList.append('Content-Disposition', 'attachment');
    const policy = vi.spyOn(env.userAgent, 'isNavigationDownloadAllowed').mockReturnValue(false);
    const download = vi.spyOn(env.userAgent, 'handleAsDownload');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(policy).toHaveBeenCalledExactlyOnceWith(params.response, source);
    expect(download).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
    expect(entry.documentState.everPopulated).toBe(false);
    expect(failures).toEqual([]);
  });

  it.each([
    { status: 200, id: null }, { status: 204, id: 'download' }, { status: 205, id: 'download' },
  ])('hands off an allowed attachment before empty-response completion ($status, $id)', async ({ status, id }) => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.status = status;
    params.response.headerList.append('Content-Disposition', 'attachment; filename="a.html"');
    params.id = 'different-params-id';
    child.ongoingNavigation = id;
    // Only the captured source permission and final target flags govern this branch.
    source.sandboxingFlags.add('sandboxed-downloads');
    child.activeDocument!.activeSandboxingFlagSet.add('sandboxed-downloads');
    const state = { ...entry.documentState };
    const policy = vi.spyOn(env.userAgent, 'isNavigationDownloadAllowed').mockReturnValue(true);
    const download = vi.spyOn(env.userAgent, 'handleAsDownload').mockImplementation(() => {
      expect(entry.document).toBeNull();
    });
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', {
      navigationId: id, navigationParams: params, completionSteps: complete,
    });
    await expect.poll(() => complete.mock.calls.length).toBe(1);
    expect(policy).toHaveBeenCalledExactlyOnceWith(params.response, source);
    expect(download).toHaveBeenCalledExactlyOnceWith(params.response, child, id);
    expect(download.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0]!);
    expect(entry.documentState).toEqual(state);
    expect(params.reservedEnv!.discarded).toBe(false);
    expect(failures).toEqual([]);
  });

  it.each(['attachment', 'example'])('keeps the actual download-admission owner explicit (%s)', async (disposition) => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.headerList.append('Content-Disposition', disposition);
    const download = vi.spyOn(env.userAgent, 'handleAsDownload');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Navigation download admission policy is not implemented' }));
    expect(download).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps the actual download handler explicit after policy admission', async () => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.headerList.append('Content-Disposition', 'attachment');
    vi.spyOn(env.userAgent, 'isNavigationDownloadAllowed').mockReturnValue(true);
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Download handling is not implemented' }));
    expect(complete).not.toHaveBeenCalled();
    expect(entry.document).toBeNull();
  });

  it('checks response policies before considering an attachment or empty response', async () => {
    const { child, entry, source, target, failures, params } = await responseFixture();
    params.response.status = 204;
    params.response.headerList.append('Content-Disposition', 'attachment');
    params.response.headerList.append('X-Frame-Options', 'DENY');
    const disposition = vi.spyOn(params.response, 'hasAttachmentDisposition');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => failures.length).toBe(1);
    expect(disposition).not.toHaveBeenCalled();
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Inline user-agent Document creation is not implemented' }));
    expect(complete).not.toHaveBeenCalled();
  });

  it('leaves conflicting disposition rejection explicit before download admission', async () => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    params.response.headerList.append('Content-Disposition', 'attachment');
    params.response.headerList.append('Content-Disposition', 'inline');
    const policy = vi.spyOn(env.userAgent, 'isNavigationDownloadAllowed');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Conflicting Content-Disposition response rejection is not implemented' }));
    expect(policy).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('history-entry loaded Document state', () => {
  it('populates a traversal entry through real Fetch while retaining a null navigation ID', async () => {
    const { document, navigable, entry, source, target, env, failures } = await fixture();
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    const transport = mockHTTPTransport(env.userAgent, (_, listener) => {
      listener.onHeaders(200, 'OK', new FetchHeaders([['Content-Type', 'text/html']]), true);
      listener.onEnd();
    });
    const active = navigable.activeSessionHistoryEntry;
    const load = vi.spyOn(navigable, 'loadDocument').mockReturnValue(loaded);
    const complete = vi.fn();
    navigable.ongoingNavigation = 'traversal';
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'none', { completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length + failures.length).toBe(1);
    expect(failures).toEqual([]);
    expect(transport).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]![0]).toMatchObject({ id: null, request: { webDriverNavigationId: null } });
    expect(complete).toHaveBeenCalledOnce();
    expect(entry.document).toBe(loaded);
    expect(entry.documentState.everPopulated).toBe(true);
    expect(navigable.activeSessionHistoryEntry).toBe(active);
    expect(navigable.currentSessionHistoryEntry).toBe(active);
    expect(navigable.ongoingNavigation).toBe('traversal');
  });

  it.each([
    ['https://loaded.test/final', false], ['blob:https://loaded.test/resource', false],
    ['about:blank', true], ['about:srcdoc', true], ['data:text/html,loaded', true],
  ] as const)('retains the loaded origin and the required policy for %s', async (url, storesPolicy) => {
    const { document, navigable, entry, source, target, env, failures } = await fixture();
    const params = suppliedParams(navigable);
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    loaded.url = parseURL(url).url!;
    loaded.origin = createOpaqueOrigin();
    // The loaded Document's URL selects storage, independently of the entry and response URLs.
    entry.url = parseURL(storesPolicy ? 'https://entry.test/' : 'about:blank').url!;
    const previousPolicy = entry.documentState.historyPolicyContainer = new PolicyContainer();
    const request = params.request = new FetchRequest(params.url, env);
    request.referrer = parseURL('https://source.test/submitted').url!;
    const previousState = { ...entry.documentState };
    const active = navigable.activeSessionHistoryEntry;
    const load = vi.spyOn(navigable, 'loadDocument').mockImplementation(() => {
      expect(env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      expect(entry.document).toBeNull();
      return loaded;
    });
    const complete = vi.fn(() => {
      expect(env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      expect(entry.documentState).toEqual({
        ...previousState, document: loaded, everPopulated: true, origin: loaded.origin,
        historyPolicyContainer: storesPolicy ? params.policyContainer : previousPolicy,
        requestReferrer: request.referrer,
      });
    });
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    expect(load).not.toHaveBeenCalled();
    await expect.poll(() => complete.mock.calls.length + failures.length).toBe(1);
    expect(failures).toEqual([]);
    expect(complete).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledExactlyOnceWith(params, source, previousState.initiatorOrigin, expect.any(ResourceReader));
    expect(entry.documentState.origin).toBe(loaded.origin);
    expect(entry.documentState.origin).not.toBe(params.origin);
    expect(entry.documentState.historyPolicyContainer).toBe(storesPolicy ? params.policyContainer : previousPolicy);
    expect(entry.documentState.historyPolicyContainer).not.toBe(loaded.policyContainer);
    expect(navigable.activeSessionHistoryEntry).toBe(active);
    expect(navigable.currentSessionHistoryEntry).toBe(active);
    // History retains the selected live container, rather than a clone.
    if (storesPolicy) {
      params.policyContainer.referrerPolicy = 'no-referrer';
      expect(entry.documentState.historyPolicyContainer.referrerPolicy).toBe('no-referrer');
    }
  });

  it.each([false, true])('completes a null loader result without changing retained state (previously populated: %s)', async (everPopulated) => {
    const { child, entry, source, target, env, failures, params } = await responseFixture();
    entry.documentState.initiatorOrigin = null;
    entry.documentState.everPopulated = everPopulated;
    entry.documentState.historyPolicyContainer = new PolicyContainer();
    const previousState = { ...entry.documentState };
    const load = vi.spyOn(child, 'loadDocument').mockReturnValue(null);
    const discard = vi.spyOn(params.reservedEnv!, 'discard');
    const failed = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationFailed');
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length + failures.length).toBe(1);
    expect(failures).toEqual([]);
    expect(complete).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledExactlyOnceWith(params, source, null, expect.any(ResourceReader));
    expect(entry.documentState).toEqual(previousState);
    expect(discard).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it.each([null, 'https://retained.test/'])('preserves a concrete referrer %s and a synthetic null reservation', async (referrer) => {
    const { document, navigable, entry, source, target, failures } = await fixture();
    const params = suppliedParams(navigable);
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    entry.documentState.requestReferrer = referrer === null ? null : parseURL(referrer).url!;
    const retainedReferrer = entry.documentState.requestReferrer;
    vi.spyOn(navigable, 'loadDocument').mockReturnValue(loaded);
    const complete = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => complete.mock.calls.length + failures.length).toBe(1);
    expect(failures).toEqual([]);
    expect(complete).toHaveBeenCalledOnce();
    expect(entry.document).toBe(loaded);
    expect(entry.documentState.requestReferrer).toBe(retainedReferrer);
    expect(params.request).toBeNull();
    expect(params.reservedEnv).toBeNull();
  });

  it('leaves synthetic referrer persistence explicit after saving a loaded Document', async () => {
    const { document, navigable, entry, source, target, failures } = await fixture();
    const params = suppliedParams(navigable);
    const [, loaded] = BrowsingContext.create(document, null, document.browsingContext!.group!);
    loaded.origin = createOpaqueOrigin();
    vi.spyOn(navigable, 'loadDocument').mockReturnValue(loaded);
    const complete = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { navigationParams: params, completionSteps: complete });
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Synthetic navigation history referrer capture is not implemented' }));
    expect(entry.document).toBe(loaded);
    expect(entry.documentState.everPopulated).toBe(true);
    expect(entry.documentState.origin).toBe(loaded.origin);
    expect(entry.documentState.historyPolicyContainer).toBe(params.policyContainer);
    expect(entry.documentState.requestReferrer).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('srcdoc navigation parameters', () => {
  it('assembles the retained resource and hands it to the child Window task before the unfinished loader', async () => {
    const { child, entry, source, target, env, failures } = await childFixture();
    const srcdoc = vi.spyOn(NavigationParams, 'fromSrcdoc');
    const queueTask = env.queueTask.bind(env);
    const queue = vi.spyOn(env, 'queueTask').mockImplementation((source, steps) => queueTask(source, () => {
      try { steps(); } catch (error) { failures.push(error); }
    }));
    const complete = vi.fn();
    child.populateHistoryEntryDocument(entry, 'navigate', source, target, 'none', { completionSteps: complete });
    expect(srcdoc).toHaveBeenCalledExactlyOnceWith(entry, child, target, 'none', null, 'navigate', env);
    expect(srcdoc.mock.results[0]).toMatchObject({ type: 'return', value: { url: { scheme: 'about', path: 'srcdoc' } } });
    expect(queue).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function), { discardSteps: undefined });
    await expect.poll(() => failures.length).toBe(1);
    expect(failures[0]).toEqual(expect.objectContaining({ message: htmlLoaderDependency }));
    expect(entry.document).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    ['', []], ['é😀', [195, 169, 240, 159, 152, 128]], ['\uD800', [239, 191, 189]],
  ] as const)('encodes %j into a browser-owned body with the specified null Fetch slots', async (resource, bytes) => {
    const { document, child, entry, target, env } = await childFixture();
    entry.documentState.resource = resource;
    entry.documentState.aboutBaseURL = parseURL('https://example.test/base/').url!;
    target.iframeReferrerPolicy = 'no-referrer';
    const params = NavigationParams.fromSrcdoc(entry, child, target, 'activation', 'srcdoc', 'back_forward', env);
    expect(serializeURL(params.url)).toBe('about:srcdoc');
    expect(params.response.status).toBe(200);
    expect(params.response.headerList.get('Content-Type')).toBe('text/html');
    expect(params.response.body!.source).toEqual(Uint8Array.from(bytes));
    expect(params.response.body!.length).toBe(bytes.length);
    expect(params.response.body!.stream.env).toBe(env.userAgent.sandbox);
    expect(params.id).toBe('srcdoc');
    expect(params.origin).toBe(entry.documentState.origin);
    expect(params.aboutBaseURL).toBe(entry.documentState.aboutBaseURL);
    expect(params.iframeReferrerPolicy).toBe('no-referrer');
    expect(params.finalSandboxingFlagSet).toBe(target.sandboxingFlags);
    expect(params.navigationTimingType).toBe('back_forward');
    expect(params.userInvolvement).toBe('activation');
    expect(params.request).toBeNull();
    expect(params.fetchController).toBeNull();
    expect(params.commitEarlyHints).toBeNull();
    expect(params.reservedEnv).toBeNull();
    expect(params.coopEnforcementResult).toEqual({
      url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    });
    expect(params.openerPolicy.value).toBe('unsafe-none');
    expect(params.openerPolicy).not.toBe(document.openerPolicy);
    document.browsingContext = null;
    const delivered = await new Promise<Uint8Array>((resolve, reject) => {
      params.response.body!.stream.getDefaultReader().readAllBytes(resolve, reject);
    });
    expect(delivered).toEqual(Uint8Array.from(bytes));
  });

  it.each([false, true])('clones the selected history-or-parent policy (history: %s)', async (fromHistory) => {
    const { document, child, entry, target, env } = await childFixture();
    const historyPolicy = new PolicyContainer();
    historyPolicy.referrerPolicy = 'no-referrer';
    document.policyContainer.referrerPolicy = 'origin';
    if (fromHistory) entry.documentState.historyPolicyContainer = historyPolicy;
    const selected = fromHistory ? historyPolicy : document.policyContainer;
    selected.cspList = new CSPList(document.origin);
    selected.cspList.policies.push(ContentSecurityPolicy.parse('sandbox', 'header', 'enforce'));
    const params = NavigationParams.fromSrcdoc(entry, child, target, 'none', null, 'navigate', env);
    expect(params.policyContainer).not.toBe(selected);
    expect(params.policyContainer.cspList).not.toBe(selected.cspList);
    expect(params.policyContainer.referrerPolicy).toBe(fromHistory ? 'no-referrer' : 'origin');
    selected.referrerPolicy = 'unsafe-url';
    expect(params.policyContainer.referrerPolicy).not.toBe('unsafe-url');
    // The captured final sandbox set is authoritative here; srcdoc does not merge inherited CSP again.
    expect(params.finalSandboxingFlagSet.size).toBe(0);
  });

  it('uses a fresh opaque origin when the target snapshot requires sandboxing', async () => {
    const { child, entry, target, env } = await childFixture();
    target.sandboxingFlags.add('sandboxed-origin');
    const first = NavigationParams.fromSrcdoc(entry, child, target, 'none', null, 'navigate', env);
    const second = NavigationParams.fromSrcdoc(entry, child, target, 'none', null, 'navigate', env);
    expect(first.origin.kind).toBe('opaque');
    expect(first.origin).not.toBe(entry.documentState.origin);
    expect(first.origin).not.toBe(second.origin);
  });

  it('does not silently invent a resource, container, or inherited origin', async () => {
    const { navigable, child, entry, target, env } = await childFixture();
    entry.documentState.resource = null;
    expect(() => NavigationParams.fromSrcdoc(entry, child, target, 'none', null, 'navigate', env)).toThrow('Srcdoc navigation requires a string resource');
    entry.documentState.resource = '';
    expect(() => NavigationParams.fromSrcdoc(entry, navigable, target, 'none', null, 'navigate', env)).toThrow('Srcdoc navigation requires a container Document');
    entry.documentState.origin = null;
    expect(() => NavigationParams.fromSrcdoc(entry, child, target, 'none', null, 'navigate', env)).toThrow('Srcdoc origin determination requires a source origin');
  });
});

describe('history population Navigation Timing diagnostics', () => {
  it.each(['top-level', 'child', 'no diagnostics'] as const)('captures %s diagnostics before loader callbacks', async (kind) => {
    const state = kind === 'child'
      ? await childFixture().then((state) => ({ ...state, navigable: state.child }))
      : await fixture();
    const { navigable, entry, source, failures } = state;
    const departingDocument = navigable.activeDocument!;
    navigable.activeSessionHistoryEntry.documentState.notRestoredReasons = {
      src: null, id: null, name: null, url: departingDocument.url,
      reasons: [{ reason: 'departing-only' }], children: [],
    };
    if (kind !== 'no diagnostics') {
      entry.documentState.notRestoredReasons = {
        src: null, id: null, name: null, url: entry.url,
        reasons: [{ reason: 'masked' }],
        children: [{ src: 'https://foreign.test/', id: '', name: '', url: null, reasons: null, children: null }],
      };
    }
    entry.documentState.requestReferrer = null;
    const params = suppliedParams(navigable, serializeURL(entry.url));
    params.navigationTimingType = 'back_forward';
    let observed: {
      document: DocumentImpl; timing: PerformanceNavigationTiming; reasons: PerformanceNavigationTiming['notRestoredReasons'];
    } | undefined;
    params.commitEarlyHints = (document) => {
      const window = document.env.realm.globalObject as Window;
      const timing = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      observed = { document, timing, reasons: timing.notRestoredReasons };
    };
    // The actual loader still needs parser-script preparation. Exercise its real
    // shared Document factory, including Timing creation and Early Hints callbacks.
    vi.spyOn(navigable, 'loadDocument').mockImplementation((params) =>
      navigable.createAndInitializeDocument('html', 'text/html', params));
    const complete = vi.fn();
    const failed = vi.fn();
    navigable.ongoingNavigation = 'traversal';
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, navigable.snapshotTargetParams(), 'none', {
      navigationParams: params, completionSteps: complete, failureSteps: failed,
    });
    await expect.poll(() => complete.mock.calls.length + failed.mock.calls.length + failures.length).toBe(1);
    expect(failed).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
    expect(observed).toBeDefined();
    const { document, timing, reasons } = observed!;
    expect(entry.document).toBe(document);
    expect(document.getNodeNavigable()).toBeNull();
    expect(navigable.activeDocument).toBe(departingDocument);
    expect(timing.type).toBe('back_forward');
    if (kind === 'top-level') {
      expect(reasons).not.toBeNull();
      expect(reasons!.reasons!.map(({ reason }) => reason)).toEqual(['masked']);
      expect(reasons!.children![0]).toMatchObject({ url: null, reasons: null, children: null });
      expect(getRelevantRealm(reasons!)).toBe(document.env.realm);
      expect(getRelevantRealm(reasons!.reasons![0]!)).toBe(document.env.realm);
      expect(Object.isFrozen(reasons!.reasons)).toBe(true);
      expect(Object.isFrozen(reasons!.children)).toBe(true);
      entry.documentState.notRestoredReasons = null;
      expect(timing.notRestoredReasons).toBe(reasons);
      expect(timing.toJSON()).toMatchObject({ notRestoredReasons: reasons });
    } else {
      expect(reasons).toBeNull();
    }
  });

  it.each([false, true])('uses the final history state after Fetch (redirect: %s)', async (redirect) => {
    const { navigable, entry, env, source, target, failures } = await fixture();
    const oldState = entry.documentState;
    const diagnostics = oldState.notRestoredReasons = {
      src: null, id: null, name: null, url: entry.url,
      reasons: [{ reason: 'masked' }], children: [],
    };
    const transport = mockHTTPTransport(env.userAgent, (request, listener) => {
      const shouldRedirect = redirect && serializeURL(request.url) === 'https://example.test/next';
      listener.onHeaders(shouldRedirect ? 302 : 200, shouldRedirect ? 'Found' : 'OK',
        new FetchHeaders(shouldRedirect ? [['Location', 'https://other.test/final']] : [['Content-Type', 'text/html']]), true);
      listener.onEnd();
    });
    vi.spyOn(navigable, 'loadDocument').mockImplementation((params) =>
      navigable.createAndInitializeDocument('html', 'text/html', params));
    const complete = vi.fn();
    const failed = vi.fn();
    navigable.ongoingNavigation = 'traversal';
    navigable.populateHistoryEntryDocument(entry, 'back_forward', source, target, 'none', {
      completionSteps: complete, failureSteps: failed,
    });
    await expect.poll(() => complete.mock.calls.length + failed.mock.calls.length + failures.length).toBe(1);
    expect(failed).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
    expect(transport).toHaveBeenCalledTimes(redirect ? 2 : 1);
    const window = entry.document!.env.realm.globalObject as Window;
    const timing = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    expect(timing.type).toBe('back_forward');
    if (redirect) {
      expect(entry.documentState).not.toBe(oldState);
      expect(timing.notRestoredReasons).toBeNull();
    } else {
      expect(timing.notRestoredReasons!.reasons!.map(({ reason }) => reason)).toEqual(['masked']);
    }
    expect(oldState.notRestoredReasons).toBe(diagnostics);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/start');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigable = document.getNodeNavigable()!;
  const env = document.env;
  const state = new DocumentState();
  state.initiatorOrigin = obtainURLOrigin(parseURL('https://source.test/').url!);
  state.origin = document.origin;
  const entry = env.createSessionHistoryEntry(parseURL('https://example.test/next').url!, state);
  const source = new SourceSnapshotParams(null);
  const target = navigable.snapshotTargetParams();
  const failures: unknown[] = [];
  const queueTask = env.queueTask.bind(env);
  const queue = vi.spyOn(env, 'queueTask').mockImplementation((source, steps) => queueTask(source, () => {
    try { steps(); } catch (error) { failures.push(error); }
  }));
  return { browser, document, navigable, env, entry, source, target, failures, queue };
}

async function childFixture() {
  const state = await fixture();
  const { document, navigable, entry } = state;
  const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
  const [, childDocument] = BrowsingContext.create(document, iframe, navigable.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(childDocument), navigable);
  iframe.contentNavigable = child;
  document.body!.appendChild(iframe);
  entry.documentState.resource = '<p>srcdoc</p>';
  return { ...state, child, env: childDocument.env, target: child.snapshotTargetParams() };
}

function suppliedParams(navigable: Navigable, url = 'https://response.test/final'): NavigationParams {
  const response = new FetchResponse();
  response.headerList.append('Content-Type', 'text/html');
  response.urlList.push(parseURL(url).url!);
  return navigable.createNavigationParams(response);
}

async function responseFixture() {
  const state = await childFixture();
  const { document, child, env, entry, failures } = state;
  entry.documentState.resource = null;
  captureTaskFailures(env, failures);
  const params = suppliedParams(child);
  params.reservedEnv = new BrowletEnvironmentBase({
    userAgent: env.userAgent, creationURL: params.url,
    topLevelCreationURL: document.url, topLevelOrigin: document.origin,
    targetBrowsingContext: child.activeBrowsingContext, isSecureContext: true,
  });
  return { ...state, params };
}

function captureTaskFailures(env: BrowletEnvironment, failures: unknown[]) {
  const queueTask = env.queueTask.bind(env);
  return vi.spyOn(env, 'queueTask').mockImplementation((source, steps) => queueTask(source, () => {
    try { steps(); } catch (error) { failures.push(error); }
  }));
}

function provideInlineDocument(navigable: Navigable, creator: DocumentImpl) {
  const [, errorDocument] = BrowsingContext.create(creator, null, creator.browsingContext!.group!);
  errorDocument.origin = createOpaqueOrigin();
  const inline = vi.spyOn(navigable, 'createDocumentForInlineContent').mockReturnValue(errorDocument);
  return { errorDocument, inline };
}
