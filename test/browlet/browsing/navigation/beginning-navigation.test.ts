import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchResponse } from '../../../../src/fetch/index';
import { copyURL, createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';
import { createSiblingWindow } from '../../../support/windows';

afterEach(() => { vi.restoreAllMocks(); });

describe('beginning navigation', () => {
  it('resolves automatic history against the active Document URL, independently of its history entry', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/');
    const document = unwrap<DocumentImpl>(browser.document);
    const navigable = document.getNodeNavigable()!;
    document.url = parseURL('https://example.test/updated').url!;

    expect(navigable.resolveHistoryBehavior(copyURL(document.url), document.origin)).toBe('replace');
  });

  it.each(['push', 'replace'] as const)('preserves explicit %s unless replacement is mandatory', async (behavior) => {
    const { document, navigable } = await fixture();
    expect(navigable.resolveHistoryBehavior(document.url, document.origin, behavior)).toBe(behavior);
    expect(navigable.resolveHistoryBehavior(parseURL('javascript:1').url!, document.origin, behavior)).toBe('replace');
    document.isInitialAboutBlank = true;
    expect(navigable.resolveHistoryBehavior(parseURL('https://other.test/').url!, document.origin, behavior)).toBe('replace');
  });

  it('permits browser UI to replace the same URL without matching the initiator origin', async () => {
    const { document, navigable } = await fixture();
    const origin = createOpaqueOrigin();
    expect(navigable.resolveHistoryBehavior(document.url, origin)).toBe('push');
    expect(navigable.resolveHistoryBehavior(document.url, origin, 'auto', 'browser UI')).toBe('replace');
  });

  it('keeps local browser-UI navigation to the same URL in one history position for opaque Documents', async () => {
    const browser = new Browlet({ route: () => '' });
    const navigable = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
    navigable.activeBrowsingContext!.popupSandboxingFlagSet.add('sandboxed-origin');
    await browser.navigate('https://example.test/');
    expect(unwrap<DocumentImpl>(browser.document).origin.kind).toBe('opaque');
    const length = browser.window.history.length;
    await browser.navigate('https://example.test/');
    expect(browser.window.history.length).toBe(length);
  });

  it.each([false, true])('honors sandbox rejection synchronously (exceptions=%s)', async (exceptionsEnabled) => {
    const { document, navigable, permission, failed, fragment, url } = await fixture();
    permission.mockReturnValue(false);
    const queue = vi.spyOn(document.env, 'queueTask');
    const navigate = () => navigable.navigate(url, document, { exceptionsEnabled }, document.env);
    if (exceptionsEnabled) expect(navigate).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    else expect(navigate).not.toThrow();
    expect(permission).toHaveBeenCalledWith(navigable, expect.objectContaining({ fetchClient: document.env }));
    expect(queue).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(fragment).not.toHaveBeenCalled();
  });

  it('requires browser UI involvement exactly when the source Document is absent', async () => {
    const { document, navigable, permission, url } = await fixture();
    expect(() => navigable.navigate(url, null, {}, document.env)).toThrow('Sourceless navigation requires browser UI involvement');
    expect(() => navigable.navigate(url, document, { userInvolvement: 'browser UI' }, document.env))
      .toThrow('Document-initiated navigation cannot have browser UI involvement');
    expect(permission).not.toHaveBeenCalled();
  });

  it('delivers sandbox SecurityError through the real Location binding', async () => {
    const { browser, permission } = await fixture();
    permission.mockReturnValue(false);
    expect(await browser.evaluate(() => {
      try { location.assign('/blocked'); }
      catch (error) { return error instanceof DOMException && error.name === 'SecurityError'; }
      return false;
    })).toBe(true);
    expect(browser.window.location.href).toBe('https://example.test/page#before');
  });

  it('begins a fragment navigation using the real source-activation state', async () => {
    const { document, navigable, activation, fragment, url } = await fixture();
    activation.mockRestore();
    navigable.navigate(url, document, {}, document.env);
    expect(fragment).toHaveBeenCalledOnce();
  });

  it('uses Agent identity rather than requiring the same Window environment', async () => {
    const { browser, document, navigable, fragment, url } = await fixture();
    const env = getRelevantRealm(createSiblingWindow(browser)).env;
    expect(env).not.toBe(document.env);
    expect(env.realm.agent).toBe(document.env.realm.agent);
    const queue = vi.spyOn(document.env, 'queueTask');

    navigable.navigate(url, document, {}, env);

    expect(fragment).toHaveBeenCalledOnce();
    expect(queue).not.toHaveBeenCalled();
  });

  it('queues for a different caller Agent even when the source and target Document are identical', async () => {
    const { document, navigable, failed, fragment, url } = await fixture();
    const other = new Browlet({ route: () => '' });
    const env = getRelevantRealm(other.window).env;
    const queue = vi.spyOn(document.env, 'queueTask');
    const base = vi.spyOn(document, 'getBaseURL');
    navigable.navigate(url, document, {}, env);
    expect(base).toHaveBeenCalledOnce();
    expect(queue).toHaveBeenCalledExactlyOnceWith('navigation-and-traversal', {
      run: expect.any(Function) as unknown, discard: expect.any(Function) as unknown,
    });
    expect(failed).not.toHaveBeenCalled();
    expect(fragment).not.toHaveBeenCalled();

    document.unloadCounter = 1;
    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });

    expect(failed).toHaveBeenCalledExactlyOnceWith(navigable, { id: expect.any(String) as string, status: 'canceled', url });
    expect(fragment).not.toHaveBeenCalled();
  });

  it('queues host work without inferring its Agent from a Document', async () => {
    const { document, navigable, fragment, url } = await fixture();
    navigable.navigate(url, null, { userInvolvement: 'browser UI' });
    expect(fragment).not.toHaveBeenCalled();
    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });
    expect(fragment).toHaveBeenCalledOnce();
  });

  it('retains initiator origin and argument values while reading target state after the handoff', async () => {
    const { document, navigable, fragment } = await fixture();
    const other = new Browlet({ route: () => '' });
    const options = { historyHandling: 'auto' as const };
    const originalOrigin = document.origin;
    const url = copyURL(document.url);
    navigable.navigate(url, document, options, getRelevantRealm(other.window).env);
    document.origin = createOpaqueOrigin();
    Object.assign(options, { historyHandling: 'replace' });
    expect(document.origin).not.toBe(originalOrigin);

    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });

    expect(fragment).toHaveBeenCalledExactlyOnceWith(url, 'push', 'none', null, null, expect.any(String), null);
  });

  it('reports distinct navigation IDs when unloading cancels successive requests', async () => {
    const { document, navigable, failed, fragment, url } = await fixture();
    document.unloadCounter = 1;
    const blocked = vi.spyOn(navigable, 'isNavigationOrHistoryUpdateBlocked');
    for (let i = 0; i < 2; i++) navigable.navigate(url, document, {}, document.env);
    const ids = failed.mock.calls.map(([, status]) => status.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(blocked).not.toHaveBeenCalled();
    expect(fragment).not.toHaveBeenCalled();
  });

  it('cancels lazy-load resumption before the navigation-throttle check', async () => {
    const { document, child, iframe, failed, fragment, url } = await childFixture();
    iframe.setAttribute('loading', 'lazy');
    document.startObservingLazyLoadingElement(iframe);
    const resume = vi.fn();
    iframe.lazyLoadResumptionSteps = resume;
    const stop = vi.spyOn(document, 'stopObservingLazyLoadingElement');
    vi.spyOn(child, 'isNavigationOrHistoryUpdateBlocked').mockImplementation(() => {
      expect(iframe.lazyLoadResumptionSteps).toBeNull();
      expect(stop).toHaveBeenCalledExactlyOnceWith(iframe);
      return true;
    });

    child.navigate(url, document, {}, document.env);

    expect(failed).toHaveBeenCalledExactlyOnceWith(child, { id: expect.any(String) as string, status: 'canceled', url });
    expect(resume).not.toHaveBeenCalled();
    expect(fragment).not.toHaveBeenCalled();
  });

  it('returns before touching lazy loading when unloading is in progress', async () => {
    const { document, child, iframe, url } = await childFixture();
    const lazy = vi.spyOn(iframe, 'willLazyLoad');
    child.activeDocument!.unloadCounter = 1;
    child.navigate(url, document, {}, document.env);
    expect(lazy).not.toHaveBeenCalled();
  });

  it('forwards fragment inputs without changing the Document or its history', async () => {
    const { document, navigable, fragment, url } = await fixture();
    const originalURL = document.url;
    const originalEntry = navigable.activeSessionHistoryEntry;
    const sourceElement = document.createElement('a');
    const state = document.env.serializeForStorage({ saved: true });
    navigable.navigate(url, document, {
      historyHandling: 'replace', userInvolvement: 'activation', sourceElement, navigationAPIState: state,
    }, document.env);
    expect(fragment).toHaveBeenCalledExactlyOnceWith(url, 'replace', 'activation', sourceElement, state, expect.any(String), null);
    expect(document.url).toBe(originalURL);
    expect(navigable.activeSessionHistoryEntry).toBe(originalEntry);
    expect(navigable.isDelayingLoadEvents).toBe(false);
  });

  it.each(['response', 'resource', 'no-fragment', 'different-path'] as const)(
    'keeps %s out of the fragment path', async (kind) => {
      const { document, navigable, fragment, url } = await fixture();
      const options = kind === 'response' ? { response: new FetchResponse() }
        : kind === 'resource' ? { documentResource: '' } : {};
      if (kind === 'no-fragment') url.fragment = null;
      if (kind === 'different-path') url.path = ['elsewhere'];
      navigable.navigate(url, document, options, document.env);
      expect(fragment).not.toHaveBeenCalled();
      expect(navigable.isDelayingLoadEvents).toBe(false);
    },
  );

  it('reaches persisted-state restoration after fragment dispatch and Document updates', async () => {
    const { document, navigable, fragment, url } = await fixture();
    fragment.mockRestore();
    expect(() => navigable.navigate(url, document, {}, document.env)).toThrow('Session-history scroll restoration is not implemented');
  });

  it('reports the generated ID before making it ongoing, without changing the active Document', async () => {
    const { document, navigable, failed } = await fixture();
    const url = document.env.parseHTMLURL('/next')!;
    const entry = navigable.activeSessionHistoryEntry;
    const observed: (string | null)[] = [];
    const started = vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationStarted').mockImplementation(() => {
      observed.push(navigable.ongoingNavigation);
    });

    navigable.navigate(url, document, {}, document.env);

    expect(observed).toEqual([null]);
    expect(started).toHaveBeenCalledExactlyOnceWith(navigable, {
      id: navigable.ongoingNavigation, status: 'pending', url,
    });
    expect(navigable.ongoingNavigation).toEqual(expect.any(String));
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(navigable.activeDocument).toBe(document);
    expect(navigable.isDelayingLoadEvents).toBe(false);
    expect(failed).not.toHaveBeenCalled();
  });

  it('sets the child load delay and captures sandbox/referrer policy before reporting start', async () => {
    const { document, child, iframe, url } = await childFixture();
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    const snapshot = vi.spyOn(child, 'snapshotTargetParams');
    const observed: boolean[] = [];
    vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationStarted').mockImplementation(() => {
      observed.push(child.isDelayingLoadEvents);
      expect(snapshot).toHaveBeenCalledOnce();
    });

    child.navigate(url, document, {}, document.env);

    expect(observed).toEqual([true]);
    expect(child.isDelayingLoadEvents).toBe(true);
    const captured = snapshot.mock.results[0]!.value as ReturnType<Navigable['snapshotTargetParams']>;
    expect(captured.sandboxingFlags.has('sandboxed-origin')).toBe(true);
    expect(captured.sandboxingFlags.has('sandboxed-scripts')).toBe(false);
    expect(captured.iframeReferrerPolicy).toBe('no-referrer');
  });

  it('reports start then failure for a traversing child without replacing its ongoing state', async () => {
    const { document, child, url } = await childFixture();
    child.setOngoingNavigation('traversal', document.env);
    const statuses: { id: string | null; status: string; }[] = [];
    vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationStarted').mockImplementation((_target, status) => {
      statuses.push(status);
    });
    vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationFailed').mockImplementation((_target, status) => {
      statuses.push(status);
    });
    const notify = vi.spyOn(child, 'informNavigationAPIAboutAbortingNavigation');

    expect(() => child.navigate(url, document, {}, document.env)).not.toThrow();

    expect(statuses).toHaveLength(2);
    expect(statuses.map((status) => status.status)).toEqual(['pending', 'canceled']);
    expect(statuses[0]!.id).toBe(statuses[1]!.id);
    expect(child.ongoingNavigation).toBe('traversal');
    expect(child.isDelayingLoadEvents).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('checks live traversal state after the Agent handoff', async () => {
    const { document, navigable, failed } = await fixture();
    const url = document.env.parseHTMLURL('/next')!;
    const started = vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationStarted');
    navigable.navigate(url, document);
    expect(started).not.toHaveBeenCalled();
    navigable.setOngoingNavigation('traversal', document.env);

    await runInHostTask(() => { document.env.responsibleEventLoop.runTaskTurn(); });

    expect(started).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledExactlyOnceWith(navigable, {
      id: started.mock.calls[0]![1].id, status: 'canceled', url,
    });
    expect(navigable.ongoingNavigation).toBe('traversal');
  });

  it('leaves ongoing state, load delay, and automation start untouched on the fragment branch', async () => {
    const { document, child, fragment } = await childFixture();
    const url = copyURL(child.activeSessionHistoryEntry.url);
    url.fragment = 'target';
    child.setOngoingNavigation('original', document.env);
    const started = vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationStarted');
    const snapshot = vi.spyOn(child, 'snapshotTargetParams');

    child.navigate(url, document, {}, document.env);

    expect(fragment).toHaveBeenCalledOnce();
    expect(child.ongoingNavigation).toBe('original');
    expect(child.isDelayingLoadEvents).toBe(false);
    expect(snapshot).not.toHaveBeenCalled();
    expect(started).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/page#before');
  const document = unwrap<DocumentImpl>(browser.document);
  // Finish loading/Performance delivery before tests advance their own operation by one turn.
  await runInHostTask(() => {
    while (document.env.responsibleEventLoop.runTaskTurn()) { /* Drain loading tasks. */ }
  });
  const navigable = document.getNodeNavigable()!;
  const turns: (() => void)[] = [];
  vi.spyOn(document.env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  // Supply activation notification/expiry; the navigation decisions and task delivery remain real.
  const activation = vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  const permission = vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate');
  const failed = vi.spyOn(document.env.userAgent, 'webDriverBiDiNavigationFailed');
  const fragment = vi.spyOn(navigable, 'navigateToFragment').mockImplementation(() => {});
  const url = parseURL('https://example.test/page#after').url!;
  return { browser, document, navigable, activation, permission, failed, fragment, url, turns };
}

async function childFixture() {
  const state = await fixture();
  const { browser, document, navigable } = state;
  const iframe = unwrap<HTMLIFrameElementImpl>(browser.document.createElement('iframe'));
  const [, childDocument] = BrowsingContext.create(document, iframe, navigable.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(childDocument), navigable);
  iframe.contentNavigable = child;
  const fragment = vi.spyOn(child, 'navigateToFragment').mockImplementation(() => {});
  return { ...state, child, iframe, fragment };
}
