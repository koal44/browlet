import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { PointerEvent } from '../../../src/browlet/platform';
import { BrowsingContext, Navigable } from '../../../src/browlet/browsing/navigation/index';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { PointerButton, PointerEventStream } from '../../../src/browlet/interaction/index';
import { PointerEventImpl } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

describe('Pointer Events §3.1.3: target preparation', () => {
  it('prepares the stream ID and event attributes before invoking the required hit test', () => {
    const { browser, stream, event, a } = createFixture();
    const hitTest = vi.fn(() => {
      expect([event.pointerId, event.type, event.bubbles, event.cancelable, event.composed, event.detail])
        .toEqual([7, 'pointermove', true, true, true, 0]);
      return unwrap<ElementImpl>(a);
    });
    expect(stream.prepareTarget('pointermove', event, hitTest)).toBe(unwrap(a));
    expect(hitTest).toHaveBeenCalledTimes(1);
    expect(stream.activeDocument).toBe(unwrap(browser.document));
  });

  it('uses newly gained capture without invoking hit testing or dispatching the input', () => {
    const { stream, event, a, b, trace } = createFixture();
    const hitTest = vi.fn(() => unwrap<ElementImpl>(b));
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    a.addEventListener('gotpointercapture', (notification) => {
      expect((notification as PointerEvent).pointerId).toBe(7);
      expect((notification as PointerEvent).clientX).toBe(12.5);
    });
    a.addEventListener('pointermove', () => trace.push('input'));
    expect(stream.prepareTarget('pointermove', event, hitTest)).toBe(unwrap(a));
    expect(trace).toEqual(['gotpointercapture:a']);
    expect(hitTest).not.toHaveBeenCalled();
    expect(event.target).toBeNull();
  });

  it('keeps using effective capture without duplicate notifications or hit tests', () => {
    const { stream, event, a, b, trace } = createFixture();
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(b));
    trace.length = 0;
    const hitTest = vi.fn(() => unwrap<ElementImpl>(b));
    expect(stream.prepareTarget('pointerrawupdate', event, hitTest)).toBe(unwrap(a));
    expect(trace).toEqual([]);
    expect(hitTest).not.toHaveBeenCalled();
  });

  it('runs hit testing after capture loss, observing changes made by the loss listener', () => {
    const { stream, event, a, b, c, trace } = createFixture();
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    trace.length = 0;
    let hitTarget: NodeImpl = unwrap<ElementImpl>(b);
    a.addEventListener('lostpointercapture', () => { hitTarget = unwrap<ElementImpl>(c); });
    stream.capture.pendingTargetOverride = null;
    const target = stream.prepareTarget('pointermove', event, () => {
      trace.push('hit-test');
      return hitTarget;
    });
    expect(trace).toEqual(['lostpointercapture:a', 'hit-test']);
    expect(target).toBe(unwrap(c));
  });

  it('uses the snapshotted capture destination despite a listener requesting another target', () => {
    const { stream, event, a, b, c, trace } = createFixture();
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    trace.length = 0;
    a.addEventListener('lostpointercapture', () => { stream.capture.pendingTargetOverride = unwrap<ElementImpl>(c); });
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(b);
    const hitTest = vi.fn(() => unwrap<ElementImpl>(a));
    expect(stream.prepareTarget('pointermove', event, hitTest)).toBe(unwrap(b));
    expect(stream.prepareTarget('pointermove', event, hitTest)).toBe(unwrap(c));
    expect(trace).toEqual(['lostpointercapture:a', 'gotpointercapture:b', 'lostpointercapture:b', 'gotpointercapture:c']);
    expect(hitTest).not.toHaveBeenCalled();
  });

  it('returns to hit testing after loss at the Document for a removed capture target', () => {
    const { stream, event, a, b, trace } = createFixture();
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    trace.length = 0;
    a.remove();
    expect(stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(b))).toBe(unwrap(b));
    expect(trace).toEqual(['lostpointercapture:#document']);
  });

  it.each(['pointerdown', 'pointermove', 'pointerup'] as const)(
    'updates the active Document for %s after capture notifications', (type) => {
      const { browser, stream, event, a } = createFixture();
      const child = createChildDocument(browser);
      stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
      stream.prepareTarget('pointermove', event, () => child);
      a.addEventListener('lostpointercapture', () => {
        expect(stream.activeDocument).toBe(unwrap(browser.document));
      });
      stream.capture.pendingTargetOverride = null;
      stream.prepareTarget(type, event, () => child);
      expect(stream.activeDocument).toBe(child);
    },
  );

  it.each(['pointerover', 'pointerenter', 'pointerrawupdate', 'pointercancel', 'pointerout', 'pointerleave'] as const)(
    'does not change the active Document for %s', (type) => {
      const { browser, stream, event, a } = createFixture();
      stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
      const child = createChildDocument(browser);
      expect(stream.prepareTarget(type, event, () => child)).toBe(child);
      expect(stream.activeDocument).toBe(unwrap(browser.document));
    },
  );

  it('propagates an unavailable hit test without inventing a target or updating the active Document', () => {
    const { stream, event } = createFixture();
    const missingGeometry = new Error('test geometry owner is unavailable');
    expect(() => stream.prepareTarget('pointermove', event, () => { throw missingGeometry; })).toThrow(missingGeometry);
    expect(stream.activeDocument).toBeNull();
  });

  it('keeps IDs, active Documents, and capture independent between streams', () => {
    const { browser, stream, event, a } = createFixture();
    const otherBrowser = new Browlet({ route: () => '' });
    const otherStream = new PointerEventStream(8, false, true, () => false);
    const otherEvent = new PointerEventImpl('pointermove');
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    otherStream.prepareTarget('pointermove', otherEvent, () => unwrap<DocumentImpl>(otherBrowser.document));
    expect([event.pointerId, otherEvent.pointerId]).toEqual([7, 8]);
    expect(stream.activeDocument).toBe(unwrap(browser.document));
    expect(otherStream.activeDocument).toBe(unwrap(otherBrowser.document));
    expect(otherStream.capture.targetOverride).toBeNull();
  });
});

