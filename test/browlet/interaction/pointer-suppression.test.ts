import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, EventTarget, PointerEvent } from '../../../src/browlet/platform';
import type { ElementImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../src/browlet/interaction/index';
import { PointerEventImpl, type PointerEventInit, type PointerInputEventType } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

describe('Pointer Events §3.1.3.3: suppressing a pointer stream', () => {
  it('cancels captured input, releases capture, then exits without hit testing a hover destination', () => {
    const { stream, send, capture, a, b, trace, geometry, hitTest, getHoverTarget } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    geometry.target = b;
    trace.length = 0;
    hitTest.mockClear();
    stream.suppress(hitTest);
    expect(trace).toEqual(['pointercancel:a:null', 'lostpointercapture:a:null', 'pointerout:a:null',
      'pointerleave:a:null', 'pointerleave:body:null', 'pointerleave:html:null']);
    expect(hitTest).not.toHaveBeenCalled();
    expect(getHoverTarget).not.toHaveBeenCalled();
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.capture.pendingTargetOverride).toBeNull();
    expect(stream.previousTarget).toBeNull();
    expect(stream.needsOverEvent).toBe(false);
  });

  it('cancels uncaptured input and exits without capture notifications', () => {
    const { stream, send, hitTest, trace } = createFixture();
    send('pointermove');
    trace.length = 0;
    stream.suppress(hitTest);
    expect(trace).toEqual(['pointercancel:a:null', 'pointerout:a:null', 'pointerleave:a:null',
      'pointerleave:body:null', 'pointerleave:html:null']);
  });

  it('does nothing before delivery or after the stream has already been suppressed', () => {
    const { stream, send, hitTest, trace } = createFixture();
    stream.suppress(hitTest);
    expect(trace).toEqual([]);
    expect(hitTest).not.toHaveBeenCalled();
    send('pointermove');
    stream.suppress(hitTest);
    trace.length = 0;
    hitTest.mockClear();
    stream.suppress(hitTest);
    expect(trace).toEqual([]);
    expect(hitTest).not.toHaveBeenCalled();
  });

  it('processes an outstanding implicit capture request before canceling', () => {
    const { stream, send, hitTest, trace } = createFixture(false, true);
    send('pointerdown', { pointerType: 'touch', buttons: 1 });
    expect(stream.capture.targetOverride).toBeNull();
    trace.length = 0;
    stream.suppress(hitTest);
    expect(trace.slice(0, 3)).toEqual(['gotpointercapture:a:null', 'pointercancel:a:null', 'lostpointercapture:a:null']);
  });

  it('preserves the last input fields despite author reinitialization, with fresh trust, flags, time, and empty samples', () => {
    const { browser, stream, send, hitTest, events, a } = createFixture();
    const fields = {
      pointerType: 'pen', isPrimary: true, width: 8, height: 10, pressure: 0.75, tangentialPressure: 0.25,
      tiltX: 12, tiltY: -14, twist: 45, altitudeAngle: 0.6, azimuthAngle: 1.2,
      screenX: 90.5, screenY: 110.5, clientX: 12.5, clientY: 17.5, movementX: 2.5, movementY: -3.5,
    };
    send('pointermove', {
      ...fields, coalescedEvents: [new PointerEventImpl('pointermove')],
      predictedEvents: [new PointerEventImpl('pointermove')],
    });
    const previous = events.find((event) => event.type === 'pointermove')!;
    previous.initMouseEvent('author', false, false, null, 9, 900, 901, 902, 903, false, false, false, false, 2, null);
    a.addEventListener('pointercancel', (event) => event.preventDefault());
    stream.suppress(hitTest);
    const canceled = events.find((event) => event.type === 'pointercancel')!;
    expect(canceled).not.toBe(previous);
    expect(canceled).toBeInstanceOf(browser.window.PointerEvent);
    expect(canceled).toMatchObject({
      ...fields, pointerId: 7, isTrusted: true, cancelable: false,
      bubbles: true, composed: true, detail: 0, defaultPrevented: false,
    });
    expect(canceled.timeStamp).toBeGreaterThan(previous.timeStamp);
    expect(unwrap<PointerEventImpl>(canceled).getCoalescedEvents()).toEqual([]);
    expect(unwrap<PointerEventImpl>(canceled).getPredictedEvents()).toEqual([]);
  });

  it('updates the private snapshot when another input is delivered', () => {
    const { stream, send, hitTest, events } = createFixture();
    send('pointermove', { clientX: 10, pressure: 0.2 });
    send('pointermove', { clientX: 20, pressure: 0.4 });
    stream.suppress(hitTest);
    expect(events.find((event) => event.type === 'pointercancel')).toMatchObject({ clientX: 20, pressure: 0.4 });
  });

  it('allocates cancellation in the selected target realm, including after a pending capture transfer', () => {
    const { browser, stream, send, capture, hitTest, a, b, events } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    capture(b);
    stream.suppress(hitTest);
    const canceled = events.find((event) => event.type === 'pointercancel')!;
    expect(canceled.target).toBe(b);
    expect(canceled).toBeInstanceOf(browser.window.PointerEvent);
    expect(stream.capture.targetOverride).toBeNull();
  });

  it('starts new delivery with fresh entry boundaries after suppression', () => {
    const { stream, send, hitTest, trace } = createFixture();
    send('pointermove');
    stream.suppress(hitTest);
    trace.length = 0;
    send('pointermove');
    expect(trace).toEqual(['pointerover:a:null', 'pointerenter:html:null', 'pointerenter:body:null',
      'pointerenter:a:null', 'pointermove:a:null']);
  });
});

