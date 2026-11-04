import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl, ElementImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerCapture } from '../../../src/browlet/interaction/index';
import { PointerEventImpl } from '../../../src/browlet/interaction/events/index';
import type { PointerEvent as PointerEventPlatform } from '../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Pointer Events §3.1.3.2: pending capture', () => {
  it('does nothing without a change and gains capture only when processing runs', () => {
    const { capture, event, a, trace } = createFixture();
    capture.processPendingPointerCapture(event);
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    expect(capture.targetOverride).toBeNull();
    expect(trace).toEqual([]);
    capture.processPendingPointerCapture(event);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['gotpointercapture:a']);
    expect(capture.targetOverride).toBe(unwrap(a));
  });

  it('uses the last request made before the processing pass', () => {
    const { capture, event, a, b, c, trace } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.pendingTargetOverride = unwrap<ElementImpl>(b);
    capture.pendingTargetOverride = unwrap<ElementImpl>(c);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['gotpointercapture:c']);
    expect(capture.targetOverride).toBe(unwrap(c));
  });

  it('fires loss before gain when transferring, and loss alone when releasing', () => {
    const { capture, event, a, b, trace, received } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    trace.length = 0;
    capture.pendingTargetOverride = unwrap<ElementImpl>(b);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:a', 'gotpointercapture:b']);
    expect(capture.targetOverride).toBe(unwrap(b));
    capture.pendingTargetOverride = null;
    expect(capture.targetOverride).toBe(unwrap(b));
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:a', 'gotpointercapture:b', 'lostpointercapture:b']);
    expect(capture.targetOverride).toBeNull();
    expect(new Set(received).size).toBe(received.length);
  });

  it('retains a loss listener request for the next pass without changing the snapshotted destination', () => {
    const { capture, event, a, b, c, trace } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    trace.length = 0;
    a.addEventListener('lostpointercapture', () => { capture.pendingTargetOverride = unwrap<ElementImpl>(c); });
    capture.pendingTargetOverride = unwrap<ElementImpl>(b);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:a', 'gotpointercapture:b']);
    expect(capture.targetOverride).toBe(unwrap(b));
    expect(capture.pendingTargetOverride).toBe(unwrap(c));
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:a', 'gotpointercapture:b', 'lostpointercapture:b', 'gotpointercapture:c']);
    expect(capture.targetOverride).toBe(unwrap(c));
  });

  it('defers a release requested by the gain listener until the next pass', () => {
    const { capture, event, a, trace } = createFixture();
    a.addEventListener('gotpointercapture', () => { capture.pendingTargetOverride = null; });
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    expect(capture.targetOverride).toBe(unwrap(a));
    expect(capture.pendingTargetOverride).toBeNull();
    expect(trace).toEqual(['gotpointercapture:a']);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['gotpointercapture:a', 'lostpointercapture:a']);
    expect(capture.targetOverride).toBeNull();
  });

  it('discards a disconnected pending request without gain or loss notifications', () => {
    const { capture, event, a, trace } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    a.remove();
    capture.processPendingPointerCapture(event);
    expect(capture.pendingTargetOverride).toBeNull();
    expect(capture.targetOverride).toBeNull();
    expect(trace).toEqual([]);
  });

  it('delivers loss to the Document after the effective target is disconnected', () => {
    const { browser, capture, event, a, trace, received } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    trace.length = 0;
    a.remove();
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:#document']);
    expect(received.at(-1)!.target).toBe(browser.document);
    expect(received.at(-1)!.clientX).toBe(12.5);
    expect(capture.pendingTargetOverride).toBeNull();
    expect(capture.targetOverride).toBeNull();
  });

  it('retains removal fixup across reinsertion when the owner reports the disconnection', () => {
    const { browser, capture, event, a, trace } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    trace.length = 0;
    a.remove();
    // This standalone state has no registered stream; apply its connectivity correction explicitly.
    capture.clearDisconnectedTargets();
    expect(capture.targetOverride).toBe(unwrap<DocumentImpl>(browser.document));
    browser.document.body!.appendChild(a);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:#document']);
    expect(capture.targetOverride).toBeNull();
  });

  it('does not gain or subsequently lose a pending target removed by the loss listener', () => {
    const { capture, event, a, b, trace } = createFixture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    trace.length = 0;
    a.addEventListener('lostpointercapture', () => b.remove());
    capture.pendingTargetOverride = unwrap<ElementImpl>(b);
    capture.processPendingPointerCapture(event);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['lostpointercapture:a']);
    expect(capture.targetOverride).toBeNull();
    expect(capture.pendingTargetOverride).toBeNull();
  });

  it('immediately notifies the Document when the gain listener removes its target', () => {
    const { capture, event, a, trace } = createFixture();
    a.addEventListener('gotpointercapture', () => a.remove());
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    capture.processPendingPointerCapture(event);
    expect(trace).toEqual(['gotpointercapture:a', 'lostpointercapture:#document']);
    expect(capture.targetOverride).toBeNull();
    expect(capture.pendingTargetOverride).toBeNull();
  });

  it('copies input attributes while allocating trusted, noncancelable notifications with empty sample lists', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://capture.test/');
    const { capture, a, received } = createFixture(browser);
    const sample = new PointerEventImpl('sample');
    const source = new PointerEventImpl('pointermove', {
      view: getRelevantRealm(browser.window).env.window, detail: 9, bubbles: true, cancelable: true,
      pointerId: 17, pointerType: 'pen', isPrimary: true, persistentDeviceId: 31,
      width: 3.5, height: 4.5, pressure: 0.75, tangentialPressure: -0.5,
      tiltX: 10, tiltY: -20, altitudeAngle: 0.6, azimuthAngle: 0.7, twist: 45,
      screenX: 5.5, screenY: 6.5, clientX: 7.5, clientY: 8.5,
      button: 2, buttons: 3, movementX: 1.25, movementY: -2.25,
      ctrlKey: true, shiftKey: true, modifierAltGraph: true, modifierCapsLock: true,
      modifierFn: true, modifierFnLock: true, modifierHyper: true, modifierNumLock: true,
      modifierScrollLock: true, modifierSuper: true, modifierSymbol: true, modifierSymbolLock: true,
      coalescedEvents: [sample], predictedEvents: [sample],
    }, 123);
    source.isTrusted = true;
    source.preventDefault();
    source.stopImmediatePropagation();
    a.addEventListener('gotpointercapture', (event) => event.preventDefault());
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(source);
    const notification = received[0]!;
    expect(notification instanceof browser.window.PointerEvent).toBe(true);
    expect([notification.type, notification.isTrusted, notification.bubbles, notification.cancelable,
      notification.composed, notification.detail, notification.defaultPrevented, notification.cancelBubble,
      notification.timeStamp, notification.view === browser.window])
      .toEqual(['gotpointercapture', true, true, false, true, 0, false, false, 123, true]);
    expect([notification.pointerId, notification.pointerType, notification.isPrimary, notification.persistentDeviceId,
      notification.width, notification.height, notification.pressure, notification.tangentialPressure,
      notification.tiltX, notification.tiltY, notification.altitudeAngle, notification.azimuthAngle, notification.twist,
      notification.screenX, notification.screenY, notification.clientX, notification.clientY,
      notification.button, notification.buttons, notification.movementX, notification.movementY])
      .toEqual([17, 'pen', true, 31, 3.5, 4.5, 0.75, -0.5, 10, -20, 0.6, 0.7, 45, 5.5, 6.5, 7.5, 8.5, 2, 3, 1.25, -2.25]);
    const keys = ['Control', 'Shift', 'AltGraph', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'NumLock',
      'ScrollLock', 'Super', 'Symbol', 'SymbolLock'];
    expect(keys.map((key) => notification.getModifierState(key))).toEqual(Array<boolean>(12).fill(true));
    expect([notification.altKey, notification.metaKey]).toEqual([false, false]);
    expect(notification.getCoalescedEvents()).toEqual([]);
    expect(notification.getPredictedEvents()).toEqual([]);
    expect(source.getCoalescedEvents()).toEqual([sample]);
    expect(source.getPredictedEvents()).toEqual([sample]);
    expect([source.defaultPrevented, source.immediatePropagationStopped]).toEqual([true, true]);
    source.initMouseEvent('changed');
    expect(notification.ctrlKey).toBe(true);
    expect(notification.getModifierState('FnLock')).toBe(true);
  });

  it('allocates notifications in the target realm while preserving the triggering view and timestamp', () => {
    const { browser, capture, event, a, received } = createFixture();
    const other = new Browlet({ route: () => '' });
    event.view = getRelevantRealm(other.window).env.window;
    event.timeStamp = 37;
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    expect(getRelevantRealm(received[0]!)).toBe(getRelevantRealm(browser.window));
    expect(received[0]!.view).toBe(other.window);
    expect(received[0]!.timeStamp).toBe(37);
  });

  it('preserves the triggering boundary event\'s related target in capture notifications', () => {
    const { capture, event, a, b, received } = createFixture();
    event.relatedTarget = unwrap<ElementImpl>(b);
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    capture.processPendingPointerCapture(event);
    capture.pendingTargetOverride = null;
    capture.processPendingPointerCapture(event);
    expect(received.map((notification) => notification.relatedTarget)).toEqual([b, b]);
  });

  it('keeps separate capture states independent and ignores author-dispatched notifications', () => {
    const { browser, capture, event, a, b } = createFixture();
    const other = new PointerCapture();
    capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    other.pendingTargetOverride = unwrap<ElementImpl>(b);
    capture.processPendingPointerCapture(event);
    other.processPendingPointerCapture(new PointerEventImpl('pointermove', { pointerId: 8 }));
    a.dispatchEvent(new browser.window.PointerEvent('lostpointercapture', { pointerId: event.pointerId }));
    b.dispatchEvent(new browser.window.PointerEvent('gotpointercapture', { pointerId: event.pointerId }));
    expect(capture.targetOverride).toBe(unwrap(a));
    expect(other.targetOverride).toBe(unwrap(b));
  });
});

/** Supply normalized input and explicit capture slots; no native producer or public capture API is implied. */
function createFixture(browser = new Browlet({ route: () => '' })) {
  const [a, b, c] = ['a', 'b', 'c'].map((id) => {
    const target = browser.document.createElement('div');
    target.id = id;
    browser.document.body!.appendChild(target);
    return target;
  });
  const capture = new PointerCapture();
  const event = new PointerEventImpl('pointermove', {
    pointerId: 7, pointerType: 'mouse', isPrimary: true, button: -1, buttons: 1,
    clientX: 12.5, view: getRelevantRealm(browser.window).env.window,
  }, 19);
  event.isTrusted = true;
  const trace: string[] = [];
  const received: PointerEventPlatform[] = [];
  for (const type of ['gotpointercapture', 'lostpointercapture']) {
    browser.document.addEventListener(type, (event) => {
      const target = event.target === a ? 'a' : event.target === b ? 'b' : event.target === c ? 'c' : '#document';
      trace.push(`${event.type}:${target}`);
      received.push(event as PointerEventPlatform);
    });
  }
  return { browser, capture, event, a: a!, b: b!, c: c!, trace, received };
}
