import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, Event, EventTarget, PointerEvent } from '../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../src/browlet/interaction/index';
import { PointerEventImpl, type PointerEventInit, type PointerInputEventType } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

describe('Pointer Events §3.1.3: boundary ordering and ordinary dispatch', () => {
  it('enters Element ancestors from outermost to innermost before the first input', () => {
    const { send, a, trace } = createFixture();
    expect(send(a).accepted).toBe(true);
    expect(trace).toEqual(['pointerover:a:null', 'pointerenter:html:null', 'pointerenter:body:null',
      'pointerenter:left:null', 'pointerenter:a:null', 'pointermove:a:null']);
  });

  it('does not repeat boundaries for an unchanged target', () => {
    const { send, a, trace, stream } = createFixture();
    send(a);
    trace.length = 0;
    send(a);
    expect(trace).toEqual(['pointermove:a:null']);
    expect(stream.previousTarget).toBe(unwrap(a));
    expect(stream.needsOverEvent).toBe(false);
  });

  it('leaves inward-to-outward, then enters outward-to-inward before the ordinary event', () => {
    const { send, a, b, trace } = createFixture();
    send(a);
    trace.length = 0;
    send(b);
    expect(trace).toEqual(['pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
      'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:b:a', 'pointermove:b:null']);
  });

  it('does not leave or re-enter the common parent when moving between siblings', () => {
    const { send, a, b, left, trace } = createFixture();
    left.append(b);
    send(a);
    trace.length = 0;
    send(b);
    expect(trace).toEqual(['pointerout:a:b', 'pointerleave:a:b', 'pointerover:b:a',
      'pointerenter:b:a', 'pointermove:b:null']);
  });

  it('does not leave an ancestor when entering its descendant, or re-enter it on return', () => {
    const { send, a, left, trace } = createFixture();
    send(left);
    trace.length = 0;
    send(a);
    expect(trace).toEqual(['pointerout:left:a', 'pointerover:a:left', 'pointerenter:a:left', 'pointermove:a:null']);
    trace.length = 0;
    send(left);
    expect(trace).toEqual(['pointerout:a:left', 'pointerleave:a:left', 'pointerover:left:a', 'pointermove:left:null']);
  });

  it('keeps boundary cancellation separate from ordinary-event cancellation', () => {
    const { send, a, b, trace } = createFixture();
    a.addEventListener('pointerout', (event) => event.preventDefault());
    b.addEventListener('pointerover', (event) => event.preventDefault());
    send(a);
    trace.length = 0;
    expect(send(b).accepted).toBe(true);
    expect(trace.at(-1)).toBe('pointermove:b:null');
    b.addEventListener('pointermove', (event) => event.preventDefault());
    const { accepted, event } = send(b);
    expect(accepted).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('allocates fresh trusted boundary events in their target realm and copies the current input fields', () => {
    const { browser, send, a, b } = createFixture();
    const received: Event[] = [];
    for (const target of [a, b]) {
      for (const type of ['pointerout', 'pointerover', 'pointerleave', 'pointerenter']) {
        target.addEventListener(type, (event) => received.push(event));
      }
    }
    send(a);
    received.length = 0;
    const { event } = send(b);
    expect(new Set(received).size).toBe(4);
    for (const notification of received) {
      expect(notification).toBeInstanceOf(browser.window.PointerEvent);
      expect(notification.isTrusted).toBe(true);
      const input = notification as PointerEvent;
      expect([input.pointerId, input.pointerType, input.clientX, input.buttons, input.timeStamp])
        .toEqual([7, 'mouse', 12.5, 1, event.timeStamp]);
      expect(unwrap<PointerEventImpl>(input)).not.toBe(event);
      expect(unwrap<PointerEventImpl>(input).getCoalescedEvents()).toEqual([]);
    }
  });

  it('delivers capture notifications before the resulting target transition', () => {
    const { send, a, b, stream, trace, browser } = createFixture();
    for (const type of ['gotpointercapture', 'lostpointercapture']) {
      browser.document.addEventListener(type, (event) => trace.push(`${type}:${(event.target as Element).id}`));
    }
    send(a);
    stream.setPointerCapture(unwrap<ElementImpl>(b), 1);
    trace.length = 0;
    send(a);
    expect(trace).toEqual(['gotpointercapture:b', 'pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
      'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:b:a', 'pointermove:b:null']);
    trace.length = 0;
    send(a);
    expect(trace).toEqual(['pointermove:b:null']);
    stream.releasePointerCapture(unwrap<ElementImpl>(b));
    trace.length = 0;
    send(a);
    expect(trace[0]).toBe('lostpointercapture:b');
    expect(trace.at(-1)).toBe('pointermove:a:null');
  });

  it('keeps boundary-time capture requests pending until the next input', () => {
    const { send, a, b, destination, stream, trace } = createFixture();
    a.addEventListener('pointerout', () => stream.setPointerCapture(unwrap<ElementImpl>(destination), 1));
    send(a);
    trace.length = 0;
    send(b);
    expect(trace.at(-1)).toBe('pointermove:b:null');
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(destination));
    trace.length = 0;
    send(b);
    expect(trace.at(-1)).toBe('pointermove:destination:null');
  });

  it.each(['pointerout', 'pointerleave', 'pointerover'])(
    'preserves the ancestor snapshot and selected ordinary target after reparenting in %s', (type) => {
      const { send, a, b, destination, trace } = createFixture();
      const listenerTarget = type === 'pointerover' ? b : a;
      listenerTarget.addEventListener(type, () => destination.append(b), { once: true });
      send(a);
      trace.length = 0;
      send(b);
      expect(trace).toEqual(['pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
        'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:b:a', 'pointermove:b:null']);
      expect(b.parentElement).toBe(destination);
    },
  );

  it('uses flat-tree hosts and lets DOM retarget relatedTarget across a closed shadow root', () => {
    const { send, a, b, right, observe, trace } = createFixture();
    const root = right.attachShadow({ mode: 'closed' });
    root.append(b);
    observe(root, 'root');
    send(a);
    trace.length = 0;
    send(b);
    expect(trace).toEqual(['pointerout:a:right', 'pointerleave:a:right', 'pointerleave:left:right',
      'pointerover:b:a', 'pointerover:right:a', 'pointerenter:right:a', 'pointerenter:b:a',
      'pointermove:b:null', 'pointermove:right:null']);
  });

  it('includes assigned slots in the boundary ancestry', () => {
    const { browser, send, a, b, right, observe, trace } = createFixture();
    const root = right.attachShadow({ mode: 'open' });
    const slot = browser.document.createElement('slot');
    root.append(slot);
    observe(slot, 'slot');
    send(a);
    trace.length = 0;
    send(b);
    expect(trace).toEqual(['pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
      'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:slot:a', 'pointerenter:b:a', 'pointermove:b:null']);
  });

  it('repairs a removed target to its surviving dispatch ancestor and sends the required over event', () => {
    const { send, a, left, stream, trace } = createFixture();
    a.addEventListener('pointermove', () => a.remove(), { once: true });
    const { event } = send(a);
    expect(event.path).toEqual([]);
    expect(stream.previousTarget).toBe(unwrap(left));
    expect(stream.needsOverEvent).toBe(true);
    trace.length = 0;
    send(left);
    expect(trace).toEqual(['pointerover:left:left', 'pointermove:left:null']);
    expect(stream.needsOverEvent).toBe(false);
  });

  it('repairs along the original dispatch path even when a listener reparents and then removes the target', () => {
    const { send, a, left, destination, stream } = createFixture();
    a.addEventListener('pointermove', () => { destination.append(a); a.remove(); });
    send(a);
    expect(stream.previousTarget).toBe(unwrap(left));
  });

  it('keeps moving outward if a previously surviving ancestor is also removed', () => {
    const { browser, send, a, left, stream } = createFixture();
    a.addEventListener('pointermove', () => a.remove());
    send(a);
    left.remove();
    stream.clearDisconnectedTarget();
    expect(stream.previousTarget).toBe(unwrap(browser.document.body!));
    browser.document.body!.remove();
    stream.clearDisconnectedTarget();
    expect(stream.previousTarget).toBe(unwrap(browser.document.documentElement!));
  });

  it('repairs a standalone stream when removal is reported before reinsertion', () => {
    const { send, a, left, stream } = createFixture();
    send(a);
    a.remove();
    stream.clearDisconnectedTarget();
    left.append(a);
    expect(stream.previousTarget).toBe(unwrap(left));
    expect(stream.needsOverEvent).toBe(true);
  });

  it('still dispatches to a selected target removed by a boundary listener', () => {
    const { send, a, b, stream, trace } = createFixture();
    a.addEventListener('pointerout', () => b.remove());
    send(a);
    trace.length = 0;
    send(b);
    expect(trace.at(-1)).toBe('pointermove:b:null');
    expect(stream.previousTarget).toBeNull();
    expect(stream.needsOverEvent).toBe(true);
  });
});

describe('Pointer Events §§3.3.1–3.3.2: pointerover and pointerenter', () => {
  it.each(['touch', 'pen'])('enters before each non-hover %s contact, including at the same position', (pointerType) => {
    const { send, a, trace } = createFixture(true);
    const entry = ['pointerover:a:null', 'pointerenter:html:null', 'pointerenter:body:null',
      'pointerenter:left:null', 'pointerenter:a:null', 'pointerdown:a:null'];
    send(a, 'pointerdown', { pointerType });
    expect(trace).toEqual(entry);

    send(a, 'pointerup', { pointerType, buttons: 0, pressure: 0 }, null);
    trace.length = 0;
    send(a, 'pointerdown', { pointerType });
    expect(trace).toEqual(entry);
  });

  it('does not repeat entry when an already hovering pointer presses a button', () => {
    const { send, a, trace } = createFixture();
    send(a, 'pointermove', { buttons: 0, pressure: 0 });
    trace.length = 0;
    send(a, 'pointerdown');
    expect(trace).toEqual(['pointerdown:a:null']);
  });

  it.each(['movement', 'layout'])('bubbles over but sends separate non-bubbling ancestor entries after %s', (trigger) => {
    const { send, update, a, b, left } = createFixture();
    send(b);
    const received: Event[] = [];
    const ancestorEntries: Event[] = [];
    const phases: string[] = [];
    const record = (event: Event) => {
      if (event.target !== a) return;
      phases.push(`${event.type}:${event.eventPhase}`);
      received.push(event);
    };
    for (const type of ['pointerover', 'pointerenter']) {
      left.addEventListener(type, record, true);
      left.addEventListener(type, record);
    }
    left.addEventListener('pointerenter', (event) => {
      if (event.target === left) ancestorEntries.push(event);
    });

    if (trigger === 'movement') send(a);
    else update(a);

    expect(phases).toEqual(['pointerover:1', 'pointerover:3', 'pointerenter:1']);
    expect(received[0]).toBe(received[1]);
    expect(received[0]).toMatchObject({
      bubbles: true, cancelable: true, composed: true, isTrusted: true, target: a, relatedTarget: b,
    });
    expect(received[2]).toMatchObject({
      bubbles: false, cancelable: false, composed: false, isTrusted: true, target: a, relatedTarget: b,
    });
    expect(ancestorEntries).toHaveLength(1);
    expect(ancestorEntries[0]).not.toBe(received[2]);
    expect(ancestorEntries[0]).toMatchObject({
      bubbles: false, cancelable: false, composed: false, isTrusted: true, target: left, relatedTarget: b,
    });
  });
});

describe('Pointer Events §3.1.4: boundary events after layout changes', () => {
  it('updates a stationary pointer with only boundary events and remembers the new target', () => {
    const { stream, send, update, a, b, trace } = createFixture();
    send(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
      'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:b:a']);
    expect(stream.previousTarget).toBe(unwrap(b));
    trace.length = 0;
    update(b);
    expect(trace).toEqual([]);
    send(b);
    expect(trace).toEqual(['pointermove:b:null']);
  });

  it('does nothing before input or after suppression', () => {
    const { stream, send, a, b, trace } = createFixture();
    const hitTest = vi.fn(() => unwrap<NodeImpl>(b));
    stream.updateAfterLayout(hitTest, 1);
    expect(hitTest).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
    send(a);
    stream.suppress(() => unwrap<NodeImpl>(a));
    trace.length = 0;
    stream.updateAfterLayout(hitTest, 2);
    expect(hitTest).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
  });

  it('keeps stable capture without invoking the hit-test dependency', () => {
    const { stream, send, a, b, trace } = createFixture();
    send(a);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    send(a);
    trace.length = 0;
    const hitTest = vi.fn(() => unwrap<NodeImpl>(b));
    stream.updateAfterLayout(hitTest, 1);
    expect(hitTest).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
    expect(stream.previousTarget).toBe(unwrap(a));
  });

  it('processes a capture transfer before sending its boundary transition', () => {
    const { stream, send, update, a, b, trace } = createFixture();
    send(a);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    send(a);
    a.addEventListener('lostpointercapture', () => trace.push('lost:a'));
    b.addEventListener('gotpointercapture', () => trace.push('got:b'));
    stream.setPointerCapture(unwrap<ElementImpl>(b), 1);
    trace.length = 0;
    update(a);
    expect(trace).toEqual(['lost:a', 'got:b', 'pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
      'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:b:a']);
    expect(stream.capture.targetOverride).toBe(unwrap(b));
  });

  it('hit tests after loss listeners and keeps the selected target through boundary listeners', () => {
    const { stream, send, a, b, destination, trace } = createFixture();
    send(a);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    send(a);
    let hit = a;
    a.addEventListener('lostpointercapture', () => { hit = b; });
    a.addEventListener('pointerout', () => { hit = destination; });
    stream.releasePointerCapture(unwrap<ElementImpl>(a));
    trace.length = 0;
    const hitTest = vi.fn(() => unwrap<NodeImpl>(hit));
    stream.updateAfterLayout(hitTest, 1);
    expect(hitTest).toHaveBeenCalledOnce();
    expect(trace).toEqual(['pointerout:a:b', 'pointerleave:a:b', 'pointerleave:left:b',
      'pointerover:b:a', 'pointerenter:right:a', 'pointerenter:b:a']);
    expect(stream.previousTarget).toBe(unwrap(b));
    trace.length = 0;
    stream.updateAfterLayout(hitTest, 2);
    expect(trace).toEqual(['pointerout:b:destination', 'pointerleave:b:destination', 'pointerleave:right:destination',
      'pointerover:destination:b', 'pointerenter:destination:b']);
  });

  it('uses current time and zero movement while retaining coordinates, held buttons, and pointer data', () => {
    const { browser, stream, send, update, a, b } = createFixture();
    const { event } = send(a, 'pointermove', {
      pointerType: 'pen', pressure: 0.75, screenX: 50.5, clientX: 12.5, button: 0, buttons: 3,
      movementX: 5, movementY: -7, width: 8, height: 10, tiltX: 4, tiltY: 6,
      coalescedEvents: [new PointerEventImpl('pointermove')],
    });
    const timeStamp = event.timeStamp + 100;
    const events: PointerEvent[] = [];
    a.addEventListener('pointerout', (event) => events.push(event as PointerEvent));
    b.addEventListener('pointerover', (event) => events.push(event as PointerEvent));
    update(b, timeStamp);
    expect(events).toHaveLength(2);
    for (const notification of events) {
      expect(notification).toBeInstanceOf(browser.window.PointerEvent);
      expect(notification).toMatchObject({
        isTrusted: true, pointerId: 7, pointerType: 'pen', pressure: 0.75, screenX: 50.5, clientX: 12.5,
        button: -1, buttons: 3, movementX: 0, movementY: 0, width: 8, height: 10, tiltX: 4, tiltY: 6, timeStamp,
      });
      expect(unwrap<PointerEventImpl>(notification).getCoalescedEvents()).toEqual([]);
      expect(unwrap<PointerEventImpl>(notification).getPredictedEvents()).toEqual([]);
    }
    expect([event.movementX, event.movementY, event.button]).toEqual([5, -7, 0]);
    expect(stream.activeDocument).toBe(unwrap<ElementImpl>(a).nodeDocument);
  });

  it('retains the input position for later re-entry when a layout hit test has no target', () => {
    const { stream, send, update, a, b, trace } = createFixture();
    send(a);
    trace.length = 0;
    update(null);
    expect(trace).toEqual(['pointerout:a:null', 'pointerleave:a:null', 'pointerleave:left:null',
      'pointerleave:body:null', 'pointerleave:html:null']);
    expect(stream.previousTarget).toBeNull();
    trace.length = 0;
    update(null);
    expect(trace).toEqual([]);
    update(b);
    expect(trace).toEqual(['pointerover:b:null', 'pointerenter:html:null', 'pointerenter:body:null',
      'pointerenter:right:null', 'pointerenter:b:null']);
  });

  it('repairs a removed previous target before sending layout boundaries', () => {
    const { stream, send, update, a, b, trace } = createFixture();
    send(a);
    a.remove();
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['pointerleave:left:b', 'pointerover:b:left', 'pointerenter:right:left', 'pointerenter:b:left']);
    expect(stream.previousTarget).toBe(unwrap(b));
    expect(stream.needsOverEvent).toBe(false);
  });

  it('retains the boundary dispatch path when an enter listener removes the new target', () => {
    const { stream, send, update, a, b, right, trace } = createFixture();
    send(a);
    b.addEventListener('pointerenter', () => b.remove(), { once: true });
    update(b);
    expect(stream.previousTarget).toBe(unwrap(right));
    expect(stream.needsOverEvent).toBe(true);
    trace.length = 0;
    update(right);
    expect(trace).toEqual(['pointerover:right:right']);
    trace.length = 0;
    update(right);
    expect(trace).toEqual([]);
  });

  it('uses DOM retargeting when layout moves the hit into a closed shadow root', () => {
    const { send, update, observe, a, b, right, trace } = createFixture();
    const root = right.attachShadow({ mode: 'closed' });
    root.append(b);
    observe(root, 'shadow');
    send(a);
    trace.length = 0;
    update(b);
    expect(trace).toEqual(['pointerout:a:right', 'pointerleave:a:right', 'pointerleave:left:right',
      'pointerover:b:a', 'pointerover:right:a', 'pointerenter:right:a', 'pointerenter:b:a']);
  });

  it('does not treat author-dispatched moves as new device input', () => {
    const { browser, send, update, a, b } = createFixture();
    send(a);
    a.dispatchEvent(new browser.window.PointerEvent('pointermove', { pointerId: 7, clientX: 999 }));
    let clientX: number | undefined;
    b.addEventListener('pointerover', (event) => { clientX = (event as PointerEvent).clientX; });
    update(b);
    expect(clientX).toBe(12.5);
  });
});

