import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Document, PointerEvent, Window } from '../../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { EventModifierState, type PointerEventImpl } from '../../../../src/browlet/interaction/events/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML §8.1.8.3: synthetic pointer and click firing', () => {
  it('fires a trusted non-pointer click with the specified defaults and no pointer-stream state', () => {
    const { target, element, window, document, traversable } = createFixture();
    const received: PointerEvent[] = [];
    target.addEventListener('click', (event) => { received.push(event as PointerEvent); });
    expect(element.fireClick()).toBe(true);
    expect(received).toHaveLength(1);
    const event = received[0]!;
    expect(event).toBeInstanceOf(window.PointerEvent);
    expect(event).toBeInstanceOf(window.MouseEvent);
    expect(getRelevantRealm(event)).toBe(document.env.realm);
    expect([event.type, event.target, event.view, event.bubbles, event.cancelable, event.composed, event.isTrusted])
      .toEqual(['click', target, window, true, true, true, true]);
    expect([event.detail, event.screenX, event.screenY, event.clientX, event.clientY,
      event.movementX, event.movementY, event.button, event.buttons, event.which, event.relatedTarget])
      .toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, null]);
    expect([event.pointerId, event.pointerType, event.isPrimary, event.width, event.height,
      event.pressure, event.tangentialPressure, event.tiltX, event.tiltY, event.twist,
      event.altitudeAngle, event.azimuthAngle, event.persistentDeviceId])
      .toEqual([-1, '', false, 1, 1, 0, 0, 0, 0, 0, Math.PI / 2, 0, 0]);
    expect([event.ctrlKey, event.shiftKey, event.altKey, event.metaKey]).toEqual([false, false, false, false]);
    const implementation = unwrap<PointerEventImpl>(event);
    expect(implementation.getCoalescedEvents()).toEqual([]);
    expect(event.getPredictedEvents()).toEqual([]);
    expect(Number.isFinite(event.timeStamp)).toBe(true);
    expect(event.timeStamp).toBeGreaterThanOrEqual(0);
    expect(traversable.pointerEventStreams.size).toBe(0);
  });

  it('supports arbitrary event names and the optional not-trusted flag', () => {
    const { platformDocument, window } = createFixture();
    const target = platformDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    const element = unwrap<ElementImpl>(target);
    const received: PointerEvent[] = [];
    target.addEventListener('synthetic-probe', (event) => { received.push(event as PointerEvent); });
    expect(element.fireSyntheticPointerEvent('synthetic-probe')).toBe(true);
    expect(element.fireSyntheticPointerEvent('synthetic-probe', true)).toBe(true);
    expect(received.map((event) => event.isTrusted)).toEqual([true, false]);
    for (const event of received) {
      expect(event).toBeInstanceOf(window.PointerEvent);
      expect([event.type, event.bubbles, event.cancelable, event.composed, event.pointerId])
        .toEqual(['synthetic-probe', true, true, true, -1]);
    }
  });

  it.each([false, true])('preserves DOM activation and cancellation when notTrusted=%s', (notTrusted) => {
    const { target, element } = createFixture();
    const activation = vi.spyOn(element, 'runActivationBehavior');
    const canceled = vi.spyOn(element, 'runLegacyCanceledActivationBehavior');
    const preActivation = vi.spyOn(element, 'runLegacyPreActivationBehavior');
    const listener = vi.fn();
    target.addEventListener('click', listener);
    expect(element.fireSyntheticPointerEvent('click', notTrusted)).toBe(true);
    expect(activation).toHaveBeenCalledOnce();
    expect(preActivation).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    target.addEventListener('click', (event) => { event.preventDefault(); }, { once: true });
    expect(element.fireSyntheticPointerEvent('click', notTrusted)).toBe(false);
    expect(activation).toHaveBeenCalledOnce();
    expect(canceled).toHaveBeenCalledOnce();
    expect(preActivation).toHaveBeenCalledTimes(2);
    expect(element.fireSyntheticPointerEvent('probe', notTrusted)).toBe(true);
    expect(activation).toHaveBeenCalledOnce();
  });

  it('snapshots all current modifiers across Windows and retains them after later input', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    const modifiers = new EventModifierState({
      ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
      modifierAltGraph: true, modifierCapsLock: true, modifierFn: true, modifierFnLock: true,
      modifierHyper: true, modifierNumLock: true, modifierScrollLock: true, modifierSuper: true,
      modifierSymbol: true, modifierSymbolLock: true,
    });
    queueModifierState(first, modifiers);
    const received: PointerEvent[] = [];
    second.target.addEventListener('click', (event) => { received.push(event as PointerEvent); });
    second.element.fireClick();
    second.element.fireSyntheticPointerEvent('click', true);
    queueModifierState(first, new EventModifierState());
    second.element.fireClick();
    const keys = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'FnLock',
      'Hyper', 'NumLock', 'ScrollLock', 'Super', 'Symbol', 'SymbolLock'];
    for (const event of received.slice(0, 2)) {
      expect([event.ctrlKey, event.shiftKey, event.altKey, event.metaKey]).toEqual([true, true, true, true]);
      expect(keys.map((key) => event.getModifierState(key))).toEqual(Array<boolean>(14).fill(true));
    }
    expect(keys.map((key) => received[2]!.getModifierState(key))).toEqual(Array<boolean>(14).fill(false));
    expect(received.map((event) => event.isTrusted)).toEqual([true, false, true]);
    // An event constructor or author dispatch must not update the retained keyboard state.
    first.target.dispatchEvent(new first.window.KeyboardEvent('keydown', { shiftKey: true }));
    expect(first.userAgent.keyboardInput.modifiers.getModifierState('Shift')).toBe(false);
  });

  it('keeps AltGraph distinct from the synthetic event’s Alt state', () => {
    const fixture = createFixture();
    queueModifierState(fixture, new EventModifierState({ modifierAltGraph: true }));
    const received: PointerEvent[] = [];
    fixture.target.addEventListener('click', (event) => { received.push(event as PointerEvent); });
    fixture.element.fireClick();
    const event = received[0]!;
    expect([event.altKey, event.getModifierState('Alt'), event.getModifierState('AltGraph')])
      .toEqual([false, false, true]);
  });

  it('uses the current Document for event allocation and view after cross-realm adoption', () => {
    const first = createFixture();
    const second = createFixture(first.userAgent);
    const received: PointerEvent[] = [];
    first.target.addEventListener('click', (event) => { received.push(event as PointerEvent); });
    second.platformDocument.documentElement!.append(first.target);
    expect(getRelevantRealm(first.target)).toBe(first.document.env.realm);
    first.element.fireClick();
    expect(getRelevantRealm(received[0]!)).toBe(second.document.env.realm);
    expect(received[0]!).toBeInstanceOf(second.window.PointerEvent);
    expect(received[0]!).not.toBeInstanceOf(first.window.PointerEvent);
    expect(received[0]!.view).toBe(second.window);
    expect(received[0]!.target).toBe(first.target);
  });

  it('keeps a detached element’s view but uses null for an inert Document', () => {
    const { target, element, window, platformDocument, document } = createFixture();
    target.remove();
    const inert = platformDocument.implementation.createHTMLDocument();
    const received: PointerEvent[] = [];
    target.addEventListener('click', (event) => { received.push(event as PointerEvent); });
    inert.body!.addEventListener('click', (event) => { received.push(event as PointerEvent); });
    element.fireClick();
    unwrap<ElementImpl>(inert.body!).fireClick();
    expect(received.map((event) => event.view)).toEqual([window, null]);
    expect(received.every((event) => event.isTrusted)).toBe(true);
    expect(received.every((event) => getRelevantRealm(event) === document.env.realm)).toBe(true);
  });

  it('uses composed DOM dispatch across a closed shadow root and returns ancestor cancellation', () => {
    const { platformDocument, target: host } = createFixture();
    const shadow = host.attachShadow({ mode: 'closed' });
    const target = platformDocument.createElement('span');
    shadow.append(target);
    const trace: string[] = [];
    const targets: unknown[] = [];
    host.addEventListener('click', (event) => { trace.push('capture'); targets.push(event.target); }, true);
    target.addEventListener('click', (event) => { trace.push('target'); targets.push(event.target); });
    host.addEventListener('click', (event) => {
      trace.push('bubble');
      targets.push(event.target);
      event.preventDefault();
    });
    expect(unwrap<ElementImpl>(target).fireClick()).toBe(false);
    expect(trace).toEqual(['capture', 'target', 'bubble']);
    expect(targets).toEqual([host, target, host]);
  });

  it('creates a fresh event for reentrant firing without borrowing HTMLElement.click’s guard', () => {
    const fixture = createFixture();
    queueModifierState(fixture, new EventModifierState({ shiftKey: true }));
    const received: PointerEvent[] = [];
    fixture.target.addEventListener('click', (event) => {
      received.push(event as PointerEvent);
      if (received.length !== 1) return;
      queueModifierState(fixture, new EventModifierState());
      fixture.element.fireClick();
    });
    expect(fixture.element.fireClick()).toBe(true);
    expect(received).toHaveLength(2);
    expect(received[0]!).not.toBe(received[1]!);
    expect(received.map((event) => [event.shiftKey, event.isTrusted])).toEqual([[true, true], [false, true]]);
  });
});

function createFixture(userAgent = createManualUserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument!;
  const platformDocument = project(document) as Document;
  const root = platformDocument.documentElement ?? platformDocument.createElement('html');
  if (!root.isConnected) platformDocument.append(root);
  const target = platformDocument.createElement('div');
  root.append(target);
  return {
    userAgent, traversable, document, platformDocument, target,
    element: unwrap<ElementImpl>(target), window: project(traversable.activeWindow!) as Window,
  };
}

function queueModifierState(fixture: ReturnType<typeof createFixture>, modifiers: EventModifierState): void {
  // Receipt changes UserAgent state immediately; these tests do not deliver queued keys
  // or substitute implementations for the still-explicit focus/default-action owners.
  fixture.userAgent.keyboardInput.queueKey({
    pressed: true, namedKey: 'Shift', text: null, glyphText: null, hasNonGlyphModifiers: false,
    code: 'ShiftLeft', location: 1, repeat: false, isComposing: false, keyCode: 16,
    reservedShortcut: false, modifiers,
  }, fixture.document);
}
