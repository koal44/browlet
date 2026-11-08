import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type NavigateOptions, type UnloadCancellationResult } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState, type PostResource } from '../../../../src/browlet/browsing/navigation/state/index';
import { CSPList, ContentSecurityPolicy } from '../../../../src/browlet/browsing/policy/csp/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { internalType } from '../../../../src/infra/index';
import { FetchHeaders, FetchResponse } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../../src/url/index';
import { mockHTTPTransport } from '../../../fetch/transport-fixture';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('parallel navigation cancellation and abortion', () => {
  it('returns before checking unloading, then queues abortion without waiting for it to populate', async () => {
    const { document, navigable, env, turns, check, populate, abort } = fixture();
    const queueTask = vi.spyOn(env, 'queueTask');
    const entry = navigable.activeSessionHistoryEntry;
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(turns).toHaveLength(1);
    expect(check).not.toHaveBeenCalled();
    expect(populate).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    await resumeNavigation(turns);
    expect(check).toHaveBeenCalledExactlyOnceWith([navigable]);
    expect(queueTask).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', expect.any(Function));
    expect(populate).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(navigable.currentSessionHistoryEntry).toBe(entry);
    expect(navigable.activeDocument).toBe(document);
    await runInHostTask(() => { expect(env.responsibleEventLoop.runTaskTurn()).toBe(true); });
    expect(abort).toHaveBeenCalledOnce();
  });

  it.each(['canceled-by-beforeunload', 'canceled-by-navigate'] as const)('stops for %s without abortion or population', async (status) => {
    const { document, navigable, env, turns, check, populate, abort, failed } = fixture();
    const queueTask = vi.spyOn(env, 'queueTask');
    check.mockReturnValue(env.userAgent.HostPromise.resolve(status, internalType<UnloadCancellationResult>()));
    const url = parseURL('https://example.test/next').url!;
    navigable.navigate(url, document, {}, env);
    const id = navigable.ongoingNavigation;
    await resumeNavigation(turns);
    expect(failed).toHaveBeenCalledExactlyOnceWith(navigable, { id, status: 'canceled', url });
    expect(queueTask).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(populate).not.toHaveBeenCalled();
    expect(navigable.activeDocument).toBe(document);
  });

  it.each(['before-check', 'during-check'] as const)('reports the original ID when superseded %s', async (when) => {
    const { document, navigable, env, turns, check, populate, failed } = fixture();
    const queueTask = vi.spyOn(env, 'queueTask');
    const url = parseURL('https://example.test/next').url!;
    navigable.navigate(url, document, {}, env);
    const id = navigable.ongoingNavigation;
    if (when === 'before-check') navigable.ongoingNavigation = 'newer';
    else check.mockImplementation(() => { navigable.ongoingNavigation = 'newer'; return env.userAgent.HostPromise.resolve('continue', internalType<UnloadCancellationResult>()); });
    await resumeNavigation(turns);
    expect(check).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledExactlyOnceWith(navigable, { id, status: 'canceled', url });
    expect(navigable.ongoingNavigation).toBe('newer');
    expect(populate).not.toHaveBeenCalled();
    expect(queueTask).not.toHaveBeenCalled();
  });

  it('waits without population and rechecks the navigation ID when a delayed check finishes', async () => {
    const { document, navigable, env, turns, check, populate, abort, failed } = fixture();
    const pending = env.userAgent.HostPromise.withResolvers(internalType<UnloadCancellationResult>());
    check.mockReturnValue(pending.promise);
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    const id = navigable.ongoingNavigation;
    turns.shift()!();
    expect(turns).toHaveLength(0);
    expect(populate).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    navigable.ongoingNavigation = 'replacement';
    pending.resolve('continue');
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(failed).toHaveBeenCalledWith(navigable, expect.objectContaining({ id, status: 'canceled' }));
    expect(navigable.ongoingNavigation).toBe('replacement');
    expect(populate).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('reports an internal check rejection through the host without treating it as permission to navigate', async () => {
    const { document, navigable, env, turns, check, populate, abort } = fixture();
    const failure = new Error('prompt owner failure');
    check.mockImplementation(() => env.userAgent.HostPromise.reject(failure, internalType<UnloadCancellationResult>()));
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    await expect(resumeNavigation(turns)).rejects.toBe(failure);
    expect(populate).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('collects live inclusive descendants when the parallel steps run', async () => {
    const { document, navigable, env, turns, check } = fixture();
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    const nested = child(document);
    const grandchild = child(nested.document);
    await resumeNavigation(turns);
    expect(check).toHaveBeenCalledExactlyOnceWith([navigable, nested.navigable, grandchild.navigable]);
  });

  it('waits for real beforeunload delivery before population and abortion', async () => {
    const { document, navigable, env, turns, check, populate, abort } = fixture();
    check.mockRestore();
    const beforeUnload = vi.spyOn(document, 'fireBeforeUnload');
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    turns.shift()!();
    expect(beforeUnload).not.toHaveBeenCalled();
    expect(populate).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    await runInHostTask(() => { expect(env.responsibleEventLoop.runTaskTurn()).toBe(true); });
    expect(beforeUnload).toHaveBeenCalledExactlyOnceWith(false);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(populate).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
  });

  it('defers through the real UserAgent scheduler without entering an HTML task', async () => {
    const { document, navigable, env, check, failed } = fixture();
    vi.mocked(env.userAgent.runInParallel).mockRestore();
    check.mockImplementation(() => {
      expect(env.responsibleEventLoop.currentlyRunningTask).toBeNull();
      return env.userAgent.HostPromise.resolve('canceled-by-beforeunload', internalType<UnloadCancellationResult>());
    });
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(check).not.toHaveBeenCalled();
    await expect.poll(() => failed.mock.calls.length).toBe(1);
  });

  it('hands off to a different Agent before starting parallel work and queues abortion on that target', async () => {
    const { document, navigable, env, turns, check, abort } = fixture();
    const nested = child(document);
    const targetEnv = nested.document.env;
    expect(targetEnv.realm.agent).not.toBe(env.realm.agent);
    const populate = vi.spyOn(nested.navigable, 'populateHistoryEntryDocument').mockImplementation(() => {});
    const targetAbort = vi.spyOn(nested.document, 'abortAndDescendants').mockImplementation(() => {
      expect(targetEnv.responsibleEventLoop.currentlyRunningTask?.source.name).toBe('navigation and traversal');
    });
    nested.navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(turns).toEqual([]);
    expect(check).not.toHaveBeenCalled();
    await runInHostTask(() => { expect(targetEnv.responsibleEventLoop.runTaskTurn()).toBe(true); });
    expect(turns).toHaveLength(1);
    await resumeNavigation(turns);
    expect(check).toHaveBeenCalledExactlyOnceWith([nested.navigable]);
    expect(populate).toHaveBeenCalledOnce();
    expect(targetAbort).not.toHaveBeenCalled();
    await runInHostTask(() => { expect(targetEnv.responsibleEventLoop.runTaskTurn()).toBe(true); });
    expect(targetAbort).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(navigable.activeDocument).toBe(document);
  });
});

describe('pending navigation history', () => {
  it('initializes a fresh, unpopulated entry without modifying the current history', async () => {
    const { document, navigable, env, turns, populate } = fixture();
    const oldEntry = navigable.activeSessionHistoryEntry;
    oldEntry.documentState.navigableTargetName = 'destination';
    const url = parseURL('https://example.test/next').url!;
    navigable.navigate(url, document, {}, env);
    await resumeNavigation(turns);
    const [entry, timing, sourceSnapshot, targetSnapshot, involvement, options] = populate.mock.calls[0]!;
    expect(entry.url).toBe(url);
    expect(entry.step).toBe('pending');
    expect(entry.document).toBeNull();
    expect(entry.documentState).toBeInstanceOf(DocumentState);
    expect(entry.documentState).not.toBe(oldEntry.documentState);
    expect(entry.documentState).toMatchObject({
      requestReferrer: undefined, requestReferrerPolicy: '', initiatorOrigin: document.origin,
      origin: null, aboutBaseURL: null, resource: null, navigableTargetName: 'destination', everPopulated: false,
    });
    expect(entry.documentState.nestedHistories).toEqual([]);
    expect(env.deserialize(entry.classicHistoryAPIState)).toBeNull();
    expect(env.deserialize(entry.navigationAPIState)).toBeUndefined();
    expect(timing).toBe('navigate');
    expect(involvement).toBe('none');
    expect(sourceSnapshot.fetchClient).toBe(env);
    expect(targetSnapshot.iframeReferrerPolicy).toBe('');
    expect(options).toMatchObject({
      navigationId: navigable.ongoingNavigation, navigationParams: null, cspNavigationType: 'other', allowPOST: true,
    });
    expect(navigable.activeSessionHistoryEntry).toBe(oldEntry);
    expect(navigable.currentSessionHistoryEntry).toBe(oldEntry);
  });

  it.each(['about:blank', 'about:blank?query#fragment', 'about:srcdoc'])(
    'retains the captured initiator origin and base for %s', async (destination) => {
      const { document, navigable, env, turns, populate } = fixture();
      const origin = document.origin;
      const baseURL = document.getBaseURL();
      navigable.navigate(parseURL(destination).url!, document, {}, env);
      document.origin = obtainURLOrigin(parseURL('https://changed.test/').url!);
      document.setURL(parseURL('https://changed.test/later').url!);
      await resumeNavigation(turns);
      const state = populate.mock.calls[0]![0].documentState;
      expect(state.origin).toBe(origin);
      expect(state.initiatorOrigin).toBe(origin);
      expect(state.aboutBaseURL).toBe(baseURL);
    },
  );

  it.each(['https://example.test/next', 'about:srcdoc?query', 'about:srcdoc#fragment', 'about:other'])(
    'does not initialize a retained local origin or base for %s', async (destination) => {
      const { document, navigable, env, turns, populate } = fixture();
      navigable.navigate(parseURL(destination).url!, document, {}, env);
      await resumeNavigation(turns);
      const state = populate.mock.calls[0]![0].documentState;
      expect(state.initiatorOrigin).toBe(document.origin);
      expect(state.origin).toBeNull();
      expect(state.aboutBaseURL).toBeNull();
    },
  );

  it('retains POST inputs without reading the body and reads the live target name after the unload check', async () => {
    const { document, navigable, env, turns, check, populate } = fixture();
    const body = vi.fn(() => { throw new Error('Body must not be read during history preparation'); });
    const resource: PostResource = { get requestBody() { return body(); }, requestContentType: 'text/plain' };
    const options: NavigateOptions = {
      documentResource: resource, formDataEntryList: [], referrerPolicy: 'origin', userInvolvement: 'activation',
    };
    navigable.navigate(parseURL('https://example.test/submission').url!, document, options, env);
    options.referrerPolicy = 'no-referrer';
    options.documentResource = null;
    check.mockImplementation(() => {
      navigable.activeSessionHistoryEntry.documentState.navigableTargetName = 'after-prompt';
      return env.userAgent.HostPromise.resolve('continue', internalType<UnloadCancellationResult>());
    });
    await resumeNavigation(turns);
    const [entry, , , , involvement, population] = populate.mock.calls[0]!;
    expect(entry.documentState.resource).toBe(resource);
    expect(entry.documentState.requestReferrerPolicy).toBe('origin');
    expect(entry.documentState.navigableTargetName).toBe('after-prompt');
    expect(involvement).toBe('activation');
    expect(population?.cspNavigationType).toBe('form-submission');
    expect(body).not.toHaveBeenCalled();
  });

  it('retains an empty srcdoc resource rather than treating it as absent', async () => {
    const { document, navigable, env, turns, populate } = fixture();
    navigable.navigate(parseURL('about:srcdoc').url!, document, { documentResource: '' }, env);
    await resumeNavigation(turns);
    expect(populate.mock.calls[0]![0].documentState.resource).toBe('');
  });

  it('supplies the browser-UI origin snapshot without inventing a source Document', async () => {
    const { navigable, env, turns, populate } = fixture();
    navigable.navigate(parseURL('about:blank').url!, null, { userInvolvement: 'browser UI' }, env);
    await resumeNavigation(turns);
    const [entry, , sourceSnapshot, , involvement] = populate.mock.calls[0]!;
    expect(entry.documentState.initiatorOrigin?.kind).toBe('opaque');
    expect(entry.documentState.origin).toBe(entry.documentState.initiatorOrigin);
    expect(serializeURL(entry.documentState.aboutBaseURL!)).toBe('about:blank');
    expect(sourceSnapshot.fetchClient).toBeNull();
    expect(involvement).toBe('browser UI');
  });

  it('appends finalization only on population completion, preserving the selected entry and history behavior', async () => {
    const { document, navigable, env, turns, populate } = fixture();
    const append = vi.spyOn(navigable.traversable, 'appendSessionHistoryTraversalSteps');
    const finalize = vi.spyOn(navigable, 'finalizeCrossDocumentNavigation').mockImplementation(() => {});
    navigable.navigate(parseURL('https://example.test/next').url!, document, { historyHandling: 'replace' }, env);
    await resumeNavigation(turns);
    const [entry, , , , , options] = populate.mock.calls[0]!;
    expect(append).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    options!.completionSteps!();
    expect(append).toHaveBeenCalledOnce();
    expect(finalize).not.toHaveBeenCalled();
    expect(turns).toHaveLength(1);
    turns.shift()!();
    expect(finalize).toHaveBeenCalledExactlyOnceWith('replace', 'none', entry);
  });

  it('connects population Fetch to HTML loading while recursive abortion remains explicit', async () => {
    const { document, navigable, env, turns, populate, abort } = fixture();
    populate.mockRestore();
    const queue = vi.spyOn(env, 'queueTask');
    const load = vi.spyOn(navigable, 'loadHTMLDocument');
    mockHTTPTransport(env.userAgent, (_, listener) => {
      listener.onHeaders(200, 'OK', new FetchHeaders([['Content-Type', 'text/html']]), true);
      listener.onEnd();
    });
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    await resumeNavigation(turns);
    await expect.poll(() => {
      while (turns.length) turns.shift()!();
      return queue.mock.calls.length;
    }).toBe(2);
    await runInHostTask(() => {
      expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
      expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    });
    await expect.poll(() => queue.mock.calls.length).toBe(3);
    await runInHostTask(() => {
      expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    });
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.results[0]!.value).toMatchObject({ URL: 'https://example.test/next', contentType: 'text/html' });
    abort.mockRestore();
    expect(() => document.abortAndDescendants()).toThrow('Document and descendant abortion is not implemented');
  });
});

describe('supplied-response navigation preparation', () => {
  it('uses response URL/origin and fresh policy/COOP state without running the provisional loader', async () => {
    const { document, turns } = fixture();
    const nested = child(document);
    const populate = vi.spyOn(nested.navigable, 'populateHistoryEntryDocument').mockImplementation(() => {});
    const loader = vi.spyOn(nested.navigable, 'createNavigationParams');
    nested.frame.setAttribute('referrerpolicy', 'no-referrer');
    const response = suppliedResponse('https://response.test/final');
    response.headerList.append('Cross-Origin-Opener-Policy', 'same-origin');
    response.headerList.append('Referrer-Policy', 'unsafe-url');
    const url = parseURL('https://requested.test/start').url!;
    nested.navigable.navigate(url, document, { response }, nested.document.env);
    await resumeNavigation(turns);
    const [entry, , , snapshot, , options] = populate.mock.calls[0]!;
    const params = options!.navigationParams!;
    expect(entry.url).toBe(url);
    expect(params.response).toBe(response);
    expect(params.url).toBe(response.url);
    expect(params.origin).toEqual(obtainURLOrigin(response.url!));
    expect(params.id).toBe(nested.navigable.ongoingNavigation);
    expect(params.request).toBeNull();
    expect(params.fetchController).toBeNull();
    expect(params.reservedEnv).toBeNull();
    expect(params.commitEarlyHints).toBeNull();
    expect(params.navigationTimingType).toBe('navigate');
    expect(params.userInvolvement).toBe('none');
    expect(params.aboutBaseURL).toBeNull();
    expect(params.iframeReferrerPolicy).toBe('no-referrer');
    expect(params.finalSandboxingFlagSet).toEqual(snapshot.sandboxingFlags);
    expect(params.finalSandboxingFlagSet).not.toBe(snapshot.sandboxingFlags);
    expect(params.openerPolicy.value).toBe('unsafe-none');
    expect(params.policyContainer.referrerPolicy).toBe('unsafe-url');
    expect(params.policyContainer).not.toBe(document.policyContainer);
    expect(params.coopEnforcementResult).toEqual({
      url: response.url, origin: params.origin, openerPolicy: params.openerPolicy,
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it('clones live initiator policy and unions CSP restrictions with the earlier target snapshot', async () => {
    const { document, turns } = fixture();
    const nested = child(document);
    const populate = vi.spyOn(nested.navigable, 'populateHistoryEntryDocument').mockImplementation(() => {});
    nested.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    nested.frame.setAttribute('referrerpolicy', 'origin');
    const url = parseURL('about:blank').url!;
    nested.navigable.navigate(url, document, { response: suppliedResponse('about:blank') }, nested.document.env);
    document.policyContainer.referrerPolicy = 'no-referrer';
    document.policyContainer.cspList = new CSPList(document.origin);
    document.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse('sandbox allow-forms', 'header', 'enforce'));
    nested.frame.removeAttribute('sandbox');
    nested.frame.setAttribute('referrerpolicy', 'unsafe-url');
    await resumeNavigation(turns);
    const [entry, , sourceSnapshot, targetSnapshot, , options] = populate.mock.calls[0]!;
    const params = options!.navigationParams!;
    expect(sourceSnapshot.sourcePolicyContainer.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(params.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(params.policyContainer).not.toBe(document.policyContainer);
    expect(params.policyContainer.cspList).not.toBe(document.policyContainer.cspList);
    expect(params.finalSandboxingFlagSet.has('sandboxed-forms')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(targetSnapshot.sandboxingFlags.has('sandboxed-scripts')).toBe(false);
    expect(targetSnapshot.sandboxingFlags.has('sandboxed-origin')).toBe(false);
    expect(params.iframeReferrerPolicy).toBe('origin');
    expect(params.origin.kind).toBe('opaque');
    expect(params.aboutBaseURL).toBe(entry.documentState.aboutBaseURL);
  });

  it('inherits srcdoc policy from the container rather than the source Document', async () => {
    const { document, turns } = fixture();
    const nested = child(document);
    const source = child(document).document;
    const populate = vi.spyOn(nested.navigable, 'populateHistoryEntryDocument').mockImplementation(() => {});
    document.policyContainer.referrerPolicy = 'origin';
    source.policyContainer.referrerPolicy = 'no-referrer';
    nested.navigable.navigate(parseURL('about:srcdoc').url!, source, { response: suppliedResponse('about:srcdoc') }, nested.document.env);
    await resumeNavigation(turns);
    const params = populate.mock.calls[0]![5]!.navigationParams!;
    expect(params.policyContainer.referrerPolicy).toBe('origin');
    expect(params.policyContainer).not.toBe(document.policyContainer);
    expect(params.origin).toBe(source.origin);
  });

  it('supports a top-level supplied response without inventing a parent policy container', async () => {
    const { document, navigable, env, turns, populate } = fixture();
    const response = suppliedResponse('https://example.test/next');
    navigable.navigate(parseURL('https://example.test/next').url!, document, { response }, env);
    await resumeNavigation(turns);
    const params = populate.mock.calls[0]![5]!.navigationParams!;
    expect(params.response).toBe(response);
    expect(params.policyContainer).not.toBe(document.policyContainer);
    // A response without a Referrer-Policy retains the empty policy value; Fetch resolves its default.
    expect(params.policyContainer.referrerPolicy).toBe('');
  });

  it('requires a response URL before population', async () => {
    const { document, navigable, env, turns, populate } = fixture();
    const response = new FetchResponse();
    navigable.navigate(parseURL('https://example.test/next').url!, document, { response }, env);
    await expect(resumeNavigation(turns)).rejects.toThrow('Navigation requires a response URL');
    expect(populate).not.toHaveBeenCalled();
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const navigable = TopLevelTraversable.create(userAgent, null, '');
  const document = navigable.activeDocument!;
  document.isInitialAboutBlank = false;
  document.setURL(parseURL('https://example.test/current').url!);
  document.origin = obtainURLOrigin(document.url);
  navigable.activeSessionHistoryEntry.url = document.url;
  const env = document.env;
  const turns: (() => void)[] = [];
  vi.spyOn(env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  const check = vi.spyOn(userAgent, 'checkIfUnloadingIsCanceled').mockImplementation(() =>
    userAgent.HostPromise.resolve('continue', internalType<UnloadCancellationResult>()));
  const populate = vi.spyOn(navigable, 'populateHistoryEntryDocument').mockImplementation(() => {});
  const abort = vi.spyOn(document, 'abortAndDescendants').mockImplementation(() => {
    expect(env.responsibleEventLoop.currentlyRunningTask?.source.name).toBe('navigation and traversal');
  });
  const failed = vi.spyOn(env.userAgent, 'webDriverBiDiNavigationFailed');
  return { document, navigable, env, turns, check, populate, abort, failed };
}

function child(parent: DocumentImpl) {
  const parentNavigable = parent.getNodeNavigable()!;
  const frame = parent.createElement('iframe') as HTMLIFrameElementImpl;
  parent.body!.appendChild(frame);
  const [, document] = BrowsingContext.create(parent, frame, parentNavigable.topLevelTraversable.activeBrowsingContext!.group!);
  const navigable = new Navigable(DocumentState.create(document), parentNavigable);
  frame.contentNavigable = navigable;
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  return { frame, document, navigable };
}

function suppliedResponse(url: string): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  return response;
}

async function resumeNavigation(turns: (() => void)[]): Promise<void> {
  turns.shift()!();
  await expect.poll(() => turns.length).toBe(1);
  turns.shift()!();
}
