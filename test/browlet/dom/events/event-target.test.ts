import { describe, expect, it, vi } from 'vitest';
import { createSandboxEnvironment } from '../../../../src/browlet/bindings';
import { parseTestDocument } from '../../../support/dom';
import {
  EventTargetImpl,
} from '../../../../src/browlet/dom/events/event-target';
import {
  AbortSignalImpl,
} from '../../../../src/browlet/dom/abort/abort-signal';
import { EventImpl, EventPhase } from '../../../../src/browlet/dom/events/event';
import { MouseEventImpl } from '../../../../src/browlet/dom/events/ui-event';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';

describe('EventTargetImpl', () => {
  it('is the event target base for DOM nodes', () => {
    const document = parseTestDocument('<main id="target"></main>');

    expect(document).toBeInstanceOf(EventTargetImpl);
    expect(document.documentElement).toBeInstanceOf(EventTargetImpl);
    expect(document.getElementById('target')).toBeInstanceOf(EventTargetImpl);
  });

  it('does not register null callbacks or listeners with aborted signals', () => {
    const env = createSandboxEnvironment();
    const target = new EventTargetImpl(env);
    const liveSignal = new AbortSignalImpl(env);
    const abortedSignal = new AbortSignalImpl(env);
    const callback = vi.fn();
    abortedSignal.signalAbort();

    target.addEventListener('null', null, {
      capture: false, once: false, signal: liveSignal,
    });
    target.addEventListener('aborted', () => {}, {
      capture: false, once: false, signal: abortedSignal,
    });
    target.addEventListener('aborted', callback, {
      capture: false, once: false, signal: abortedSignal,
    });
    target.dispatchEvent(new EventImpl('null'));
    target.dispatchEvent(new EventImpl('aborted'));

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not let a duplicate listener signal remove the original', () => {
    const env = createSandboxEnvironment();
    const target = new EventTargetImpl(env);
    const firstSignal = new AbortSignalImpl(env);
    const duplicateSignal = new AbortSignalImpl(env);
    const callback = vi.fn();

    target.addEventListener('ready', callback, {
      capture: false, once: false, signal: firstSignal,
    });
    target.addEventListener('ready', callback, {
      capture: false, once: false, signal: duplicateSignal,
    });
    duplicateSignal.signalAbort();
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('dispatches listeners with target state and cancellation', () => {
    const target = new EventTargetImpl(createSandboxEnvironment());
    const event = new EventImpl('ready', { cancelable: true });
    const observations: unknown[] = [];

    target.addEventListener('ready', function(
      this: EventTargetImpl,
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
      EventPhase.AtTarget,
    ]);
    expect(event.target).toBe(target);
    expect(event.currentTarget).toBeNull();
    expect(event.eventPhase).toBe(EventPhase.None);
    expect(event.composedPath()).toEqual([]);
  });

  it('prevents passive listeners from canceling an event', () => {
    const target = new EventTargetImpl(createSandboxEnvironment());
    const event = new EventImpl('ready', { cancelable: true });

    target.addEventListener('ready', (received) => {
      received.preventDefault();
    }, { capture: false, once: false, passive: true });

    expect(target.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([false, true])(
    'runs ancestor activation around listeners when cancellation is %s',
    (cancel) => {
      const calls: string[] = [];
      const env = createSandboxEnvironment();
      class ActivatingTarget extends EventTargetImpl {
        override runActivationBehavior(): void { calls.push('activation'); }
        override runLegacyPreActivationBehavior(): void { calls.push('pre'); }
        override runLegacyCanceledActivationBehavior(): void { calls.push('canceled'); }
      }
      const parent = new ActivatingTarget(env);
      class ChildTarget extends EventTargetImpl {
        override getEventParent(): EventTargetImpl { return parent; }
      }
      class ClickEvent extends MouseEventImpl {}
      const target = new ChildTarget(env);
      target.addEventListener('click', (event) => {
        calls.push('listener');
        if (cancel) event.preventDefault();
      });

      expect(target.dispatchEvent(new ClickEvent('click', {
        bubbles: true,
        cancelable: true,
      }))).toBe(!cancel);
      expect(calls).toEqual(['pre', 'listener', cancel ? 'canceled' : 'activation']);
    },
  );

  it('dispatches through node ancestors in capture and bubble order', () => {
    const document = parseTestDocument(
      '<main id="parent"><button id="target"></button></main>',
    );
    const parent = document.getElementById('parent')!;
    const target = document.getElementById('target')!;
    const order: string[] = [];
    const observe = (name: string) => (event: EventImpl) => {
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
      `document-capture:${EventPhase.Capturing}`,
      `parent-capture:${EventPhase.Capturing}`,
      `target-capture:${EventPhase.AtTarget}`,
      `target-bubble:${EventPhase.AtTarget}`,
      `parent-bubble:${EventPhase.Bubbling}`,
      `document-bubble:${EventPhase.Bubbling}`,
    ]);
  });

  it('retargets composed events when they leave a shadow tree', () => {
    const document = parseTestDocument('<main id="host"></main>');
    const host = document.getElementById('host')!;
    const root = new ShadowRootImpl(host, 'closed', document.env);
    const target = document.createElement('button');
    const targets: (EventTargetImpl | null)[] = [];

    root.appendChild(target);
    target.addEventListener(
      'ready',
      (event: EventImpl) => targets.push(event.target),
    );
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
    const document = parseTestDocument('<main id="host"></main>');
    const host = document.getElementById('host')!;
    const root = new ShadowRootImpl(host, 'open', document.env);
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
    const target = new EventTargetImpl(createSandboxEnvironment());
    const callback = vi.fn();

    target.addEventListener('ready', callback);
    target.addEventListener('ready', callback);
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('removes event listeners by type, callback, and capture', () => {
    const target = new EventTargetImpl(createSandboxEnvironment());
    const callback = vi.fn();

    target.addEventListener('ready', callback, true);
    target.addEventListener('ready', callback, false);
    target.removeEventListener('ready', callback, true);
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('removes once listeners before invoking them', () => {
    const target = new EventTargetImpl(createSandboxEnvironment());
    const callback = vi.fn(() => {
      target.dispatchEvent(new EventImpl('ready'));
    });

    target.addEventListener('ready', callback, { capture: false, once: true });
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).toHaveBeenCalledOnce();
  });

  it('removes signal-bound listeners when their signal aborts', () => {
    const env = createSandboxEnvironment();
    const target = new EventTargetImpl(env);
    const signal = new AbortSignalImpl(env);
    const callback = vi.fn();

    target.addEventListener('ready', callback, {
      capture: false, once: false, signal,
    });
    signal.signalAbort();
    target.dispatchEvent(new EventImpl('ready'));

    expect(callback).not.toHaveBeenCalled();
  });
});