describe('Pointer Events §7.1: suppression before viewport takeover', () => {
  it('requires a delivered down, not just hover or prepared input', () => {
    const { stream, send, hitTest } = createFixture(false, true);
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(false);
    send('pointermove');
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(false);
    stream.prepareTarget('pointerdown', new PointerEventImpl('', { buttons: 1 }), hitTest);
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(false);
  });

  it.each(['pointerup', 'pointercancel'] as const)('does not cancel again after %s', (type) => {
    const { stream, send, hitTest, trace } = createFixture(false, true);
    send('pointerdown');
    send(type, { buttons: 0 });
    trace.length = 0;
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(false);
    expect(trace).toEqual([]);
  });

  it('requires direct-manipulation capability independently of pointerType', () => {
    const { stream, send, hitTest, trace } = createFixture(false, false);
    send('pointerdown', { pointerType: 'touch' });
    trace.length = 0;
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(false);
    expect(trace).toEqual([]);
  });

  it('cancels an active direct-manipulation contact even when its down was canceled by the author', () => {
    const { stream, send, hitTest, a, trace } = createFixture(false, true);
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    expect(send('pointerdown', { pointerType: 'pen' }).accepted).toBe(false);
    trace.length = 0;
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(true);
    expect(trace).toContain('pointercancel:a:null');
    expect(trace).toContain('lostpointercapture:a:null');
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.previousTarget).toBeNull();
    trace.length = 0;
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(false);
    expect(trace).toEqual([]);
  });

  it('allows a new contact after the previous contact was suppressed', () => {
    const { stream, send, hitTest } = createFixture(false, true);
    send('pointerdown');
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(true);
    send('pointerdown');
    expect(stream.suppressForDirectManipulation(hitTest)).toBe(true);
  });
});