describe('Pointer Events §§3.1.3, 8.4: implicit capture', () => {
  it.each([false, true])('makes the request visible before a down listener (release there: %s)', (releaseOnDown) => {
    const { stream, event, a, b, trace, hasLockedElement } = createFixture(true);
    const aImpl = unwrap<ElementImpl>(a);
    event.buttons = 1;
    event.pointerType = 'touch';
    const down = aImpl.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    down.copyInputFrom(event);
    hasLockedElement.mockImplementation((document) => {
      expect(document).toBe(aImpl.nodeDocument);
      expect(stream.activeDocument).toBe(document);
      return false;
    });
    let observed: [boolean, ElementImpl | null, ElementImpl | DocumentImpl | null] | undefined;
    a.addEventListener('pointerdown', (notification) => {
      trace.push('pointerdown');
      observed = [notification.isTrusted, stream.capture.pendingTargetOverride, stream.capture.targetOverride];
      if (releaseOnDown) stream.releasePointerCapture(aImpl);
    });

    const target = stream.prepareTarget('pointerdown', down, () => aImpl);
    expect(trace).toEqual([]);
    // Exercise the prepared state through real DOM dispatch; the remaining
    // native boundary/default-action pipeline is not connected by this test.
    target.dispatch(down);
    expect(observed).toEqual([true, aImpl, null]);
    expect(trace).toEqual(['pointerdown']);
    const hitTest = vi.fn(() => unwrap<ElementImpl>(b));
    const next = stream.prepareTarget('pointermove', event, hitTest);
    expect(next).toBe(unwrap(releaseOnDown ? b : a));
    expect(trace).toEqual(releaseOnDown ? ['pointerdown'] : ['pointerdown', 'gotpointercapture:a']);
    expect(hitTest).toHaveBeenCalledTimes(releaseOnDown ? 1 : 0);
    expect(hasLockedElement).toHaveBeenCalledTimes(1);
  });

  it.each([[false, 'mouse'], [false, 'pen'], [false, 'touch'], [true, 'pen'], [true, 'vendor-device']] as const)(
    'uses direct-manipulation capability %s independently of pointerType %s', (direct, pointerType) => {
      const { stream, event, a, hasLockedElement } = createFixture(direct);
      event.buttons = 1;
      event.pointerType = pointerType;
      stream.prepareTarget('pointerdown', event, () => unwrap<ElementImpl>(a));
      expect(stream.capture.pendingTargetOverride).toBe(direct ? unwrap(a) : null);
      expect(hasLockedElement).toHaveBeenCalledTimes(direct ? 1 : 0);
    },
  );

  it.each(['pointerover', 'pointerenter', 'pointermove', 'pointerrawupdate', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave'] as const)(
    'does not request implicit capture for %s', (type) => {
      const { stream, event, a, hasLockedElement } = createFixture(true);
      event.buttons = 1;
      stream.prepareTarget(type, event, () => unwrap<ElementImpl>(a));
      expect(stream.capture.pendingTargetOverride).toBeNull();
      expect(hasLockedElement).not.toHaveBeenCalled();
    },
  );

  it('does not request capture for a Document target', () => {
    const { browser, stream, event, hasLockedElement } = createFixture(true);
    event.buttons = 1;
    const document = unwrap<DocumentImpl>(browser.document);
    expect(stream.prepareTarget('pointerdown', event, () => document)).toBe(document);
    expect(stream.activeDocument).toBe(document);
    expect(stream.capture.pendingTargetOverride).toBeNull();
    expect(hasLockedElement).not.toHaveBeenCalled();
  });
});

describe('Pointer Events §3.3.3: pointerdown dispatch', () => {
  it.each(['mouse', 'pen'])('delivers only one %s down across a button chord or barrel-to-contact transition', (pointerType) => {
    const { browser, a, sendButton } = createButtonFixture(pointerType);
    const received: PointerEvent[] = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      a.addEventListener(type, (event) => received.push(event as PointerEvent));
    }

    sendButton(PointerButton.Secondary, true);
    sendButton(PointerButton.Primary, true);
    sendButton(PointerButton.Secondary, false);
    sendButton(PointerButton.Primary, false);

    expect(received.map((event) => [event.type, event.button, event.buttons])).toEqual([
      ['pointerdown', 2, 2], ['pointermove', 0, 3], ['pointermove', 2, 1], ['pointerup', 0, 0],
    ]);
    for (const event of received) {
      expect(event).toBeInstanceOf(browser.window.PointerEvent);
      expect(event).toMatchObject({ pointerId: 7, pointerType, isPrimary: true, isTrusted: true, target: a });
    }
  });

  it.each([false, true])('reports down cancellation without undoing contact or capture (passive: %s)', (passive) => {
    const { browser, stream, pointer, a, trace, sendButton } = createButtonFixture('touch', true);
    const received: PointerEvent[] = [];
    browser.document.addEventListener('pointerdown', (event) => {
      received.push(event as PointerEvent);
      event.preventDefault();
    }, { passive });
    a.addEventListener('pointerup', (event) => received.push(event as PointerEvent));

    expect(sendButton(PointerButton.Primary, true)?.accepted).toBe(passive);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'pointerdown', target: a, bubbles: true, cancelable: true, composed: true,
      isTrusted: true, isPrimary: true, pointerType: 'touch', button: 0, buttons: 1, defaultPrevented: !passive,
    });
    expect(pointer.buttons).toBe(1);
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
    expect(stream.capture.targetOverride).toBeNull();

    expect(sendButton(PointerButton.Primary, false)?.accepted).toBe(true);
    expect(received.map((event) => event.type)).toEqual(['pointerdown', 'pointerup']);
    expect(trace).toEqual(['gotpointercapture:a', 'lostpointercapture:a']);
    expect(pointer.buttons).toBe(0);
    expect(stream.capture.pendingTargetOverride).toBeNull();
    expect(stream.capture.targetOverride).toBeNull();
    expect(stream.previousTarget).toBeNull();
  });
});

