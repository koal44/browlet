import { describe, expect, it, vi } from 'vitest';
import {
  parseHTMLDocument,
} from '../../../../../src/browlet/parser/document-construction';
import {
  EventTargetImpl,
} from '../../../../../src/browlet/dom/events/event-target';
import { EventImpl } from '../../../../../src/browlet/dom/events/event';
import { ShadowRootImpl } from '../../../../../src/browlet/dom/nodes/shadow-root';

describe('EventTargetImpl', () => {
  it('is the event target base for DOM nodes', () => {
    const document = parseHTMLDocument('<main id="target"></main>');

    expect(document).toBeInstanceOf(EventTargetImpl);
    expect(document.documentElement).toBeInstanceOf(EventTargetImpl);
    expect(document.getElementById('target')).toBeInstanceOf(EventTargetImpl);
  });

  it('does not install abort steps for null callbacks or aborted signals', () => {
    const target = new EventTargetImpl();
    const liveController = new AbortController();
    const abortedController = new AbortController();
    const liveAdd = vi.spyOn(liveController.signal, 'addEventListener');
    const abortedAdd = vi.spyOn(abortedController.signal, 'addEventListener');
    abortedController.abort();

    target.addEventListener('null', null, { signal: liveController.signal });
    target.addEventListener('aborted', () => {}, {
      signal: abortedController.signal,
    });

    expect(liveAdd).not.toHaveBeenCalled();
    expect(abortedAdd).not.toHaveBeenCalled();
  });

  it('installs abort steps for a registered listener', () => {
    const target = new EventTargetImpl();
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');

    target.addEventListener('ready', () => {}, { signal: controller.signal });

    expect(addEventListener).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith(
      'abort',
      expect.any(Function),
      { once: true },
    );
  });

  it('dispatches listeners with target state and cancellation', () => {
    const target = new EventTargetImpl();
    const event = new EventImpl('ready', { cancelable: true });
    const observations: unknown[] = [];

    target.addEventListener('ready', function(
      this: EventTarget,
      received,
    ) {
      observations.push(
        this,
        received.target,
        received.currentTarget,
        received.eventPhase,
      );
      received.preventDefault();
    });

    expect(target.dispatchEvent(event)).toBe(false);
    expect(observations).toEqual([
      target,
      target,
      target,
      EventImpl.AT_TARGET,
    ]);
    expect(event.target).toBe(target);
    expect(event.currentTarget).toBeNull();
    expect(event.eventPhase).toBe(EventImpl.NONE);
    expect(event.composedPath()).toEqual([]);
  });

  it('prevents passive listeners from canceling an event', () => {
    const target = new EventTargetImpl();
    const event = new EventImpl('ready', { cancelable: true });

    target.addEventListener('ready', (received) => {
      received.preventDefault();
    }, { passive: true });

    expect(target.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('exposes dispatch topology and activation through internal hooks', () => {
    const parent = new EventTargetImpl();
    const event = new EventImpl('click');
    const activation: string[] = [];
    const target = new EventTargetImpl({
      getParent: () => parent,
      activationBehavior: () => activation.push('activation'),
      legacyPreActivationBehavior: () => activation.push('pre'),
      legacyCanceledActivationBehavior: () => activation.push('canceled'),
    });

    expect(EventTargetImpl.getParent(target, event)).toBe(parent);
    expect(EventTargetImpl.hasActivationBehavior(target)).toBe(true);
    expect(EventTargetImpl.hasLegacyPreActivationBehavior(target)).toBe(true);
    expect(EventTargetImpl.hasLegacyCanceledActivationBehavior(target))
      .toBe(true);

    EventTargetImpl.runLegacyPreActivationBehavior(target);
    EventTargetImpl.runActivationBehavior(target, event);
    EventTargetImpl.runLegacyCanceledActivationBehavior(target);

    expect(activation).toEqual(['pre', 'activation', 'canceled']);
  });

  it('dispatches through node ancestors in capture and bubble order', () => {
    const document = parseHTMLDocument(
      '<main id="parent"><button id="target"></button></main>',
    );
    const parent = document.getElementById('parent')!;
    const target = document.getElementById('target')!;
    const order: string[] = [];
    const observe = (name: string) => (event: Event) => {
      order.push(`${name}:${event.eventPhase}`);
      expect(event.target).toBe(target);
    };

    document.addEventListener('ready', observe('document-capture'), true);
    parent.addEventListener('ready', observe('parent-capture'), true);
    target.addEventListener('ready', observe('target-capture'), true);
    target.addEventListener('ready', observe('target-bubble'));
    parent.addEventListener('ready', observe('parent-bubble'));
    document.addEventListener('ready', observe('document-bubble'));

    target.dispatchEvent(new EventImpl('ready', {
      bubbles: true,
    }));

    expect(order).toEqual([
      `document-capture:${EventImpl.CAPTURING_PHASE}`,
      `parent-capture:${EventImpl.CAPTURING_PHASE}`,
      `target-capture:${EventImpl.AT_TARGET}`,
      `target-bubble:${EventImpl.AT_TARGET}`,
      `parent-bubble:${EventImpl.BUBBLING_PHASE}`,
      `document-bubble:${EventImpl.BUBBLING_PHASE}`,
    ]);
  });

  it('retargets composed events when they leave a shadow tree', () => {
    const document = parseHTMLDocument('<main id="host"></main>');
    const host = document.getElementById('host')!;
    const root = new ShadowRootImpl(host, 'closed');
    const target = document.createElement('button');
    const targets: (EventTarget | null)[] = [];

    root.appendChild(target);
    target.addEventListener('ready', (event) => targets.push(event.target));
    root.addEventListener('ready', (event) => targets.push(event.target));
    host.addEventListener('ready', (event) => targets.push(event.target));
    document.addEventListener('ready', (event) => targets.push(event.target));

    target.dispatchEvent(new EventImpl('ready', {
      bubbles: true,
      composed: true,
    }));

    expect(targets).toEqual([target, target, host, host]);
  });

  it('does not propagate non-composed events beyond their shadow root', () => {
    const document = parseHTMLDocument('<main id="host"></main>');
    const host = document.getElementById('host')!;
    const root = new ShadowRootImpl(host, 'open');
    const target = document.createElement('button');
    const inside = vi.fn();
    const outside = vi.fn();

    root.appendChild(target);
    root.addEventListener('ready', inside);
    host.addEventListener('ready', outside);
    target.dispatchEvent(new EventImpl('ready', {
      bubbles: true,
    }));

    expect(inside).toHaveBeenCalledOnce();
    expect(outside).not.toHaveBeenCalled();
  });

  it('suppresses duplicate event listeners during dispatch', () => {
    const target = new EventTargetImpl();
    const callback = vi.fn();

    target.addEventListener('ready', callback);
    target.addEventListener('ready', callback);
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('removes event listeners by type, callback, and capture', () => {
    const target = new EventTargetImpl();
    const callback = vi.fn();

    target.addEventListener('ready', callback, true);
    target.addEventListener('ready', callback, false);
    target.removeEventListener('ready', callback, true);
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('removes once listeners before invoking them', () => {
    const target = new EventTargetImpl();
    const callback = vi.fn(() => {
      target.dispatchEvent(new EventImpl('ready'));
    });

    target.addEventListener('ready', callback, { once: true });
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('removes signal-bound listeners when their signal aborts', () => {
    const target = new EventTargetImpl();
    const controller = new AbortController();
    const callback = vi.fn();

    target.addEventListener('ready', callback, {
      signal: controller.signal,
    });
    controller.abort();
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).not.toHaveBeenCalled();
  });
});
