import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { NavigateEvent as BrowletNavigateEvent } from '../../../../src/browlet/platform';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, type NavigateOptions } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/element';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { FetchResponse } from '../../../../src/fetch/index';
import { toScalarValueString } from '../../../../src/infra/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import type { FormDataEntry } from '../../../../src/xhr/index';
import { unwrap } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('ordinary navigation event eligibility', () => {
  it.each([
    'https://example.test/next', 'http://example.test/next', 'https://foreign.test/next',
    'about:blank', 'blob:https://example.test/id', 'file:///next.html',
    // SPEC_CLASH(navigate-event-top-level-data): Chromium adds an earlier top-level data: blocker.
    'data:text/html,body',
  ])('fires for a fetch-scheme destination: %s', async (destination) => {
    const { document, navigable, navigation, env } = await fixture();
    const fire = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent').mockReturnValue(false);
    const url = parseURL(destination).url!;
    navigable.navigate(url, document, {}, env);
    expect(fire).toHaveBeenCalledExactlyOnceWith('push', url, false, expect.objectContaining({ userInvolvement: 'none' }));
  });

  it.each(['mailto:person@example.test', 'custom:destination', 'ftp://example.test/next'])(
    'keeps non-fetch schemes out of this event path: %s', async (destination) => {
      const { document, navigable, navigation, env } = await fixture();
      const fire = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent');
      navigable.navigate(parseURL(destination).url!, document, {}, env);
      expect(fire).not.toHaveBeenCalled();
    },
  );

  it('does not fire for a browser-UI initiation', async () => {
    const { navigable, navigation, env } = await fixture();
    const fire = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent');
    navigable.navigate(parseURL('https://example.test/next').url!, null, { userInvolvement: 'browser UI' }, env);
    expect(fire).not.toHaveBeenCalled();
  });

  it('does not suppress the event merely because the caller supplied a response', async () => {
    const { document, navigable, navigation, env } = await fixture();
    const fire = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent').mockReturnValue(false);
    const url = parseURL('https://example.test/next').url!;
    navigable.navigate(url, document, { response: new FetchResponse() }, env);
    expect(fire).toHaveBeenCalledOnce();
  });

  it.each([false, true])('uses same-origin-domain between the live source and target (relaxed=%s)', async (relaxed) => {
    const { document, child, childDocument, env } = await childFixture();
    const sourceOrigin = obtainURLOrigin(parseURL('https://a.example.test/').url!);
    const targetOrigin = obtainURLOrigin(parseURL('https://b.example.test/').url!);
    if (sourceOrigin.kind !== 'tuple' || targetOrigin.kind !== 'tuple') throw new Error('Tuple origins required');
    if (relaxed) sourceOrigin.domain = targetOrigin.domain = { kind: 'domain', value: 'example.test' };
    document.origin = sourceOrigin;
    childDocument.origin = targetOrigin;
    const fire = vi.spyOn(child.activeWindow!.navigation, 'firePushReplaceReloadNavigateEvent').mockReturnValue(false);
    const navigate = () => child.navigate(parseURL('https://elsewhere.test/next').url!, document, {}, env);
    if (relaxed) {
      expect(navigate).not.toThrow();
      expect(fire).toHaveBeenCalledOnce();
    } else {
      expect(navigate).not.toThrow();
      expect(fire).not.toHaveBeenCalled();
    }
  });

  it('does not fire while the destination is the initial about:blank Document', async () => {
    const { document, child, childDocument, env } = await childFixture();
    childDocument.isInitialAboutBlank = true;
    const fire = vi.spyOn(child.activeWindow!.navigation, 'firePushReplaceReloadNavigateEvent');
    child.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(fire).not.toHaveBeenCalled();
  });

  it('rechecks the source origin after ongoing-navigation abortion callbacks', async () => {
    const { document, child, env } = await childFixture();
    const fire = vi.spyOn(child.activeWindow!.navigation, 'firePushReplaceReloadNavigateEvent').mockReturnValue(false);
    const notify = child.informNavigationAPIAboutAbortingNavigation.bind(child);
    vi.spyOn(child, 'informNavigationAPIAboutAbortingNavigation').mockImplementation((loop) => {
      notify(loop);
      document.origin = obtainURLOrigin(parseURL('https://foreign.test/').url!);
    });
    child.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe('ordinary navigation event inputs and cancellation', () => {
  it.each(['assign', 'replace'] as const)('delivers and cancels a real Location.%s request before loading', async (method) => {
    const { browser, route, navigable, navigation: sourceNavigation } = await fixture();
    const entry = navigable.activeSessionHistoryEntry;
    expect(await browser.evaluate((method) => {
      let captured!: NavigateEvent;
      let state: unknown;
      navigation.addEventListener('navigate', (event) => {
        captured = event;
        state = event.destination.getState();
        event.preventDefault();
      }, { once: true });
      location[method]('/next');
      return {
        type: captured.navigationType, url: captured.destination.url, sameDocument: captured.destination.sameDocument,
        state, realm: captured instanceof NavigateEvent && captured.destination instanceof NavigationDestination,
        target: captured.target === navigation, trusted: captured.isTrusted,
        cancelable: captured.cancelable, canIntercept: captured.canIntercept,
        userInitiated: captured.userInitiated, hashChange: captured.hashChange,
        form: captured.formData, source: captured.sourceElement, aborted: captured.signal.aborted,
        reason: (captured.signal.reason as DOMException).name,
      };
    }, method)).toEqual({
      type: method === 'assign' ? 'push' : 'replace', url: 'https://example.test/next', sameDocument: false,
      state: undefined, realm: true, target: true, trusted: true, cancelable: true, canIntercept: true,
      userInitiated: false, hashChange: false, form: null, source: null, aborted: true, reason: 'AbortError',
    });
    expect(navigable.activeSessionHistoryEntry).toBe(entry);
    expect(sourceNavigation.ongoingNavigateEvent).toBeNull();
    expect(route).toHaveBeenCalledOnce();
  });

  it('accepts the Navigation API tracker, exposes state/info, and rejects both promises on cancellation', async () => {
    const { browser, navigation: sourceNavigation, route } = await fixture();
    expect(await browser.evaluate(async () => {
      const info = { token: true };
      let captured!: NavigateEvent;
      let state: unknown;
      navigation.addEventListener('navigate', (event) => {
        captured = event;
        state = event.destination.getState();
        event.preventDefault();
      }, { once: true });
      const result = navigation.navigate('/next', { state: { saved: true }, info });
      const results = await Promise.allSettled([result.committed, result.finished]);
      return {
        state, sameInfo: captured.info === info,
        errors: results.map((result) => result.status === 'rejected' &&
          result.reason instanceof DOMException && result.reason.name),
      };
    })).toEqual({ state: { saved: true }, sameInfo: true, errors: ['AbortError', 'AbortError'] });
    expect(sourceNavigation.ongoingAPIMethodTracker).toBeNull();
    expect(route).toHaveBeenCalledOnce();
  });

  it.each(['post', 'empty-post', 'get', 'srcdoc'] as const)('exposes a form entry list only for a POST resource (%s)', async (kind) => {
    const { browser, document, navigable, env } = await fixture();
    const source = browser.document.createElement('form');
    const entries: FormDataEntry[] = kind === 'empty-post' ? [] : [[toScalarValueString('field'), toScalarValueString('value')]];
    const options: NavigateOptions = {
      sourceElement: unwrap<ElementImpl>(source), userInvolvement: 'activation', formDataEntryList: entries,
      documentResource: kind === 'post' || kind === 'empty-post'
        ? { requestBody: new Uint8Array(), requestContentType: 'application/x-www-form-urlencoded' }
        : kind === 'srcdoc' ? '<p>srcdoc</p>' : null,
    };
    const observed: unknown[] = [];
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      observed.push(event.sourceElement === source, event.userInitiated,
        event.formData === null ? null : [...event.formData.entries()]);
      event.preventDefault();
    });
    navigable.navigate(parseURL('https://example.test/submitted').url!, document, options, env);
    expect(observed).toEqual([true, true, kind === 'post' ? [['field', 'value']] : kind === 'empty-post' ? [] : null]);
  });

  it.each(['absent', 'null-option', 'serialized-null', 'serialized-state'] as const)('distinguishes absent state from serialized values (%s)', async (kind) => {
    const { browser, document, navigable, env } = await fixture();
    const value = { saved: 'state' };
    const options: NavigateOptions = kind === 'absent' ? {}
      : { navigationAPIState: kind === 'null-option' ? null : env.serializeForStorage(kind === 'serialized-null' ? null : value) };
    let state: unknown = 'not observed';
    browser.window.navigation.addEventListener('navigate', (baseEvent) => {
      const event = baseEvent as BrowletNavigateEvent;
      state = event.destination.getState();
      event.preventDefault();
    });
    navigable.navigate(parseURL('https://example.test/next').url!, document, options, env);
    expect(state).toEqual(kind === 'serialized-state' ? value : kind === 'serialized-null' ? null : undefined);
  });

  it('delivers the event only after a queued handoff to the target Agent', async () => {
    const { browser, document, navigable, env } = await fixture();
    const events: unknown[] = [];
    browser.window.navigation.addEventListener('navigate', (event) => { events.push(event); event.preventDefault(); });
    await runInHostTask(() => {
      navigable.navigate(parseURL('https://example.test/next').url!, document);
      expect(events).toHaveLength(0);
      expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    });
    expect(events).toHaveLength(1);
  });

  it('hands accepted navigation to queued unload checks after its event', async () => {
    const { browser, document, navigable, navigation, env, route, turns } = await fixture();
    const events: BrowletNavigateEvent[] = [];
    const beforeUnload = vi.spyOn(document, 'fireBeforeUnload').mockReturnValue([true, true]);
    browser.window.navigation.addEventListener('navigate', (event) => { events.push(event as BrowletNavigateEvent); });
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    await expect.poll(() => beforeUnload.mock.calls.length).toBe(1);
    await expect.poll(() => turns.length).toBe(1);
    turns.shift()!();
    expect(events).toHaveLength(1);
    expect(events[0]!.signal.aborted).toBe(false);
    expect(navigation.ongoingNavigateEvent).not.toBeNull();
    expect(navigable.activeDocument).toBe(document);
    expect(route).toHaveBeenCalledOnce();
  });
});

describe('ordinary navigation interception handoff', () => {
  it('stops ordinary loading while a real precommit handler is pending', async () => {
    const { browser, navigation: sourceNavigation, route } = await fixture();
    await browser.evaluate(() => {
      navigation.addEventListener('navigate', (event) => {
        event.intercept({ precommitHandler: () => new Promise<void>(() => {}) });
      }, { once: true });
      location.assign('/intercepted');
    });
    expect(sourceNavigation.ongoingNavigateEvent!.interceptionState).toBe('intercepted');
    expect(sourceNavigation.transition).not.toBeNull();
    expect(browser.window.location.href).toBe('https://example.test/current');
    expect(route).toHaveBeenCalledOnce();
  });

  it('commits interception in the same Document without loading, then queues history application', async () => {
    const { browser, document, navigable, env, route, turns } = await fixture();
    browser.window.navigation.addEventListener('navigate', (event) => {
      (event as BrowletNavigateEvent).intercept({ handler: () => new Promise<void>(() => {}) });
    });
    navigable.navigate(parseURL('https://example.test/next').url!, document, {}, env);
    expect(navigable.activeDocument).toBe(document);
    expect(browser.window.location.href).toBe('https://example.test/next');
    expect(route).toHaveBeenCalledOnce();
    expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
    expect(() => turns.shift()!()).toThrow('Same-document history-step application is not implemented');
  });
});

async function fixture() {
  const route = vi.fn(() => '');
  const browser = new Browlet({ route });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  // Finish loading/Performance delivery before tests advance their own operation by one turn.
  await runInHostTask(() => {
    while (document.env.responsibleEventLoop.runTaskTurn()) { /* Drain loading tasks. */ }
  });
  const env = document.env;
  const navigable = document.getNodeNavigable()!;
  const turns: (() => void)[] = [];
  vi.spyOn(env.userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
  // The earlier activation and sandbox admission owners remain unfinished.
  vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
  vi.spyOn(navigable, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  return { browser, route, document, navigable, env, turns, navigation: document.getRelevantGlobalObject()!.navigation };
}

async function childFixture() {
  const state = await fixture();
  const { document, navigable } = state;
  const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
  const [, childDocument] = BrowsingContext.create(document, iframe, navigable.activeBrowsingContext!.group!);
  const child = new Navigable(DocumentState.create(childDocument), navigable);
  iframe.contentNavigable = child;
  // Supply the unfinished child-loading result; these tests exercise the navigation caller's eligibility gate.
  childDocument.isInitialAboutBlank = false;
  childDocument.setURL(parseURL('https://example.test/child').url!);
  return { ...state, child, childDocument };
}
