import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../../src/infra/index';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLBodyElement, PageRevealEvent, Window } from '../../../../src/browlet/platform';
import { ViewTransitionImpl } from '../../../../src/browlet/rendering/index';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import { WindowRenderingProducer, type RenderingOpportunityHost } from '../../../../src/browlet/scripting/rendering-opportunity';
import { renderingTaskSource } from '../../../../src/browlet/scripting/tasks';
import { monotonicClock, UnsafeMoment } from '../../../../src/browlet/timing/clock';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { project, unwrap } from '../../../support/browlet-binding';
import { runInHostTask } from '../../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document revelation', () => {
  it('fires one trusted Window event without requiring a transition', () => {
    const { document, platform, resolve } = fixture();
    const received: PageRevealEvent[] = [];
    const documentListener = vi.fn();
    platform.document.addEventListener('pagereveal', documentListener);
    platform.addEventListener('pagereveal', function(this: Window, event) {
      expect(this).toBe(platform);
      expect(document.hasBeenRevealed).toBe(true);
      expect(event.target).toBe(platform);
      expect(event.currentTarget).toBe(platform);
      received.push(event as PageRevealEvent);
    });
    expect(document.hasBeenRevealed).toBe(false);
    document.reveal();
    document.reveal();
    expect(resolve).toHaveBeenCalledOnce();
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(platform.PageRevealEvent);
    expect(received[0]!.viewTransition).toBeNull();
    expect(received[0]!.isTrusted).toBe(true);
    expect([received[0]!.bubbles, received[0]!.cancelable, received[0]!.composed]).toEqual([false, false, false]);
    expect(documentListener).not.toHaveBeenCalled();
  });

  it('sets the guard before resolution and keeps it through reentrant event listeners', () => {
    const { document, platform, resolve } = fixture();
    resolve.mockImplementation(() => {
      expect(document.hasBeenRevealed).toBe(true);
      document.reveal();
      return null;
    });
    const handler = vi.fn(() => { document.reveal(); });
    platform.onpagereveal = handler;
    document.reveal();
    expect(resolve).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does no resolution or delivery for an already revealed Document', () => {
    const { document, platform, resolve } = fixture();
    document.hasBeenRevealed = true;
    const handler = vi.fn();
    platform.onpagereveal = handler;
    document.reveal();
    expect(resolve).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards the body handler through the existing Window event machinery', () => {
    const { document, platform } = fixture();
    const handler = vi.fn();
    const body = platform.document.body as HTMLBodyElement;
    body.onpagereveal = handler;
    expect(platform.onpagereveal).toBe(handler);
    document.reveal();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('exposes the resolved transition before activating that same object', () => {
    const { document, platform, resolve, loop } = fixture();
    const transition = new ViewTransitionImpl(document, document.env);
    resolve.mockReturnValue(transition);
    const order: string[] = [];
    const activate = vi.spyOn(transition, 'activate').mockImplementation(() => {
      order.push('activate');
      expect(loop.runningExecutionContext).toBe(document.env.realmExecutionContext);
      document.reveal();
    });
    platform.onpagereveal = (event) => {
      order.push('event');
      expect(unwrap((event as PageRevealEvent).viewTransition!)).toBe(transition);
      resolve.mockReturnValue(null); // A listener cannot replace the already resolved transition.
    };
    document.reveal();
    expect(order).toEqual(['event', 'activate']);
    expect(activate).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
    expect(loop.runningExecutionContext).toBeNull();
  });

  it('checkpoints activation promises before the next rendering phase', async () => {
    const { document, platform, resolve, loop, top } = fixture();
    const agent = document.env.realm.agent;
    if (!(agent instanceof WindowAgent)) throw new Error('Expected a Window agent');
    const transition = new ViewTransitionImpl(document, document.env);
    resolve.mockReturnValue(transition);
    const ready = document.env.InternalPromise.withResolvers(internalType<void>());
    const order: string[] = [];
    ready.promise.then(() => { order.push('ready'); });
    vi.spyOn(transition, 'activate').mockImplementation(() => {
      order.push('activate');
      expect(loop.runningExecutionContext).toBe(document.env.realmExecutionContext);
      ready.resolve();
    });
    platform.onpagereveal = () => { order.push('event'); };
    const observe = vi.fn<RenderingOpportunityHost['observeRenderingOpportunities']>(() => () => {});
    const producer = new WindowRenderingProducer(agent, {
      hasRenderingOpportunity: (navigable) => navigable === top,
      observeRenderingOpportunities: observe,
      unsafeSharedCurrentTime: () => new UnsafeMoment(monotonicClock, 10),
    }, {
      // The production caller remains unconnected while CSS resolution is unfinished.
      reveal: ({ document }) => { document.reveal(); },
      runAnimationFrameCallbacks: () => { order.push('raf'); },
    });
    producer.start();
    try {
      observe.mock.calls[0]![0]([top]);
      await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
      expect(order).toEqual(['event', 'activate', 'ready', 'raf']);
      observe.mock.calls[0]![0]([top]);
      await runInHostTask(() => { expect(loop.runTaskTurn()).toBe(true); });
      expect(order).toEqual(['event', 'activate', 'ready', 'raf', 'raf']);
    } finally {
      producer.stop();
    }
  });

  it('cleans up the script boundary when unfinished activation throws', async () => {
    const { document, platform, resolve, loop } = fixture();
    resolve.mockReturnValue(new ViewTransitionImpl(document, document.env));
    const handler = vi.fn();
    platform.onpagereveal = handler;
    await inRenderingTask(document, () => {
      expect(() => document.reveal()).toThrow('View transition activation is not implemented');
      expect(loop.runningExecutionContext).toBeNull();
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(document.hasBeenRevealed).toBe(true);
  });

  it('keeps missing inbound CSS resolution explicit without delivering an invented null transition', () => {
    const { document, platform, resolve } = fixture();
    resolve.mockRestore();
    const handler = vi.fn();
    platform.onpagereveal = handler;
    expect(() => document.reveal()).toThrow('Inbound cross-document view transition resolution is not implemented');
    expect(document.hasBeenRevealed).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('reveals again after retained-Document reactivation resets the guard', () => {
    const { document, platform, top } = fixture();
    const order: string[] = [];
    platform.onpagereveal = () => { order.push('reveal'); };
    platform.onpageshow = () => { order.push('show'); };
    document.reveal();
    document.currentDocumentReadiness = 'complete';
    document.pageShowing = false;
    vi.spyOn(document, 'resetAutocompleteOffControls').mockImplementation(() => {});
    vi.spyOn(document, 'updateVisibilityState').mockImplementation(() => {});
    const entry = top.activeSessionHistoryEntry;
    document.reactivate(entry, [entry]);
    expect(document.hasBeenRevealed).toBe(false);
    expect(order).toEqual(['reveal', 'show']);
    document.reveal();
    expect(order).toEqual(['reveal', 'show', 'reveal']);
  });
});

/** Use real Window/binding/scheduler ownership, supplying only the missing CSS resolution result. */
function fixture() {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = top.activeDocument!;
  const window = document.getRelevantGlobalObject()!;
  window.navigation.initializeEntriesForNewDocument([top.activeSessionHistoryEntry], top.activeSessionHistoryEntry);
  const platform = project(window) as Window;
  const resolve = vi.spyOn(document, 'resolveInboundCrossDocumentViewTransition').mockReturnValue(null);
  return { top, document, window, platform, resolve, loop: document.env.responsibleEventLoop };
}

async function inRenderingTask(document: DocumentImpl, steps: () => void): Promise<void> {
  document.env.realm.queueGlobalTask(renderingTaskSource, steps);
  await runInHostTask(() => { expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true); });
}