describe('Pointer Events §§8.2–8.3: requests for a resolved active pointer', () => {
  it('replaces only pending capture until the next processing pass', () => {
    const { stream, event, a, b, trace } = createFixture();
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    stream.setPointerCapture(unwrap<ElementImpl>(b), 1);
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(b));
    expect(stream.capture.targetOverride).toBeNull();
    expect(trace).toEqual([]);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    expect(trace).toEqual(['gotpointercapture:b']);
  });

  it('rejects a disconnected target before consulting Pointer Lock and preserves the pending request', () => {
    const { stream, a, b, hasLockedElement } = createFixture();
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    b.remove();
    expect(() => stream.setPointerCapture(unwrap<ElementImpl>(b), 0))
      .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(hasLockedElement).not.toHaveBeenCalled();
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
  });

  it.each([[0, true], [1, true], [1, false]] as const)(
    'checks Pointer Lock before silently returning (buttons: %s, same Document: %s)', (buttons, sameDocument) => {
      const { browser, stream, a, b, hasLockedElement } = createFixture();
      stream.activeDocument = sameDocument ? unwrap<DocumentImpl>(browser.document) : createChildDocument(browser);
      stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
      hasLockedElement.mockReturnValue(true);
      expect(() => stream.setPointerCapture(unwrap<ElementImpl>(b), buttons))
        .toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
      expect(hasLockedElement).toHaveBeenCalledWith(unwrap(browser.document));
      expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
    },
  );

  it.each([[0, true], [1, false]] as const)(
    'preserves pending capture on a silent return (buttons: %s, same Document: %s)', (buttons, sameDocument) => {
      const { browser, stream, a, b, hasLockedElement } = createFixture();
      stream.activeDocument = sameDocument ? unwrap<DocumentImpl>(browser.document) : createChildDocument(browser);
      stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
      stream.setPointerCapture(unwrap<ElementImpl>(b), buttons);
      expect(hasLockedElement).toHaveBeenCalledWith(unwrap(browser.document));
      expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
    },
  );

  it('propagates an unavailable Pointer Lock query without accepting the request', () => {
    const { browser, stream, a, b, hasLockedElement } = createFixture();
    stream.activeDocument = unwrap<DocumentImpl>(browser.document);
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    const unavailable = new Error('test Pointer Lock owner is unavailable');
    hasLockedElement.mockImplementation(() => { throw unavailable; });
    expect(() => stream.setPointerCapture(unwrap<ElementImpl>(b), 1)).toThrow(unavailable);
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
  });

  it('only releases the requesting element and defers loss notification', () => {
    const { stream, event, a, b, trace } = createFixture();
    stream.capture.pendingTargetOverride = unwrap<ElementImpl>(a);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(a));
    trace.length = 0;
    stream.releasePointerCapture(unwrap<ElementImpl>(b));
    expect(stream.capture.pendingTargetOverride).toBe(unwrap(a));
    stream.releasePointerCapture(unwrap<ElementImpl>(a));
    expect(stream.capture.pendingTargetOverride).toBeNull();
    expect(stream.capture.targetOverride).toBe(unwrap(a));
    expect(trace).toEqual([]);
    stream.prepareTarget('pointermove', event, () => unwrap<ElementImpl>(b));
    expect(trace).toEqual(['lostpointercapture:a']);
  });
});

