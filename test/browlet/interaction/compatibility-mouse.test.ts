import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { Element, EventTarget, MouseEvent } from '../../../src/browlet/platform';
import type { DocumentImpl, ElementImpl, NodeImpl } from '../../../src/browlet/dom/nodes/index';
import { PointerEventStream } from '../../../src/browlet/interaction/index';
import { PointerEventImpl, type PointerEventInit, type PointerInputEventType } from '../../../src/browlet/interaction/events/index';
import { unwrap } from '../../support/browlet-binding';

describe('Pointer Events §§10.2–10.3: compatibility mouse mapping', () => {
  it('interleaves hover movement and button events without using pointer detail for click count', () => {
    const { send, a, trace } = createFixture();
    send('pointermove', a);
    expect(trace).toEqual(['pointerover:a', 'mouseover:a', 'pointermove:a', 'mousemove:a']);
    trace.length = 0;
    const down = send('pointerdown', a, {}, 2);
    send('pointermove', a, { buttons: 1 });
    send('pointerup', a, {}, 2);
    expect(trace).toEqual(['pointerdown:a', 'mousedown:a', 'pointermove:a', 'mousemove:a', 'pointerup:a', 'mouseup:a']);
    expect(down.event.detail).toBe(0);
  });

  it('uses immediate non-hover mapping before entry and exits only after mouseup', () => {
    const { send, a, trace } = createFixture(false);
    send('pointerdown', a);
    send('pointerup', a);
    expect(trace).toEqual(['mousemove:a', 'pointerover:a', 'mouseover:a', 'pointerdown:a', 'mousedown:a',
      'gotpointercapture:a', 'pointerup:a', 'mouseup:a', 'lostpointercapture:a', 'pointerout:a', 'mouseout:a']);
  });

  it('treats hover and direct-manipulation capability independently for a hovering pen', () => {
    const { send, a, trace } = createFixture(true, true, 'pen');
    send('pointerdown', a);
    expect(trace).toEqual(['pointerover:a', 'mouseover:a', 'pointerdown:a', 'mousedown:a']);
    send('pointerup', a);
    expect(trace.at(-1)).toBe('lostpointercapture:a');
    trace.length = 0;
    send('pointermove', a);
    expect(trace).toEqual(['pointermove:a', 'mousemove:a']);
  });

  it('suppresses down/move/up after a canceled primary down, but keeps boundaries and click independent', () => {
    const { send, a, b, stream, trace } = createFixture();
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    expect(send('pointerdown', a).accepted).toBe(false);
    expect(trace).toEqual(['pointerover:a', 'mouseover:a', 'pointerdown:a']);
    trace.length = 0;
    send('pointermove', b, { buttons: 1 });
    send('pointerup', b);
    stream.dispatchActivation('click', 1);
    expect(trace).toEqual(['pointerout:a', 'pointerover:b', 'mouseout:a', 'mouseover:b',
      'pointermove:b', 'pointerup:b', 'click:parent']);
    trace.length = 0;
    send('pointermove', b);
    expect(trace).toEqual(['pointermove:b', 'mousemove:b']);
  });

  it('still sends the initial non-hover mousemove when the subsequent down is canceled', () => {
    const { send, a, trace } = createFixture(false);
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    send('pointerdown', a);
    send('pointerup', a);
    expect(trace).toEqual(['mousemove:a', 'pointerover:a', 'mouseover:a', 'pointerdown:a',
      'gotpointercapture:a', 'pointerup:a', 'lostpointercapture:a', 'pointerout:a', 'mouseout:a']);
  });

  it('does not let a passive pointer listener suppress mouse delivery', () => {
    const { send, a, trace } = createFixture();
    a.addEventListener('pointerdown', (event) => event.preventDefault(), { passive: true });
    expect(send('pointerdown', a).accepted).toBe(true);
    expect(trace.at(-1)).toBe('mousedown:a');
  });

  it.each(['pointermove', 'pointerup'] as const)('does not establish suppression by canceling %s', (type) => {
    const { send, a, trace } = createFixture();
    send('pointerdown', a);
    trace.length = 0;
    a.addEventListener(type, (event) => event.preventDefault());
    expect(send(type, a).accepted).toBe(false);
    expect(trace).toEqual([`${type}:a`, `${type === 'pointermove' ? 'mousemove' : 'mouseup'}:a`]);
  });

  it('keeps mouse cancellation separate from the pointer result and later mapping', () => {
    const { send, a, trace } = createFixture();
    a.addEventListener('mousedown', (event) => event.preventDefault());
    expect(send('pointerdown', a).accepted).toBe(true);
    trace.length = 0;
    send('pointerup', a);
    expect(trace).toEqual(['pointerup:a', 'mouseup:a']);
  });

  it('does not share suppression between pointer types in the same Document', () => {
    const { send, a, b, trace } = createFixture();
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    send('pointerdown', a, { pointerType: 'mouse' });
    trace.length = 0;
    send('pointerdown', b, { pointerType: 'pen', pointerId: 8 });
    expect(trace.at(-1)).toBe('mousedown:b');
    trace.length = 0;
    send('pointermove', a, { pointerType: 'mouse', buttons: 1 });
    expect(trace.at(-1)).toBe('pointermove:a');
    expect(trace).not.toContain('mousemove:a');
  });

  it('shares suppression between streams of the same type, independently of their IDs', () => {
    const fixture = createFixture();
    const { send, a, b, trace } = fixture;
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    send('pointerdown', a);
    trace.length = 0;
    const otherStream = new PointerEventStream(8, false, true, () => false);
    send('pointermove', b, { buttons: 1 }, 0, b, otherStream);
    expect(trace.at(-1)).toBe('pointermove:b');
    expect(trace).not.toContain('mousemove:b');
  });

  it('does not let nonprimary input produce mouse events or clear a primary suppression flag', () => {
    const { send, a, b, trace, document } = createFixture();
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    send('pointerdown', a);
    trace.length = 0;
    send('pointerup', b, { isPrimary: false });
    expect(trace.every((type) => !type.startsWith('mouse'))).toBe(true);
    expect(document.legacyMouse.target).toBe(unwrap(a));
    trace.length = 0;
    send('pointermove', a, { buttons: 1 });
    expect(trace).not.toContain('mousemove:a');
  });

  it('clears stale suppression on hover if a release happened outside the context', () => {
    const { send, a, trace } = createFixture();
    a.addEventListener('pointerdown', (event) => event.preventDefault());
    send('pointerdown', a);
    trace.length = 0;
    send('pointermove', a, { buttons: 0 });
    expect(trace).toEqual(['pointermove:a', 'mousemove:a']);
  });

  it('maps chorded presses and releases, including the transposed middle/right button masks', () => {
    const { send, a, trace, received } = createFixture();
    send('pointerdown', a);
    trace.length = received.length = 0;
    send('pointermove', a, { button: 1, buttons: 5 }, 2);
    send('pointermove', a, { button: 2, buttons: 7 }, 3);
    send('pointermove', a, { button: 1, buttons: 3 }, 2);
    send('pointermove', a, { button: 2, buttons: 1 }, 3);
    expect(trace).toEqual(['pointermove:a', 'mousedown:a', 'pointermove:a', 'mousedown:a',
      'pointermove:a', 'mouseup:a', 'pointermove:a', 'mouseup:a']);
    expect(received.filter((event) => event.type.startsWith('mouse')).map((event) => [event.button, event.buttons, event.detail]))
      .toEqual([[1, 5, 2], [2, 7, 3], [1, 3, 2], [2, 1, 3]]);
  });

  it('creates trusted realm-owned mouse data without leaking pointer-specific fields or movement into button events', () => {
    const { browser, send, a, received } = createFixture();
    send('pointerdown', a, {
      screenX: -2.25, clientX: 12.75, buttons: 1,
      movementX: 7, movementY: -3, ctrlKey: true, modifierCapsLock: true,
    }, 4);
    const down = received.find((event) => event.type === 'mousedown')!;
    expect(down).toBeInstanceOf(browser.window.MouseEvent);
    expect(down).not.toBeInstanceOf(browser.window.PointerEvent);
    expect([down.isTrusted, down.bubbles, down.cancelable, down.composed]).toEqual([true, true, true, true]);
    expect([down.screenX, down.clientX, down.detail, down.button, down.buttons, down.movementX, down.movementY])
      .toEqual([-3, 12, 4, 0, 1, 0, 0]);
    expect(down.relatedTarget).toBeNull();
    expect(down.view).toBe(browser.window);
    expect(down.timeStamp).toBe(123);
    expect([down.ctrlKey, down.getModifierState('CapsLock')]).toEqual([true, true]);
    received.length = 0;
    send('pointermove', a, { movementX: 2.5, movementY: -1.5 });
    const move = received.find((event) => event.type === 'mousemove')!;
    expect([move.button, move.detail, move.movementX, move.movementY]).toEqual([0, 0, 2.5, -1.5]);
  });

  it.each([false, true])('maps a removed pointer target to its ancestor (reinsert: %s)', (reinsert) => {
    const { send, a, parent, trace } = createFixture();
    a.addEventListener('pointerdown', () => { a.remove(); if (reinsert) parent.append(a); });
    send('pointerdown', a);
    expect(trace.at(-1)).toBe('mousedown:parent');
  });

  it('repairs the selected target when pointerover removes it before pointerdown', () => {
    const { send, a, trace } = createFixture();
    a.addEventListener('pointerover', () => a.remove(), { once: true });
    send('pointerdown', a);
    expect(trace.at(-1)).toBe('mousedown:parent');
  });

  it('uses removal-time ancestry after a pointer listener moves and removes the target', () => {
    const { send, a, b, trace } = createFixture();
    a.addEventListener('pointerdown', () => { b.moveBefore(a, null); a.remove(); });
    send('pointerdown', a);
    expect(trace.at(-1)).toBe('mousedown:b');
  });

  it('sends a cancellation mouseup to Window before capture loss and boundaries', () => {
    const { send, a, stream, trace, received, browser } = createFixture(false);
    send('pointerdown', a);
    trace.length = received.length = 0;
    stream.suppress(() => unwrap<NodeImpl>(a));
    expect(trace).toEqual(['gotpointercapture:a', 'pointercancel:a', 'mouseup:window',
      'lostpointercapture:a', 'pointerout:a', 'mouseout:a']);
    const up = received.find((event) => event.type === 'mouseup')!;
    expect(up.target).toBe(browser.window);
    expect(up.detail).toBe(0);
  });

  it('suppresses the cancellation mouseup but clears the flag for the next contact', () => {
    const { send, a, stream, trace } = createFixture(false);
    a.addEventListener('pointerdown', (event) => event.preventDefault(), { once: true });
    send('pointerdown', a);
    trace.length = 0;
    stream.suppress(() => unwrap<NodeImpl>(a));
    expect(trace).not.toContain('mouseup:window');
    trace.length = 0;
    send('pointerdown', a);
    expect(trace.at(-1)).toBe('mousedown:a');
  });

  it('maps captured up to the capture target before restoring hover boundaries', () => {
    const { send, a, b, stream, trace } = createFixture();
    send('pointerdown', a);
    stream.setPointerCapture(unwrap<ElementImpl>(a), 1);
    send('pointermove', b, { buttons: 1 });
    trace.length = 0;
    send('pointerup', b);
    expect(trace).toEqual(['pointerup:a', 'mouseup:a', 'lostpointercapture:a',
      'pointerout:a', 'pointerover:b', 'mouseout:a', 'mouseover:b']);
  });

  it('does not generate mapped motion for raw updates', async () => {
    const { browser, send, a, trace } = createFixture();
    await browser.navigate('https://pointer.test/');
    const target = browser.document.createElement('div');
    browser.document.body!.append(target);
    const raw: string[] = [];
    target.addEventListener('pointerrawupdate', (event) => raw.push(event.type));
    target.addEventListener('mousemove', (event) => raw.push(event.type));
    send('pointerrawupdate', target);
    expect(raw).toEqual(['pointerrawupdate']);
    // An ordinary author-created move has no route to this internal mapping.
    a.dispatchEvent(new browser.window.PointerEvent('pointermove', { isPrimary: true }));
    expect(trace).not.toContain('mousemove:a');
  });

  it('updates mouse boundaries after layout without sending an ordinary mousemove', () => {
    const { send, a, b, stream, trace } = createFixture();
    send('pointermove', a);
    trace.length = 0;
    stream.updateAfterLayout(() => unwrap<NodeImpl>(b), 150);
    expect(trace).toEqual(['pointerout:a', 'pointerover:b', 'mouseout:a', 'mouseover:b']);
    trace.length = 0;
    stream.updateAfterLayout(() => null, 151);
    expect(trace).toEqual(['pointerout:b', 'mouseout:b']);
  });

  it('keeps different Documents suppression state independent', () => {
    const first = createFixture();
    const second = createFixture();
    first.a.addEventListener('pointerdown', (event) => event.preventDefault());
    first.send('pointerdown', first.a);
    second.send('pointerdown', second.a);
    expect(second.trace.at(-1)).toBe('mousedown:a');
  });
});

