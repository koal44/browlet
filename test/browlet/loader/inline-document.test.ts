import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { DocumentState, SourceSnapshotParams } from '../../../src/browlet/browsing/navigation/state/index';
import { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import type { Window } from '../../../src/browlet/platform';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchBody, FetchResponse } from '../../../src/fetch/index';
import { areSameOrigin, obtainURLOrigin, serializeOrigin } from '../../../src/url/index';
import { createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('inline user-agent Document creation', () => {
  it.each([
    ['navigate', 'navigation-id'], ['reload', null], ['back_forward', 'history-id'],
  ] as const)('creates an opaque %s Document with fresh response policies (id: %s)', (timingType, id) => {
    const { navigable, userAgent, url } = fixture();
    const initial = navigable.activeDocument!;
    const context = navigable.activeBrowsingContext;
    const render = vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => {});
    const create = vi.spyOn(navigable, 'createAndInitializeDocument');

    const document = navigable.createDocumentForInlineContent(id, timingType, 'activation', url);

    expect(document.type).toBe('html');
    expect(document.contentType).toBe('text/html');
    expect(document.URL).toBe('https://destination.test/final?query=1#fragment');
    expect(document.url).not.toBe(url);
    expect(document.referrer).toBe('');
    expect(serializeOrigin(document.origin)).toBe('null');
    expect(areSameOrigin(document.origin, obtainURLOrigin(url))).toBe(false);
    expect(areSameOrigin(document.origin, initial.origin)).toBe(false);
    expect(document.env.realm).not.toBe(initial.env.realm);
    expect(document.browsingContext).toBe(context);
    expect(document.duringLoadingNavigationID).toBe(id);
    expect(document.navigationTimingEntry!.type).toBe(timingType);
    expect(document.navigationTimingEntry!.name).toBe(document.URL);
    expect(document.navigationTimingEntry!.transferSize).toBe(0);
    expect(document.aboutBaseURL).toBeNull();
    expect(document.activeSandboxingFlagSet.size).toBe(0);
    expect(document.openerPolicy.value).toBe('unsafe-none');
    expect(document.policyContainer.cspList?.policies ?? []).toEqual([]);
    expect(document.policyContainer.embedderPolicy.value).toBe('unsafe-none');
    expect(document.activeParser).toBeNull();
    expect(document.documentElement).toBeNull();
    expect(document.readyState).toBe('loading');
    expect(navigable.activeDocument).toBe(initial);
    expect(render).toHaveBeenCalledExactlyOnceWith(document, undefined);
    const params = create.mock.calls[0]![2];
    expect(params.response.urlList).toEqual([url]);
    expect(params.response.headerList.list).toEqual([]);
    expect(params.response.body).toBeNull();
    expect([params.request, params.fetchController, params.commitEarlyHints, params.reservedEnv]).toEqual([null, null, null, null]);
    expect(params.userInvolvement).toBe('activation');
    expect(params.coopEnforcementResult).toEqual({
      url: document.url, origin: document.origin, openerPolicy: document.openerPolicy,
      needsBrowsingContextGroupSwitch: false,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    });
    url.fragment = 'changed';
    expect(document.URL).toBe('https://destination.test/final?query=1#fragment');
  });

  it('never shares opaque origins or policy objects between inline Documents for the same URL', () => {
    const { navigable, userAgent, url } = fixture();
    vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => {});
    const first = navigable.createDocumentForInlineContent(null, 'navigate', 'none', url);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', historyEntry(first));
    const second = navigable.createDocumentForInlineContent(null, 'navigate', 'none', url);
    expect(areSameOrigin(first.origin, second.origin)).toBe(false);
    expect(first.env.realm).not.toBe(second.env.realm);
    expect(first.policyContainer).not.toBe(second.policyContainer);
    expect(first.openerPolicy).not.toBe(second.openerPolicy);
  });

  it('gives a PDF renderer the original reader while constructing from a fresh synthetic response', async () => {
    const { navigable, userAgent, url } = fixture();
    userAgent.pdfViewerSupported = true;
    const response = new FetchResponse();
    response.urlList.push(navigable.activeDocument!.url, url);
    response.headerList.append('Content-Type', 'application/pdf');
    response.headerList.append('Content-Security-Policy', "sandbox; default-src 'none'");
    response.headerList.append('Cross-Origin-Opener-Policy', 'same-origin');
    response.headerList.append('Refresh', '0;url=/must-not-refresh');
    const bytes = new TextEncoder().encode('%PDF-test');
    response.body = FetchBody.fromBytes(bytes, userAgent.sandbox);
    const resource = new ResourceReader(response, userAgent);
    await resource.determineMIMEType();
    const params = navigable.createNavigationParams(response);
    const render = vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => {});
    const create = vi.spyOn(navigable, 'createAndInitializeDocument');

    const document = (await navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource))!;

    expect(render).toHaveBeenCalledExactlyOnceWith(document, resource);
    expect(document.URL).toBe('https://destination.test/final?query=1#fragment');
    expect(document.policyContainer.cspList?.policies ?? []).toEqual([]);
    expect(document.openerPolicy.value).toBe('unsafe-none');
    expect(document.willDeclarativelyRefresh).toBe(false);
    expect(create.mock.calls[0]![2].response).not.toBe(response);
    expect(create.mock.calls[0]![2].response.body).toBeNull();
    expect(resource.response).toBe(response);
    await expect(resource.read()).resolves.toEqual(bytes);
    await expect(resource.read()).resolves.toBeNull();
  });

  it('can create an isolated error Document beneath a COEP-protected parent without admitting the failed response again', () => {
    const userAgent = createManualUserAgent();
    const top = TopLevelTraversable.create(userAgent, null, 'inline');
    const parent = top.activeDocument!;
    const iframe = parent.createElement('iframe') as HTMLIFrameElementImpl;
    const [, initial] = BrowsingContext.create(parent, iframe, top.activeBrowsingContext!.group!);
    const initialState = DocumentState.create(initial);
    initialState.origin = initial.origin;
    const child = new Navigable(initialState, top);
    iframe.contentNavigable = child;
    parent.body!.appendChild(iframe);
    child.activeSessionHistoryEntry.step = top.activeSessionHistoryEntry.step;
    top.activeSessionHistoryEntry.documentState.nestedHistories.push({ id: child.id, entries: [child.activeSessionHistoryEntry] });
    parent.policyContainer.embedderPolicy.value = 'require-corp';
    const render = vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => {});
    const check = vi.spyOn(child, 'checkResponseEmbedderPolicy');
    const url = parent.env.parseURL('https://blocked.test/destination')!;

    const document = child.createDocumentForInlineContent(null, 'navigate', 'none', url);

    expect(document.URL).toBe('https://blocked.test/destination');
    expect(document.policyContainer.embedderPolicy.value).toBe('unsafe-none');
    expect(check).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledExactlyOnceWith(document, undefined);
    expect(child.activeDocument).toBe(initial);
    child.finalizeCrossDocumentNavigation('replace', 'none', historyEntry(document));
    expect(iframe.contentDocument).toBeNull();
    const window = parent.env.realm.globalObject as Window;
    expect((window.document.body!.firstElementChild as InstanceType<Window['HTMLIFrameElement']>).contentDocument).toBeNull();
  });

  it('waits for history activation before delivering completion', async () => {
    const { navigable, userAgent, url } = fixture();
    const order: string[] = [];
    vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => { order.push('render'); });
    const document = navigable.createDocumentForInlineContent(null, 'navigate', 'none', url);
    const env = document.env;
    const loop = env.responsibleEventLoop;
    const queue = vi.spyOn(env, 'queueTask');
    const window = env.realm.globalObject as Window;
    window.document.addEventListener('DOMContentLoaded', () => { order.push('DOMContentLoaded'); });
    window.addEventListener('load', () => { order.push('load'); });
    expect(loop.runTaskTurn()).toBe(false);
    expect(order).toEqual(['render']);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', historyEntry(document));
    await expect.poll(() => {
      loop.performMicrotaskCheckpoint();
      return queue.mock.calls.some(([source]) => source === 'network');
    }).toBe(true);
    expect(document.readyState).toBe('loading');
    expect(loop.runTaskTurn()).toBe(true);
    expect(document.readyState).toBe('complete');
    expect(order).toEqual(['render', 'DOMContentLoaded', 'load']);
  });

  it('discards queued completion after destruction', async () => {
    const { navigable, userAgent, url } = fixture();
    vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => {});
    const document = navigable.createDocumentForInlineContent(null, 'navigate', 'none', url);
    const env = document.env;
    env.queueTask('network', () => { document.destroy(); });
    const queue = vi.spyOn(env, 'queueTask');
    const finish = vi.spyOn(document, 'finishLoading');
    navigable.finalizeCrossDocumentNavigation('replace', 'none', historyEntry(document));
    await expect.poll(() => {
      env.responsibleEventLoop.performMicrotaskCheckpoint();
      return queue.mock.calls.some(([source]) => source === 'network');
    }).toBe(true);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(finish).not.toHaveBeenCalled();
  });

  it('delivers completion through the automatic loop without a manual checkpoint', async () => {
    const { navigable, userAgent, url } = fixture(new UserAgent());
    vi.spyOn(userAgent, 'renderInlineDocument').mockImplementation(() => {});
    const document = navigable.createDocumentForInlineContent(null, 'navigate', 'none', url);
    const window = document.env.realm.globalObject as Window;
    const loaded = new Promise<void>((resolve) => { window.addEventListener('load', () => { resolve(); }); });
    navigable.finalizeCrossDocumentNavigation('replace', 'none', historyEntry(document));
    await loaded;
    expect(document.readyState).toBe('complete');
    await expect.poll(() => document.loadTimingInfo.loadEventEndTime).toBeGreaterThan(0);
  });

  it('leaves presentation explicit instead of completing an unrendered Document', () => {
    const { navigable, url } = fixture();
    const finish = vi.spyOn(DocumentImpl.prototype, 'finishLoading');
    expect(() => navigable.createDocumentForInlineContent(null, 'navigate', 'none', url))
      .toThrow('Inline user-agent Document rendering is not implemented');
    expect(finish).not.toHaveBeenCalled();
  });
});

function fixture(userAgent = createManualUserAgent()) {
  const navigable = TopLevelTraversable.create(userAgent, null, 'inline');
  const url = navigable.activeDocument!.env.parseURL('https://destination.test/final?query=1#fragment')!;
  return { navigable, userAgent, url };
}

function historyEntry(document: DocumentImpl) {
  const state = DocumentState.create(document);
  state.origin = document.origin;
  return document.env.createSessionHistoryEntry(document.url, state);
}