/** Only geometry and Pointer Lock are supplied by tests; notifications use real DOM/Binding dispatch. */
function createFixture(isDirectManipulation = false) {
  const browser = new Browlet({ route: () => '' });
  const [a, b, c] = ['a', 'b', 'c'].map((id) => {
    const target = browser.document.createElement('div');
    target.id = id;
    browser.document.body!.appendChild(target);
    return target;
  });
  const hasLockedElement = vi.fn((_document: DocumentImpl) => false);
  const stream = new PointerEventStream(7, isDirectManipulation, !isDirectManipulation, hasLockedElement);
  const event = new PointerEventImpl('input-snapshot', { pointerId: 0, clientX: 12.5, detail: 9 });
  const trace: string[] = [];
  for (const type of ['gotpointercapture', 'lostpointercapture']) {
    browser.document.addEventListener(type, (event) => {
      const target = event.target === a ? 'a' : event.target === b ? 'b' : event.target === c ? 'c' : '#document';
      trace.push(`${event.type}:${target}`);
    });
  }
  return { browser, stream, event, a: a!, b: b!, c: c!, trace, hasLockedElement };
}

/** Connect normalized source actions to real realm-owned dispatch; no native input adapter is claimed. */
function createButtonFixture(pointerType: string, isDirectManipulation = false) {
  const fixture = createFixture(isDirectManipulation);
  const document = unwrap<DocumentImpl>(fixture.browser.document);
  const target = unwrap<ElementImpl>(fixture.a);
  const pointer = document.env.userAgent.activePointers.activate(pointerType);
  const sendButton = (button: PointerButton, pressed: boolean) => {
    const change = pointer.changeButton(button, pressed);
    if (change === null) return null;
    const event = target.createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.button = change.button;
    event.buttons = change.buttons;
    event.pointerType = pointer.pointerType;
    event.isPrimary = pointer.isPrimary;
    const selected = fixture.stream.prepareTarget(change.type, event, () => target);
    const accepted = fixture.stream.dispatchToTarget(event, selected, () => null, 1);
    return { event, accepted };
  };
  return { ...fixture, pointer, sendButton };
}

function createChildDocument(browser: Browlet): DocumentImpl {
  const parent = unwrap<DocumentImpl>(browser.document);
  const container = parent.createElement('iframe') as HTMLIFrameElementImpl;
  parent.body!.appendChild(container);
  const [, child] = BrowsingContext.createTopLevel(parent.env.userAgent);
  // Child creation is unfinished; connect real implementations at the retained association.
  container.contentNavigable = new Navigable(createDocumentState(child), parent.getNodeNavigable());
  return child;
}
