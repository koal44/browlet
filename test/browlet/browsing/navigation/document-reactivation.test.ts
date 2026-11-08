import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchResponse } from '../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import type { TimerHost } from '../../../../src/infra/tasks';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { Duration } from '../../../../src/timing/clock';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { PageTransitionEvent, Window } from '../../../../src/browlet/platform';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('retained-Document reactivation', () => {
  it('retains its legacy navigation type before pageshow instead of reclassifying a restored load', async () => {
    let observedType: number | undefined;
    const { document, target, previous } = fixture(undefined, (platform) => {
      platform.onpageshow = () => { observedType = platform.performance.navigation.type; };
    });
    document.legacyNavigationType = 'reload';
    const performance = document.env.getWindowOrWorkerGlobalScopeMixin().performance;
    const retained = performance.navigation;
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    await inTask(document, () => document.reactivate(target, [target, previous], 'traverse', previous));
    expect(observedType).toBe(1);
    expect(performance.navigation).toBe(retained);
    expect(retained.type).toBe(1);
  });

  it('restores the Window Document exposed by the native global after reactivation', () => {
    const { document, window } = fixture();
    const platform = project(window) as Window;
    expect(platform.document.URL).toBe(document.URL);
  });

  it('refreshes activation from a predecessor discovered while this Document was cached', () => {
    const { document, navigation, target, previous } = fixture();
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    document.updateForHistoryStepApplication(target, false, 2, 0, 'traverse', [target, previous], previous);
    expect(navigation.activation!.from?.key).toBe(previous.navigationAPIKey);
    expect(navigation.activation!.entry).toBe(navigation.currentEntry);
  });

  it('shows the retained Document with refreshed Navigation state before disposing removed entries', async () => {
    const order: string[] = [];
    const shown: unknown[] = [];
    const { document, window, platformNavigation, target, previous } = fixture(undefined, (platform) => {
      const platformDocument = platform.document;
      const navigation = platform.navigation;
      const activation = navigation.activation;
      const [removed, current] = navigation.entries();
      removed!.ondispose = () => { order.push('dispose'); };
      platformDocument.addEventListener('pageshow', () => { order.push('document-listener'); });
      platform.addEventListener('pagereveal', () => { order.push('pagereveal'); });
      navigation.oncurrententrychange = () => { order.push('currententrychange'); };
      platform.onpageshow = (event) => {
        order.push('pageshow');
        shown.push({
          type: event.type, persisted: (event as PageTransitionEvent).persisted, trusted: event.isTrusted,
          bubbles: event.bubbles, cancelable: event.cancelable,
          target: event.target === platformDocument, currentTarget: event.currentTarget === platform,
          current: navigation.currentEntry === current, activation: navigation.activation === activation,
          activationEntry: navigation.activation!.entry === current,
          navigationType: navigation.activation!.navigationType,
          from: navigation.activation!.from === navigation.entries()[1], hidden: document.hidden,
        });
        // Cancellation is observable on this legacy event but does not undo restoration.
        event.preventDefault();
      };
    });
    const reset = vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {
      order.push('reset');
      expect(document.pageShowing).toBe(false);
    });
    vi.spyOn(document, 'updateVisibilityState').mockImplementation((state) => {
      order.push('visibility');
      expect(state).toBe('visible');
      expect(document.pageShowing).toBe(true);
      expect(document.hasBeenRevealed).toBe(false);
      expect(platformNavigation.activation!.from!.key).toBe(previous.navigationAPIKey);
      expect(platformNavigation.entries()).toHaveLength(2);
    });
    expect(window.eventHandlers.get('onpageshow')!.realm === document.env.realm).toBe(true);

    await inTask(document, () => {
      document.updateForHistoryStepApplication(target, false, 2, 0, 'traverse', [target, previous], previous);
      expect(order).toEqual(['reset', 'visibility', 'pageshow']);
    });
    expect(reset).toHaveBeenCalledOnce();
    expect(shown).toEqual([{
      type: 'pageshow', persisted: true, trusted: true, bubbles: true, cancelable: true,
      target: true, currentTarget: true, current: true, activation: true, activationEntry: true,
      navigationType: 'traverse', from: true, hidden: false,
    }]);
    expect(document.pageShowing).toBe(true);
    expect(document.hasBeenRevealed).toBe(false);
    await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
    expect(order).toEqual(['reset', 'visibility', 'pageshow', 'dispose']);
  });

  it.each([
    ['loading', false], ['interactive', false], ['complete', true],
  ] as const)('reconciles entries without pageshow for readiness %s and pageShowing %s', (readiness, showing) => {
    const { document, window, navigation, target, previous } = fixture();
    document.currentDocumentReadiness = readiness;
    document.pageShowing = showing;
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    const visible = vi.spyOn(document, 'updateVisibilityState');
    const show = vi.spyOn(window, 'firePageTransitionEvent');
    document.reactivate(target, [target, previous], 'traverse', previous);
    expect(navigation.currentEntry!.sessionHistoryEntry === target).toBe(true);
    expect(navigation.activation!.from!.key).toBe(previous.navigationAPIKey);
    expect(document.pageShowing).toBe(showing);
    expect(document.hasBeenRevealed).toBe(true);
    expect(visible).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('does not emit a second pageshow during or after its listener', async () => {
    let shown = 0;
    const { document, target, previous } = fixture(undefined, (platform) => {
      platform.onpageshow = () => {
        shown++;
        if (shown === 1) document.reactivate(target, [target, previous]);
      };
    });
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    await inTask(document, () => document.reactivate(target, [target, previous]));
    expect(shown).toBe(1);
    document.hasBeenRevealed = true;
    await inTask(document, () => document.reactivate(target, [target, previous]));
    expect(shown).toBe(1);
    expect(document.hasBeenRevealed).toBe(true);
  });

  it('still fires pageshow when Navigation entries are disabled', async () => {
    const show = vi.fn(() => {});
    const { document, platformNavigation, target } = fixture(undefined, (platform) => { platform.onpageshow = show; });
    document.origin = createOpaqueOrigin();
    target.documentState.origin = document.origin;
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    await inTask(document, () => document.reactivate(target, [target]));
    expect(show).toHaveBeenCalledOnce();
    expect(platformNavigation.entries()).toEqual([]);
    expect(document.pageShowing).toBe(true);
  });

  it('stops at the form-owner dependency before changing Navigation or page state', () => {
    const { document, navigation, target, previous } = fixture();
    const reconcile = vi.spyOn(navigation, 'updateEntriesForReactivation');
    const activate = vi.spyOn(navigation, 'updateActivation');
    expect(() => document.reactivate(target, [target, previous], 'traverse', previous))
      .toThrow('Autocomplete-off control reset is not implemented');
    expect(reconcile).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(document.pageShowing).toBe(false);
    expect(document.hasBeenRevealed).toBe(true);
  });

  it('keeps real visibility changes explicit instead of silently bypassing their hooks', () => {
    const { document, window, navigation, target, previous } = fixture();
    document.setInitialVisibilityState('hidden');
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    const show = vi.spyOn(window, 'firePageTransitionEvent');
    expect(() => document.reactivate(target, [target, previous], 'traverse', previous))
      .toThrow('Document visibility change processing is not implemented');
    expect(navigation.activation!.from!.key).toBe(previous.navigationAPIKey);
    // These flags precede visibility in HTML; an unfinished-owner exception is not a completed restoration.
    expect(document.pageShowing).toBe(true);
    expect(document.hasBeenRevealed).toBe(false);
    expect(document.visibilityState).toBe('hidden');
    expect(show).not.toHaveBeenCalled();
  });

  it('accepts unchanged visibility without pretending to implement a visibility transition', () => {
    const { document } = fixture();
    expect(() => document.updateVisibilityState('visible')).not.toThrow();
    document.setInitialVisibilityState('hidden');
    expect(() => document.updateVisibilityState('hidden')).not.toThrow();
    expect(() => document.updateVisibilityState('visible')).toThrow('Document visibility change processing is not implemented');
  });

  it('does not count timer suspension twice after the Document has already become active', () => {
    const wakeups: { delay: number; steps: () => void; remove: ReturnType<typeof vi.fn>; }[] = [];
    const host: TimerHost = {
      scheduleTimeout(delay, steps) {
        const wakeup = { delay, steps, remove: vi.fn() };
        wakeups.push(wakeup);
        return wakeup;
      },
    };
    const { document, top, target, previous } = fixture(host);
    let now = 0;
    vi.spyOn(document.env, 'currentHighResolutionTime').mockImplementation(() => new Duration(now));
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    const timers = document.env.getWindowOrWorkerGlobalScopeMixin().timers;
    const order: string[] = [];
    timers.runStepsAfterTimeout('before-cache', 10, () => { order.push('first'); });
    now = 4;
    top.activeSessionHistoryEntry = previous;
    previous.document!.makeActive();
    expect(wakeups[0]!.remove).toHaveBeenCalledOnce();
    now = 20;
    timers.runStepsAfterTimeout('during-cache', 20, () => { order.push('second'); });
    expect(wakeups).toHaveLength(1);
    now = 104;
    top.activeSessionHistoryEntry = target;
    document.makeActive();
    expect(wakeups.slice(1).map((wakeup) => wakeup.delay)).toEqual([6, 20]);
    expect(timers.getNextTimeoutDeadline()?.milliseconds).toBe(110);
    document.reactivate(target, [target, previous]);
    expect(timers.getNextTimeoutDeadline()?.milliseconds).toBe(110);
    expect(wakeups).toHaveLength(3);
    expect(order).toEqual([]);
    now = 110;
    wakeups[1]!.steps();
    expect(order).toEqual(['first']);
    now = 124;
    wakeups[2]!.steps();
    expect(order).toEqual(['first', 'second']);
  });
});

