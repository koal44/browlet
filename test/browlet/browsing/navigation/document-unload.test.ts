import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { Event, PageTransitionEvent, Window } from '../../../../src/browlet/platform';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchResponse } from '../../../../src/fetch/index';
import { Duration } from '../../../../src/timing/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('single-Document unloading', () => {
  it('requires the old Document\'s running task before changing lifecycle state', () => {
    const { document } = fixture();
    expect(() => document.unload()).toThrow('Document unloading requires a task on its owning event loop');
    expect(document.salvageable).toBe(true);
    expect(document.unloadCounter).toBe(0);
  });

  it('keeps cache admission explicit for a salvageable Document', () => {
    const { document, run, loop } = fixture();
    const event = vi.spyOn(document.getRelevantGlobalObject()!, 'fireEvent');
    document.hasBeenScrolledByUser = true;
    expect(() => run(() => document.unload())).toThrow('Back-forward cache admission is not implemented');
    expect(event).not.toHaveBeenCalled();
    expect(document.salvageable).toBe(true);
    expect(document.hasBeenScrolledByUser).toBe(true);
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
  });

  it('fires pagehide before visibility and unload, with counters bracketing the specified phases', () => {
    const { document, userAgent, window, run, loop } = fixture();
    const admission = vi.spyOn(userAgent, 'shouldKeepDocumentInBfcache').mockReturnValue(false);
    document.pageShowing = true;
    document.hasBeenScrolledByUser = true;
    const order: string[] = [];
    const events: unknown[] = [];
    const platformWindow = window.window;
    const platformDocument = window.document;
    window.addEventListener('pagehide', (event) => {
      order.push('pagehide');
      events.push({
        type: event.type, persisted: (event as PageTransitionEvent).persisted,
        target: event.target, showing: document.pageShowing, salvageable: document.salvageable,
        counters: [document.unloadCounter, loop.terminationNestingLevel],
      });
    });
    // Visibility's cross-specification notifications remain a separate throwing owner.
    const visibility = vi.spyOn(document, 'updateVisibilityState').mockImplementation((state) => {
      expect(state).toBe('hidden');
      order.push('visibility');
    });
    window.addEventListener('unload', (event) => {
      order.push('unload');
      event.preventDefault();
      events.push({
        type: event.type, target: event.target, currentTarget: event.currentTarget,
        flags: [event.isTrusted, event.bubbles, event.cancelable, event.defaultPrevented],
        counters: [document.unloadCounter, loop.terminationNestingLevel],
      });
    });
    const cleanup = document.runUnloadingCleanup.bind(document);
    vi.spyOn(document, 'runUnloadingCleanup').mockImplementation(() => {
      order.push('cleanup');
      expect(document.hasBeenScrolledByUser).toBe(false);
      expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([1, 0]);
      cleanup();
    });
    const reasons = vi.spyOn(document, 'buildNotRestoredReasons');
    const destroy = vi.spyOn(document, 'destroy');
    run(() => document.unload());
    expect(admission).toHaveBeenCalledExactlyOnceWith(document);
    expect(visibility).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { type: 'pagehide', persisted: false, target: platformDocument, showing: false, salvageable: false, counters: [1, 1] },
      { type: 'unload', target: platformDocument, currentTarget: platformWindow, flags: [true, false, false, false], counters: [1, 1] },
    ]);
    // Destruction performs its own idempotent resource cleanup after unload cleanup.
    expect(order).toEqual(['pagehide', 'visibility', 'unload', 'cleanup', 'cleanup']);
    expect(reasons.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]!);
    expect(document.browsingContext).toBeNull();
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
  });

  it('reports persisted pagehide and retains the Document and timers after cache admission', () => {
    const { document, incoming, userAgent, window, run, loop } = fixture();
    vi.spyOn(userAgent, 'shouldKeepDocumentInBfcache').mockReturnValue(true);
    const clock = vi.spyOn(incoming.env, 'currentHighResolutionTime').mockReturnValue(new Duration(25));
    vi.spyOn(document, 'updateVisibilityState').mockImplementation(() => {});
    const clear = vi.spyOn(document.env.getWindowOrWorkerGlobalScopeMixin().timers, 'clear');
    const hide = vi.fn((event: Event) => (event as PageTransitionEvent).persisted);
    const unload = vi.fn();
    window.addEventListener('pagehide', hide);
    window.addEventListener('unload', unload);
    document.pageShowing = true;
    document.hasBeenScrolledByUser = true;
    const context = document.browsingContext;
    run(() => document.unload(incoming));
    expect(hide).toHaveBeenCalledOnce();
    expect(hide.mock.results[0]!.value).toBe(true);
    expect(unload).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(document.browsingContext).toBe(context);
    expect(document.salvageable).toBe(true);
    expect(document.pageShowing).toBe(false);
    expect(document.hasBeenScrolledByUser).toBe(false);
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
    expect(clock).not.toHaveBeenCalled();
    expect([incoming.navigationTimingEntry!.unloadEventStart, incoming.navigationTimingEntry!.unloadEventEnd]).toEqual([0, 0]);
  });

  it('skips cache admission for an unsalvageable Document and clears its timers', () => {
    const { document, userAgent, run } = fixture();
    document.makeUnsalvageable('test-blocker');
    const admission = vi.spyOn(userAgent, 'shouldKeepDocumentInBfcache');
    const timers = document.env.getWindowOrWorkerGlobalScopeMixin().timers;
    timers.runStepsAfterTimeout('unload-test', 10_000, () => {});
    expect(timers.hasOutstandingTimers()).toBe(true);
    run(() => document.unload());
    expect(admission).not.toHaveBeenCalled();
    expect(timers.hasOutstandingTimers()).toBe(false);
    expect(document.browsingContext).toBeNull();
  });

  it('does not send another pagehide or visibility update if the page is not showing', () => {
    const { document, window, run } = fixture();
    document.salvageable = false;
    const hide = vi.fn();
    const unload = vi.fn();
    const visibility = vi.spyOn(document, 'updateVisibilityState');
    window.addEventListener('pagehide', hide);
    window.addEventListener('unload', unload);
    run(() => document.unload());
    expect(hide).not.toHaveBeenCalled();
    expect(visibility).not.toHaveBeenCalled();
    expect(unload).toHaveBeenCalledOnce();
  });

  it('updates an already-created navigation entry using incoming-relative, outgoing-coarsened times', () => {
    const { document, incoming, run } = fixture();
    document.salvageable = false;
    expect(incoming.env.responsibleEventLoop).toBe(document.env.responsibleEventLoop);
    const record = incoming.previousDocumentUnloadTiming;
    const entry = incoming.navigationTimingEntry!;
    expect(entry.previousDocumentUnloadTiming).toBe(record);
    expect([entry.unloadEventStart, entry.unloadEventEnd]).toEqual([0, 0]);
    const clock = vi.spyOn(incoming.env, 'currentHighResolutionTime')
      .mockReturnValueOnce(new Duration(12.345)).mockReturnValueOnce(new Duration(13.987));
    run(() => document.unload(incoming));
    expect(clock).toHaveBeenCalledTimes(2);
    expect(incoming.previousDocumentUnloadTiming).toBe(record);
    expect(entry.unloadEventStart).toBeCloseTo(12.3);
    expect(entry.unloadEventEnd).toBeCloseTo(13.9);
    const performance = (incoming.env.realm.globalObject as Window).performance;
    expect(performance.timing.unloadEventStart).toBeGreaterThan(0);
    expect(performance.timing.unloadEventEnd).toBeGreaterThanOrEqual(performance.timing.unloadEventStart);
  });

  it.each(['foreign-origin', 'opaque-origin', 'foreign-redirect', 'relaxed-domains'] as const)(
    'keeps unload measurements hidden for %s', (reason) => {
      const { document, incoming, run } = fixture();
      document.salvageable = false;
      if (reason === 'foreign-redirect') { incoming.wasCreatedViaCrossOriginRedirects = true; }
      else if (reason === 'opaque-origin') { incoming.origin = createOpaqueOrigin(); }
      else if (reason === 'foreign-origin') { incoming.origin = obtainURLOrigin(parseURL('https://foreign.test/').url!); }
      else {
        const first = obtainURLOrigin(parseURL('https://a.example.test/').url!);
        const second = obtainURLOrigin(parseURL('https://b.example.test/').url!);
        if (first.kind !== 'tuple' || second.kind !== 'tuple') throw new Error('Tuple origins required');
        first.domain = second.domain = { kind: 'domain', value: 'example.test' };
        document.origin = first;
        incoming.origin = second;
      }
      vi.spyOn(incoming.env, 'currentHighResolutionTime').mockReturnValue(new Duration(25));
      run(() => document.unload(incoming));
      expect(incoming.previousDocumentUnloadTiming).toEqual({ unloadEventStartTime: 0, unloadEventEndTime: 0 });
      expect([incoming.navigationTimingEntry!.unloadEventStart, incoming.navigationTimingEntry!.unloadEventEnd]).toEqual([0, 0]);
    },
  );

  it('leaves zero timing for a destination on another event loop', () => {
    const { document, run } = fixture();
    const { incoming } = fixture();
    document.salvageable = false;
    expect(document.env.responsibleEventLoop).not.toBe(incoming.env.responsibleEventLoop);
    const clock = vi.spyOn(incoming.env, 'currentHighResolutionTime');
    run(() => document.unload(incoming));
    expect(clock).not.toHaveBeenCalled();
    expect(incoming.previousDocumentUnloadTiming).toEqual({ unloadEventStartTime: 0, unloadEventEndTime: 0 });
  });

  it('retains the explicit visibility dependency and restores both counters when it throws', () => {
    const { document, run, loop } = fixture();
    document.salvageable = false;
    document.pageShowing = true;
    loop.terminationNestingLevel = 3;
    document.unloadCounter = 2;
    expect(() => run(() => document.unload())).toThrow('Document visibility change processing is not implemented');
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([2, 3]);
  });

  it('restores the unload counter if cross-specification cleanup throws', () => {
    const { document, run, loop } = fixture();
    document.salvageable = false;
    vi.spyOn(document, 'runUnloadingCleanup').mockImplementation(() => { throw new Error('cleanup failed'); });
    expect(() => run(() => document.unload())).toThrow('cleanup failed');
    expect([document.unloadCounter, loop.terminationNestingLevel]).toEqual([0, 0]);
  });

  it('destroys a Document made unsalvageable during cleanup without firing a late unload event', () => {
    const { document, userAgent, window, run } = fixture();
    vi.spyOn(userAgent, 'shouldKeepDocumentInBfcache').mockReturnValue(true);
    vi.spyOn(document, 'runUnloadingCleanup').mockImplementation(() => { document.makeUnsalvageable('test-cleanup'); });
    const unload = vi.fn();
    window.addEventListener('unload', unload);
    run(() => document.unload());
    expect(unload).not.toHaveBeenCalled();
    expect(document.browsingContext).toBeNull();
  });

  it('runs through the automatic loop without a manually driven turn', async () => {
    const { document, incoming } = fixture(new UserAgent());
    document.salvageable = false;
    document.env.queueTask('navigation-and-traversal', { run: () => { document.unload(incoming); } });
    await expect.poll(() => document.browsingContext).toBeNull();
    expect(incoming.navigationTimingEntry!.unloadEventEnd).toBeGreaterThanOrEqual(incoming.navigationTimingEntry!.unloadEventStart);
  });
});

function fixture(userAgent = createManualUserAgent()) {
  const top = TopLevelTraversable.create(userAgent, null, 'unload');
  const create = (url: string): DocumentImpl => {
    const response = new FetchResponse();
    response.urlList.push(parseURL(url).url!);
    return top.createAndInitializeDocument('html', 'text/html', top.createNavigationParams(response));
  };
  const document = create('https://example.test/old');
  const response = new FetchResponse();
  response.urlList.push(document.url);
  const entry = top.createHistoryEntry(document, top.createNavigationParams(response));
  top.activeSessionHistoryEntry = top.currentSessionHistoryEntry = entry;
  document.makeActive();
  document.setInitialVisibilityState('visible');
  const incoming = create('https://example.test/new');
  const loop = document.env.responsibleEventLoop;
  const run = (steps: () => void): void => {
    document.env.queueTask('navigation-and-traversal', { run: steps });
    expect(loop.runTaskTurn()).toBe(true);
  };
  return { userAgent, top, document, incoming, loop, run, window: document.env.realm.globalObject as Window };
}