describe('Pointer Events §8.5: implicit capture release after pointerup', () => {
  it('releases before restoring the uncaptured hover target, and remembers that new boundary position', () => {
    const { stream, send, capture, geometry, getHoverTarget, a, b, trace } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    geometry.target = b;
    trace.length = 0;
    send('pointerup', { buttons: 0, pressure: 0 });
    expect(trace).toEqual(['pointerup:a:null', 'lostpointercapture:a:null', 'pointerout:a:b', 'pointerleave:a:b',
      'pointerover:b:a', 'pointerenter:b:a']);
    expect(getHoverTarget).toHaveBeenCalledOnce();
    expect(stream.previousTarget).toBe(unwrap(b));
    trace.length = 0;
    send('pointermove');
    expect(trace).toEqual(['pointermove:b:null']);
  });

  it('queries the hover target after loss listeners, without taking a second ordinary input', () => {
    const { send, capture, geometry, a, b, c, trace } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    geometry.target = b;
    a.addEventListener('lostpointercapture', () => { geometry.target = c; });
    trace.length = 0;
    send('pointerup', { buttons: 0, pressure: 0 });
    expect(trace).toEqual(['pointerup:a:null', 'lostpointercapture:a:null', 'pointerout:a:c', 'pointerleave:a:c',
      'pointerover:c:a', 'pointerenter:c:a']);
  });

  it.each(['mouse', 'touch'])('uses explicit non-hover capability rather than the %s pointerType', (pointerType) => {
    const { stream, send, capture, a, trace } = createFixture(false);
    send('pointermove', { pointerType });
    capture(a);
    send('pointermove', { pointerType });
    trace.length = 0;
    send('pointerup', { pointerType, buttons: 0, pressure: 0 });
    expect(trace).toEqual(['pointerup:a:null', 'lostpointercapture:a:null', 'pointerout:a:null',
      'pointerleave:a:null', 'pointerleave:body:null', 'pointerleave:html:null']);
    expect(stream.previousTarget).toBeNull();
    expect(stream.capture.targetOverride).toBeNull();
  });

  it('releases capture even when pointerup is canceled', () => {
    const { stream, send, capture, a } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    a.addEventListener('pointerup', (event) => event.preventDefault());
    expect(send('pointerup', { buttons: 0, pressure: 0 }).accepted).toBe(false);
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.capture.pendingTargetOverride).toBeNull();
  });

  it('retains input for loss and boundary notifications even if a loss listener reinitializes pointerup', () => {
    const { send, capture, geometry, a, b, events } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    geometry.target = b;
    a.addEventListener('lostpointercapture', () => {
      events.find((event) => event.type === 'pointerup')!.initMouseEvent('author', false, false, null, 0,
        0, 0, 999, 999, false, false, false, false, 0, null);
    });
    send('pointerup', { buttons: 0, pressure: 0, clientX: 32.5 });
    expect(events.find((event) => event.type === 'pointerover' && event.target === b)?.clientX).toBe(32.5);
  });

  it('recovers a restored hover target using its boundary dispatch path when a listener removes it', () => {
    const { browser, stream, send, capture, geometry, a, b, trace } = createFixture();
    send('pointermove');
    capture(a);
    send('pointermove');
    geometry.target = b;
    b.addEventListener('pointerover', () => b.remove());
    send('pointerup', { buttons: 0, pressure: 0 });
    expect(stream.previousTarget).toBe(unwrap(browser.document.body!));
    expect(stream.needsOverEvent).toBe(true);
    geometry.target = browser.document.body!;
    trace.length = 0;
    send('pointermove');
    expect(trace).toEqual(['pointerover:body:body', 'pointermove:body:null']);
  });

  it('does not let author-dispatched up or cancel events alter native capture state', () => {
    const { browser, stream, send, capture, a, hitTest, events } = createFixture();
    send('pointermove', { clientX: 12.5 });
    capture(a);
    send('pointermove', { clientX: 17.5 });
    for (const type of ['pointerup', 'pointercancel']) {
      a.dispatchEvent(new browser.window.PointerEvent(type, { pointerId: 7, clientX: 900 }));
      expect(stream.capture.targetOverride).toBe(unwrap(a));
    }
    stream.suppress(hitTest);
    expect(events.find((event) => event.type === 'pointercancel' && event.isTrusted)?.clientX).toBe(17.5);
  });
});

/** Real Binding and DOM dispatch; only device capability, geometry, and the unfinished lock query are supplied. */
function createFixture(hover = true, directManipulation = false) {
  const browser = new Browlet({ route: () => '' });
  const stream = new PointerEventStream(7, directManipulation, () => false);
  const trace: string[] = [];
  const events: PointerEvent[] = [];
  const labels = new Map<EventTarget, string>();
  const observe = (target: EventTarget, label: string) => {
    labels.set(target, label);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture',
      'lostpointercapture', 'pointerout', 'pointerleave', 'pointerover', 'pointerenter']) {
      target.addEventListener(type, (event) => {
        if (event.target !== target) return;
        const pointerEvent = event as PointerEvent;
        events.push(pointerEvent);
        trace.push(`${event.type}:${label}:${pointerEvent.relatedTarget === null ? 'null' : labels.get(pointerEvent.relatedTarget)}`);
      });
    }
  };
  observe(browser.document.documentElement!, 'html');
  observe(browser.document.body!, 'body');
  const element = (label: string) => {
    const value = browser.document.createElement('div');
    browser.document.body!.append(value);
    observe(value, label);
    return value;
  };
  const a = element('a');
  const b = element('b');
  const c = element('c');
  const geometry: { target: Element; } = { target: a };
  const hitTest = vi.fn(() => unwrap<NodeImpl>(geometry.target));
  const getHoverTarget = vi.fn(() => hover ? hitTest() : null);
  const capture = (element: Element) => stream.setPointerCapture(unwrap<ElementImpl>(element), 1);
  const send = (type: PointerInputEventType, init: PointerEventInit = {}) => {
    const input = new PointerEventImpl(type, { pointerType: 'mouse', buttons: 1, ...init }, 0);
    const target = stream.prepareTarget(type, input, hitTest);
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.copyInputFrom(input);
    event.setPointerEventAttributes(type);
    return { event, accepted: stream.dispatchToTarget(event, target, getHoverTarget) };
  };
  return { browser, stream, trace, events, a, b, c, geometry, hitTest, getHoverTarget, capture, send };
}