/** Real bindings/dispatch; the test supplies normalized input, device capability, hit testing and click count. */
function createFixture(supportsHover = true, isDirectManipulation = !supportsHover, pointerType = supportsHover ? 'mouse' : 'touch') {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  const stream = new PointerEventStream(7, isDirectManipulation, supportsHover, () => false);
  const trace: string[] = [];
  const received: MouseEvent[] = [];
  const observe = (target: EventTarget, label: string) => {
    for (const type of ['pointerover', 'pointerout', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
      'gotpointercapture', 'lostpointercapture', 'mouseover', 'mouseout', 'mousedown', 'mousemove', 'mouseup', 'click']) {
      target.addEventListener(type, (event) => {
        if (event.target !== target) return;
        trace.push(`${type}:${label}`);
        received.push(event as MouseEvent);
      });
    }
  };
  const parent = browser.document.createElement('div');
  const a = browser.document.createElement('div');
  const b = browser.document.createElement('div');
  browser.document.body!.append(parent);
  parent.append(a, b);
  observe(browser.window, 'window');
  observe(parent, 'parent');
  observe(a, 'a');
  observe(b, 'b');
  const send = (
    type: PointerInputEventType, hit: Element, init: PointerEventInit = {}, clickCount = 1,
    hoverTarget: Element | null = supportsHover ? hit : null, inputStream = stream,
  ) => {
    const event = unwrap<NodeImpl>(hit).createTrustedEvent(PointerEventImpl) as PointerEventImpl;
    event.copyInputFrom(new PointerEventImpl(type, {
      pointerType, isPrimary: true, button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
      buttons: type === 'pointerdown' ? 1 : 0, ...init,
    }, 123));
    const selected = inputStream.prepareTarget(type, event, () => unwrap<NodeImpl>(hit));
    const accepted = inputStream.dispatchToTarget(event, selected,
      () => hoverTarget === null ? null : unwrap<NodeImpl>(hoverTarget), clickCount,
    );
    return { event, accepted };
  };
  return { browser, document, stream, send, a, b, parent, trace, received };
}