/** Make a retained Document active again without running its history-update/reactivation steps. */
function fixture(timerHost?: TimerHost, beforeLeaving?: (window: Window) => void) {
  const userAgent = createManualUserAgent();
  if (timerHost !== undefined) userAgent.timerHost = timerHost;
  const top = TopLevelTraversable.create(userAgent, null, '');
  const document = top.activeDocument!;
  document.setURL(parseURL('https://example.test/retained').url!);
  document.origin = obtainURLOrigin(document.url);
  document.isInitialAboutBlank = false;
  const target = top.activeSessionHistoryEntry;
  target.url = document.url;
  target.documentState.origin = document.origin;
  document.latestEntry = target;
  document.currentDocumentReadiness = 'complete';
  document.hasBeenRevealed = true;
  const window = document.getRelevantGlobalObject()!;
  const navigation = window.navigation;
  const removed = document.env.createSessionHistoryEntry(parseURL('https://example.test/old').url!, target.documentState);
  navigation.initializeEntriesForNewDocument([removed, target], target);
  navigation.updateActivation('reload', target);
  const platform = project(window) as Window;
  const platformNavigation = platform.navigation;
  // A cached page retains handlers installed in its original realm before leaving.
  // Registering a new Node-owned function through a later realm's inherited setter tests a different callback owner.
  beforeLeaving?.(platform);

  const response = new FetchResponse();
  response.urlList.push(parseURL('https://example.test/departing').url!);
  const params = top.createNavigationParams(response);
  const departing = top.createAndInitializeDocument('html', 'text/html', params);
  const previous = top.createHistoryEntry(departing, params);
  previous.step = 1;
  top.sessionHistoryEntries.push(previous);
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry = previous;
  departing.makeActive();
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry = target;
  document.makeActive();
  return { userAgent, top, document, window, navigation, platformNavigation, target, previous };
}

async function inTask(document: DocumentImpl, steps: () => void): Promise<void> {
  document.env.queueTask('navigation-and-traversal', { run: steps });
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