/** Real DOM/Binding allocation and dispatch, with only geometry and Pointer Lock supplied by the test. */
function createFixture(isDirectManipulation = false) {
  const browser = new Browlet({ route: () => '' });
  const stream = new PointerEventStream(7, isDirectManipulation, !isDirectManipulation, () => false);
  const trace: string[] = [];
  const labels = new Map<EventTarget, string>();
  const observe = (target: EventTarget, label: string) => {
    labels.set(target, label);
    for (const type of ['pointerout', 'pointerleave', 'pointerover', 'pointerenter', 'pointermove', 'pointerdown']) {
      target.addEventListener(type, (event) => {
        if (event.target !== target) return;
        const related = (event as PointerEvent).relatedTarget;
        trace.push(`${event.type}:${label}:${related === null ? 'null' : labels.get(related)}`);
      });
    }
  };
  const element = (id: string, parent: Element) => {
    const node = browser.document.createElement('div');
    node.id = id;
    parent.append(node);
    observe(node, id);
    return node;
  };
  observe(browser.document, 'document');
  observe(browser.document.documentElement!, 'html');
  observe(browser.document.body!, 'body');
  const left = element('left', browser.document.body!);
  const right = element('right', browser.document.body!);
  const destination = element('destination', browser.document.body!);
  const a = element('a', left);
  const b = element('b', right);
  const send = (
    hit: Element, type: PointerInputEventType = 'pointermove', init: PointerEventInit = {}, hoverTarget: Element | null = hit,
  ) => {
    const event = unwrap<DocumentImpl>(browser.document).createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.copyInputFrom(new PointerEventImpl(type, { pointerType: 'mouse', buttons: 1, clientX: 12.5, ...init }));
    const target = stream.prepareTarget(type, event, () => unwrap<NodeImpl>(hit));
    const accepted = stream.dispatchToTarget(event, target, () => hoverTarget === null ? null : unwrap<NodeImpl>(hoverTarget), 1);
    return { event, accepted };
  };
  const update = (hit: Element | null, timeStamp = unwrap<DocumentImpl>(browser.document).env.realm.eventTimeStamp()) => {
    stream.updateAfterLayout(() => hit === null ? null : unwrap<NodeImpl>(hit), timeStamp);
  };
  return { browser, stream, trace, observe, send, update, a, b, left, right, destination };
}
